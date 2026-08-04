BEGIN;

DROP TRIGGER IF EXISTS append_only ON channel_sync_events;

DROP TABLE IF EXISTS channel_rules CASCADE;
DROP TABLE IF EXISTS channel_sync_events CASCADE;
DROP TABLE IF EXISTS channel_overrides CASCADE;
DROP TABLE IF EXISTS channel_listings CASCADE;
DROP TABLE IF EXISTS channels CASCADE;

DROP TYPE IF EXISTS sync_outcome;
DROP TYPE IF EXISTS sync_action;
DROP TYPE IF EXISTS listing_status;
DROP TYPE IF EXISTS channel_key;

COMMIT;
