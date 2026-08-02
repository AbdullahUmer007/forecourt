-- =====================================================================
-- M4 — Vehicle data: lookups, MOT records, provider cost metering
--
-- Expand-only. Rollback: 0003_vehicle_data.down.sql
-- Covers the FREE providers (DVLA VES, DVSA MOT). Valuation and provenance
-- columns exist but stay empty until the paid contracts are signed.
-- =====================================================================

BEGIN;

CREATE TYPE data_provider AS ENUM (
  'dvla_ves', 'dvsa_mot', 'cap_hpi', 'hpi_check', 'percayso', 'jato', 'aggregator'
);

-- ---------------------------------------------------------------- lookups
-- Every provider call, with the RAW response stored beside the parsed result.
-- That is what makes a parser bug fixable without re-paying for the call —
-- and vehicle data lookups are our dominant marginal cost.
CREATE TABLE vehicle_lookups (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL,
  vehicle_id     uuid REFERENCES vehicles(id),   -- null: lookup before the vehicle exists
  registration   text NOT NULL,
  provider       data_provider NOT NULL,
  lookup_type    text NOT NULL,
  request        jsonb,
  raw_response   jsonb,                          -- never discard this
  parsed         jsonb,
  cost_pence     integer NOT NULL DEFAULT 0,
  cached         boolean NOT NULL DEFAULT false,
  succeeded      boolean NOT NULL DEFAULT true,
  error_message  text,
  performed_by   uuid REFERENCES users(id),
  performed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, performed_at),
  CONSTRAINT vehicle_lookups_cost_non_negative CHECK (cost_pence >= 0)
);
CREATE INDEX vl_tenant_reg_idx      ON vehicle_lookups (tenant_id, registration, performed_at DESC);
CREATE INDEX vl_tenant_provider_idx ON vehicle_lookups (tenant_id, provider, performed_at DESC);
CREATE INDEX vl_tenant_cost_idx     ON vehicle_lookups (tenant_id, performed_at) WHERE NOT cached;

-- ---------------------------------------------------------------- MOT records
CREATE TABLE mot_records (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  vehicle_id           uuid NOT NULL REFERENCES vehicles(id),
  test_date            date NOT NULL,
  result               text NOT NULL,
  expiry_date          date,
  odometer             integer,
  odometer_unit        text,
  odometer_miles       integer,          -- normalised; km readings converted
  odometer_result_type text,
  test_number          text,
  defects              jsonb NOT NULL DEFAULT '[]'::jsonb,
  advisories           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mot_odometer_non_negative CHECK (coalesce(odometer_miles, 0) >= 0)
);
CREATE UNIQUE INDEX mot_tenant_vehicle_test_unique ON mot_records (tenant_id, vehicle_id, test_date, coalesce(test_number, ''));
CREATE INDEX mot_tenant_vehicle_idx ON mot_records (tenant_id, vehicle_id, test_date DESC);

-- ---------------------------------------------------------------- cost metering
-- Rolled up per tenant per day so a dealer's data spend is visible without
-- scanning the lookup table, and so plan allowances can be enforced.
CREATE TABLE provider_usage_daily (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  usage_date   date NOT NULL,
  provider     data_provider NOT NULL,
  lookup_type  text NOT NULL,
  call_count   integer NOT NULL DEFAULT 0,
  cached_count integer NOT NULL DEFAULT 0,
  cost_pence   bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pud_non_negative CHECK (call_count >= 0 AND cached_count >= 0 AND cost_pence >= 0)
);
CREATE UNIQUE INDEX pud_unique ON provider_usage_daily (tenant_id, usage_date, provider, lookup_type);

SELECT * FROM apply_tenant_policies();
SELECT make_append_only('vehicle_lookups');

COMMIT;
