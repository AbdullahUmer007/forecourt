-- Rollback 0020 — deliberately a no-op, with a documented forward fix.
--
-- `compliance_rules` is append-only by trigger: DELETE is refused, and so is
-- UPDATE. That is the whole point of the table — it is the record of what the
-- law said and when, and a rollback that could erase a version would make
-- every historic figure unreproducible.
--
-- So there is nothing to undo here, and pretending otherwise with a DELETE
-- would produce a down migration that always fails.
--
-- The forward fix, if the version 1 row is ever found to be wrong: insert a
-- version 3 with the corrected parameters and an `effective_from` that closes
-- the period, exactly as version 2 superseded version 1. Correcting the law's
-- history is itself an append.
--
-- Rolling back 0020 therefore leaves the version 1 row in place. It is inert
-- unless something asks for the threshold in force before 30 June 2026.

BEGIN;
COMMIT;
