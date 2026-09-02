BEGIN;

ALTER TABLE appraisals
  DROP COLUMN IF EXISTS make_id,
  DROP COLUMN IF EXISTS model_id,
  DROP COLUMN IF EXISTS variant_id;

ALTER TABLE vehicles
  DROP COLUMN IF EXISTS make_id,
  DROP COLUMN IF EXISTS model_id,
  DROP COLUMN IF EXISTS variant_id;

DROP TABLE IF EXISTS vehicle_variants;
DROP TABLE IF EXISTS vehicle_models;
DROP TABLE IF EXISTS vehicle_makes;

COMMIT;
