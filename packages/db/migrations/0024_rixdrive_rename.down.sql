-- Rollback of 0024. Restores the two strings exactly as 0018 and 0022 left
-- them, so that rolling back to 0023 leaves a database indistinguishable from
-- one that never ran 0024.
--
-- This is the one place the old name is deliberately reinstated: a rollback
-- that "helpfully" kept the new wording would mean forward and backward
-- migrations do not compose, and the next person bisecting a schema problem
-- would be chasing a difference nobody wrote.

BEGIN;

CREATE OR REPLACE FUNCTION freeze_impersonation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'An impersonation session cannot be deleted. It is the record of Forecourt staff reading a customer''s data.';
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
  'Forecourt staff. Platform data, not tenant data — no tenant_id, and listed among the isolation suite''s special tables.';

COMMIT;
