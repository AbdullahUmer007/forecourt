BEGIN;

DROP FUNCTION IF EXISTS count_auth_attempts(auth_attempt_kind, text, text, timestamptz);

DROP TABLE IF EXISTS auth_attempts CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS mfa_recovery_codes CASCADE;

DROP TYPE IF EXISTS auth_attempt_kind;

COMMIT;
