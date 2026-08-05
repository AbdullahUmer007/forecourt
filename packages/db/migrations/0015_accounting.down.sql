BEGIN;

DROP TABLE IF EXISTS postings CASCADE;
DROP TABLE IF EXISTS posting_batches CASCADE;
DROP TABLE IF EXISTS account_mappings CASCADE;
DROP TABLE IF EXISTS accounting_connections CASCADE;

DROP TYPE IF EXISTS batch_status;
DROP TYPE IF EXISTS posting_status;
DROP TYPE IF EXISTS posting_source;
DROP TYPE IF EXISTS accounting_provider;

COMMIT;
