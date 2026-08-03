-- =====================================================================
-- M10 — Leads & communications.
--
-- Expand-only. Rollback: 0008_leads.down.sql
-- Depends on 0001_tenancy.sql, 0002_vehicles.sql and 0007_contacts.sql.
--
-- Two things here are load-bearing beyond the obvious:
--
--   1. `messages` records the CONSENT RECORD RELIED ON at the moment of
--      sending. Not "we checked" — which consent row, by id. A send whose
--      justification cannot be reproduced is not evidence of anything, which
--      is the finding at the centre of the post-Hopcraft liability.
--
--   2. Loss reasons are a constrained enum, never free text and never
--      optional. A dealer who cannot see why they lose deals cannot fix it,
--      and "not interested" typed into a box teaches nobody anything.
-- =====================================================================

BEGIN;

-- Where the lead came from. Marketplace leads are named individually because
-- the parser, the SLA and the consent position all differ by source — an
-- Auto Trader lead cannot rely on the dealer's own soft opt-in.
CREATE TYPE lead_source AS ENUM (
  'website_enquiry', 'website_callback', 'website_test_drive', 'website_part_ex',
  'website_reserve', 'saved_search', 'phone', 'walk_in',
  'autotrader', 'ebay', 'cargurus', 'facebook', 'other_marketplace'
);

-- The pipeline. Deliberately short: a stage list a sales executive cannot hold
-- in their head on a forecourt gets ignored, and an ignored pipeline is worse
-- than none because the dashboard then lies.
CREATE TYPE lead_stage AS ENUM (
  'new', 'contacted', 'qualified', 'appointment', 'test_drive', 'negotiating', 'won', 'lost'
);

-- Structured loss reasons. These are the ones a dealer can actually act on:
-- price and part-exchange are pricing decisions, stock is a buying decision,
-- finance is a lender-panel decision, and "went elsewhere" with a competitor
-- name is market intelligence.
CREATE TYPE loss_reason AS ENUM (
  'price_too_high', 'part_ex_valuation', 'vehicle_sold', 'no_suitable_stock',
  'finance_declined', 'finance_terms', 'bought_elsewhere', 'changed_mind',
  'timing', 'unresponsive', 'duplicate', 'not_genuine'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status AS ENUM (
  'queued', 'sent', 'delivered', 'failed', 'bounced', 'blocked'
);

-- ------------------------------------------------------------------ leads
CREATE TABLE leads (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  site_id           uuid REFERENCES sites(id),

  contact_id        uuid NOT NULL REFERENCES contacts(id),
  -- The car they asked about. Null for a general enquiry, and NOT cascaded:
  -- a sold vehicle keeps its leads, because "we had four enquiries on that
  -- Golf" is the demand signal a buyer uses.
  vehicle_id        uuid REFERENCES vehicles(id),

  source            lead_source NOT NULL,
  -- The marketplace's own reference, for deduplicating a lead that arrives
  -- twice — by email parse and by API — which every portal does.
  source_reference  text,

  stage             lead_stage NOT NULL DEFAULT 'new',
  assigned_to       uuid REFERENCES users(id),

  message           text,

  -- The SLA clock. `first_response_at` is stamped by the first OUTBOUND
  -- message, so it measures what the customer experienced rather than what
  -- someone ticked.
  received_at       timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  due_at            timestamptz,

  -- Closure. Both are NOT NULL when the stage is terminal, enforced below.
  closed_at         timestamptz,
  loss_reason       loss_reason,
  loss_detail       text,
  -- Who they bought from instead. Free text because it is a competitor name,
  -- and it is the most valuable field on a lost lead.
  lost_to           text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id),

  -- A lost lead MUST say why. Making this optional is listed as an
  -- anti-pattern in the domain skill for a reason: a dealer who cannot see
  -- why they lose cannot fix it, and the field never gets filled in later.
  CONSTRAINT lead_lost_needs_reason CHECK (
    stage <> 'lost' OR loss_reason IS NOT NULL
  ),
  CONSTRAINT lead_closed_when_terminal CHECK (
    (stage IN ('won', 'lost')) = (closed_at IS NOT NULL)
  )
);

CREATE INDEX leads_inbox_idx       ON leads (tenant_id, stage, received_at DESC);
CREATE INDEX leads_assigned_idx    ON leads (tenant_id, assigned_to, stage);
CREATE INDEX leads_contact_idx     ON leads (tenant_id, contact_id, received_at DESC);
CREATE INDEX leads_vehicle_idx     ON leads (tenant_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
-- The SLA board: unanswered leads, soonest deadline first.
CREATE INDEX leads_sla_idx         ON leads (tenant_id, due_at)
  WHERE first_response_at IS NULL AND closed_at IS NULL;
-- Marketplace dedupe. Partial so the many null references cost nothing.
CREATE UNIQUE INDEX leads_source_reference_unique
  ON leads (tenant_id, source, source_reference)
  WHERE source_reference IS NOT NULL;

-- ------------------------------------------------------------- lead_events
--
-- The lead's own history: every stage change, assignment and note, appended.
-- This is what makes "who touched this and when" answerable, and it is what
-- the SLA report is computed from rather than from mutable columns.
CREATE TABLE lead_events (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  lead_id      uuid NOT NULL REFERENCES leads(id),

  kind         text NOT NULL,
  from_stage   lead_stage,
  to_stage     lead_stage,
  detail       text,

  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES users(id),

  CONSTRAINT lead_event_kind_known CHECK (
    kind IN ('created', 'stage_changed', 'assigned', 'note', 'message_sent',
             'message_received', 'sla_breached', 'reopened')
  )
);
CREATE INDEX lead_events_lead_idx ON lead_events (tenant_id, lead_id, occurred_at);

SELECT make_append_only('lead_events');

-- ---------------------------------------------------------------- messages
--
-- Every message in or out, on any channel, in one table so the lead inbox can
-- interleave them into a single conversation.
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  lead_id         uuid REFERENCES leads(id),
  contact_id      uuid NOT NULL REFERENCES contacts(id),

  direction       message_direction NOT NULL,
  channel         consent_channel NOT NULL,
  -- Normalised destination, matching how `suppressions.destination` is stored,
  -- so a suppression written one way still matches a send addressed another.
  destination     text NOT NULL,

  subject         text,
  body            text NOT NULL,

  -- Marketing or service. This decides whether consent was required at all,
  -- so it is stored rather than inferred later from the body text.
  is_marketing    boolean NOT NULL,

  -- THE evidence column. Which consent record permitted this send — by id,
  -- not a boolean "we checked". Null is lawful only for an inbound message or
  -- a service message, enforced by the constraint below.
  consent_id      uuid REFERENCES contact_consents(id),
  -- The wording version shown, denormalised at send time. The wording row is
  -- append-only, but recording the version here means reproducing the message
  -- does not depend on resolving the record chain years later.
  wording_version integer,

  status          message_status NOT NULL DEFAULT 'queued',
  -- Why a send was blocked, in the words `canSend` produced. A blocked message
  -- is kept: "we did not send this, and here is why" is the record that
  -- demonstrates the gate works.
  blocked_reason  text,

  provider        text,
  provider_ref    text,
  -- Idempotency key. An outbound send that retries must not send twice.
  idempotency_key text,

  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),

  -- The golden rule of this module, at the database level: an outbound
  -- MARKETING message that was actually sent must cite the consent record
  -- that permitted it. No consent id, no marketing send.
  CONSTRAINT message_marketing_send_needs_consent CHECK (
    direction = 'inbound'
    OR is_marketing = false
    OR status IN ('queued', 'blocked', 'failed')
    OR consent_id IS NOT NULL
  ),
  CONSTRAINT message_blocked_has_reason CHECK (
    status <> 'blocked' OR blocked_reason IS NOT NULL
  )
);
CREATE INDEX messages_lead_idx    ON messages (tenant_id, lead_id, occurred_at);
CREATE INDEX messages_contact_idx ON messages (tenant_id, contact_id, occurred_at DESC);
CREATE UNIQUE INDEX messages_idempotency_unique
  ON messages (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

SELECT make_append_only('messages');

-- ------------------------------------------------------------ SLA policy
--
-- Per tenant, per source. A marketplace lead has minutes before the buyer
-- rings the next dealer on the list; a walk-in has none of that urgency.
CREATE TABLE lead_sla_policies (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  source            lead_source,
  respond_within_minutes integer NOT NULL,
  escalate_to       uuid REFERENCES users(id),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sla_minutes_positive CHECK (respond_within_minutes > 0)
);
-- One policy per source per tenant, and one default per tenant.
--
-- Two partial indexes rather than `coalesce(source::text, '*')`: an enum-to-text
-- cast is not IMMUTABLE, so Postgres refuses it in an index expression. The
-- pair says the same thing and costs nothing extra.
CREATE UNIQUE INDEX lead_sla_policies_tenant_source_unique
  ON lead_sla_policies (tenant_id, source) WHERE source IS NOT NULL;
CREATE UNIQUE INDEX lead_sla_policies_tenant_default_unique
  ON lead_sla_policies (tenant_id) WHERE source IS NULL;

SELECT * FROM apply_tenant_policies();

COMMIT;
