BEGIN;

DROP TRIGGER IF EXISTS freeze_period ON prep_blocks;
DROP TRIGGER IF EXISTS freeze_period ON prep_stage_events;
DROP FUNCTION IF EXISTS freeze_prep_period();

DROP TABLE IF EXISTS prep_blocks CASCADE;
DROP TABLE IF EXISTS prep_parts CASCADE;
DROP TABLE IF EXISTS prep_tasks CASCADE;
DROP TABLE IF EXISTS prep_stage_events CASCADE;
DROP TABLE IF EXISTS prep_cards CASCADE;
DROP TABLE IF EXISTS prep_stages CASCADE;

DROP TYPE IF EXISTS prep_block_reason;
DROP TYPE IF EXISTS prep_task_source;
DROP TYPE IF EXISTS prep_task_status;

COMMIT;
