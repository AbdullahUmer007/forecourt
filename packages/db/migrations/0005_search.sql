-- =====================================================================
-- M7 — Public inventory experience: shortlists, saved searches, demand.
--
-- Expand-only. Rollback: 0005_search.down.sql
-- Depends on 0001_tenancy.sql and 0002_vehicles.sql.
-- =====================================================================

BEGIN;

CREATE TYPE alert_frequency AS ENUM ('instant', 'daily', 'weekly');
CREATE TYPE shortlist_owner AS ENUM ('anonymous', 'contact');

-- ---------------------------------------------------------------- shortlists
--
-- A shortlist starts anonymous, keyed by an unguessable token in a
-- first-party cookie, and is merged into a contact when the buyer identifies
-- themselves. The token is the only credential, so it is treated as one:
-- 32 random bytes, unique per tenant, and never logged.
--
-- `contacts` does not exist until M9. `contact_id` is deliberately a bare uuid
-- with no foreign key rather than a column added later — adding a NOT VALID FK
-- in M9 is an expand-only change; back-filling a whole column is not.
CREATE TABLE shortlists (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  site_id        uuid REFERENCES sites(id),

  owner_kind     shortlist_owner NOT NULL DEFAULT 'anonymous',
  token          text,
  contact_id     uuid,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  merged_into_id uuid REFERENCES shortlists(id),

  -- Exactly one owner. An anonymous list has a token; an identified one has a
  -- contact. A row with neither is unreachable; a row with both, ambiguous.
  CONSTRAINT shortlist_owner_exclusive CHECK (
    (owner_kind = 'anonymous' AND token IS NOT NULL AND contact_id IS NULL) OR
    (owner_kind = 'contact'   AND contact_id IS NOT NULL)
  ),
  -- 32 bytes base64url. A short or sequential token lets anyone read another
  -- buyer's saved cars — what they can afford and when they were looking.
  CONSTRAINT shortlist_token_unguessable CHECK (token IS NULL OR length(token) >= 43)
);

-- Tenant-scoped uniqueness. A token is meaningless outside its dealer, and
-- scoping the index this way makes a cross-tenant token lookup impossible
-- rather than merely unlikely.
CREATE UNIQUE INDEX shortlists_token_unique ON shortlists (tenant_id, token) WHERE token IS NOT NULL;
CREATE INDEX shortlists_contact_idx ON shortlists (tenant_id, contact_id) WHERE contact_id IS NOT NULL;

CREATE TABLE shortlist_items (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  shortlist_id  uuid NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  saved_at      timestamptz NOT NULL DEFAULT now(),
  -- Kept when the car sells, so the buyer sees "sold — here is a similar one"
  -- instead of silently losing the car they were deciding on.
  removed_at    timestamptz,
  notified_sold_at timestamptz
);
CREATE UNIQUE INDEX shortlist_items_unique ON shortlist_items (tenant_id, shortlist_id, vehicle_id);
CREATE INDEX shortlist_items_vehicle_idx ON shortlist_items (tenant_id, vehicle_id);

-- ---------------------------------------------------------------- saved searches
CREATE TABLE saved_searches (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  site_id          uuid REFERENCES sites(id),
  shortlist_id     uuid REFERENCES shortlists(id) ON DELETE SET NULL,
  contact_id       uuid,

  name             text NOT NULL,
  canonical_path   text NOT NULL,
  query            jsonb NOT NULL,
  frequency        alert_frequency NOT NULL DEFAULT 'daily',

  -- The M9 consent record permitting marketing on this channel. NULL means no
  -- alert may be sent — re-checked at SEND time, not at save time (rule 7).
  consent_id       uuid,
  consent_version  text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  unsubscribed_at  timestamptz,

  CONSTRAINT saved_search_has_an_owner CHECK (shortlist_id IS NOT NULL OR contact_id IS NOT NULL)
);
CREATE INDEX saved_searches_due_idx ON saved_searches (tenant_id, frequency, last_notified_at)
  WHERE unsubscribed_at IS NULL AND consent_id IS NOT NULL;

-- ---------------------------------------------------------------- demand signal
--
-- Append-only. "Eleven people looked for an automatic Qashqai under £12,000
-- last month and we had none" is a buying instruction, and a table that can be
-- edited after the fact is not evidence of anything.
--
-- Only thin and empty results are recorded. Logging every search would bury
-- the signal and store far more visitor behaviour than we need.
CREATE TABLE search_events (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  site_id        uuid REFERENCES sites(id),

  canonical_path text NOT NULL,
  make           text,
  model          text,
  max_price_pence bigint,
  keyword        text,
  result_count   integer NOT NULL,

  occurred_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT search_event_count_non_negative CHECK (result_count >= 0),
  CONSTRAINT search_event_price_non_negative CHECK (max_price_pence IS NULL OR max_price_pence >= 0),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Partitions are created a month ahead by a scheduled job. Two are seeded here
-- so the first insert cannot fail on a missing partition.
CREATE TABLE search_events_2026_08 PARTITION OF search_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE search_events_2026_09 PARTITION OF search_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE INDEX search_events_demand_idx ON search_events (tenant_id, make, model, occurred_at);

SELECT make_append_only('search_events');

SELECT * FROM apply_tenant_policies();

COMMIT;
