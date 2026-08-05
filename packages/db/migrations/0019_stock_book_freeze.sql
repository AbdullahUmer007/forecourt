-- 0019: the stock book can actually be completed.
--
-- M11 declared `stock_book_entries` blanket append-only:
--
--     SELECT make_append_only('stock_book_entries');
--
-- while the same migration's own column comments say
--
--     -- 2–7: the purchase side, completed at book-in.
--     -- 8–12: the sale side, completed at invoice.
--
-- Those two statements contradict each other. `make_append_only` installs a
-- BEFORE UPDATE OR DELETE trigger that refuses every update, so the sale side
-- could never be written and the twelve mandatory fields could never all be
-- present. The table was unusable for the one thing it exists for, and nothing
-- caught it because M11 shipped with a domain and a schema but no screen and
-- no write path.
--
-- The fix is the treatment `invoices` already has in the same migration, for
-- reasons that migration states plainly: an invoice "has a lawful lifecycle —
-- draft → issued → paid — so a blanket UPDATE ban would make it impossible to
-- issue one. What must be frozen is the CONTENT once issued, not the row."
-- A stock book entry has exactly the same shape: purchase side at book-in,
-- sale side at invoice, immutable forever after.
--
-- So this replaces the blanket ban with a content freeze that is STRICTER
-- than append-only in the ways that matter:
--
--   * deletion is refused, always
--   * the entry number, the vehicle and the purchase side (fields 2–7) are
--     immutable from creation — they are what was true at book-in
--   * the sale side (fields 8–12) may be written exactly ONCE, and only while
--     `sale_date` is null; once the sale is recorded nothing moves again
--   * a correction reference cannot be changed, so an adjusting entry cannot
--     be re-pointed at a different original
--
-- Corrections remain what they always were: a new entry with its own number,
-- `corrects_entry_id` set and a stated reason. The original is never edited.
--
-- Rollback: 0019_stock_book_freeze.down.sql restores the blanket trigger,
-- which returns the table to being unwritable but preserves every row.

BEGIN;

CREATE OR REPLACE FUNCTION freeze_stock_book_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'A stock book entry cannot be deleted. HMRC requires it for six years; correct it with an adjusting entry.';
  END IF;

  -- Identity and the purchase side: what was true at book-in, forever.
  IF NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
     OR NEW.entry_number IS DISTINCT FROM OLD.entry_number
     OR NEW.vehicle_id   IS DISTINCT FROM OLD.vehicle_id
     OR NEW.purchase_date        IS DISTINCT FROM OLD.purchase_date
     OR NEW.purchase_invoice_ref IS DISTINCT FROM OLD.purchase_invoice_ref
     OR NEW.purchase_price_pence IS DISTINCT FROM OLD.purchase_price_pence
     OR NEW.seller_name          IS DISTINCT FROM OLD.seller_name
     OR NEW.seller_address       IS DISTINCT FROM OLD.seller_address
     OR NEW.registration         IS DISTINCT FROM OLD.registration
     OR NEW.vehicle_description  IS DISTINCT FROM OLD.vehicle_description THEN
    RAISE EXCEPTION
      'The entry number and the purchase side of a stock book entry are fixed. Raise an adjusting entry instead.';
  END IF;

  -- A correction cannot be re-pointed at a different original.
  IF NEW.corrects_entry_id IS DISTINCT FROM OLD.corrects_entry_id
     OR NEW.correction_reason IS DISTINCT FROM OLD.correction_reason THEN
    RAISE EXCEPTION 'The correction reference on a stock book entry is fixed.';
  END IF;

  -- The sale side may be written once, and only before a sale is recorded.
  IF OLD.sale_date IS NOT NULL THEN
    IF NEW.sale_date           IS DISTINCT FROM OLD.sale_date
       OR NEW.sale_invoice_number IS DISTINCT FROM OLD.sale_invoice_number
       OR NEW.buyer_name          IS DISTINCT FROM OLD.buyer_name
       OR NEW.buyer_address       IS DISTINCT FROM OLD.buyer_address
       OR NEW.selling_price_pence IS DISTINCT FROM OLD.selling_price_pence
       OR NEW.margin_pence        IS DISTINCT FROM OLD.margin_pence
       OR NEW.vat_due_pence       IS DISTINCT FROM OLD.vat_due_pence
       OR NEW.vat_rule_version    IS DISTINCT FROM OLD.vat_rule_version THEN
      RAISE EXCEPTION
        'This sale is already recorded in the stock book. Correct it with an adjusting entry, which keeps both figures on the record.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS append_only ON stock_book_entries;
CREATE TRIGGER freeze_stock_book
  BEFORE UPDATE OR DELETE ON stock_book_entries
  FOR EACH ROW EXECUTE FUNCTION freeze_stock_book_entry();

COMMIT;
