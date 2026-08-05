-- Rollback 0019.
--
-- Restores the blanket append-only trigger. Note what that means: the stock
-- book becomes unwritable again and the sale side of any incomplete entry can
-- never be completed. Every existing row is preserved — this only changes what
-- may be written from here on.

BEGIN;

DROP TRIGGER IF EXISTS freeze_stock_book ON stock_book_entries;
DROP FUNCTION IF EXISTS freeze_stock_book_entry();

SELECT make_append_only('stock_book_entries');

COMMIT;
