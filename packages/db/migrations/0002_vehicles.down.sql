-- Rollback for 0002_vehicles.sql. Reverse dependency order.
BEGIN;
DROP TRIGGER IF EXISTS vehicles_search_vector ON vehicles;
DROP FUNCTION IF EXISTS vehicles_search_vector_update();
DROP TABLE IF EXISTS vehicle_costs CASCADE;
DROP TABLE IF EXISTS vehicle_prices CASCADE;
DROP TABLE IF EXISTS vehicle_status_history CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TYPE IF EXISTS cost_category;
DROP TYPE IF EXISTS purchase_source;
DROP TYPE IF EXISTS vat_scheme;
DROP TYPE IF EXISTS vehicle_state;
COMMIT;
