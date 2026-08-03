-- =====================================================================
-- M12 — Deals and the Evidence Ledger.
--
-- Expand-only. Rollback: 0010_deals.down.sql
-- Depends on 0002_vehicles, 0006_finance, 0007_contacts, 0009_money.
--
-- ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED FCA COMPLIANCE CONSULTANT'S SIGN-OFF.
--
-- This is the module the strategy documents call the moat, and the reason is
-- narrow: after *Hopcraft* and the redress scheme, the question a lender or an
-- ombudsman asks a dealer is not "did you disclose the commission?" but "show
-- me what the customer saw, on the day, in the order they saw it". A dealer
-- who can produce that in ten seconds has a defence. One who cannot is
-- assessed on the assumption they did not.
--
-- Three things follow from that, and they shape every table below:
--
--   1. The ledger is HASH-CHAINED. Each entry carries the hash of the one
--      before it, so removing or editing an entry breaks every hash after it.
--      Append-only prevents casual mutation; the chain makes tampering
--      *provable*, which is what turns a database table into evidence.
--
--   2. Contract formation is a MANDATORY structured field, not a note. It
--      decides whether a 14-day cancellation right exists at all, and an
--      online enquiry followed by a showroom signature is an on-premises sale
--      with no such right. Getting it wrong is expensive in both directions.
--
--   3. Add-ons are never pre-ticked, and each carries its own demands-and-needs
--      statement. PRIN 2A treats a bundled add-on nobody chose as a fair-value
--      failure, and "the box was already ticked" is the finding.
-- =====================================================================

BEGIN;

CREATE TYPE deal_state AS ENUM (
  'building', 'quoted', 'agreed', 'contracted', 'delivered', 'completed', 'cancelled', 'unwound'
);

-- Where the contract was FORMED — not where the enquiry started. An online
-- enquiry that ends with a signature in the showroom is `on_premises`.
CREATE TYPE contract_formation AS ENUM ('on_premises', 'distance', 'off_premises');

-- The kinds of evidence the ledger holds. Named individually rather than as
-- free text because the export bundle groups by them, and because a missing
-- kind is a gap someone can be asked about.
CREATE TYPE evidence_kind AS ENUM (
  'initial_disclosure', 'quote_presented', 'quote_selected', 'commission_disclosure',
  'demands_and_needs', 'affordability', 'adequate_explanation', 'vulnerability_screen',
  'fair_value_confirmation', 'addon_offered', 'addon_accepted', 'addon_declined',
  'document_shown', 'document_signed', 'contract_formed', 'delivery',
  'cancellation_requested', 'rejection_requested', 'repair_attempt', 'note'
);

CREATE TYPE signature_method AS ENUM ('wet', 'e_signature', 'in_person_device');

-- --------------------------------------------------------------- deals
CREATE TABLE deals (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  site_id             uuid REFERENCES sites(id),

  contact_id          uuid NOT NULL REFERENCES contacts(id),
  vehicle_id          uuid REFERENCES vehicles(id),
  lead_id             uuid REFERENCES leads(id),

  state               deal_state NOT NULL DEFAULT 'building',
  reference           text,

  -- THE field. Mandatory before a deal can be contracted, enforced below.
  contract_formation  contract_formation,

  -- Money, in integer minor units. The margin panel derives from these plus
  -- M11's vehicle costs; nothing here is computed in a browser.
  currency            text NOT NULL DEFAULT 'GBP',
  vehicle_price_pence     bigint,
  part_exchange_pence     bigint NOT NULL DEFAULT 0,
  part_exchange_settlement_pence bigint NOT NULL DEFAULT 0,
  deposit_pence           bigint NOT NULL DEFAULT 0,
  finance_amount_pence    bigint NOT NULL DEFAULT 0,
  addons_total_pence      bigint NOT NULL DEFAULT 0,

  -- The finance quote actually taken, if any. M8 owns the quote itself.
  finance_quote_id    uuid REFERENCES vehicle_finance_quotes(id),

  -- Dates that start the statutory clocks. `contracted_at` is the CCR trigger
  -- for a distance sale; `delivered_at` starts both CRA clocks.
  quoted_at           timestamptz,
  contracted_at       timestamptz,
  delivered_at        timestamptz,
  completed_at        timestamptz,

  cancelled_at        timestamptz,
  cancellation_reason text,

  -- The sale invoice, once raised. M11 owns the document.
  invoice_id          uuid REFERENCES invoices(id),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_by          uuid REFERENCES users(id),

  -- A contracted deal must record HOW it was contracted. Without it the CCR
  -- cancellation right cannot be computed, and the safe default (assume the
  -- right exists) is not something to leave to chance on every deal.
  CONSTRAINT deal_contracted_needs_formation CHECK (
    state IN ('building', 'quoted', 'agreed', 'cancelled') OR contract_formation IS NOT NULL
  ),
  CONSTRAINT deal_contracted_has_timestamp CHECK (
    state IN ('building', 'quoted', 'agreed', 'cancelled') OR contracted_at IS NOT NULL
  ),
  CONSTRAINT deal_delivered_has_timestamp CHECK (
    state NOT IN ('delivered', 'completed') OR delivered_at IS NOT NULL
  ),
  CONSTRAINT deal_cancelled_has_reason CHECK (
    state <> 'cancelled' OR cancellation_reason IS NOT NULL
  ),
  CONSTRAINT deal_money_non_negative CHECK (
    coalesce(vehicle_price_pence, 0) >= 0
    AND part_exchange_pence >= 0 AND part_exchange_settlement_pence >= 0
    AND deposit_pence >= 0 AND finance_amount_pence >= 0 AND addons_total_pence >= 0
  )
);
CREATE INDEX deals_tenant_state_idx    ON deals (tenant_id, state, created_at DESC);
CREATE INDEX deals_tenant_contact_idx  ON deals (tenant_id, contact_id);
CREATE INDEX deals_tenant_vehicle_idx  ON deals (tenant_id, vehicle_id);
-- The clocks board: delivered deals still inside a statutory window.
CREATE INDEX deals_clocks_idx ON deals (tenant_id, delivered_at)
  WHERE delivered_at IS NOT NULL AND state <> 'cancelled';

-- ------------------------------------------------------------- add-ons
--
-- Each add-on is its own product sale with its own demands-and-needs
-- statement and its own fair-value reference. Never pre-ticked: `offered_at`
-- and `accepted_at` are separate, and a row with an acceptance but no offer is
-- refused, because that is exactly what a pre-ticked box looks like in data.
CREATE TABLE deal_addons (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  deal_id             uuid NOT NULL REFERENCES deals(id),

  product_code        text NOT NULL,
  product_name        text NOT NULL,
  price_pence         bigint NOT NULL,
  cost_pence          bigint,

  -- PRIN 2A: a separate statement per product, not one covering the bundle.
  demands_and_needs   text,
  fair_value_reference text,

  offered_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  declined_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),

  CONSTRAINT addon_price_non_negative CHECK (price_pence >= 0),
  -- An add-on cannot be accepted before it was offered. This is the data
  -- shape of a pre-ticked box, and it is refused.
  CONSTRAINT addon_accepted_after_offered CHECK (
    accepted_at IS NULL OR accepted_at >= offered_at
  ),
  CONSTRAINT addon_not_both_accepted_and_declined CHECK (
    accepted_at IS NULL OR declined_at IS NULL
  ),
  -- An accepted add-on must carry its own demands-and-needs statement.
  CONSTRAINT addon_accepted_needs_statement CHECK (
    accepted_at IS NULL OR demands_and_needs IS NOT NULL
  )
);
CREATE INDEX deal_addons_deal_idx ON deal_addons (tenant_id, deal_id);

-- ------------------------------------------------- THE EVIDENCE LEDGER
--
-- Append-only AND hash-chained. Append-only stops casual mutation; the chain
-- makes tampering provable — remove or edit one entry and every hash after it
-- fails to verify.
--
-- `sequence` is per DEAL rather than per tenant: a deal's chain must be
-- verifiable on its own, because that is the unit that gets exported and sent
-- to an ombudsman.
CREATE TABLE deal_evidence (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  deal_id         uuid NOT NULL REFERENCES deals(id),

  sequence        integer NOT NULL,
  kind            evidence_kind NOT NULL,

  -- What was shown or done, as structured data. Deliberately jsonb: the shape
  -- differs per kind, and forcing it into columns would mean a migration every
  -- time the FCA adds a disclosure requirement.
  payload         jsonb NOT NULL,

  -- The exact document version the customer saw. A disclosure nobody can
  -- reproduce is not evidence, which is the finding at the centre of the
  -- post-Hopcraft liability.
  document_version text,
  wording_version  integer,

  -- The chain. `entry_hash` covers this row's content AND `previous_hash`.
  previous_hash   text,
  entry_hash      text NOT NULL,

  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES users(id),

  CONSTRAINT evidence_sequence_positive CHECK (sequence > 0),
  CONSTRAINT evidence_hash_not_blank CHECK (length(btrim(entry_hash)) > 0)
);
-- One entry per position per deal — the chain cannot fork.
CREATE UNIQUE INDEX deal_evidence_deal_sequence_unique
  ON deal_evidence (tenant_id, deal_id, sequence);
CREATE INDEX deal_evidence_deal_idx ON deal_evidence (tenant_id, deal_id, sequence);
CREATE INDEX deal_evidence_kind_idx ON deal_evidence (tenant_id, kind, occurred_at DESC);

-- ------------------------------------------------------------ documents
--
-- Templates with version control. The version shown is recorded on the
-- evidence entry, so "which terms did this customer actually agree to?" has an
-- answer years later even after the template has moved on.
CREATE TABLE document_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),

  code            text NOT NULL,
  name            text NOT NULL,
  version         integer NOT NULL,
  body_markdown   text NOT NULL,

  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  CONSTRAINT document_template_body_not_blank CHECK (length(btrim(body_markdown)) > 0)
);
CREATE UNIQUE INDEX document_templates_tenant_code_version_unique
  ON document_templates (tenant_id, code, version);

CREATE TABLE deal_documents (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  deal_id         uuid NOT NULL REFERENCES deals(id),

  template_id     uuid REFERENCES document_templates(id),
  code            text NOT NULL,
  version         integer NOT NULL,

  -- The rendered document as the customer saw it, and its hash. Storing the
  -- rendered form matters: re-rendering from a template years later gives you
  -- today's template, not the one they signed.
  rendered_body   text NOT NULL,
  content_hash    text NOT NULL,

  shown_at        timestamptz,
  signed_at       timestamptz,
  signature_method signature_method,
  signer_name     text,
  signer_ip       inet,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_document_signed_has_method CHECK (
    signed_at IS NULL OR signature_method IS NOT NULL
  ),
  CONSTRAINT deal_document_signed_has_name CHECK (
    signed_at IS NULL OR signer_name IS NOT NULL
  )
);
CREATE INDEX deal_documents_deal_idx ON deal_documents (tenant_id, deal_id);

-- ------------------------------------------------------ repair attempts
--
-- Each repair PAUSES the 30-day right to reject, and on resumption at least
-- seven days must remain (CRA s.22(6)–(7)). The clock maths lives in
-- `packages/domain/src/clocks.ts`; this is where the attempts are recorded.
CREATE TABLE deal_repair_attempts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  deal_id       uuid NOT NULL REFERENCES deals(id),

  fault_reported text NOT NULL,
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  outcome       text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT repair_completed_after_started CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);
CREATE INDEX deal_repair_attempts_deal_idx ON deal_repair_attempts (tenant_id, deal_id, started_at);

-- --------------------------------------------------------- append-only
--
-- The ledger and the documents are evidence. The repair attempts are too:
-- they move a statutory deadline, so an edited start date moves a customer's
-- rights.
SELECT make_append_only('deal_evidence');
SELECT make_append_only('deal_documents');
SELECT make_append_only('deal_addons');

-- A repair attempt is NOT blanket append-only, because it has one lawful
-- update: an open repair gets completed. Everything else about it is frozen —
-- the start date moves a statutory deadline, so back-dating it would shorten a
-- customer's right to reject.
CREATE OR REPLACE FUNCTION freeze_repair_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'A repair attempt cannot be deleted — it moved the customer''s right-to-reject deadline.';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.fault_reported IS DISTINCT FROM OLD.fault_reported
     OR NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    RAISE EXCEPTION
      'The start date and reported fault of a repair attempt are fixed. They set a statutory deadline.';
  END IF;
  IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'A completed repair cannot be re-dated.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER freeze_repair
  BEFORE UPDATE OR DELETE ON deal_repair_attempts
  FOR EACH ROW EXECUTE FUNCTION freeze_repair_attempt();

SELECT * FROM apply_tenant_policies();

COMMIT;
