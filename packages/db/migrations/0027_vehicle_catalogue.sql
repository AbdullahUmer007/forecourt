-- Platform vehicle catalogue: make → model → variant.
--
-- Shared reference data, not tenant-owned. Every dealer reads the same list
-- so a book-in cannot invent a derivative. Seeded from vehicle_details/*.csv
-- by `pnpm db:seed:catalogue`. Expand-only. Rollback: 0027_vehicle_catalogue.down.sql

BEGIN;

CREATE TABLE vehicle_makes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  source_id   integer NOT NULL UNIQUE,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_makes_name_ok CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX vehicle_makes_name_lower_idx ON vehicle_makes (lower(name));
CREATE INDEX vehicle_makes_name_trgm_idx ON vehicle_makes USING gin (name gin_trgm_ops);

CREATE TABLE vehicle_models (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  make_id     uuid NOT NULL REFERENCES vehicle_makes(id),
  source_id   integer UNIQUE,
  name        text NOT NULL,
  slug        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_models_name_ok CHECK (length(btrim(name)) > 0),
  CONSTRAINT vehicle_models_make_name UNIQUE (make_id, name)
);

CREATE INDEX vehicle_models_make_idx ON vehicle_models (make_id, name);
CREATE INDEX vehicle_models_name_trgm_idx ON vehicle_models USING gin (name gin_trgm_ops);

CREATE TABLE vehicle_variants (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  model_id    uuid NOT NULL REFERENCES vehicle_models(id),
  source_id   integer NOT NULL UNIQUE,
  type_name   text,
  name        text NOT NULL,
  label       text NOT NULL,
  kw          smallint,
  hp          smallint,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_variants_name_ok CHECK (length(btrim(name)) > 0)
);

CREATE INDEX vehicle_variants_model_idx ON vehicle_variants (model_id, label);
CREATE INDEX vehicle_variants_label_trgm_idx ON vehicle_variants USING gin (label gin_trgm_ops);

-- Optional FKs on the records a dealer actually writes. Text columns stay:
-- they are what search, invoices and the shopfront already read.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS make_id uuid REFERENCES vehicle_makes(id),
  ADD COLUMN IF NOT EXISTS model_id uuid REFERENCES vehicle_models(id),
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES vehicle_variants(id);

ALTER TABLE appraisals
  ADD COLUMN IF NOT EXISTS make_id uuid REFERENCES vehicle_makes(id),
  ADD COLUMN IF NOT EXISTS model_id uuid REFERENCES vehicle_models(id),
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES vehicle_variants(id);

-- Platform tables: no tenant_id. Readable by every connected role, writable
-- by none of them. The seed script connects as the database owner.
ALTER TABLE vehicle_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_makes FORCE ROW LEVEL SECURITY;
CREATE POLICY catalogue_read ON vehicle_makes FOR SELECT USING (true);

ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_models FORCE ROW LEVEL SECURITY;
CREATE POLICY catalogue_read ON vehicle_models FOR SELECT USING (true);

ALTER TABLE vehicle_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY catalogue_read ON vehicle_variants FOR SELECT USING (true);

GRANT SELECT ON vehicle_makes, vehicle_models, vehicle_variants TO app_user;
GRANT SELECT ON vehicle_makes, vehicle_models, vehicle_variants TO app_public;
GRANT SELECT ON vehicle_makes, vehicle_models, vehicle_variants TO app_platform;

COMMIT;
