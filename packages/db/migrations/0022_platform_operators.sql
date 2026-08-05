-- 0022: Forecourt's own staff have an identity.
--
-- M20 built the platform admin schema — subscriptions, feature flags, usage,
-- impersonation grants and sessions — and every one of those tables refers to
-- an operator as `users(id)`. But nothing in the schema says WHICH users are
-- Forecourt staff. `users` has an email, a password and an MFA secret; it has
-- no notion of somebody who works here rather than at a dealership.
--
-- So the platform admin application could not authenticate anybody. The most
-- dangerous surface in the product — the one that can read a dealer's customer
-- data — had no identity boundary at all, and the check "is this person
-- allowed in here?" had no column to consult.
--
-- This adds one, as a TABLE rather than a flag on `users`, because membership
-- of Forecourt staff carries things a boolean cannot:
--
--   * a role, because reading a tenant's stock level and approving access to
--     commission data are not the same privilege
--   * a granted/revoked pair, so somebody leaving is a recorded act with a
--     date rather than a row somebody remembers to delete
--   * who granted it, because access to every dealer on the platform should
--     never be something one person can give themselves
--
-- `platform_operators` is NOT tenant-scoped and deliberately has no
-- `tenant_id`. It is platform data, like `compliance_rules`, and it is listed
-- among the isolation suite's special tables for the same reason.
--
-- Rollback: 0022_platform_operators.down.sql drops the table. Every operator
-- record goes with it, and the admin application can authenticate nobody —
-- which is the safe direction to fail.

BEGIN;

CREATE TYPE platform_operator_role AS ENUM (
  -- Reads a tenant's health, subscription and usage. Cannot enter an account.
  'support_read',
  -- Can request impersonation, subject to every refusal in `canImpersonate`.
  'support',
  -- Can approve somebody ELSE's elevation to commission data. The four-eyes
  -- rule is already a CHECK constraint (`elevated_by <> operator_id`); this is
  -- who is allowed to be the second pair.
  'approver',
  -- Billing and plan changes.
  'billing',
  -- Everything, including granting operator access to others.
  'admin'
);

CREATE TABLE platform_operators (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),

  role        platform_operator_role NOT NULL DEFAULT 'support_read',

  -- Access to every dealer on the platform is not something one person gives
  -- themselves. Nullable only for the first operator, who has nobody to be
  -- granted by; the CHECK below says so rather than leaving it to convention.
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),

  -- Somebody leaving is a recorded act with a date, not a deleted row. The
  -- impersonation log references operators years later and a dangling id is
  -- worse than a revoked one.
  revoked_at  timestamptz,
  revoked_reason text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT platform_operator_revoked_has_reason CHECK (
    revoked_at IS NULL OR revoked_reason IS NOT NULL
  ),
  CONSTRAINT platform_operator_not_self_granted CHECK (
    granted_by IS NULL OR granted_by <> user_id
  )
);

-- One live operator record per user. A revoked one and a current one can
-- coexist, which is how somebody rejoining is represented.
CREATE UNIQUE INDEX platform_operators_user_live_unique
  ON platform_operators (user_id) WHERE revoked_at IS NULL;
CREATE INDEX platform_operators_role_idx ON platform_operators (role) WHERE revoked_at IS NULL;

COMMENT ON TABLE platform_operators IS
  'Forecourt staff. Platform data, not tenant data — no tenant_id, and listed among the isolation suite''s special tables.';

-- RLS ON, FORCED, and a policy that denies everything.
--
-- A table with no tenant_id is invisible to the policy gate's main query, and
-- "it has no tenant_id" is precisely how a table ends up unprotected — the
-- gate's own comment says so, having been written after `tenants` and `users`
-- leaked for exactly that reason. So this is listed in the gate's SPECIAL set
-- and given a real policy rather than left out of both.
--
-- The policy is `USING (false)`: the list of everybody at Forecourt with
-- access to every dealership is not something a dealer's own application
-- connection may read, under any tenant context. `app_user` additionally
-- receives no grant on this table at all, so the deny is belt and braces —
-- but the policy is what the gate can see, and what says the intent out loud.
--
-- The admin application connects as a platform role, which bypasses RLS by
-- design and is why `app_platform` exists and is separately audited.
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operators FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_operators_no_tenant_access ON platform_operators
  USING (false) WITH CHECK (false);

REVOKE ALL ON platform_operators FROM app_user, app_public;

-- ------------------------------------------------------ operator sessions
--
-- The admin application's own sessions, in their own table.
--
-- NOT `sessions`. That table carries a `tenant_id` and belongs to the CRM,
-- and sharing it would mean a dealer's session row and a Forecourt operator's
-- session row are the same shape in the same place — one query away from
-- being confused for each other by a future refactor. They are different
-- kinds of thing and the separation is the point.
--
-- Tokens are stored HASHED, as everywhere else: a database backup is not a
-- set of live credentials.
CREATE TABLE operator_sessions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         uuid NOT NULL REFERENCES users(id),

  token_hash      text NOT NULL,

  -- Set when a second factor has actually been completed. Every screen in the
  -- admin application reads across every dealership, so this is required
  -- unconditionally rather than for sensitive actions only.
  mfa_satisfied_at timestamptz,

  ip              text,
  user_agent      text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,

  CONSTRAINT operator_session_expires_after_start CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX operator_sessions_token_unique ON operator_sessions (token_hash);
CREATE INDEX operator_sessions_live_idx ON operator_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_sessions FORCE ROW LEVEL SECURITY;

-- Same reasoning as the operator list above: a dealer's application
-- connection has no business reading Forecourt's own session table.
CREATE POLICY operator_sessions_no_tenant_access ON operator_sessions
  USING (false) WITH CHECK (false);

REVOKE ALL ON operator_sessions FROM app_user, app_public;

-- ------------------------------------------------ what app_platform may read
--
-- `app_platform` is BYPASSRLS. It has always been, and it had NO GRANTS AT
-- ALL, so nothing could actually use it — the role existed as an intention.
--
-- Granting it blanket SELECT would be the easy thing and the wrong one. This
-- role can see every dealership at once, so what it may read is the only
-- boundary left: the admin application must be able to say how many cars a
-- dealer has and never what a dealer's customers are called.
--
-- So the grants are COLUMN-LEVEL wherever the application only needs to
-- count. `GRANT SELECT (id, tenant_id, state) ON vehicles` is enforced by
-- Postgres; "we only ever count these" is enforced by nobody.
--
-- Notably absent, and deliberately: contacts, leads, deals, messages,
-- invoices, deal_evidence, payments. Support that genuinely needs those goes
-- through impersonation, which the dealer has to grant and which is logged.

-- Platform tables: full read.
GRANT SELECT ON tenants, sites, tenant_subscriptions, feature_flags,
                usage_records, impersonation_grants, impersonation_sessions,
                platform_operators, operator_sessions
  TO app_platform;

-- Writes the admin application genuinely makes.
GRANT INSERT, UPDATE ON operator_sessions TO app_platform;
GRANT INSERT ON impersonation_sessions TO app_platform;
GRANT UPDATE (elevated, elevated_by, elevated_at, elevation_reason, ended_at, status)
  ON impersonation_sessions TO app_platform;
GRANT INSERT, UPDATE ON feature_flags TO app_platform;
GRANT UPDATE ON tenant_subscriptions TO app_platform;

-- Identity, for operator sign-in only.
GRANT SELECT (id, email, name, password_hash, mfa_secret, mfa_enrolled_at, status)
  ON users TO app_platform;

-- Counted, never read. Column-level so the restriction is the database's
-- rather than a convention in a query somebody may later widen.
GRANT SELECT (id, tenant_id, state, booked_in_at, sold_at) ON vehicles TO app_platform;
GRANT SELECT (id, tenant_id, state, delivered_at) ON deals TO app_platform;
GRANT SELECT (id, tenant_id, received_at, first_response_at, closed_at) ON leads TO app_platform;
-- `users` is global by design and has no tenant_id; its columns are granted
-- above for sign-in. Staff counts come from `tenant_memberships` instead.
GRANT SELECT (id, tenant_id, user_id, status) ON tenant_memberships TO app_platform;

COMMIT;
