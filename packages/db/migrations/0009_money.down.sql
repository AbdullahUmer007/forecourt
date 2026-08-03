BEGIN;

DROP TRIGGER IF EXISTS freeze_issued_lines ON invoice_lines;
DROP TRIGGER IF EXISTS freeze_issued ON invoices;
DROP FUNCTION IF EXISTS freeze_issued_invoice_line();
DROP FUNCTION IF EXISTS freeze_issued_invoice();

DROP TRIGGER IF EXISTS append_only ON aml_overrides;
DROP TRIGGER IF EXISTS append_only ON payments;
DROP TRIGGER IF EXISTS append_only ON stock_book_entries;

DROP TABLE IF EXISTS aml_overrides CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS stock_book_sequences CASCADE;
DROP TABLE IF EXISTS stock_book_entries CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_sequences CASCADE;

DROP TYPE IF EXISTS payment_direction;
DROP TYPE IF EXISTS payment_method;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS invoice_kind;

COMMIT;
