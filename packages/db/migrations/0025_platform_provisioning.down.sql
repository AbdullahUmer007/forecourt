-- Rollback of 0025_platform_provisioning.sql.
-- Leaves the 0022 identity SELECT grant on users intact.

BEGIN;

REVOKE INSERT, UPDATE ON tenants FROM app_platform;
REVOKE INSERT, UPDATE ON sites FROM app_platform;
REVOKE INSERT, UPDATE ON brands FROM app_platform;
REVOKE INSERT, UPDATE ON domains FROM app_platform;
REVOKE INSERT ON roles FROM app_platform;
REVOKE INSERT, UPDATE ON tenant_memberships FROM app_platform;
REVOKE INSERT ON audit_events FROM app_platform;

REVOKE INSERT ON users FROM app_platform;
REVOKE UPDATE (name, password_hash, failed_login_count, locked_until, updated_at, status)
  ON users FROM app_platform;

-- 0022 granted SELECT on tenants, sites, tenant_memberships. Restore those
-- after the broader SELECT, INSERT, UPDATE revoke above.
GRANT SELECT ON tenants, sites TO app_platform;
GRANT SELECT (id, tenant_id, user_id, status) ON tenant_memberships TO app_platform;

COMMIT;
