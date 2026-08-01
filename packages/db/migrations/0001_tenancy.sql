-- =====================================================================
-- M2 — Tenancy & identity
--
-- Expand-only. Nothing here drops or narrows an existing object.
-- Rollback: 0001_tenancy.down.sql (drops in reverse dependency order).
-- Run packages/db/src/rls.sql BEFORE this, then apply_tenant_policies() AFTER.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------- uuid v7
-- Time-sortable primary keys. Avoids the index fragmentation of uuid v4 while
-- keeping the non-guessability we need for public-facing identifiers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  -- version 7
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  -- variant 10xx
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10'   || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;

-- ---------------------------------------------------------------- enums
CREATE TYPE fca_permission_type AS ENUM ('limited', 'full', 'appointed_rep', 'none');
CREATE TYPE vat_scheme_default  AS ENUM ('margin', 'qualifying', 'mixed');
CREATE TYPE tenant_status       AS ENUM ('provisioning', 'trial', 'live', 'past_due', 'suspended', 'cancelled');
CREATE TYPE membership_status   AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE system_role         AS ENUM ('owner','manager','sales_executive','business_manager',
                                         'buyer','prep','marketing','accountant','read_only');

-- ---------------------------------------------------------------- tenants
CREATE TABLE tenants (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name                    text NOT NULL,
  legal_name              text NOT NULL,
  companies_house_no      text,
  vat_number              text,
  vat_registered          boolean NOT NULL DEFAULT false,
  fca_frn                 text,
  fca_permission          fca_permission_type NOT NULL DEFAULT 'none',
  ar_principal_name       text,
  ar_principal_frn        text,
  vat_scheme_default      vat_scheme_default NOT NULL DEFAULT 'margin',
  accepts_cash            boolean NOT NULL DEFAULT false,
  hvd_registered          boolean NOT NULL DEFAULT false,
  hvd_number              text,
  trade_bodies            text[] NOT NULL DEFAULT '{}',
  data_protection_contact text,
  plan                    text NOT NULL DEFAULT 'pro',
  status                  tenant_status NOT NULL DEFAULT 'provisioning',
  trial_ends_at           timestamptz,
  settings                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_by              uuid,
  deleted_at              timestamptz,

  -- An Appointed Representative must name its principal firm: the principal's
  -- name and FRN appear on the initial disclosure and every finance promotion.
  CONSTRAINT tenants_ar_requires_principal CHECK (
    fca_permission <> 'appointed_rep'
    OR (ar_principal_name IS NOT NULL AND ar_principal_frn IS NOT NULL)
  ),
  -- A firm introducing finance must have an FRN recorded.
  CONSTRAINT tenants_frn_required_when_regulated CHECK (
    fca_permission = 'none' OR fca_frn IS NOT NULL
  ),
  -- Accepting cash without HMRC High Value Dealer registration is a live AML
  -- exposure. The threshold itself lives in compliance_rules, never here.
  CONSTRAINT tenants_hvd_number_when_registered CHECK (
    hvd_registered = false OR hvd_number IS NOT NULL
  )
);
CREATE INDEX tenants_status_idx  ON tenants (status);
CREATE INDEX tenants_fca_frn_idx ON tenants (fca_frn);

-- ---------------------------------------------------------------- users (global)
-- Deliberately NOT tenant-scoped: one person may work for two dealers, and an
-- external accountant may serve several. The tenant boundary is the membership.
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email              text NOT NULL,
  name               text NOT NULL,
  phone              text,
  password_hash      text,
  mfa_secret         text,
  mfa_enrolled_at    timestamptz,
  passkeys           jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_login_at      timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  status             text NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- sites
CREATE TABLE sites (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  name                text NOT NULL,
  address             jsonb NOT NULL DEFAULT '{}'::jsonb,
  lat                 text,
  lng                 text,
  phone               text,
  email               text,
  opening_hours       jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone            text NOT NULL DEFAULT 'Europe/London',
  stock_number_prefix text,
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_by          uuid REFERENCES users(id),
  deleted_at          timestamptz
);
CREATE INDEX sites_tenant_idx ON sites (tenant_id, is_active);
CREATE UNIQUE INDEX sites_tenant_name_unique ON sites (tenant_id, name) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- brands & domains
CREATE TABLE brands (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  name           text NOT NULL,
  logo_light_key text,
  logo_dark_key  text,
  theme          jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone_of_voice  text NOT NULL DEFAULT 'straight_talking',
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  updated_by     uuid REFERENCES users(id)
);
CREATE INDEX brands_tenant_idx ON brands (tenant_id);
CREATE UNIQUE INDEX brands_tenant_default_unique ON brands (tenant_id) WHERE is_default;

CREATE TABLE domains (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  brand_id           uuid NOT NULL REFERENCES brands(id),
  hostname           text NOT NULL,
  is_primary         boolean NOT NULL DEFAULT false,
  verification_token text NOT NULL,
  verified_at        timestamptz,
  ssl_status         text NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- The ONE deliberate exception to tenant-scoped uniqueness: a hostname can only
-- ever resolve to a single tenant. An unknown or unverified host must 404 —
-- never fall through to a default tenant.
CREATE UNIQUE INDEX domains_hostname_unique ON domains (lower(hostname));
CREATE INDEX domains_tenant_idx ON domains (tenant_id);

-- ---------------------------------------------------------------- roles & membership
CREATE TABLE roles (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  key                      system_role,
  name                     text NOT NULL,
  description              text,
  is_system                boolean NOT NULL DEFAULT false,
  permissions              jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_all_sites          boolean NOT NULL DEFAULT false,
  discount_limit_pence     integer,
  refund_limit_pence       integer,
  price_change_limit_pence integer,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES users(id),
  updated_by               uuid REFERENCES users(id),
  CONSTRAINT roles_limits_non_negative CHECK (
    coalesce(discount_limit_pence, 0) >= 0
    AND coalesce(refund_limit_pence, 0) >= 0
    AND coalesce(price_change_limit_pence, 0) >= 0
  )
);
CREATE UNIQUE INDEX roles_tenant_name_unique ON roles (tenant_id, name);
CREATE UNIQUE INDEX roles_tenant_key_unique  ON roles (tenant_id, key) WHERE key IS NOT NULL;
CREATE INDEX roles_tenant_idx ON roles (tenant_id);

CREATE TABLE tenant_memberships (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  user_id              uuid NOT NULL REFERENCES users(id),
  role_id              uuid NOT NULL REFERENCES roles(id),
  permission_overrides jsonb NOT NULL DEFAULT '{"grant":[],"revoke":[]}'::jsonb,
  scope_all_sites      boolean NOT NULL DEFAULT false,
  job_title            text,
  status               membership_status NOT NULL DEFAULT 'invited',
  invited_by           uuid REFERENCES users(id),
  invited_at           timestamptz,
  accepted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE UNIQUE INDEX memberships_tenant_user_unique ON tenant_memberships (tenant_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX memberships_tenant_idx ON tenant_memberships (tenant_id, status);
CREATE INDEX memberships_user_idx   ON tenant_memberships (user_id);

CREATE TABLE user_sites (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES sites(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_sites_unique     ON user_sites (membership_id, site_id);
CREATE INDEX        user_sites_tenant_idx ON user_sites (tenant_id);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       text NOT NULL,
  role_id     uuid NOT NULL REFERENCES roles(id),
  site_ids    uuid[] NOT NULL DEFAULT '{}',
  token_hash  text NOT NULL,
  invited_by  uuid NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_token_unique   ON invitations (token_hash);
CREATE INDEX        invitations_tenant_email_idx ON invitations (tenant_id, lower(email));

-- ---------------------------------------------------------------- sessions & keys
CREATE TABLE sessions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id              uuid NOT NULL REFERENCES users(id),
  tenant_id            uuid REFERENCES tenants(id),
  token_hash           text NOT NULL,
  device_name          text,
  user_agent           text,
  ip                   text,
  trusted_device       boolean NOT NULL DEFAULT false,
  mfa_satisfied_at     timestamptz,
  step_up_satisfied_at timestamptz,
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_token_unique ON sessions (token_hash);
CREATE INDEX        sessions_user_idx     ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE api_keys (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  key_hash   text NOT NULL,
  key_prefix text NOT NULL,
  scopes     text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX api_keys_hash_unique ON api_keys (key_hash);
CREATE INDEX        api_keys_tenant_idx  ON api_keys (tenant_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- audit (append-only)
CREATE TABLE audit_events (
  id            uuid NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL,
  site_id       uuid,
  actor_type    text NOT NULL,
  actor_id      uuid,
  resource_type text NOT NULL,
  resource_id   uuid,
  action        text NOT NULL,
  diff          jsonb,
  ip            text,
  user_agent    text,
  request_id    text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_tenant_time_idx ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_resource_idx    ON audit_events (tenant_id, resource_type, resource_id);
CREATE INDEX audit_actor_idx       ON audit_events (tenant_id, actor_id);

-- Rolling monthly partitions. A scheduled job creates the next one; this seeds
-- the current and next month so the first insert never fails.
CREATE OR REPLACE FUNCTION ensure_audit_partition(p_month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  part_name text := 'audit_events_' || to_char(p_month, 'YYYY_MM');
BEGIN
  IF to_regclass('public.' || part_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      part_name, date_trunc('month', p_month), date_trunc('month', p_month) + interval '1 month');
    -- A new partition inherits neither policies nor grants. Applying them here
    -- means next month's audit data is protected the moment it exists, rather
    -- than the next time someone remembers to run the policy generator.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', part_name);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', part_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $p$, part_name);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO app_user', part_name);
  END IF;
END $$;

SELECT ensure_audit_partition(current_date);
SELECT ensure_audit_partition((current_date + interval '1 month')::date);

-- ---------------------------------------------------------------- compliance rules
-- Platform-level, NOT tenant-scoped: the law is the same for everyone and a
-- tenant must not be able to edit it. No tenant_id means no RLS policy.
CREATE TABLE compliance_rules (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  key            text NOT NULL,
  version        integer NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,
  parameters     jsonb NOT NULL,
  source_url     text NOT NULL,
  notes          text,
  checked_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX compliance_rules_key_version_unique   ON compliance_rules (key, version);
CREATE INDEX        compliance_rules_key_effective_idx    ON compliance_rules (key, effective_from DESC);

-- Seed the rules verified in August 2026. Every one carries its source and the
-- date it was last checked. The monthly regulatory watch updates these.
INSERT INTO compliance_rules (key, version, effective_from, parameters, source_url, notes, checked_at) VALUES
('vat.margin_fraction', 1, '2011-01-04',
 '{"numerator":1,"denominator":6,"standard_rate_bps":2000}',
 'https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181',
 'Margin VAT = gross margin x 1/6 at 20%. Negative margin yields no VAT and is never offset against another vehicle.',
 '2026-08-01'),

('aml.hvd_threshold', 2, '2026-06-30',
 '{"amount_pence":1000000,"currency":"GBP"}',
 'https://www.gov.uk/hmrc-internal-manuals/economic-crime-supervision-handbook/ecsh51525',
 'Converted from EUR 10,000 to a fixed GBP 10,000 on 30 June 2026. Version 1 (EUR) retained for pre-June-2026 records.',
 '2026-08-01'),

('cra.consumer_rights_windows', 1, '2015-10-01',
 '{"reject_window_days":30,"repair_resume_minimum_days":7,"burden_of_proof_months":6,"cancellation_window_days":14}',
 'https://www.legislation.gov.uk/ukpga/2015/15/section/22',
 'Repair pause/resume mechanic is CRA s.22(6)-(7); s.22(3) sets the 30-day baseline. CCR 14-day applies to distance and off-premises sales only.',
 '2026-08-01'),

('conc.representative_example', 1, '2014-04-01',
 '{"required_fields":["representative_apr","interest_rate","rate_is_fixed","total_amount_of_credit","other_charges","cash_price","advance_payment","duration_months","total_amount_payable","repayment_amount"],"representative_threshold":0.51}',
 'https://handbook.fca.org.uk/handbook/conc3',
 'CONC 3.5.3R. UNDER REVIEW: FCA CP26/15 (Apr-Jun 2026) proposes simplifying or removing the representative example and revisiting the 51% threshold. Treat the field list as configurable.',
 '2026-08-01'),

('fca.motor_finance_redress', 1, '2026-03-30',
 '{"status":"partially_suspended","agreement_window":{"from":"2007-04-06","to":"2024-11-01"},"triggers":{"dca":true,"high_commission":{"pct_of_total_charge_for_credit":0.39,"pct_of_amount_of_credit":0.10},"undisclosed_tie":true},"de_minimis_pence":{"pre_2014_04":12000,"post_2014_04":15000},"consumer_longstop":"2027-08-31"}',
 'https://www.fca.org.uk/publications/policy-statements/ps26-3-motor-finance-consumer-redress-scheme',
 'PARTIALLY SUSPENDED by the Upper Tribunal on/around 1-2 July 2026 pending challenges (Consumer Voice, Mercedes-Benz FS, VW FS, Credit Agricole Auto Finance). Hearing expected Dec 2026 - Feb 2027. These are the PUBLISHED parameters, not the operative ones. Never present the deadlines to a dealer as settled.',
 '2026-08-01');

-- ---------------------------------------------------------------- protection
-- Apply tenant isolation to everything created above that carries tenant_id.
SELECT * FROM apply_tenant_policies();

-- Audit is evidence: append-only.
SELECT make_append_only('audit_events');

COMMIT;
