BEGIN;
DROP TRIGGER IF EXISTS vehicle_media_count_sync ON vehicle_media;
DROP FUNCTION IF EXISTS sync_published_photo_count();
DROP TABLE IF EXISTS media_processing_jobs CASCADE;
DROP TABLE IF EXISTS vehicle_media CASCADE;
DROP TYPE IF EXISTS media_status;
DROP TYPE IF EXISTS shot_kind;
DROP TYPE IF EXISTS media_kind;
COMMIT;
