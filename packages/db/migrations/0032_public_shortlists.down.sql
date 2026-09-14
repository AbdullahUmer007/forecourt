-- Roll back site code first. Retain buyer choices and audit records.
BEGIN;
REVOKE SELECT, INSERT, UPDATE ON shortlists, shortlist_items FROM app_public;
-- Restore the previous policy generator before running policy reapplication after rollback.
COMMIT;
