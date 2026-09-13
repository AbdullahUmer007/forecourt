BEGIN;
REVOKE INSERT ON audit_events FROM app_public;
COMMIT;
