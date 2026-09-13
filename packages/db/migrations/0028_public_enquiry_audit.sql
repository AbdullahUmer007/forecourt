-- Public enquiries append audit events, but cannot read private CRM records.
BEGIN;
GRANT INSERT ON audit_events TO app_public;
COMMIT;
