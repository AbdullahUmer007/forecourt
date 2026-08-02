-- =====================================================================
-- M3 — Vehicle core
--
-- Expand-only. Rollback: 0002_vehicles.down.sql
-- Depends on 0001_tenancy.sql (tenants, sites, users, uuid_generate_v7).
-- =====================================================================

BEGIN;

CREATE TYPE vehicle_state AS ENUM (
  'sourcing', 'purchased', 'in_transit', 'booked_in', 'in_prep', 'ready',
  'live', 'reserved', 'sold', 'delivered',
  'on_hold', 'returned', 'trade_disposal', 'written_off', 'archived'
);

CREATE TYPE vat_scheme AS ENUM ('margin', 'qualifying', 'non_qualifying');

CREATE TYPE purchase_source AS ENUM (
  'auction', 'part_exchange', 'trade', 'private', 'consignment', 'fleet', 'lease_return'
);

CREATE TYPE cost_category AS ENUM (
  'mechanical', 'bodywork', 'tyres', 'mot', 'parts', 'valet',
  'transport', 'advertising', 'funding', 'provenance', 'other'
);

-- ---------------------------------------------------------------- vehicles
CREATE TABLE vehicles (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  site_id                  uuid NOT NULL REFERENCES sites(id),

  -- identity
  stock_number             text NOT NULL,
  stock_sequence           integer NOT NULL,
  registration             text NOT NULL,          -- normalised: uppercase, no spaces
  vin                      text,
  previous_registrations   text[] NOT NULL DEFAULT '{}',
  engine_number            text,

  -- specification (populated by lookup in M4; all overridable)
  make                     text,
  model                    text,
  derivative               text,
  body_style               text,
  doors                    smallint,
  seats                    smallint,
  transmission             text,
  drivetrain               text,
  fuel_type                text,
  engine_cc                integer,
  power_bhp                integer,
  co2_gkm                  integer,
  euro_status              text,
  ulez_compliant           boolean,
  first_registered_on      date,
  model_year               smallint,
  colour                   text,
  paint_type               text,
  mileage                  integer,
  mileage_unit             text NOT NULL DEFAULT 'miles',
  mot_expires_on           date,
  tax_band                 text,
  insurance_group          text,
  former_keepers           smallint,
  service_history_type     text,
  last_service_date        date,
  last_service_mileage     integer,
  key_count                smallint,
  v5c_present              boolean NOT NULL DEFAULT false,
  v5c_reference            text,
  spec                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  options                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  features                 text[] NOT NULL DEFAULT '{}',
  spec_edited              boolean NOT NULL DEFAULT false,

  -- state
  state                    vehicle_state NOT NULL DEFAULT 'sourcing',
  state_changed_at         timestamptz NOT NULL DEFAULT now(),
  on_hold_reason           text,

  -- commercial. Money is ALWAYS bigint minor units (pence) + currency.
  currency                 text NOT NULL DEFAULT 'GBP',
  vat_scheme               vat_scheme,
  vat_scheme_locked_at     timestamptz,
  purchase_price_pence     bigint,
  purchase_date            date,
  purchase_source          purchase_source,
  supplier_id              uuid,                   -- FK added in M12 (suppliers)
  purchase_invoice_ref     text,
  funding_method           text,
  retail_price_pence       bigint,
  target_price_pence       bigint,
  minimum_price_pence      bigint,
  price_changed_at         timestamptz,
  total_cost_pence         bigint NOT NULL DEFAULT 0,   -- cached; recomputed on cost change
  projected_margin_pence   bigint,                      -- cached

  -- merchandising
  advert_headline          text,
  advert_description       text,
  advert_highlights        text[] NOT NULL DEFAULT '{}',
  attention_grabber        text,
  video_url                text,
  spin_url                 text,
  advert_strength          smallint,
  published_photo_count    integer NOT NULL DEFAULT 0,

  -- provenance / compliance gates (populated in M4)
  provenance_checked_at    timestamptz,
  provenance_adverse       boolean NOT NULL DEFAULT false,
  provenance_acknowledged_by     uuid REFERENCES users(id),
  provenance_acknowledged_reason text,
  highest_mot_mileage      integer,
  mileage_anomaly_acknowledged_by uuid REFERENCES users(id),

  -- lifecycle timestamps — these drive every days metric in the product
  booked_in_at             timestamptz,
  ready_at                 timestamptz,
  live_at                  timestamptz,
  reserved_at              timestamptz,
  sold_at                  timestamptz,
  delivered_at             timestamptz,
  days_in_stock_cached     integer,

  search_vector            tsvector,
  notes                    text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES users(id),
  updated_by               uuid REFERENCES users(id),
  deleted_at               timestamptz,

  CONSTRAINT vehicles_money_non_negative CHECK (
    coalesce(purchase_price_pence, 0) >= 0
    AND coalesce(retail_price_pence, 0) >= 0
    AND coalesce(minimum_price_pence, 0) >= 0
    AND total_cost_pence >= 0
  ),
  CONSTRAINT vehicles_mileage_non_negative CHECK (coalesce(mileage, 0) >= 0),
  -- Once a sale is invoiced the VAT scheme is frozen. Recording WHEN it locked
  -- is what lets the stock book prove which scheme applied at the point of sale.
  CONSTRAINT vehicles_vat_scheme_present_when_locked CHECK (
    vat_scheme_locked_at IS NULL OR vat_scheme IS NOT NULL
  ),
  -- An adverse provenance marker may only be cleared with a recorded reason.
  CONSTRAINT vehicles_provenance_ack_has_reason CHECK (
    provenance_acknowledged_by IS NULL OR provenance_acknowledged_reason IS NOT NULL
  )
);

-- ---------------------------------------------------------------------
-- THE CONSTRAINT THAT MATTERS MOST ON THIS TABLE.
--
-- Registration uniqueness is scoped to the TENANT, never global. A global
-- unique index would let one dealer discover another's stock: type a
-- registration, get a constraint violation, and you have learned that a
-- competitor has that car. Same reasoning as domains.hostname in 0001, but
-- the opposite conclusion — there the global scope was the safe choice.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX vehicles_tenant_registration_unique
  ON vehicles (tenant_id, registration) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX vehicles_tenant_stock_number_unique ON vehicles (tenant_id, stock_number);
CREATE UNIQUE INDEX vehicles_tenant_site_sequence_unique ON vehicles (tenant_id, site_id, stock_sequence);

-- Tenant-first composite indexes on every hot path.
CREATE INDEX vehicles_tenant_state_site_idx ON vehicles (tenant_id, state, site_id) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_tenant_booked_in_idx  ON vehicles (tenant_id, booked_in_at);
CREATE INDEX vehicles_tenant_make_model_idx ON vehicles (tenant_id, make, model, retail_price_pence);
CREATE INDEX vehicles_tenant_price_idx      ON vehicles (tenant_id, retail_price_pence) WHERE state IN ('live','reserved');
CREATE INDEX vehicles_search_idx            ON vehicles USING gin (search_vector);
CREATE INDEX vehicles_features_idx          ON vehicles USING gin (features);

-- ---------------------------------------------------------------- status history
-- Append-only. The durations between these rows ARE the product's most
-- valuable data: days in prep, days to live, days to sell.
CREATE TABLE vehicle_status_history (
  id              uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL,
  site_id         uuid,
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  from_state      vehicle_state,
  to_state        vehicle_state NOT NULL,
  reason          text,
  override_reason text,
  overridden_by   uuid REFERENCES users(id),
  actor_id        uuid REFERENCES users(id),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
);
CREATE INDEX vsh_tenant_vehicle_idx ON vehicle_status_history (tenant_id, vehicle_id, occurred_at);
CREATE INDEX vsh_tenant_state_idx   ON vehicle_status_history (tenant_id, to_state, occurred_at);

-- ---------------------------------------------------------------- price history
-- Append-only. Every price change is attributed, including bulk operations.
CREATE TABLE vehicle_prices (
  id                  uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL,
  site_id             uuid,
  vehicle_id          uuid NOT NULL REFERENCES vehicles(id),
  price_pence         bigint NOT NULL,
  previous_price_pence bigint,
  currency            text NOT NULL DEFAULT 'GBP',
  reason              text,
  source              text NOT NULL DEFAULT 'manual',  -- manual | aging_ladder | bulk | import
  bulk_operation_id   uuid,
  actor_id            uuid REFERENCES users(id),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, effective_from),
  CONSTRAINT vehicle_prices_non_negative CHECK (price_pence >= 0)
);
CREATE INDEX vp_tenant_vehicle_idx ON vehicle_prices (tenant_id, vehicle_id, effective_from DESC);

-- ---------------------------------------------------------------- costs
CREATE TABLE vehicle_costs (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  site_id               uuid REFERENCES sites(id),
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
  category              cost_category NOT NULL,
  description           text NOT NULL,
  supplier_id           uuid,
  estimated_amount_pence bigint,
  actual_amount_pence   bigint,
  vat_amount_pence      bigint,
  vat_recoverable       boolean NOT NULL DEFAULT true,
  currency              text NOT NULL DEFAULT 'GBP',
  status                text NOT NULL DEFAULT 'estimated',  -- estimated | committed | invoiced | paid
  approved_by           uuid REFERENCES users(id),
  approved_at           timestamptz,
  purchase_invoice_id   uuid,
  incurred_on           date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  CONSTRAINT vehicle_costs_non_negative CHECK (
    coalesce(estimated_amount_pence, 0) >= 0 AND coalesce(actual_amount_pence, 0) >= 0
  )
);
CREATE INDEX vc_tenant_vehicle_idx  ON vehicle_costs (tenant_id, vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX vc_tenant_category_idx ON vehicle_costs (tenant_id, category, incurred_on);

-- ---------------------------------------------------------------- search
CREATE OR REPLACE FUNCTION vehicles_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('english', coalesce(NEW.registration, '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW.stock_number, '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW.make, '') || ' ' || coalesce(NEW.model, '')), 'B')
    || setweight(to_tsvector('english', coalesce(NEW.derivative, '')), 'B')
    || setweight(to_tsvector('english', coalesce(NEW.colour, '') || ' ' || coalesce(NEW.fuel_type, '')), 'C')
    || setweight(to_tsvector('english', coalesce(NEW.advert_description, '')), 'D');
  RETURN NEW;
END $$;

CREATE TRIGGER vehicles_search_vector
  BEFORE INSERT OR UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION vehicles_search_vector_update();

-- Registration search must tolerate spacing and the O/0, I/1 confusions a
-- dealer makes when reading a plate off a windscreen.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX vehicles_registration_trgm_idx ON vehicles USING gin (registration gin_trgm_ops);

-- ---------------------------------------------------------------- protection
SELECT * FROM apply_tenant_policies();
SELECT make_append_only('vehicle_status_history');
SELECT make_append_only('vehicle_prices');

COMMIT;
