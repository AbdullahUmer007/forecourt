-- =====================================================================
-- Auth hardening — MFA enrolment, password reset, per-IP rate limiting.
--
-- Expand-only. Rollback: 0014_auth_hardening.down.sql
-- Depends on 0001_tenancy (users, sessions).
--
-- M2 built the columns — `users.mfa_secret`, `mfa_enrolled_at`,
-- `sessions.mfa_satisfied_at` — and the CRM's sign-in built the password half.
-- What was missing is everything that makes those columns usable and the three
-- holes left open, which STATE.md has been carrying as the reason the CRM
-- cannot go near a dealer:
--
--   1. RECOVERY CODES. Enrolling MFA without them means a lost phone is a lost
--      account, and the dealer principal is the person most likely to hold the
--      permissions that mandate MFA. Single-use, hashed, and issued at
--      enrolment rather than offered afterwards — a recovery code somebody has
--      to remember to generate is one they generate the day after they need it.
--
--   2. PASSWORD RESET as a token, not a new password read down the phone. The
--      token is hashed at rest, single-use, short-lived and bound to the user,
--      for the same reason the session token is: a database backup or a
--      support screenshot must not hand over an account.
--
--   3. PER-IP RATE LIMITING. Lockout today is per ACCOUNT, so one common
--      password sprayed across five hundred accounts never trips anything —
--      each account sees a single failure. That is the attack that actually
--      works against a small business, and counting by account cannot see it.
-- =====================================================================

BEGIN;

CREATE TYPE auth_attempt_kind AS ENUM (
  'password', 'mfa', 'recovery_code', 'password_reset_request', 'password_reset'
);

-- ------------------------------------------------------ recovery codes
--
-- Hashed with the same one-way function as a session token, never stored in
-- the clear, and shown to the user exactly once at enrolment.
CREATE TABLE mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),

  code_hash   text NOT NULL,
  used_at     timestamptz,
  used_ip     text,

  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recovery_code_hash_not_blank CHECK (length(btrim(code_hash)) > 0)
);
CREATE UNIQUE INDEX mfa_recovery_codes_hash_unique ON mfa_recovery_codes (code_hash);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id)
  WHERE used_at IS NULL;

-- ------------------------------------------------------- reset tokens
CREATE TABLE password_reset_tokens (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id),

  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,

  -- Who asked, and from where. A reset trail is the first thing anyone looks
  -- at after an account compromise.
  requested_ip  text,
  requested_by  uuid REFERENCES users(id),

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reset_token_hash_not_blank CHECK (length(btrim(token_hash)) > 0),
  CONSTRAINT reset_token_expiry_future CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX password_reset_tokens_hash_unique ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id)
  WHERE used_at IS NULL;

-- ------------------------------------------------------ auth attempts
--
-- Every authentication attempt, successful or not, with the IP it came from.
--
-- This is what makes per-IP limiting possible, and it is deliberately NOT
-- tenant-scoped: an attacker spraying one password across many dealerships is
-- exactly the case a per-tenant table cannot see. It carries no tenant_id and
-- gets its own policy below rather than the generic one.
--
-- `identifier` is the email as SUPPLIED, which may belong to no account at
-- all. That is the point — an attempt against a non-existent user still has to
-- count towards the IP's budget, or enumeration is free.
CREATE TABLE auth_attempts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind          auth_attempt_kind NOT NULL,

  ip            text,
  identifier    text,
  user_id       uuid REFERENCES users(id),

  succeeded     boolean NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
-- The two queries the limiter runs, and nothing else.
CREATE INDEX auth_attempts_ip_idx ON auth_attempts (ip, occurred_at DESC)
  WHERE ip IS NOT NULL;
CREATE INDEX auth_attempts_identifier_idx ON auth_attempts (identifier, occurred_at DESC)
  WHERE identifier IS NOT NULL;

-- --------------------------------------------------------------- grants
--
-- These three tables carry no tenant_id, so `apply_tenant_policies()` skips
-- them — the same gap that left `compliance_rules` ungranted from M1 until M8
-- found it. Granted and policied explicitly here.
--
-- RLS is FORCED on all three and no policy permits the application role to
-- read another user's rows: recovery codes and reset tokens are credentials,
-- and `auth_attempts` is a log the application only ever appends to and
-- aggregates. The CRM reaches them through the same connection that resolves a
-- session, which runs before any tenant context exists.
ALTER TABLE mfa_recovery_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes     FORCE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens  FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts          FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes    TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO app_user;
GRANT SELECT, INSERT                 ON auth_attempts         TO app_user;

-- A user may only ever see their OWN recovery codes and reset tokens. There is
-- no path from one user to another's credentials, even before a tenant context
-- exists — which is precisely when these are read.
CREATE POLICY own_recovery_codes ON mfa_recovery_codes
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY own_reset_tokens ON password_reset_tokens
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- The attempt log is append-and-aggregate. No row-level read is granted to the
-- application at all: the limiter counts, it never inspects, and a table the
-- app can read row by row is one an injection can enumerate.
CREATE POLICY append_attempts ON auth_attempts
  FOR INSERT WITH CHECK (true);

-- Which leaves the limiter needing a count it cannot SELECT for. A
-- SECURITY DEFINER function is the whole answer: it returns an integer and
-- nothing else, so the application learns "seventeen attempts from this
-- address" without ever being able to ask who they were for.
CREATE OR REPLACE FUNCTION count_auth_attempts(
  p_kind        auth_attempt_kind,
  p_ip          text,
  p_identifier  text,
  p_since       timestamptz
) RETURNS TABLE(by_ip integer, by_identifier integer)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    count(*) FILTER (WHERE p_ip IS NOT NULL AND a.ip = p_ip)::integer,
    count(*) FILTER (
      WHERE p_identifier IS NOT NULL AND lower(a.identifier) = lower(p_identifier))::integer
  FROM auth_attempts a
  WHERE a.kind = p_kind AND a.occurred_at >= p_since AND NOT a.succeeded
$$;

REVOKE ALL ON FUNCTION count_auth_attempts(auth_attempt_kind, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_auth_attempts(auth_attempt_kind, text, text, timestamptz) TO app_user;

COMMIT;
