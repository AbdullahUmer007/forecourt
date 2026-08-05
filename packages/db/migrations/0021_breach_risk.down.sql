-- Rollback 0021.
--
-- Drops the Article 34 risk assessment and its justification. Any assessment
-- recorded against a breach is LOST — there is nowhere else it is written —
-- and the product returns to being unable to flag people who should have been
-- told about a breach and were not.

BEGIN;

ALTER TABLE data_breaches DROP CONSTRAINT IF EXISTS breach_low_risk_has_reason;
ALTER TABLE data_breaches
  DROP COLUMN IF EXISTS high_risk,
  DROP COLUMN IF EXISTS high_risk_reason;

COMMIT;
