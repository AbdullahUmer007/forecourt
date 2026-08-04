-- =====================================================================
-- M16 — Channel feeds.
--
-- Expand-only. Rollback: 0013_channels.down.sql
-- Depends on 0002_vehicles, 0004_media.
--
-- There is no universal UK stock-feed standard. Every portal defines its own
-- schema, its own required fields and its own idea of a valid mileage, so the
-- design the spec calls for — and the only one that survives a fifth channel —
-- is ONE canonical internal vehicle model and one VERSIONED adapter per
-- channel.
--
-- Three things here are not bookkeeping:
--
--   1. A COST-OF-CREDIT FIGURE MUST NEVER REACH A FEED. On our own site a
--      payment renders through `<FinancePromotion>` with the representative
--      example beside it. In a feed, a third party renders our payload on
--      their page, in their layout, with no way to attach the example CONC
--      3.5.3R requires. The domain layer refuses to build such a payload; this
--      schema stores no finance column for one to hide in.
--
--   2. DELISTING IS A DEADLINE, NOT AN EVENT. A sold car left live on Auto
--      Trader generates enquiries the dealer cannot fulfil and is arguably a
--      misleading action under the CPRs. `delist_due_at` is written when the
--      vehicle sells, so a car that should have come down is a QUERY rather
--      than a job someone hopes ran.
--
--   3. A FEED THAT SILENTLY STOPS IS THE COMMON FAILURE. Nobody notices for
--      three weeks that the whole forecourt is missing from a portal. Every
--      attempt is logged with its outcome, so "last successful sync" is a
--      fact rather than an assumption.
-- =====================================================================

BEGIN;

CREATE TYPE channel_key AS ENUM (
  'auto_trader', 'ebay_motors_group', 'cargurus', 'carwow',
  'meta_catalogue', 'google_vehicle_ads', 'generic_xml', 'generic_csv'
);

CREATE TYPE listing_status AS ENUM (
  'not_published', 'queued', 'published', 'failed', 'delist_queued', 'delisted'
);

CREATE TYPE sync_action AS ENUM ('publish', 'update', 'delist', 'validate');

CREATE TYPE sync_outcome AS ENUM ('success', 'rejected', 'transport_error', 'skipped');

-- ------------------------------------------------------------- channels
CREATE TABLE channels (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  site_id             uuid REFERENCES sites(id),

  channel             channel_key NOT NULL,
  display_name        text NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,

  -- The adapter that built the last payload. Stored per channel because a
  -- portal changes its schema without asking, and "which mapping produced
  -- this?" is the first question when a feed starts being rejected.
  adapter_version     integer NOT NULL DEFAULT 1,

  -- Credentials live in the secret store; this is the handle, never the key.
  credentials_ref     text,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- §10.2: immediate by default, but some dealers keep a sold car up for a
  -- day to catch "similar vehicle" enquiries. Both are supported; neither is
  -- left to a hope that someone remembers.
  delist_delay_minutes integer NOT NULL DEFAULT 0,

  -- Per-channel monthly cost, for M18's Channel P&L. Money as minor units.
  monthly_cost_pence  bigint,
  currency            text NOT NULL DEFAULT 'GBP',

  last_success_at     timestamptz,
  last_attempt_at     timestamptz,
  last_error          text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_by          uuid REFERENCES users(id),

  CONSTRAINT channel_delay_non_negative CHECK (delist_delay_minutes >= 0),
  CONSTRAINT channel_cost_non_negative CHECK (
    monthly_cost_pence IS NULL OR monthly_cost_pence >= 0
  ),
  CONSTRAINT channel_adapter_version_positive CHECK (adapter_version > 0)
);
CREATE UNIQUE INDEX channels_tenant_channel_unique
  ON channels (tenant_id, channel, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX channels_enabled_idx ON channels (tenant_id, enabled) WHERE enabled;

-- ------------------------------------------------------------- listings
--
-- One row per vehicle per channel. The per-vehicle publish status §10.2 asks
-- for, and the thing a dealer looks at when they ask "why isn't my car on
-- Auto Trader?".
CREATE TABLE channel_listings (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  channel_id        uuid NOT NULL REFERENCES channels(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicles(id),

  status            listing_status NOT NULL DEFAULT 'not_published',

  -- The portal's own identifier and the live URL, once it has one. The URL is
  -- what a dealer actually wants: "show me my advert".
  external_id       text,
  external_url      text,

  -- Rule 8: feed publishes deduplicate by payload hash. Without this a nightly
  -- rebuild re-pushes every unchanged car to every channel every night, which
  -- is how a dealer's rate limit gets exhausted by their own stock.
  payload_hash      text,

  last_published_at timestamptz,
  last_attempt_at   timestamptz,
  last_error        text,
  error_count       integer NOT NULL DEFAULT 0,

  -- When this listing must be gone by. Written when the vehicle sells or is
  -- reserved; a car past this with status still 'published' is an overdue
  -- delisting, findable by query rather than by hoping a job ran.
  delist_due_at     timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT listing_error_count_non_negative CHECK (error_count >= 0),
  -- A published listing must say when. Without it "last successful sync" is a
  -- guess, and the feed health monitor is the feature that exists to stop
  -- guessing.
  CONSTRAINT listing_published_has_timestamp CHECK (
    status <> 'published' OR last_published_at IS NOT NULL
  ),
  CONSTRAINT listing_failed_has_error CHECK (
    status <> 'failed' OR last_error IS NOT NULL
  )
);
CREATE UNIQUE INDEX channel_listings_unique
  ON channel_listings (tenant_id, channel_id, vehicle_id);
CREATE INDEX channel_listings_status_idx
  ON channel_listings (tenant_id, status, last_attempt_at);
CREATE INDEX channel_listings_vehicle_idx ON channel_listings (tenant_id, vehicle_id);
-- The list that matters: cars that should be gone and are not.
CREATE INDEX channel_listings_overdue_delist_idx
  ON channel_listings (tenant_id, delist_due_at)
  WHERE delist_due_at IS NOT NULL AND status IN ('published', 'delist_queued');

-- ------------------------------------------------------------ overrides
--
-- §10.2: some dealers advertise a different price, description or photo set
-- per channel. Held separately from the vehicle so the vehicle stays the
-- single source of truth and an override is visibly an override.
--
-- The advertised price must be the price honoured (§8.3), so an override is a
-- REAL price for that channel, not a teaser.
CREATE TABLE channel_overrides (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  channel_id      uuid NOT NULL REFERENCES channels(id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),

  price_pence     bigint,
  headline        text,
  description     text,
  -- Media ids in the order this channel should receive them. Null means "use
  -- the vehicle's own order".
  media_ids       uuid[],
  features        text[],

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),
  updated_by      uuid REFERENCES users(id),

  CONSTRAINT channel_override_price_non_negative CHECK (
    price_pence IS NULL OR price_pence >= 0
  )
);
CREATE UNIQUE INDEX channel_overrides_unique
  ON channel_overrides (tenant_id, channel_id, vehicle_id);

-- ---------------------------------------------------------- sync events
--
-- APPEND-ONLY. Every attempt, successful or not, with the raw response.
--
-- Rule 8 requires a stored raw response for external calls, and this is the
-- table that makes "the feed has been broken for three weeks" a query instead
-- of a discovery. It is also the evidence when a portal insists it never
-- received something.
CREATE TABLE channel_sync_events (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  channel_id        uuid NOT NULL REFERENCES channels(id),
  vehicle_id        uuid REFERENCES vehicles(id),

  action            sync_action NOT NULL,
  outcome           sync_outcome NOT NULL,

  -- Rule 8: an idempotency key on every external call.
  idempotency_key   text NOT NULL,
  adapter_version   integer NOT NULL,

  http_status       integer,
  -- Human-readable, because "422" tells a dealer nothing and the error list is
  -- read by the marketing role, not by us.
  message           text,
  raw_response      jsonb,
  duration_ms       integer,

  occurred_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_event_key_not_blank CHECK (length(btrim(idempotency_key)) > 0),
  -- Anything that did not succeed must say why, or the error list is a list of
  -- blanks.
  CONSTRAINT sync_event_failure_has_message CHECK (
    outcome = 'success' OR message IS NOT NULL
  )
);
CREATE INDEX channel_sync_events_channel_idx
  ON channel_sync_events (tenant_id, channel_id, occurred_at DESC);
CREATE INDEX channel_sync_events_vehicle_idx
  ON channel_sync_events (tenant_id, vehicle_id, occurred_at DESC);
-- Deduplicates a retried call, per rule 8.
CREATE UNIQUE INDEX channel_sync_events_idempotency_unique
  ON channel_sync_events (tenant_id, idempotency_key);

-- ---------------------------------------------------- auto-publish rules
--
-- §10.2: "publish to Auto Trader when status = Live and photos ≥ 8".
--
-- The conditions are columns rather than a jsonb expression on purpose: a
-- rules engine nobody can read is a rules engine that quietly publishes the
-- wrong cars, and these four cover what dealers actually ask for.
CREATE TABLE channel_rules (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  channel_id          uuid NOT NULL REFERENCES channels(id),

  enabled             boolean NOT NULL DEFAULT true,
  min_photos          integer,
  min_price_pence     bigint,
  max_price_pence     bigint,
  -- Empty means "any". Postgres arrays keep this readable in a way a jsonb
  -- predicate does not.
  makes               text[],
  exclude_makes       text[],

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),

  CONSTRAINT channel_rule_photos_non_negative CHECK (min_photos IS NULL OR min_photos >= 0),
  CONSTRAINT channel_rule_price_band_ordered CHECK (
    min_price_pence IS NULL OR max_price_pence IS NULL OR max_price_pence >= min_price_pence
  )
);
CREATE UNIQUE INDEX channel_rules_channel_unique ON channel_rules (tenant_id, channel_id);

-- --------------------------------------------------------- append-only
--
-- The sync log is the record of what we sent and what came back. Editing it
-- would destroy the only evidence of a feed that stopped working.
SELECT make_append_only('channel_sync_events');

SELECT * FROM apply_tenant_policies();

COMMIT;
