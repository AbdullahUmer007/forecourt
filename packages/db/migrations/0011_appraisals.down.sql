BEGIN;

DROP TRIGGER IF EXISTS freeze_settlement ON appraisal_settlements;
DROP FUNCTION IF EXISTS freeze_settlement();

DROP TRIGGER IF EXISTS append_only ON appraisal_offers;
DROP TRIGGER IF EXISTS append_only ON appraisal_valuations;

DROP TABLE IF EXISTS appraisal_settlements CASCADE;
DROP TABLE IF EXISTS appraisal_offers CASCADE;
DROP TABLE IF EXISTS appraisal_valuations CASCADE;
DROP TABLE IF EXISTS appraisal_costs CASCADE;
DROP TABLE IF EXISTS recon_cost_standards CASCADE;
DROP TABLE IF EXISTS appraisal_damage CASCADE;
DROP TABLE IF EXISTS appraisals CASCADE;

DROP TYPE IF EXISTS appraisal_cost_source;
DROP TYPE IF EXISTS recon_standard_source;
DROP TYPE IF EXISTS settlement_source;
DROP TYPE IF EXISTS disposal_route;
DROP TYPE IF EXISTS valuation_source;
DROP TYPE IF EXISTS panel_group;
DROP TYPE IF EXISTS damage_severity;
DROP TYPE IF EXISTS damage_type;
DROP TYPE IF EXISTS appraisal_seller_type;
DROP TYPE IF EXISTS appraisal_state;

COMMIT;
