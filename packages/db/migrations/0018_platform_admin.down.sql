BEGIN;

DROP TRIGGER IF EXISTS freeze_impersonation ON impersonation_sessions;
DROP FUNCTION IF EXISTS freeze_impersonation();

DROP TABLE IF EXISTS impersonation_sessions CASCADE;
DROP TABLE IF EXISTS impersonation_grants CASCADE;
DROP TABLE IF EXISTS usage_records CASCADE;
DROP TABLE IF EXISTS feature_flags CASCADE;
DROP TABLE IF EXISTS tenant_subscriptions CASCADE;

DROP TYPE IF EXISTS usage_metric;
DROP TYPE IF EXISTS impersonation_status;
DROP TYPE IF EXISTS subscription_status;
DROP TYPE IF EXISTS platform_plan;

COMMIT;
