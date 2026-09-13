-- Roll back the application first. Retain appointment and audit history.
-- Additive table and indexes can remain safely with the previous app.
BEGIN;
COMMIT;
