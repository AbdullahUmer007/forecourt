-- 0024: the platform is called RixDrive, and two strings in the database
-- still say otherwise.
--
-- The product was renamed from Forecourt. Almost all of that rename is in
-- application code, but two pieces of the old name were written INTO Postgres
-- by earlier migrations and are still there at runtime:
--
--   1. `freeze_impersonation()` raises 'It is the record of Forecourt staff
--      reading a customer's data.' That is an error message a human reads —
--      the most sensitive one in the platform, guarding the audit record of us
--      looking at a dealer's customers — and it names a company that no longer
--      exists by that name.
--   2. `COMMENT ON TABLE platform_operators` describes the table as holding
--      'Forecourt staff'. Developer-facing, but it is the description an
--      operator sees in psql when they ask what a table is for.
--
-- Migrations 0018 and 0022 are NOT edited to fix this. They have been applied;
-- rewriting them would make the files disagree with what actually ran, and the
-- next person to read them would be reading fiction. Rule 4 — corrections are
-- new rows, not edits — applies to schema history as much as to invoices.
--
-- The function body below is otherwise byte-identical to the one 0018
-- installed. Only the one message changes. It is repeated in full because
-- CREATE OR REPLACE FUNCTION has no way to patch a single line.
--
-- No schema change, no data change, no lock of consequence. Safe to run at any
-- time, and safe to run twice.
--
-- Rollback: 0024_rixdrive_rename.down.sql
-- Depends on 0018_platform_admin.sql and 0022_platform_operators.sql.

BEGIN;

CREATE OR REPLACE FUNCTION freeze_impersonation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'An impersonation session cannot be deleted. It is the record of RixDrive staff reading a customer''s data.';
  END IF;
  IF NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION
      'Who, which tenant, why, when it started and when it expires are all fixed on an impersonation session.';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'An impersonation session that has ended cannot be re-dated.';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON TABLE platform_operators IS
  'RixDrive staff. Platform data, not tenant data — no tenant_id, and listed among the isolation suite''s special tables.';

COMMIT;
