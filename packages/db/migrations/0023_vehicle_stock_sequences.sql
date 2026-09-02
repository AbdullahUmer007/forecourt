-- 0023: stock numbers get a counter, because a car can now be booked in.
--
-- `vehicles` has carried `stock_number` and `stock_sequence` since 0002, with
-- a UNIQUE (tenant_id, site_id, stock_sequence). Nothing ever allocated one:
-- the only writer was `seed-demo.mjs`, which counts its own loop. The moment a
-- dealer can add a car through the CRM, two people booking in at once on a
-- Saturday morning both read the same max() and one of them hits that unique
-- index — so the allocation needs to be serialised somewhere.
--
-- A counter ROW, not a Postgres SEQUENCE, for the reason M11 recorded when it
-- numbered invoices: a sequence does not roll back. A failed book-in would
-- burn a stock number and leave a gap, and the stock number is one of the
-- twelve mandatory VAT stock book fields (VAT Notice 718/1) — gaps in that
-- series are the first thing an inspection asks about. `SELECT ... FOR UPDATE`
-- on this row serialises allocation within a site, and if the transaction
-- rolls back the number is never consumed.
--
-- Per SITE rather than per tenant, matching the unique index already on
-- `vehicles` and the `stock_number_prefix` already on `sites`: a two-branch
-- dealer runs KEN-0001 and OXF-0001 as separate books, which is what their
-- accountant expects.
--
-- Expand-only. Rollback: 0023_vehicle_stock_sequences.down.sql
-- Depends on 0001_tenancy.sql (tenants, sites, uuid_generate_v7,
-- apply_tenant_policies) and 0002_vehicles.sql (the vehicles it counts).

BEGIN;

CREATE TABLE vehicle_stock_sequences (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  site_id       uuid NOT NULL REFERENCES sites(id),

  -- Denormalised from sites.stock_number_prefix at first allocation. Stored
  -- rather than joined for the same reason invoices store their reference:
  -- renaming a site's prefix must not retrospectively renumber the cars
  -- already in the stock book.
  prefix        text NOT NULL DEFAULT '',

  -- The last number ALLOCATED. The next book-in takes this + 1.
  last_number   bigint NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_stock_sequence_last_number_non_negative CHECK (last_number >= 0)
);

CREATE UNIQUE INDEX vehicle_stock_sequences_tenant_site_unique
  ON vehicle_stock_sequences (tenant_id, site_id);

-- ---------------------------------------------------------------- backfill
--
-- Start each counter above whatever the seeds already wrote. Without this the
-- first book-in on a seeded database allocates 1, collides with the demo car
-- that already holds sequence 1, and the dealer sees a constraint violation on
-- their first ever use of the product.
INSERT INTO vehicle_stock_sequences (tenant_id, site_id, prefix, last_number)
SELECT v.tenant_id,
       v.site_id,
       coalesce(s.stock_number_prefix, ''),
       max(v.stock_sequence)
  FROM vehicles v
  JOIN sites s ON s.id = v.site_id
 GROUP BY v.tenant_id, v.site_id, s.stock_number_prefix
ON CONFLICT (tenant_id, site_id) DO NOTHING;

-- ---------------------------------------------------------------- protection
-- tenant_id and site_id both present, so this picks up the tenant_isolation
-- policy AND the RESTRICTIVE site_scope policy: a user attached to one branch
-- cannot allocate a number out of another branch's book.
SELECT * FROM apply_tenant_policies();

COMMIT;
