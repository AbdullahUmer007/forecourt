BEGIN;
-- Exclusion checks cover every site, including rows hidden by caller RLS.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_staff_no_overlap EXCLUDE USING gist
 (tenant_id WITH =, assigned_to WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'scheduled');
ALTER TABLE appointments ADD CONSTRAINT appointments_customer_no_overlap EXCLUDE USING gist
 (tenant_id WITH =, contact_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'scheduled');
COMMIT;
