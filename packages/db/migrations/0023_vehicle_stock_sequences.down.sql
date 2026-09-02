-- Rollback 0023.
--
-- Dropping the counter loses the allocation high-water mark, so re-applying
-- 0023 rebuilds it from `max(stock_sequence)` over the vehicles that exist at
-- that moment. That is correct as long as no vehicle has been hard-deleted —
-- and vehicles are soft-deleted (`deleted_at`), so the backfill still sees
-- them and cannot reissue a number that reached a stock book.

BEGIN;

DROP TABLE IF EXISTS vehicle_stock_sequences;

COMMIT;
