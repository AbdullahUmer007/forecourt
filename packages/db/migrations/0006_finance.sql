-- =====================================================================
-- M8 — Finance display & compliance
--
-- Expand-only. Rollback: 0006_finance.down.sql
-- Depends on 0001_tenancy.sql and 0002_vehicles.sql.
--
-- ⚠️  NOTHING IN THIS MIGRATION MAY BE ENABLED ON A LIVE DEALER SITE UNTIL
--     THE RETAINED FCA COMPLIANCE CONSULTANT HAS SIGNED OFF compliance_rules
--     ROW 'conc.representative_example' v1. The application refuses to render
--     a promotion against an unsigned rule, so this is enforced, not advisory.
-- =====================================================================

BEGIN;

CREATE TYPE finance_product_type AS ENUM ('hp', 'pcp', 'personal_loan', 'lease_purchase');
CREATE TYPE commission_type AS ENUM
  ('flat', 'percentage_of_credit', 'volume_bonus', 'difference_in_charges', 'none');

-- ---------------------------------------------------------------- rules
--
-- `compliance_rules` already exists — M1 created it and seeded five rules,
-- including `conc.representative_example` v1. M8 extends it rather than
-- recreating it, because those rows are a record of what we believed the law
-- required on a given date and must survive.
--
-- Expand-only: two nullable columns and a CHECK. No back-fill, no rewrite.
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS signed_off_by text;
ALTER TABLE compliance_rules ADD COLUMN IF NOT EXISTS signed_off_at timestamptz;

DO $$ BEGIN
  ALTER TABLE compliance_rules ADD CONSTRAINT compliance_rule_signoff_complete CHECK (
    (signed_off_by IS NULL AND signed_off_at IS NULL) OR
    (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rules are evidence of what we believed the law required on a given date, so
-- a rule is superseded by inserting a higher version — never by editing one.
SELECT make_append_only('compliance_rules');

-- ---------------------------------------------------------------- lenders
CREATE TABLE finance_products (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  site_id            uuid REFERENCES sites(id),

  lender_name        text NOT NULL,
  lender_frn         text,
  provider           text NOT NULL,          -- ivendi, codeweavers, direct
  product_type       finance_product_type NOT NULL,
  display_name       text NOT NULL,

  min_term_months    integer NOT NULL DEFAULT 12,
  max_term_months    integer NOT NULL DEFAULT 60,
  min_advance_pence  bigint NOT NULL DEFAULT 0,
  min_credit_pence   bigint NOT NULL DEFAULT 0,
  max_credit_pence   bigint,

  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT finance_product_term_range CHECK (max_term_months >= min_term_months AND min_term_months > 0)
);
CREATE INDEX finance_products_tenant_idx ON finance_products (tenant_id, active);

-- ---------------------------------------------------------------- the example
--
-- Append-only and versioned. A representative example that was live on a page
-- in March is what we advertised in March, and no later edit may rewrite that.
-- Superseding one means inserting a new version and closing the old window.
CREATE TABLE representative_examples (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  site_id               uuid REFERENCES sites(id),
  version               integer NOT NULL,
  product_type          finance_product_type NOT NULL,

  cash_price_pence      bigint NOT NULL,
  advance_payment_pence bigint NOT NULL,
  amount_of_credit_pence bigint NOT NULL,
  term_months           integer NOT NULL,
  monthly_payment_pence bigint NOT NULL,
  final_payment_pence   bigint,
  other_charges         jsonb NOT NULL DEFAULT '[]'::jsonb,

  interest_rate_percent numeric(6,3) NOT NULL,
  interest_rate_fixed   boolean NOT NULL DEFAULT true,
  representative_apr_percent numeric(6,3) NOT NULL,
  total_amount_payable_pence bigint NOT NULL,

  -- Which rule version this example was built to satisfy. When CONC changes,
  -- this is how we know which examples need rebuilding rather than guessing.
  rule_id               uuid REFERENCES compliance_rules(id),

  approved_by           text,
  approved_at           timestamptz,
  effective_from        timestamptz NOT NULL DEFAULT now(),
  effective_to          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rep_example_positive CHECK (
    cash_price_pence > 0 AND amount_of_credit_pence > 0 AND
    monthly_payment_pence > 0 AND term_months > 0 AND advance_payment_pence >= 0
  ),
  CONSTRAINT rep_example_credit_reconciles CHECK (
    amount_of_credit_pence = cash_price_pence - advance_payment_pence
  ),
  CONSTRAINT rep_example_approval_complete CHECK (
    (approved_by IS NULL AND approved_at IS NULL) OR
    (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT rep_example_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX rep_examples_version_unique ON representative_examples (tenant_id, product_type, version);
CREATE INDEX rep_examples_live_idx ON representative_examples (tenant_id, effective_from DESC)
  WHERE approved_at IS NOT NULL;

SELECT make_append_only('representative_examples');

-- ---------------------------------------------------------------- quotes
--
-- Indicative payments, precomputed nightly so the search grid and the vehicle
-- page never call a lender in a request handler (rule 8). Every figure here
-- came FROM the provider — we store and display, we do not derive. What we do
-- derive is the verification: `verified_at` is set only once the cashflows
-- reconcile, and nothing unverified may be displayed.
CREATE TABLE vehicle_finance_quotes (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  site_id               uuid REFERENCES sites(id),
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  finance_product_id    uuid REFERENCES finance_products(id),

  provider              text NOT NULL,
  provider_quote_ref    text,
  lender_name           text NOT NULL,
  product_type          finance_product_type NOT NULL,

  cash_price_pence      bigint NOT NULL,
  deposit_pence         bigint NOT NULL,
  part_exchange_pence   bigint NOT NULL DEFAULT 0,
  amount_of_credit_pence bigint NOT NULL,
  term_months           integer NOT NULL,
  monthly_payment_pence bigint NOT NULL,
  final_payment_pence   bigint,
  fees                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  apr_percent           numeric(6,3) NOT NULL,
  flat_rate_percent     numeric(6,3),
  fixed_rate            boolean NOT NULL DEFAULT true,
  total_charge_for_credit_pence bigint NOT NULL,
  total_amount_payable_pence    bigint NOT NULL,

  annual_mileage        integer,
  excess_pence_per_mile integer,

  -- Verification. A quote that fails its own arithmetic must never be shown:
  -- the moment we render it, the lender's error is our financial promotion.
  verified_at           timestamptz,
  verification_problems jsonb NOT NULL DEFAULT '[]'::jsonb,

  quoted_at             timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quote_positive CHECK (
    monthly_payment_pence > 0 AND term_months > 0 AND amount_of_credit_pence > 0
  ),
  CONSTRAINT quote_expiry_after_issue CHECK (expires_at > quoted_at),
  CONSTRAINT quote_credit_reconciles CHECK (
    amount_of_credit_pence = cash_price_pence - deposit_pence - part_exchange_pence
  )
);
CREATE UNIQUE INDEX vfq_current_unique
  ON vehicle_finance_quotes (tenant_id, vehicle_id, product_type, term_months, deposit_pence, quoted_at);
CREATE INDEX vfq_displayable_idx ON vehicle_finance_quotes (tenant_id, vehicle_id, expires_at)
  WHERE verified_at IS NOT NULL;
-- The monthly-payment search facet reads this, and only this.
CREATE INDEX vfq_payment_facet_idx ON vehicle_finance_quotes (tenant_id, monthly_payment_pence)
  WHERE verified_at IS NOT NULL;

-- ---------------------------------------------------------------- disclosure
--
-- The initial disclosure is a PAGE, versioned, with the wording that was live
-- on each date. CONC 4 requires it before any finance discussion, and "what
-- did your website say in April" is a question we must be able to answer.
CREATE TABLE initial_disclosure_versions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  version            integer NOT NULL,
  body_markdown      text NOT NULL,
  fca_frn            text,
  principal_name     text,
  principal_frn      text,
  lender_panel       jsonb NOT NULL DEFAULT '[]'::jsonb,
  commission_statement text NOT NULL,
  approved_by        text,
  approved_at        timestamptz,
  effective_from     timestamptz NOT NULL DEFAULT now(),
  effective_to       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idv_version_unique ON initial_disclosure_versions (tenant_id, version);

SELECT make_append_only('initial_disclosure_versions');

-- ---------------------------------------------------------------- evidence
--
-- Every time a cost-of-credit figure is put in front of a customer, we record
-- what was shown and which example legitimised it. This is what answers
-- "prove what your website displayed on 14 March" — the question the industry
-- is currently unable to answer, at a cost of about £9bn.
CREATE TABLE finance_promotion_log (
  id                 uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  site_id            uuid REFERENCES sites(id),

  page_path          text NOT NULL,
  vehicle_id         uuid REFERENCES vehicles(id),
  quote_id           uuid,
  representative_example_id uuid,
  rule_id            uuid,
  rule_version       integer,

  apr_percent        numeric(6,3),
  monthly_payment_pence bigint,
  rendered_hash      text NOT NULL,       -- hash of the exact markup shown

  occurred_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE finance_promotion_log_2026_08 PARTITION OF finance_promotion_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE finance_promotion_log_2026_09 PARTITION OF finance_promotion_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE INDEX fpl_tenant_time_idx ON finance_promotion_log (tenant_id, occurred_at DESC);

SELECT make_append_only('finance_promotion_log');

-- ---------------------------------------------------------------- seed
--
-- Version 2 of `conc.representative_example`, superseding M1's v1.
--
-- Two things were wrong with v1, both found while building the renderer:
--
--   1. The field list was not in the order CONC 3.5.5R prescribes, and the
--      order is part of the rule, not a presentation choice.
--   2. It split "rate is fixed" into its own field. The rule treats the rate
--      and whether it is fixed or variable as ONE item, and rendering them as
--      two rows makes the example longer and less clear than the rule intends.
--
-- v1 is left in place. It is the record of what we believed on 1 August, and
-- rewriting history in a compliance table is exactly what this table exists to
-- prevent. The resolver prefers the highest version whose window covers the
-- date, so v2 governs from now and v1 still explains any earlier decision.
--
-- Seeded UNSIGNED on purpose: the application refuses to render a promotion
-- against a rule with no sign-off, so this row is inert until the retained
-- compliance consultant approves it. That is the launch gate, and it cannot be
-- forgotten because nothing renders without it.
INSERT INTO compliance_rules (key, version, effective_from, parameters, source_url, notes, checked_at)
VALUES (
  'conc.representative_example', 2, '2026-08-02T00:00:00Z',
  '{
     "requiredFields": ["interestRate","otherCharges","amountOfCredit","representativeApr",
                        "cashPriceAndAdvance","duration","totalAmountPayable","repaymentAmount"],
     "prominentField": "representativeApr",
     "heading": "Representative Example",
     "representativeThreshold": 0.51,
     "maxAgeDays": 90
   }'::jsonb,
  'https://www.handbook.fca.org.uk/handbook/CONC/3/5.html',
  'CONC 3.5 as at 2 August 2026, in the order CONC 3.5.5R prescribes, with the rate and its fixed/variable '
  'nature as a single item. Supersedes v1, whose field list was unordered. UNDER REVIEW: FCA CP26/15 '
  '(opened 29 April 2026, closed 17 June 2026) asks whether the mandatory representative example supports '
  'consumer understanding and whether the 51% threshold remains appropriate; no policy statement had been '
  'published as at 2 August 2026, so the current rules stand. '
  'UNSIGNED — must be approved by the retained FCA compliance consultant before any promotion renders.',
  '2026-08-02'
);

SELECT * FROM apply_tenant_policies();

-- compliance_rules carries no tenant_id, so the policy generator skips it. It
-- is platform-owned reference data: every dealer reads the same law, and no
-- dealer may write it. Enforced rather than assumed — a tenant able to edit
-- its own representative-example rule could switch its own gate off.
ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rules FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_rules_readable ON compliance_rules;
CREATE POLICY compliance_rules_readable ON compliance_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS compliance_rules_no_tenant_writes ON compliance_rules;
CREATE POLICY compliance_rules_no_tenant_writes ON compliance_rules FOR INSERT WITH CHECK (false);

-- `apply_tenant_policies()` grants table privileges only to tables carrying a
-- tenant_id, so compliance_rules has had NO grant since M1 created it — the
-- application role could not read the VAT fraction, the AML threshold or the
-- CRA windows it is supposed to read them from. Nothing had exercised it yet.
-- Found by the isolation test written for this module.
GRANT SELECT ON compliance_rules TO app_user;
GRANT SELECT ON compliance_rules TO app_public;

COMMIT;
