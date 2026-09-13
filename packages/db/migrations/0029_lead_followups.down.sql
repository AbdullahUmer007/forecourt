-- Roll back the application first. Preserve task data and append-only history.
-- Additive columns are harmless to the previous app version.
BEGIN;
DROP INDEX IF EXISTS leads_follow_up_idx;
COMMIT;
