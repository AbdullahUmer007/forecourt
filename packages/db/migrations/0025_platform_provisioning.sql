-- 0025: let the platform admin provision a dealership.
--
-- `app_platform` could already count tenants and sign operators in. It could
-- not create one. The grants below are the writes the admin application
-- actually makes when onboarding a dealer: tenant, first site, brand, the
-- nine system roles, the owner user, their membership, an optional hostname,
-- and an audit row.
--
-- Still absent, and still deliberately: contacts, leads, deals, invoices,
-- evidence. Creating a dealership is not reading a dealer's customers.
--
-- Rollback: 0025_platform_provisioning.down.sql
-- Depends on 0022_platform_operators.sql.

BEGIN;

GRANT SELECT, INSERT, UPDATE ON tenants TO app_platform;
GRANT SELECT, INSERT, UPDATE ON sites TO app_platform;
GRANT SELECT, INSERT, UPDATE ON brands TO app_platform;
GRANT SELECT, INSERT, UPDATE ON domains TO app_platform;
GRANT SELECT, INSERT ON roles TO app_platform;
GRANT SELECT, INSERT, UPDATE ON tenant_memberships TO app_platform;
GRANT INSERT ON audit_events TO app_platform;

-- Identity: create the owner, or reuse an existing user and reset the
-- password we just generated for them. Column-level so the role still cannot
-- read MFA secrets it has no business writing.
GRANT INSERT (email, name, password_hash, status)
  ON users TO app_platform;
GRANT UPDATE (name, password_hash, failed_login_count, locked_until, updated_at, status)
  ON users TO app_platform;

COMMIT;
