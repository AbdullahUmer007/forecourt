BEGIN;

-- Drop the forward references back to M7 first, or the contacts drop below
-- fails on a dependent constraint.
ALTER TABLE saved_searches DROP CONSTRAINT IF EXISTS saved_searches_consent_fk;
ALTER TABLE saved_searches DROP CONSTRAINT IF EXISTS saved_searches_contact_fk;
ALTER TABLE shortlists     DROP CONSTRAINT IF EXISTS shortlists_contact_fk;

DROP TRIGGER IF EXISTS append_only ON contact_consents;
DROP TRIGGER IF EXISTS append_only ON suppressions;
DROP TRIGGER IF EXISTS append_only ON contact_merges;

DROP TABLE IF EXISTS data_subject_requests CASCADE;
DROP TABLE IF EXISTS contact_merges CASCADE;
DROP TABLE IF EXISTS suppressions CASCADE;
DROP TABLE IF EXISTS contact_consents CASCADE;
DROP TABLE IF EXISTS consent_wordings CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;

DROP TYPE IF EXISTS vulnerability_driver;
DROP TYPE IF EXISTS contact_kind;
DROP TYPE IF EXISTS consent_source;
DROP TYPE IF EXISTS consent_channel;
DROP TYPE IF EXISTS consent_basis;

COMMIT;
