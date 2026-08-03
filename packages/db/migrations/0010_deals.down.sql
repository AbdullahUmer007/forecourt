BEGIN;

DROP TRIGGER IF EXISTS freeze_repair ON deal_repair_attempts;
DROP FUNCTION IF EXISTS freeze_repair_attempt();

DROP TRIGGER IF EXISTS append_only ON deal_addons;
DROP TRIGGER IF EXISTS append_only ON deal_documents;
DROP TRIGGER IF EXISTS append_only ON deal_evidence;

DROP TABLE IF EXISTS deal_repair_attempts CASCADE;
DROP TABLE IF EXISTS deal_documents CASCADE;
DROP TABLE IF EXISTS document_templates CASCADE;
DROP TABLE IF EXISTS deal_evidence CASCADE;
DROP TABLE IF EXISTS deal_addons CASCADE;
DROP TABLE IF EXISTS deals CASCADE;

DROP TYPE IF EXISTS signature_method;
DROP TYPE IF EXISTS evidence_kind;
DROP TYPE IF EXISTS contract_formation;
DROP TYPE IF EXISTS deal_state;

COMMIT;
