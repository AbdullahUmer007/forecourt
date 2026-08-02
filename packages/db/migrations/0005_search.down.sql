BEGIN;
DROP TRIGGER IF EXISTS append_only ON search_events;
DROP TABLE IF EXISTS search_events CASCADE;   -- drops its partitions with it
DROP TABLE IF EXISTS saved_searches CASCADE;
DROP TABLE IF EXISTS shortlist_items CASCADE;
DROP TABLE IF EXISTS shortlists CASCADE;
DROP TYPE IF EXISTS shortlist_owner;
DROP TYPE IF EXISTS alert_frequency;
COMMIT;
