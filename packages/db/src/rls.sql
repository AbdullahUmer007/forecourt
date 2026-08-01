-- =====================================================================
-- Forecourt — tenant isolation.
--
-- A leak between two dealers is the one bug that ends the company.
-- Four independent layers protect against it; this file is layers 2 and 3.
--
--   1. request context      (application, AsyncLocalStorage)
--   2. session variables    (this file, set_tenant_context)
--   3. row-level security   (this file, per-table policies)
--   4. repository guard     (application, injects tenant_id)
--
-- Any one layer failing must not cause a leak.
-- =====================================================================

-- ---------------------------------------------------------------- roles

-- The application connects as a role that CANNOT bypass RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
  -- Migrations run as a separately-named, separately-audited role.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator NOLOGIN;
  END IF;
  -- Platform jobs that legitimately cross tenants must declare themselves.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN BYPASSRLS;
  END IF;
  -- The public site renderer is read-only.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_public') THEN
    CREATE ROLE app_public NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ------------------------------------------------- session context helper

-- SET LOCAL, not SET: scoped to the transaction so it cannot leak across a
-- pooled connection.
CREATE OR REPLACE FUNCTION set_tenant_context(
  p_tenant_id       uuid,
  p_user_id         uuid,
  p_site_ids        uuid[]  DEFAULT '{}',
  p_scope_all_sites boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id',       p_tenant_id::text, true);
  PERFORM set_config('app.user_id',         p_user_id::text,   true);
  PERFORM set_config('app.site_ids',        array_to_string(p_site_ids, ','), true);
  PERFORM set_config('app.scope_all_sites', p_scope_all_sites::text, true);
END $$;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ------------------------------------------------------ policy generator

-- Applies isolation to every table carrying a tenant_id. Run after every
-- migration; `pnpm db:policies` verifies it and fails CI if a table was missed.
CREATE OR REPLACE FUNCTION apply_tenant_policies() RETURNS TABLE(table_name text, action text)
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  has_site boolean;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      -- 'p' matters: a partitioned parent is not relkind 'r', and skipping it
      -- would leave the whole audit trail unprotected.
      AND c.relkind IN ('r', 'p')
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
  LOOP
    -- FORCE matters: without it the table owner bypasses every policy.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t.relname);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.relname);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    $p$, t.relname);

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns col
      WHERE col.table_schema = 'public'
        AND col.table_name = t.relname
        AND col.column_name = 'site_id'
    ) INTO has_site;

    IF has_site THEN
      EXECUTE format('DROP POLICY IF EXISTS site_scope ON %I', t.relname);
      -- AS RESTRICTIVE is load-bearing, not stylistic.
      --
      -- Postgres combines multiple PERMISSIVE policies with OR. A permissive
      -- site_scope returns true whenever scope_all_sites is set, which would
      -- OR away tenant_isolation entirely and leak every tenant's rows on any
      -- table carrying a site_id. RESTRICTIVE makes it AND with the tenant
      -- policy, which is the intended meaning: "your tenant AND your sites".
      --
      -- Regression-tested by tests/isolation/cross-tenant.test.ts — the
      -- site_id tables (user_sites, audit_events) are what catch this.
      EXECUTE format($p$
        CREATE POLICY site_scope ON %I
          AS RESTRICTIVE
          USING (
            coalesce(current_setting('app.scope_all_sites', true)::boolean, true)
            OR site_id IS NULL
            OR site_id = ANY (
                 string_to_array(coalesce(nullif(current_setting('app.site_ids', true), ''), '00000000-0000-0000-0000-000000000000'), ',')::uuid[]
               )
          )
      $p$, t.relname);
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t.relname);
    EXECUTE format('GRANT SELECT ON %I TO app_public', t.relname);

    table_name := t.relname; action := 'policies applied'; RETURN NEXT;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Two tables carry no tenant_id and would otherwise be left wide open.
  -- ------------------------------------------------------------------

  -- `tenants`: the boundary column is `id`, not `tenant_id`. Without this a
  -- user of tenant A could read tenant B's legal name, VAT number and FRN.
  IF to_regclass('public.tenants') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE tenants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE tenants FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON tenants';
    EXECUTE $p$
      CREATE POLICY tenant_isolation ON tenants
        USING      (id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (id = current_setting('app.tenant_id', true)::uuid)
    $p$;
    EXECUTE 'GRANT SELECT, UPDATE ON tenants TO app_user';
    table_name := 'tenants'; action := 'policies applied (id-scoped)'; RETURN NEXT;
  END IF;

  -- `users` is deliberately global — one person may work for two dealers, and
  -- an external accountant may serve several. But a user must only be visible
  -- to a tenant they actually belong to, or the table becomes a directory of
  -- every dealer's staff.
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE users FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS membership_visibility ON users';
    EXECUTE $p$
      CREATE POLICY membership_visibility ON users
        USING (
          id = current_setting('app.user_id', true)::uuid
          OR EXISTS (
            SELECT 1 FROM tenant_memberships m
            WHERE m.user_id = users.id
              AND m.tenant_id = current_setting('app.tenant_id', true)::uuid
              AND m.deleted_at IS NULL
          )
        )
    $p$;
    EXECUTE 'GRANT SELECT, UPDATE ON users TO app_user';
    table_name := 'users'; action := 'policies applied (membership-scoped)'; RETURN NEXT;
  END IF;
END $$;

-- --------------------------------------------------- append-only enforcement

-- Financial, invoice, stock-book and evidence rows are never updated or
-- deleted. Corrections create a new versioned or adjusting row.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% on %.% is forbidden: this table is append-only. Insert a correcting row instead.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION make_append_only(p_table text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS append_only ON %I', p_table);
  EXECUTE format(
    'CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', p_table);
END $$;

-- Apply to the tables that are evidence.
-- SELECT make_append_only('deal_evidence');
-- SELECT make_append_only('stock_book_entries');
-- SELECT make_append_only('invoices');
-- SELECT make_append_only('contact_consents');
-- SELECT make_append_only('audit_events');
