BEGIN;

REVOKE INSERT ON contacts, leads, lead_events, appraisals FROM app_public;

ALTER TABLE appraisals DROP COLUMN IF EXISTS vat_invoice_received;

COMMIT;
