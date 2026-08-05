-- Rollback 0022.
--
-- Drops the operator table and its role type. Every operator record goes with
-- it, and the platform admin application can then authenticate nobody — which
-- is the safe direction to fail: no identity means no access, rather than
-- unbounded access.
--
-- `impersonation_sessions.operator_id` references `users`, not this table, so
-- the impersonation log survives intact. Its rows will name users who are no
-- longer identifiable as staff, which is exactly what the revoked_at column
-- exists to avoid.

BEGIN;

DROP TABLE IF EXISTS operator_sessions;
DROP TABLE IF EXISTS platform_operators;
DROP TYPE IF EXISTS platform_operator_role;

COMMIT;
