-- =====================================================================
-- M13 — Part-exchange appraisal.
--
-- Expand-only. Rollback: 0011_appraisals.down.sql
-- Depends on 0002_vehicles (vehicles, cost_category), 0007_contacts,
--            0008_leads, 0010_deals.
--
-- The part-exchange is where a used-car deal is won or quietly lost. The sale
-- car's price is published and negotiated in public; the part-exchange number
-- is invented at the kerbside in four minutes by someone holding a phone in
-- the rain, and it is the figure that decides whether the deal happens and
-- whether it made any money.
--
-- Four things follow from that, and they shape every table below:
--
--   1. AN OFFER IS EVIDENCE. "You said £4,500 on Saturday" is a conversation
--      that happens, and the dealer needs the record — the number, the moment,
--      who gave it, what it was based on and when it lapsed. `appraisal_offers`
--      is append-only and a revised offer is a NEW ROW with its own revision.
--      Nothing edits an offer that has already been given to a customer.
--
--   2. THE BREAKDOWN IS INTERNAL. The customer is told one number. The market
--      value, the recon estimate and the target margin behind it are cost data,
--      and the roles table says a sales executive has no cost prices unless
--      granted. They live in separate columns precisely so the API can drop
--      them, rather than in a blob that gets returned whole by accident.
--
--   3. A SETTLEMENT FIGURE HAS AN EXPIRY DATE AND A SOURCE. Money still owed
--      on the car being traded in has to reach the customer's lender, the
--      lender quotes it good only to a date, and a figure the customer stated
--      from memory is not a figure. A stale or unverified settlement is paid
--      out of the dealer's own margin, and they find out weeks later.
--
--   4. CONVERSION RE-KEYS NOTHING. Everything captured here is what the
--      vehicles table and the VAT stock book need. Typing it twice is how a
--      registration, a mileage or a purchase price ends up different in two
--      places, and the stock book is the one HMRC reads.
-- =====================================================================

BEGIN;

CREATE TYPE appraisal_state AS ENUM (
  'draft', 'appraised', 'offered', 'accepted', 'declined',
  'expired', 'converted', 'abandoned'
);

-- Who we are buying FROM. This decides the VAT scheme on the resulting stock
-- record and it is not inferable later: a private individual cannot charge us
-- VAT, so the car goes on the margin scheme, and getting that wrong is a VAT
-- assessment rather than a tidy-up.
CREATE TYPE appraisal_seller_type AS ENUM (
  'private_individual', 'vat_registered_business', 'non_vat_business'
);

CREATE TYPE damage_type AS ENUM (
  'scratch', 'dent', 'scuff', 'chip', 'crack', 'corrosion', 'missing',
  'paint_mismatch', 'kerbing', 'tear', 'stain', 'warning_light', 'wear'
);

CREATE TYPE damage_severity AS ENUM ('light', 'moderate', 'heavy');

-- What a mark is ON, for costing. The specific spot tapped on the map is free
-- text (`panel`) because it varies by body style and a three-door should not
-- need a migration; the GROUP is what a standard cost is keyed on.
CREATE TYPE panel_group AS ENUM (
  'body_panel', 'bumper', 'glass', 'wheel', 'tyre',
  'interior', 'mechanical', 'electrical'
);

CREATE TYPE valuation_source AS ENUM (
  'cap_hpi', 'trade_guide', 'auction_comparable', 'own_history', 'manual'
);

CREATE TYPE disposal_route AS ENUM ('retail', 'trade', 'auction');

CREATE TYPE settlement_source AS ENUM (
  'customer_stated', 'lender_letter', 'lender_portal', 'provenance_check'
);

CREATE TYPE recon_standard_source AS ENUM ('tenant_default', 'observed_average', 'manual');

CREATE TYPE appraisal_cost_source AS ENUM ('standard', 'manual', 'mot_advisory');

-- ----------------------------------------------------------- appraisals
CREATE TABLE appraisals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  site_id               uuid REFERENCES sites(id),

  -- Who it belongs to. A part-exchange has a contact; a walk-in valuation
  -- might not have a deal yet, and an appraisal taken to buy outright has
  -- neither a lead nor a deal.
  contact_id            uuid REFERENCES contacts(id),
  lead_id               uuid REFERENCES leads(id),
  deal_id               uuid REFERENCES deals(id),

  state                 appraisal_state NOT NULL DEFAULT 'draft',
  seller_type           appraisal_seller_type,

  -- The vehicle being appraised. Normalised registration, same rule as
  -- `vehicles`: uppercase, no spaces. NOT unique per tenant — the same car can
  -- legitimately be appraised twice, six months apart, at different numbers.
  registration          text NOT NULL,
  vin                   text,
  make                  text,
  model                 text,
  derivative            text,
  -- DVLA rarely gives the derivative and several trims share one record. A
  -- guessed derivative is a wrong price and a mis-described vehicle, so the
  -- appraisal records whether a human confirmed it, and conversion refuses
  -- without it.
  derivative_confirmed  boolean NOT NULL DEFAULT false,
  body_style            text,
  doors                 smallint,
  transmission          text,
  fuel_type             text,
  colour                text,
  engine_cc             integer,
  first_registered_on   date,
  mileage               integer,
  mot_expires_on        date,
  former_keepers        smallint,
  service_history_type  text,
  last_service_mileage  integer,
  key_count             smallint,
  v5c_present           boolean,
  -- Tread depths in tenths of a millimetre, keyed by wheel position, so the
  -- legal 1.6mm minimum is an integer comparison rather than a float one.
  tyre_depths_tenths_mm jsonb NOT NULL DEFAULT '{}'::jsonb,
  interior_grade        text,
  condition_notes       text,

  -- A valuation is a point-in-time statement about a moving market. An
  -- appraisal with no expiry becomes a number someone quotes back in March.
  appraised_at          timestamptz,
  appraised_by          uuid REFERENCES users(id),
  expires_at            timestamptz,

  declined_reason       text,
  abandoned_reason      text,

  -- Conversion. One appraisal produces at most one stock record, and the link
  -- is what makes the conversion idempotent.
  converted_vehicle_id  uuid REFERENCES vehicles(id),
  converted_at          timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_by            uuid REFERENCES users(id),

  CONSTRAINT appraisal_registration_not_blank CHECK (length(btrim(registration)) > 0),
  CONSTRAINT appraisal_mileage_non_negative CHECK (coalesce(mileage, 0) >= 0),
  -- A converted appraisal must name the stock record it became. Without this
  -- the idempotence check has nothing to read and a double conversion creates
  -- two stock records for one car.
  CONSTRAINT appraisal_converted_has_vehicle CHECK (
    state <> 'converted' OR (converted_vehicle_id IS NOT NULL AND converted_at IS NOT NULL)
  ),
  -- The VAT scheme of the resulting stock record is derived from who we bought
  -- it from, so that has to be recorded before it can become stock.
  CONSTRAINT appraisal_converted_has_seller_type CHECK (
    state <> 'converted' OR seller_type IS NOT NULL
  ),
  CONSTRAINT appraisal_declined_has_reason CHECK (
    state <> 'declined' OR declined_reason IS NOT NULL
  ),
  CONSTRAINT appraisal_abandoned_has_reason CHECK (
    state <> 'abandoned' OR abandoned_reason IS NOT NULL
  )
);
CREATE INDEX appraisals_tenant_state_idx ON appraisals (tenant_id, state, created_at DESC);
CREATE INDEX appraisals_tenant_reg_idx   ON appraisals (tenant_id, registration);
CREATE INDEX appraisals_tenant_deal_idx  ON appraisals (tenant_id, deal_id);
CREATE INDEX appraisals_tenant_contact_idx ON appraisals (tenant_id, contact_id);
-- One stock record can only have come from one appraisal.
CREATE UNIQUE INDEX appraisals_converted_vehicle_unique
  ON appraisals (tenant_id, converted_vehicle_id)
  WHERE converted_vehicle_id IS NOT NULL;

-- --------------------------------------------------------- damage marks
--
-- The tap-to-mark damage map. Structured — panel, type, severity — rather than
-- a free-text note, because this is what drives the recon estimate from the
-- tenant's standard costs. "Scuffed alloys and a dent on the tailgate" typed
-- into a box prices nothing and is not a disclosure either.
CREATE TABLE appraisal_damage (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  appraisal_id    uuid NOT NULL REFERENCES appraisals(id),

  panel           text NOT NULL,
  panel_group     panel_group NOT NULL,
  damage_type     damage_type NOT NULL,
  severity        damage_severity NOT NULL,
  size_mm         integer,
  notes           text,

  -- The storage key of the photograph, not a vehicle_media id: there is no
  -- vehicle yet. M5's pipeline owns the key and the EXIF stripping; conversion
  -- re-points these onto the new stock record.
  photo_key       text,

  -- What the standard cost said this mark would cost to put right, captured at
  -- the moment of appraisal. Standard costs move; the offer was made against
  -- the ones in force on the day and has to stay explicable.
  estimate_pence  bigint,
  currency        text NOT NULL DEFAULT 'GBP',

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  CONSTRAINT damage_panel_not_blank CHECK (length(btrim(panel)) > 0),
  CONSTRAINT damage_size_non_negative CHECK (coalesce(size_mm, 0) >= 0),
  CONSTRAINT damage_estimate_non_negative CHECK (coalesce(estimate_pence, 0) >= 0)
);
CREATE INDEX appraisal_damage_appraisal_idx ON appraisal_damage (tenant_id, appraisal_id);

-- -------------------------------------------------- recon cost standards
--
-- The tenant's own standard costs, which is what makes the estimate arrive
-- pre-filled instead of blank. Versioned by an effective window so an offer
-- made in June can still be explained in November after the bodyshop put its
-- prices up.
CREATE TABLE recon_cost_standards (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),

  damage_type     damage_type NOT NULL,
  severity        damage_severity NOT NULL,
  panel_group     panel_group NOT NULL,

  cost_pence      bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'GBP',

  source          recon_standard_source NOT NULL DEFAULT 'tenant_default',
  -- How many real prep jobs an observed average is built from. Below the
  -- domain layer's minimum it is not reported as an average at all — the same
  -- rule as the representative-APR report, and for the same reason: a
  -- confident number from four data points is worse than no number.
  sample_size     integer,

  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  CONSTRAINT recon_standard_cost_non_negative CHECK (cost_pence >= 0),
  CONSTRAINT recon_standard_window_ordered CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  -- An "observed average" that cannot say what it observed is a guess wearing
  -- a label that makes people trust it.
  CONSTRAINT recon_standard_observed_has_sample CHECK (
    source <> 'observed_average' OR sample_size IS NOT NULL
  ),
  CONSTRAINT recon_standard_sample_positive CHECK (coalesce(sample_size, 1) > 0)
);
CREATE UNIQUE INDEX recon_cost_standards_key_unique
  ON recon_cost_standards (tenant_id, damage_type, severity, panel_group, effective_from);
CREATE INDEX recon_cost_standards_lookup_idx
  ON recon_cost_standards (tenant_id, damage_type, severity, panel_group, effective_from DESC);

-- ------------------------------------------------------ recon estimate
--
-- The estimate lines themselves. Separate from the damage marks because not
-- every cost comes from a mark: an MOT advisory pulled from M4's history is a
-- suggested work item, and a manual line is what the buyer knows and the map
-- does not.
CREATE TABLE appraisal_costs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  appraisal_id    uuid NOT NULL REFERENCES appraisals(id),

  category        cost_category NOT NULL,
  description     text NOT NULL,
  estimate_pence  bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'GBP',

  source          appraisal_cost_source NOT NULL DEFAULT 'manual',
  damage_id       uuid REFERENCES appraisal_damage(id),
  standard_id     uuid REFERENCES recon_cost_standards(id),

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  CONSTRAINT appraisal_cost_non_negative CHECK (estimate_pence >= 0),
  CONSTRAINT appraisal_cost_description_not_blank CHECK (length(btrim(description)) > 0),
  -- A line claiming to come from a standard must name which one, or the offer
  -- cannot be explained back to the costs that produced it.
  CONSTRAINT appraisal_cost_standard_named CHECK (
    source <> 'standard' OR standard_id IS NOT NULL
  )
);
CREATE INDEX appraisal_costs_appraisal_idx ON appraisal_costs (tenant_id, appraisal_id);

-- --------------------------------------------------------- valuations
--
-- The valuation panel, snapshotted. Append-only: this is what the offer was
-- based on, and a valuation that can be edited afterwards cannot explain an
-- offer that has already been given.
--
-- Nothing here is rendered on a public page. DECISIONS.md 2026-08-02 refuses
-- any guide-price claim we cannot evidence, and a trade valuation is cost data
-- in any case.
CREATE TABLE appraisal_valuations (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  appraisal_id          uuid NOT NULL REFERENCES appraisals(id),

  source                valuation_source NOT NULL,
  currency              text NOT NULL DEFAULT 'GBP',
  trade_pence           bigint,
  retail_pence          bigint,
  private_pence         bigint,
  -- Whatever the valuation assumed. A trade figure quoted at 40,000 miles does
  -- not describe a car that has done 78,000.
  valued_at_mileage     integer,
  forecast_days_to_sell integer,

  captured_at           timestamptz NOT NULL DEFAULT now(),
  captured_by           uuid REFERENCES users(id),
  -- The provider response as received, alongside the parsed figures.
  raw                   jsonb,

  CONSTRAINT valuation_has_a_figure CHECK (
    trade_pence IS NOT NULL OR retail_pence IS NOT NULL OR private_pence IS NOT NULL
  ),
  CONSTRAINT valuation_figures_non_negative CHECK (
    coalesce(trade_pence, 0) >= 0 AND coalesce(retail_pence, 0) >= 0
    AND coalesce(private_pence, 0) >= 0
  ),
  CONSTRAINT valuation_mileage_non_negative CHECK (coalesce(valued_at_mileage, 0) >= 0)
);
CREATE INDEX appraisal_valuations_appraisal_idx
  ON appraisal_valuations (tenant_id, appraisal_id, captured_at DESC);

-- ------------------------------------------------------------- offers
--
-- APPEND-ONLY. A revised offer is a new revision, never an edit: the previous
-- number was said out loud to a customer and remains part of what happened.
--
-- The internal breakdown sits in its own columns rather than a jsonb blob so
-- that a query can select the allowance without dragging the cost data with
-- it. Field-level permission filtering is server-side, and it is much easier
-- to get right when the fields are actually separate.
CREATE TABLE appraisal_offers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  appraisal_id          uuid NOT NULL REFERENCES appraisals(id),

  revision              integer NOT NULL,
  currency              text NOT NULL DEFAULT 'GBP',

  -- THE number. What the customer is told their car is worth to us.
  allowance_pence       bigint NOT NULL,

  -- Internal only, never customer-facing.
  market_value_pence    bigint,
  recon_estimate_pence  bigint,
  target_margin_pence   bigint,
  fees_pence            bigint NOT NULL DEFAULT 0,
  disposal_route        disposal_route,

  offered_at            timestamptz NOT NULL DEFAULT now(),
  offered_by            uuid REFERENCES users(id),
  -- An offer without a lapse date is an offer the dealer is still honouring
  -- in six weeks' time.
  expires_at            timestamptz,

  accepted_at           timestamptz,
  declined_at           timestamptz,
  declined_reason       text,

  -- Recorded when the allowance exceeds what the car is worth to us — which is
  -- a legitimate way to close a deal, and needs to be visible rather than
  -- buried, because it is really a discount on the sale car.
  over_allowance_pence  bigint,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT offer_revision_positive CHECK (revision > 0),
  CONSTRAINT offer_allowance_non_negative CHECK (allowance_pence >= 0),
  CONSTRAINT offer_internal_non_negative CHECK (
    coalesce(market_value_pence, 0) >= 0 AND coalesce(recon_estimate_pence, 0) >= 0
    AND coalesce(target_margin_pence, 0) >= 0 AND fees_pence >= 0
  ),
  CONSTRAINT offer_expires_after_offered CHECK (
    expires_at IS NULL OR expires_at > offered_at
  ),
  CONSTRAINT offer_not_both_accepted_and_declined CHECK (
    accepted_at IS NULL OR declined_at IS NULL
  ),
  CONSTRAINT offer_accepted_after_offered CHECK (
    accepted_at IS NULL OR accepted_at >= offered_at
  ),
  CONSTRAINT offer_declined_has_reason CHECK (
    declined_at IS NULL OR declined_reason IS NOT NULL
  )
);
CREATE UNIQUE INDEX appraisal_offers_revision_unique
  ON appraisal_offers (tenant_id, appraisal_id, revision);
CREATE INDEX appraisal_offers_appraisal_idx
  ON appraisal_offers (tenant_id, appraisal_id, revision DESC);

-- -------------------------------------------------------- settlements
--
-- Outstanding finance on the car coming in. This money has to reach the
-- customer's lender, and M12 already establishes that it ADDS to what the
-- customer owes rather than netting off.
--
-- Two fields carry the weight. `valid_until` is the lender's own expiry — a
-- settlement quoted three weeks ago has accrued interest since and the
-- difference comes out of the dealer's margin. `source` records where the
-- figure came from, and a number the customer recalled is not a figure: the
-- constraint below refuses to mark it verified.
CREATE TABLE appraisal_settlements (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  appraisal_id        uuid NOT NULL REFERENCES appraisals(id),

  lender_name         text NOT NULL,
  agreement_reference text,

  currency            text NOT NULL DEFAULT 'GBP',
  settlement_pence    bigint NOT NULL,
  -- Per-day accrual after the quote date, where the lender states it. Lets the
  -- screen show what it will be on the day of the handover rather than what it
  -- was on the day of the phone call.
  daily_accrual_pence bigint,

  source              settlement_source NOT NULL,
  verified            boolean NOT NULL DEFAULT false,

  quoted_at           timestamptz NOT NULL,
  valid_until         timestamptz,

  paid_at             timestamptz,
  payment_reference   text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),

  CONSTRAINT settlement_lender_not_blank CHECK (length(btrim(lender_name)) > 0),
  CONSTRAINT settlement_non_negative CHECK (settlement_pence >= 0),
  CONSTRAINT settlement_accrual_non_negative CHECK (coalesce(daily_accrual_pence, 0) >= 0),
  CONSTRAINT settlement_valid_until_after_quote CHECK (
    valid_until IS NULL OR valid_until >= quoted_at
  ),
  -- What the customer remembers owing is not a settlement figure. It is a
  -- starting point for a phone call to the lender.
  CONSTRAINT settlement_customer_stated_not_verified CHECK (
    NOT verified OR source <> 'customer_stated'
  ),
  CONSTRAINT settlement_paid_has_reference CHECK (
    paid_at IS NULL OR payment_reference IS NOT NULL
  )
);
CREATE INDEX appraisal_settlements_appraisal_idx
  ON appraisal_settlements (tenant_id, appraisal_id, quoted_at DESC);
-- The operational list that matters: settlements owed and not yet paid.
CREATE INDEX appraisal_settlements_unpaid_idx
  ON appraisal_settlements (tenant_id, valid_until)
  WHERE paid_at IS NULL;

-- --------------------------------------------------------- append-only
--
-- An offer that was given to a customer, and the valuation it was based on,
-- are both records of what happened. Corrections are new rows.
SELECT make_append_only('appraisal_offers');
SELECT make_append_only('appraisal_valuations');

-- A settlement is NOT blanket append-only, for the same reason a repair
-- attempt is not: it has exactly one lawful update, which is being paid. The
-- quoted figure, the lender and the expiry are frozen — those are what the
-- dealer's exposure is measured against, and a re-dated settlement hides the
-- fact that it lapsed.
CREATE OR REPLACE FUNCTION freeze_settlement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'A settlement figure cannot be deleted — it records money owed to a lender. Record a new quote instead.';
  END IF;
  IF NEW.settlement_pence IS DISTINCT FROM OLD.settlement_pence
     OR NEW.lender_name IS DISTINCT FROM OLD.lender_name
     OR NEW.agreement_reference IS DISTINCT FROM OLD.agreement_reference
     OR NEW.quoted_at IS DISTINCT FROM OLD.quoted_at
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.appraisal_id IS DISTINCT FROM OLD.appraisal_id THEN
    RAISE EXCEPTION
      'A quoted settlement is fixed. If the lender has requoted, record the new quote as a new row.';
  END IF;
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'A settlement that has been paid cannot be re-dated.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER freeze_settlement
  BEFORE UPDATE OR DELETE ON appraisal_settlements
  FOR EACH ROW EXECUTE FUNCTION freeze_settlement();

SELECT * FROM apply_tenant_policies();

COMMIT;
