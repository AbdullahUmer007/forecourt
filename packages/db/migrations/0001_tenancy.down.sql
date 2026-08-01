-- Rollback for 0001_tenancy.sql. Drops in reverse dependency order.
-- Data loss is total and intentional; this is for a failed deploy, not a
-- production correction. compliance_rules is dropped last because other
-- migrations may reference it.
BEGIN;
DROP TABLE IF EXISTS audit_events CASCADE;   -- partitions cascade
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS user_sites CASCADE;
DROP TABLE IF EXISTS tenant_memberships CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS domains CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS compliance_rules CASCADE;
DROP FUNCTION IF EXISTS ensure_audit_partition(date);
DROP TYPE IF EXISTS system_role;
DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS tenant_status;
DROP TYPE IF EXISTS vat_scheme_default;
DROP TYPE IF EXISTS fca_permission_type;
COMMIT;
