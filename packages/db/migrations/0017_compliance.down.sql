BEGIN;

DROP TABLE IF EXISTS data_breaches CASCADE;
DROP TABLE IF EXISTS complaints CASCADE;
DROP TABLE IF EXISTS compliance_tasks CASCADE;
DROP TABLE IF EXISTS compliance_registers CASCADE;

DROP TYPE IF EXISTS breach_status;
DROP TYPE IF EXISTS complaint_status;
DROP TYPE IF EXISTS complaint_outcome;
DROP TYPE IF EXISTS compliance_task_status;
DROP TYPE IF EXISTS register_kind;

COMMIT;
