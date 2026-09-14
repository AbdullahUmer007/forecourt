BEGIN;
CREATE OR REPLACE FUNCTION apply_tenant_policies() RETURNS TABLE(table_name text, action text)
LANGUAGE plpgsql AS $$
DECLARE
  t record;
  has_site boolean;

  -- ------------------------------------------------------------------
  -- What the PUBLIC SITE may read. An allow-list, not everything.
  -- ------------------------------------------------------------------
  --
  -- This loop used to end with `GRANT SELECT ON <every tenant table> TO
  -- app_public`, which handed the unauthenticated shopfront's role read access
  -- to the dealer's contacts, messages, leads, deals, invoices, payments, the
  -- evidence ledger and the CRM's own `sessions` table. Row-level security
  -- still confined it to one dealership, so it was not a cross-tenant leak —
  -- it was worse in a different direction: an injection or a rendering bug on
  -- the page a stranger loads could reach everything that dealer holds.
  --
  -- `app_platform` was narrowed to column-level grants in migration 0022 for
  -- exactly this reason. `app_public` faces the open internet and had never
  -- been narrowed at all.
  --
  -- The list is what `apps/site/src/data/*` actually queries. Adding a table
  -- here is a deliberate act with a reviewer; the previous arrangement granted
  -- every future table by default, which is the wrong direction for a role
  -- with no authentication in front of it.
  public_readable constant text[] := ARRAY[
    'brands',                   -- theme, name, logo
    'domains',                  -- host → tenant resolution
    'sites',                    -- opening hours, address
    'vehicles',                 -- the stock itself
    'vehicle_media',            -- photographs
    'vehicle_prices',           -- the price-drop history shown on a listing
    'mot_records',              -- the MOT history table on a listing
    'vehicle_finance_quotes',   -- gated again by M8 before anything renders
    'representative_examples',  -- CONC 3.5.3R; a quote cannot render without one
    'search_events'             -- the demand signal, which it also writes
  ];
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

    -- REVOKE on the else branch, not merely "do not grant": this function runs
    -- against existing databases, and every one of them has already been given
    -- the blanket grant this replaces. Without the revoke the fix would apply
    -- only to databases created after it.
    IF t.relname = ANY (public_readable) THEN
      EXECUTE format('GRANT SELECT ON %I TO app_public', t.relname);
    ELSE
      EXECUTE format('REVOKE ALL ON %I FROM app_public', t.relname);
    END IF;

    table_name := t.relname; action := 'policies applied'; RETURN NEXT;
  END LOOP;

  -- Anonymous saved-car access requires both the tenant AND a token digest.
  -- RESTRICTIVE policies compose with tenant/site policies; CRM roles retain their own scope.
  IF to_regclass('public.shortlists') IS NOT NULL AND to_regclass('public.shortlist_items') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS shortlist_visitor ON shortlists';
    EXECUTE $p$CREATE POLICY shortlist_visitor ON shortlists AS RESTRICTIVE TO app_public
      USING (owner_kind = 'anonymous' AND contact_id IS NULL AND merged_into_id IS NULL
        AND token = nullif(current_setting('app.shortlist_token', true), ''))
      WITH CHECK (owner_kind = 'anonymous' AND contact_id IS NULL AND merged_into_id IS NULL
        AND token = nullif(current_setting('app.shortlist_token', true), ''))$p$;
    EXECUTE 'DROP POLICY IF EXISTS shortlist_item_visitor ON shortlist_items';
    EXECUTE $p$CREATE POLICY shortlist_item_visitor ON shortlist_items AS RESTRICTIVE TO app_public
      USING (EXISTS (SELECT 1 FROM shortlists s WHERE s.id = shortlist_id AND s.tenant_id = shortlist_items.tenant_id))
      WITH CHECK (EXISTS (SELECT 1 FROM shortlists s WHERE s.id = shortlist_id AND s.tenant_id = shortlist_items.tenant_id)
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.tenant_id = shortlist_items.tenant_id))$p$;
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON shortlists, shortlist_items TO app_public';
  END IF;

  -- The one thing the public site writes: the demand signal, which records
  -- what buyers searched for and found nothing for. INSERT only — it is
  -- append-only evidence of demand, and the site has no reason to amend it.
  IF to_regclass('public.search_events') IS NOT NULL THEN
    EXECUTE 'GRANT INSERT ON search_events TO app_public';
  END IF;

  -- Public part-exchange is a lead, not a valuation. The shopfront writes the
  -- contact, the lead and a draft appraisal, then the desk rings with a figure.
  -- INSERT only, tenant-scoped by RLS. No SELECT on those tables.
  FOR t IN SELECT unnest(ARRAY['contacts', 'leads', 'lead_events', 'appraisals', 'audit_events']) AS relname
  LOOP
    IF to_regclass('public.' || t.relname) IS NOT NULL THEN
      EXECUTE format('GRANT INSERT ON %I TO app_public', t.relname);
    END IF;
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
    -- READ for the public site too, and nothing more.
    --
    -- Every page it renders names the dealership — the masthead, the footer's
    -- FCA disclosure, the JSON-LD AutoDealer block — so `withTenant` cannot do
    -- its job without this. It was missed because `tenants` carries no
    -- `tenant_id` and is handled here rather than by the loop above, which
    -- grants `app_public` as it goes; the moment the site's door started doing
    -- `SET LOCAL ROLE app_public` the whole public site began returning 500,
    -- and nothing exercised it through the real door to notice.
    --
    -- Safe because the policy directly above is `id = app.tenant_id` and
    -- `app_public` is NOBYPASSRLS: it can see the row for the dealership whose
    -- hostname was resolved, and no other. SELECT only — the public site has
    -- no business updating a dealer's legal name or FRN, and the read-only
    -- claim in its door should be true of its privileges, not just its code.
    EXECUTE 'GRANT SELECT ON tenants TO app_public';
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
SELECT * FROM apply_tenant_policies();
COMMIT;
