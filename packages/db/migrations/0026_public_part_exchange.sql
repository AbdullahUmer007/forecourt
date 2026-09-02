-- Public part-exchange writes a contact, a lead and a draft appraisal.
-- INSERT only, tenant-scoped by RLS. The shopfront still cannot SELECT those
-- tables. vat_invoice_received is the fact convertToStock already asks for.

BEGIN;

ALTER TABLE appraisals
  ADD COLUMN IF NOT EXISTS vat_invoice_received boolean;

GRANT INSERT ON contacts, leads, lead_events, appraisals TO app_public;

COMMIT;
