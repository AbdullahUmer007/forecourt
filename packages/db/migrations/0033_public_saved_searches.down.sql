-- Roll back application first. Restore the previous policy generator before reapplying policies.
-- Keep records and restrictive policies; no destructive rollback.
BEGIN;
REVOKE SELECT, INSERT, UPDATE ON saved_searches FROM app_public;
COMMIT;
