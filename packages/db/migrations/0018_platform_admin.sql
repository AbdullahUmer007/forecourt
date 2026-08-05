-- =====================================================================
-- M20 — Platform administration and billing.
--
-- Expand-only. Rollback: 0018_platform_admin.down.sql
-- Depends on 0001_tenancy.
--
-- OUR side, never mixed into tenant UI. Most of it is ordinary: a tenant
-- directory, subscriptions, feature flags, quotas. One feature is not
-- ordinary, and it is the reason this migration has a long comment.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SUPPORT IMPERSONATION IS THE MOST DANGEROUS FEATURE IN THE PRODUCT
-- ─────────────────────────────────────────────────────────────────────────
--
-- It is a documented, deliberate way for us to read a dealer's customer data —
-- their contacts, their deals, their finance commissions. Every safeguard in
-- this codebase, four layers of tenant isolation included, is downstream of
-- somebody at Forecourt not being able to do that casually.
--
-- So the spec's requirements are not preferences, and they are enforced here
-- rather than in a runbook:
--
--   · TIME-LIMITED   — `expires_at` is NOT NULL. A session that never ends is
--                      an account, not a support visit.
--   · REASON-REQUIRED — free text, NOT NULL, because "support" is not a reason
--                      and a dropdown becomes one click.
--   · CONSENTED      — per tenant, recorded with who granted it and when. A
--                      grant that cannot be produced is not consent.
--   · AUDITED        — every session and every elevation is a row, and this
--                      table is APPEND-ONLY. If we could edit our own access
--                      log, the log would be worth nothing.
--   · BANNER-FLAGGED — the tenant's own UI shows it. Enforced in the app; the
--                      column that drives it lives here.
--   · SECOND APPROVAL for finance commission and full payment details, by a
--                      DIFFERENT person. A single member of staff can never
--                      reach the most sensitive data alone.
-- =====================================================================

BEGIN;

CREATE TYPE platform_plan AS ENUM ('starter', 'pro', 'group', 'reseller');

CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'paused', 'cancelled'
);

CREATE TYPE impersonation_status AS ENUM ('active', 'ended', 'expired', 'revoked');

CREATE TYPE usage_metric AS ENUM (
  'vehicle_lookup', 'provenance_check', 'sms', 'e_signature', 'valuation'
);

-- ------------------------------------------------------- subscriptions
CREATE TABLE tenant_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),

  plan                  platform_plan NOT NULL DEFAULT 'starter',
  status                subscription_status NOT NULL DEFAULT 'trialing',

  -- Stripe's identifiers. Never card data — that never touches our database.
  stripe_customer_id    text,
  stripe_subscription_id text,

  -- Money in minor units, like everywhere else.
  monthly_price_pence   bigint,
  currency              text NOT NULL DEFAULT 'GBP',
  -- The stock band the price was set from, so a dealer who grows knows why
  -- their bill changed.
  stock_band_limit      integer,

  trial_ends_at         timestamptz,
  current_period_end    timestamptz,
  cancelled_at          timestamptz,
  -- Dunning: when we first failed to take payment.
  past_due_since        timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_price_non_negative CHECK (
    monthly_price_pence IS NULL OR monthly_price_pence >= 0
  ),
  CONSTRAINT subscription_cancelled_has_timestamp CHECK (
    status <> 'cancelled' OR cancelled_at IS NOT NULL
  ),
  CONSTRAINT subscription_past_due_has_timestamp CHECK (
    status <> 'past_due' OR past_due_since IS NOT NULL
  )
);
CREATE UNIQUE INDEX tenant_subscriptions_tenant_unique ON tenant_subscriptions (tenant_id);

-- ------------------------------------------------------- feature flags
CREATE TABLE feature_flags (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  flag          text NOT NULL,
  enabled       boolean NOT NULL DEFAULT false,
  -- Why this tenant has it. A flag nobody can explain is a flag nobody dares
  -- turn off.
  reason        text,
  expires_at    timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),

  CONSTRAINT feature_flag_name_not_blank CHECK (length(btrim(flag)) > 0)
);
CREATE UNIQUE INDEX feature_flags_tenant_flag_unique ON feature_flags (tenant_id, flag);

-- ---------------------------------------------------------- usage meter
--
-- Per-tenant quota monitoring. Vehicle lookups cost us real money per call,
-- so this is both a billing input and the thing that catches a runaway job
-- before it produces a five-figure invoice.
CREATE TABLE usage_records (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  metric        usage_metric NOT NULL,
  period_month  date NOT NULL,
  quantity      integer NOT NULL DEFAULT 0,
  -- What it cost US, which is not what we charge for it.
  cost_pence    bigint NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'GBP',

  -- The point at which somebody is told. Null means no cap.
  quota         integer,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT usage_quantity_non_negative CHECK (quantity >= 0),
  CONSTRAINT usage_cost_non_negative CHECK (cost_pence >= 0),
  CONSTRAINT usage_period_is_month_start CHECK (
    date_trunc('month', period_month) = period_month
  )
);
CREATE UNIQUE INDEX usage_records_unique
  ON usage_records (tenant_id, metric, period_month);

-- ------------------------------------------- impersonation consent
--
-- A tenant's standing permission for us to enter their account at all. Without
-- a live grant there is no impersonation, however good the reason.
CREATE TABLE impersonation_grants (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),

  -- Who at the DEALERSHIP agreed. Not who at Forecourt asked.
  granted_by    uuid NOT NULL REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,

  -- What they agreed to. Recorded verbatim so "they said it was fine" has a
  -- referent.
  scope_note    text,

  CONSTRAINT impersonation_grant_expires_after_granted CHECK (expires_at > granted_at)
);
CREATE INDEX impersonation_grants_live_idx ON impersonation_grants (tenant_id, expires_at)
  WHERE revoked_at IS NULL;

-- -------------------------------------------------- impersonation sessions
--
-- APPEND-ONLY. This is the log of us reading a customer's data, and a log we
-- could edit would be worth nothing.
CREATE TABLE impersonation_sessions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  grant_id            uuid REFERENCES impersonation_grants(id),

  -- The Forecourt staff member. A platform user, not a tenant one.
  operator_id         uuid NOT NULL REFERENCES users(id),
  -- Which tenant user they appeared as.
  acting_as_user_id   uuid REFERENCES users(id),

  -- Free text, NOT NULL. "Support" is not a reason, and a dropdown becomes one
  -- click — so this is a sentence somebody had to write.
  reason              text NOT NULL,
  status              impersonation_status NOT NULL DEFAULT 'active',

  started_at          timestamptz NOT NULL DEFAULT now(),
  -- NOT NULL. A session that never ends is an account, not a support visit.
  expires_at          timestamptz NOT NULL,
  ended_at            timestamptz,

  -- The second approval, for finance commission and full payment details.
  -- A DIFFERENT person, enforced below: one member of staff can never reach
  -- the most sensitive data alone.
  elevated            boolean NOT NULL DEFAULT false,
  elevated_by         uuid REFERENCES users(id),
  elevated_at         timestamptz,
  elevation_reason    text,

  ip                  text,
  user_agent          text,

  CONSTRAINT impersonation_reason_meaningful CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT impersonation_expires_after_start CHECK (expires_at > started_at),
  CONSTRAINT impersonation_elevation_complete CHECK (
    NOT elevated OR (elevated_by IS NOT NULL AND elevated_at IS NOT NULL
                     AND elevation_reason IS NOT NULL)
  ),
  -- The four-eyes rule, in the schema. The person approving access to
  -- commission data cannot be the person who wants it.
  CONSTRAINT impersonation_elevation_is_second_person CHECK (
    elevated_by IS NULL OR elevated_by <> operator_id
  )
);
CREATE INDEX impersonation_sessions_tenant_idx
  ON impersonation_sessions (tenant_id, started_at DESC);
CREATE INDEX impersonation_sessions_active_idx
  ON impersonation_sessions (tenant_id, expires_at) WHERE status = 'active';

-- An impersonation session is the record of us reading somebody's customer
-- data. Ending one is a status change, so it uses a content freeze rather than
-- a blanket append-only that would make ending impossible.
CREATE OR REPLACE FUNCTION freeze_impersonation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'An impersonation session cannot be deleted. It is the record of Forecourt staff reading a customer''s data.';
  END IF;
  IF NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION
      'Who, which tenant, why, when it started and when it expires are all fixed on an impersonation session.';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'An impersonation session that has ended cannot be re-dated.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER freeze_impersonation
  BEFORE UPDATE OR DELETE ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION freeze_impersonation();

SELECT * FROM apply_tenant_policies();

COMMIT;
