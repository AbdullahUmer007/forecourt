BEGIN;
DROP TRIGGER IF EXISTS append_only ON finance_promotion_log;
DROP TRIGGER IF EXISTS append_only ON initial_disclosure_versions;
DROP TRIGGER IF EXISTS append_only ON representative_examples;
DROP TRIGGER IF EXISTS append_only ON compliance_rules;
DROP TABLE IF EXISTS finance_promotion_log CASCADE;   -- drops its partitions with it
DROP TABLE IF EXISTS initial_disclosure_versions CASCADE;
DROP TABLE IF EXISTS vehicle_finance_quotes CASCADE;
DROP TABLE IF EXISTS representative_examples CASCADE;
DROP TABLE IF EXISTS finance_products CASCADE;
-- compliance_rules is NOT dropped: M1 created it and it holds VAT, AML and CRA
-- rules this module never touched. Roll back only what M8 added to it.
DELETE FROM compliance_rules WHERE key = 'conc.representative_example' AND version = 2;
ALTER TABLE compliance_rules DROP CONSTRAINT IF EXISTS compliance_rule_signoff_complete;
ALTER TABLE compliance_rules DROP COLUMN IF EXISTS signed_off_at;
ALTER TABLE compliance_rules DROP COLUMN IF EXISTS signed_off_by;
DROP TYPE IF EXISTS commission_type;
DROP TYPE IF EXISTS finance_product_type;
COMMIT;
