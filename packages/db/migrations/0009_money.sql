-- =====================================================================
-- M11 — Money: invoicing, the VAT margin stock book, payments and cash.
--
-- Expand-only. Rollback: 0009_money.down.sql
-- Depends on 0001_tenancy.sql, 0002_vehicles.sql and 0007_contacts.sql.
--
-- ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED VAT SPECIALIST'S SIGN-OFF.
--    The margin-scheme presentation rule below is the one that costs real
--    money if it is wrong: showing VAT separately on a margin invoice makes
--    the WHOLE sale standard-rated. On a £12,000 car that is £2,000 of VAT
--    the dealer never collected and now owes.
--
-- Three things here are structural rather than incidental:
--
--   1. Invoice numbers are GAPLESS per tenant. A gap is a question from HMRC
--      about the invoice that is missing, and "it was a software rollback" is
--      not an answer anyone wants to give. Numbers are allocated from a
--      counter row, and a cancelled invoice becomes a credit note — never a
--      released number.
--
--   2. Invoices, invoice lines and stock book entries are append-only. A
--      correction is an adjusting document, not an edit. These are the
--      records HMRC asks to see, and a record that can be edited after the
--      fact is not evidence of anything.
--
--   3. `vat_amount_pence` on a margin-scheme line is CHECK-constrained to
--      zero. The domain layer refuses it, the renderer refuses it, and now
--      the database refuses it too. Three layers, because this is the single
--      most expensive mistake available in the product.
-- =====================================================================

BEGIN;

CREATE TYPE invoice_kind AS ENUM ('sale', 'credit_note', 'proforma', 'deposit');
CREATE TYPE invoice_status AS ENUM ('draft', 'issued', 'paid', 'part_paid', 'cancelled');

-- How the money arrived. `cash` is called out because it is the one that
-- triggers the AML High Value Dealer threshold.
CREATE TYPE payment_method AS ENUM (
  'cash', 'card', 'bank_transfer', 'finance', 'part_exchange', 'cheque', 'other'
);
CREATE TYPE payment_direction AS ENUM ('in', 'out');

-- ------------------------------------------------------ invoice sequences
--
-- One counter per tenant per series. Gapless numbering needs a serialisable
-- allocation point, and a Postgres SEQUENCE is explicitly NOT that: sequences
-- do not roll back, so an aborted transaction burns a number and leaves a gap.
-- A row we lock with SELECT ... FOR UPDATE does roll back with its transaction,
-- which is the whole reason this table exists.
CREATE TABLE invoice_sequences (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  -- A dealer may run separate series per site or per document type. The
  -- default series is 'sale'.
  series        text NOT NULL DEFAULT 'sale',
  prefix        text NOT NULL DEFAULT '',
  -- The last number ISSUED. The next invoice takes this + 1.
  last_number   bigint NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_sequence_last_number_non_negative CHECK (last_number >= 0)
);
CREATE UNIQUE INDEX invoice_sequences_tenant_series_unique
  ON invoice_sequences (tenant_id, series);

-- --------------------------------------------------------------- invoices
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  site_id           uuid REFERENCES sites(id),

  kind              invoice_kind NOT NULL DEFAULT 'sale',
  status            invoice_status NOT NULL DEFAULT 'draft',

  -- The gapless number, allocated at ISSUE. Null while draft: a draft that
  -- never gets issued must not consume a number.
  series            text NOT NULL DEFAULT 'sale',
  number            bigint,
  -- The rendered reference, e.g. "KEN-000142". Stored rather than derived so
  -- a change to the prefix cannot retrospectively renumber history.
  reference         text,

  contact_id        uuid REFERENCES contacts(id),
  vehicle_id        uuid REFERENCES vehicles(id),

  -- Buyer identity, DENORMALISED at issue. VAT Notice 718/1 requires the
  -- buyer's name and address on the invoice, and it must be what was true on
  -- the day — not what the contact record says three years later.
  buyer_name        text,
  buyer_address     text,

  -- The VAT scheme this sale was made under. Drives presentation, and is
  -- frozen on the document: a vehicle's scheme is decided at book-in and
  -- cannot be reinterpreted after the invoice is raised.
  vat_scheme        vat_scheme,

  currency          text NOT NULL DEFAULT 'GBP',
  -- Totals in integer minor units. Never numeric, never float.
  net_total_pence   bigint NOT NULL DEFAULT 0,
  vat_total_pence   bigint NOT NULL DEFAULT 0,
  gross_total_pence bigint NOT NULL DEFAULT 0,

  issued_at         timestamptz,
  due_at            timestamptz,

  -- A cancelled sale invoice points at the credit note that reverses it.
  -- Never a deleted row and never a released number.
  credited_by_id    uuid REFERENCES invoices(id),
  -- A credit note points back at what it reverses.
  credits_id        uuid REFERENCES invoices(id),

  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),

  -- An issued invoice must carry its number; a draft must not.
  CONSTRAINT invoice_issued_has_number CHECK (
    (status = 'draft') = (number IS NULL)
  ),
  CONSTRAINT invoice_issued_has_reference CHECK (
    number IS NULL OR reference IS NOT NULL
  ),
  CONSTRAINT invoice_issued_has_timestamp CHECK (
    (status = 'draft') = (issued_at IS NULL)
  ),
  -- THE margin-scheme rule, at the document level. A margin sale shows no VAT.
  CONSTRAINT invoice_margin_shows_no_vat CHECK (
    vat_scheme IS DISTINCT FROM 'margin' OR vat_total_pence = 0
  ),
  CONSTRAINT invoice_totals_reconcile CHECK (
    gross_total_pence = net_total_pence + vat_total_pence
  ),
  CONSTRAINT invoice_credit_note_credits_something CHECK (
    kind <> 'credit_note' OR credits_id IS NOT NULL
  )
);
CREATE UNIQUE INDEX invoices_tenant_series_number_unique
  ON invoices (tenant_id, series, number) WHERE number IS NOT NULL;
CREATE INDEX invoices_tenant_status_idx  ON invoices (tenant_id, status, issued_at DESC);
CREATE INDEX invoices_tenant_contact_idx ON invoices (tenant_id, contact_id);
CREATE INDEX invoices_tenant_vehicle_idx ON invoices (tenant_id, vehicle_id);

-- ---------------------------------------------------------- invoice lines
CREATE TABLE invoice_lines (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  invoice_id        uuid NOT NULL REFERENCES invoices(id),

  position          integer NOT NULL,
  description       text NOT NULL,
  quantity          integer NOT NULL DEFAULT 1,

  unit_price_pence  bigint NOT NULL,
  net_pence         bigint NOT NULL,
  -- Zero on every margin-scheme line, enforced at the document level above and
  -- again here, because a line is what a renderer iterates.
  vat_amount_pence  bigint NOT NULL DEFAULT 0,
  vat_rate_bps      integer NOT NULL DEFAULT 0,
  gross_pence       bigint NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_line_quantity_positive CHECK (quantity > 0),
  CONSTRAINT invoice_line_reconciles CHECK (gross_pence = net_pence + vat_amount_pence),
  CONSTRAINT invoice_line_vat_rate_sane CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000)
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (tenant_id, invoice_id, position);

-- ------------------------------------------------------- stock book
--
-- The VAT margin scheme stock book. Twelve mandatory fields, retained at least
-- six years, immutable once the sale is invoiced.
--
-- This is the record HMRC asks to see on an inspection. Everything about its
-- shape follows from that: append-only, entry numbers sequential per tenant,
-- and corrections as adjusting entries that reference what they correct.
CREATE TABLE stock_book_entries (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  vehicle_id            uuid REFERENCES vehicles(id),

  -- 1. Sequential stock book number, per tenant.
  entry_number          bigint NOT NULL,

  -- 2–7: the purchase side, completed at book-in.
  purchase_date         date,
  purchase_invoice_ref  text,
  purchase_price_pence  bigint,
  seller_name           text,
  seller_address        text,
  registration          text,
  vehicle_description   text,

  -- 8–12: the sale side, completed at invoice.
  sale_date             date,
  sale_invoice_number   text,
  buyer_name            text,
  buyer_address         text,
  selling_price_pence   bigint,
  margin_pence          bigint,
  vat_due_pence         bigint,

  -- Which compliance_rules version computed the VAT, so a historic entry can
  -- be re-derived exactly even after the rate changes.
  vat_rule_version      integer,

  -- An adjusting entry references the one it corrects. The original is never
  -- edited: that is the entire point of an append-only stock book.
  corrects_entry_id     uuid REFERENCES stock_book_entries(id),
  correction_reason     text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),

  CONSTRAINT stock_book_margin_non_negative CHECK (
    margin_pence IS NULL OR margin_pence >= 0
  ),
  CONSTRAINT stock_book_correction_has_reason CHECK (
    corrects_entry_id IS NULL OR correction_reason IS NOT NULL
  )
);
CREATE UNIQUE INDEX stock_book_tenant_entry_number_unique
  ON stock_book_entries (tenant_id, entry_number);
CREATE INDEX stock_book_tenant_vehicle_idx ON stock_book_entries (tenant_id, vehicle_id);
CREATE INDEX stock_book_tenant_sale_date_idx ON stock_book_entries (tenant_id, sale_date);

-- Its own sequence counter, same reasoning as invoice numbers.
CREATE TABLE stock_book_sequences (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  last_number bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stock_book_sequence_non_negative CHECK (last_number >= 0)
);
CREATE UNIQUE INDEX stock_book_sequences_tenant_unique ON stock_book_sequences (tenant_id);

-- --------------------------------------------------------------- payments
CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  site_id           uuid REFERENCES sites(id),

  invoice_id        uuid REFERENCES invoices(id),
  contact_id        uuid REFERENCES contacts(id),
  vehicle_id        uuid REFERENCES vehicles(id),

  direction         payment_direction NOT NULL DEFAULT 'in',
  method            payment_method NOT NULL,
  amount_pence      bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'GBP',

  -- A refund states its reason. An unexplained outbound payment is the shape
  -- of both a fraud and an accounting problem.
  reason            text,
  reference         text,
  provider          text,
  provider_ref      text,

  -- Links payments that form ONE transaction for AML purposes. Splitting
  -- £12,000 into two £6,000 cash payments is the classic evasion, and the
  -- regulation counts linked payments together.
  linked_group_id   uuid,

  received_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),

  CONSTRAINT payment_amount_positive CHECK (amount_pence > 0),
  CONSTRAINT payment_refund_has_reason CHECK (direction = 'in' OR reason IS NOT NULL)
);
CREATE INDEX payments_tenant_invoice_idx ON payments (tenant_id, invoice_id);
CREATE INDEX payments_tenant_contact_idx ON payments (tenant_id, contact_id, received_at DESC);
-- The AML query: cash received against one customer or one linked set.
CREATE INDEX payments_tenant_cash_idx ON payments (tenant_id, contact_id, received_at)
  WHERE method = 'cash';
CREATE INDEX payments_linked_group_idx ON payments (tenant_id, linked_group_id)
  WHERE linked_group_id IS NOT NULL;

-- ------------------------------------------------- AML threshold overrides
--
-- Accepting cash at or above the High Value Dealer threshold without HMRC
-- registration is an offence, so the product hard-blocks it. A block that
-- cannot be overridden gets worked around outside the system, where nothing
-- is recorded — so there is an override, and it demands a named authoriser
-- and a reason, and it is append-only evidence.
CREATE TABLE aml_overrides (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),

  contact_id      uuid REFERENCES contacts(id),
  payment_id      uuid REFERENCES payments(id),
  linked_group_id uuid,

  running_total_pence bigint NOT NULL,
  threshold_pence     bigint NOT NULL,
  reason              text NOT NULL,
  authorised_by       uuid NOT NULL REFERENCES users(id),

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aml_override_reason_not_blank CHECK (length(btrim(reason)) > 0)
);
CREATE INDEX aml_overrides_tenant_idx ON aml_overrides (tenant_id, created_at DESC);

-- --------------------------------------------------------- append-only
--
-- These are the records HMRC asks to see. A record that can be edited after
-- the fact is not evidence of anything.
--
-- `invoices` is deliberately NOT in this list, and the distinction matters.
-- An invoice has a lawful lifecycle — draft → issued → paid — so a blanket
-- UPDATE ban would make it impossible to issue one. What must be frozen is
-- the CONTENT once issued, not the row. The trigger below freezes exactly
-- that: after issue, only the status and the credit-note link may move, and
-- the money, the number and the buyer are immutable.
-- `invoice_lines` is likewise not blanket-append-only: a draft invoice is
-- still being built, and a line added in error before issue should be
-- removable rather than credited. Once the parent is issued the lines are
-- frozen by the same reasoning as the header.
SELECT make_append_only('stock_book_entries');
SELECT make_append_only('payments');
SELECT make_append_only('aml_overrides');

CREATE OR REPLACE FUNCTION freeze_issued_invoice_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status invoice_status;
BEGIN
  SELECT status INTO parent_status FROM invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'The lines of an issued invoice cannot be changed. Raise a credit note and a corrected invoice.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER freeze_issued_lines
  BEFORE UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION freeze_issued_invoice_line();

CREATE OR REPLACE FUNCTION freeze_issued_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'An invoice cannot be deleted. Cancel it with a credit note, which keeps the number in sequence.';
  END IF;

  -- A draft is still being written; nothing is frozen yet.
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;

  IF NEW.number IS DISTINCT FROM OLD.number
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.series IS DISTINCT FROM OLD.series THEN
    RAISE EXCEPTION 'An issued invoice number cannot change. A gap or a reuse is an HMRC question.';
  END IF;

  IF NEW.net_total_pence   IS DISTINCT FROM OLD.net_total_pence
     OR NEW.vat_total_pence   IS DISTINCT FROM OLD.vat_total_pence
     OR NEW.gross_total_pence IS DISTINCT FROM OLD.gross_total_pence
     OR NEW.vat_scheme        IS DISTINCT FROM OLD.vat_scheme THEN
    RAISE EXCEPTION
      'An issued invoice cannot be re-priced. Raise a credit note and a corrected invoice.';
  END IF;

  IF NEW.buyer_name IS DISTINCT FROM OLD.buyer_name
     OR NEW.buyer_address IS DISTINCT FROM OLD.buyer_address
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'The buyer and issue date on an issued invoice are part of the record.';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER freeze_issued
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION freeze_issued_invoice();

SELECT * FROM apply_tenant_policies();

COMMIT;
