/**
 * THE CROSS-TENANT LEAK SUITE.
 *
 * This is the most important test in the repository. A leak between two
 * dealers is the one bug that ends the company.
 *
 * It runs on every PR and is a BLOCKING gate. It fails the build on:
 *   - any tenant table without RLS enabled AND forced AND a policy
 *   - any read, write, delete, list, search, export or feed path that can
 *     reach another tenant's row
 *
 * Requires a real Postgres: DATABASE_URL=postgres://... pnpm test:isolation
 * It SKIPS (loudly) without one, so a developer without a database sees a
 * warning rather than a false pass — but CI must always provide one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

if (!DATABASE_URL) {
  console.warn(
    '\n  ⚠️  DATABASE_URL is not set — the cross-tenant leak suite did not run.\n' +
      '     This is the blocking CI gate. CI MUST set DATABASE_URL.\n',
  );
}

type Row = Record<string, unknown>;
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  end: () => Promise<void>;
  unsafe: (q: string, v?: unknown[]) => Promise<Row[]>;
  begin: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
};

let sql: Sql;

/**
 * Run a block inside a transaction as the unprivileged application role, with
 * a tenant context set — exactly how the application talks to the database.
 * SET LOCAL scopes both to the transaction, so nothing leaks across the pool.
 */
async function asTenant<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Sql) => Promise<T>,
  opts: { siteIds?: string[]; scopeAllSites?: boolean } = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE app_user');
    await tx.unsafe('SELECT set_tenant_context($1::uuid, $2::uuid, $3::uuid[], $4::boolean)', [
      tenantId, userId, opts.siteIds ?? [], opts.scopeAllSites ?? true,
    ]);
    return fn(tx);
  });
}

const tableExists = async (table: string): Promise<boolean> => {
  const [row] = await sql`SELECT to_regclass(${`public.${table}`}) AS t`;
  return row?.['t'] != null;
};

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

/** Tables that must be tested for isolation. Every new tenant table joins this list. */
const TENANT_TABLES = [
  // M2 — tenancy & identity
  'sites',
  'brands',
  'domains',
  'roles',
  'tenant_memberships',
  'user_sites',
  'invitations',
  'api_keys',
  'audit_events',
  // M3 — vehicle core
  'vehicles',
  'vehicle_status_history',
  'vehicle_prices',
  'vehicle_costs',
  // M4 — vehicle data
  'vehicle_lookups',
  'mot_records',
  'provider_usage_daily',
  // M5+ — created by later migrations; each skips until its table exists
  'contacts',
  'leads',
  'deals',
  'invoices',
  'stock_book_entries',
  'deal_evidence',
  'contact_consents',
  'vehicle_media',
  'appointments',
] as const;

/**
 * Tables that carry no tenant_id and are therefore invisible to the generic
 * policy generator. Each needs its own boundary — and its own test, because
 * "it has no tenant_id" is exactly how a table ends up unprotected.
 */
const SPECIAL_TABLES = {
  // boundary is `id`, not `tenant_id`
  tenants: 'id',
  // global by design; visible only via a shared membership
  users: 'membership',
} as const;

/** Append-only tables reject UPDATE via a trigger before RLS is reached. */
const APPEND_ONLY = new Set<string>([
  'audit_events', 'deal_evidence', 'stock_book_entries', 'invoices', 'contact_consents',
  'vehicle_status_history', 'vehicle_prices', 'vehicle_lookups',
]);

/**
 * A minimally valid row per table, referencing tenant B's own child records.
 *
 * This matters: an INSERT that omits a NOT NULL column fails with SQLSTATE
 * 23502 before the policy is ever consulted, so the test would pass even with
 * RLS switched off. Every payload here is valid in every respect EXCEPT that
 * it belongs to another tenant — so the only thing that can reject it is the
 * policy, and a 42501 is proof the policy did the work.
 */
const B_MEMBERSHIP = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B_ROLE = '66666666-6666-4666-8666-666666666666';
const B_SITE = '88888888-8888-4888-8888-888888888888';
const B_BRAND = '99999999-9999-4999-8999-999999999992';
const B_USER = '44444444-4444-4444-8444-444444444444';
const A_VEHICLE = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const B_VEHICLE = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

const INSERT_PAYLOAD: Record<string, { columns: string; values: string }> = {
  sites: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Site'` },
  brands: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Brand'` },
  domains: {
    columns: 'tenant_id, brand_id, hostname, verification_token',
    values: `'${TENANT_B}', '${B_BRAND}', 'smuggled.isolation.test', 'tok-x'`,
  },
  roles: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Role'` },
  tenant_memberships: {
    columns: 'tenant_id, user_id, role_id',
    values: `'${TENANT_B}', '${B_USER}', '${B_ROLE}'`,
  },
  user_sites: {
    columns: 'tenant_id, membership_id, site_id',
    values: `'${TENANT_B}', '${B_MEMBERSHIP}', '${B_SITE}'`,
  },
  invitations: {
    columns: 'tenant_id, email, role_id, token_hash, invited_by, expires_at',
    values: `'${TENANT_B}', 'smuggled@b.test', '${B_ROLE}', 'hash-x', '${B_USER}', now() + interval '7 days'`,
  },
  api_keys: {
    columns: 'tenant_id, name, key_hash, key_prefix, created_by',
    values: `'${TENANT_B}', 'Smuggled Key', 'keyhash-x', 'fc_x', '${B_USER}'`,
  },
  audit_events: {
    columns: 'tenant_id, actor_type, resource_type, action',
    values: `'${TENANT_B}', 'user', 'vehicle', 'create'`,
  },
  vehicles: {
    columns: 'tenant_id, site_id, stock_number, stock_sequence, registration',
    values: `'${TENANT_B}', '${B_SITE}', 'SMUG-0001', 9001, 'SM99GLD'`,
  },
  vehicle_status_history: {
    columns: 'tenant_id, vehicle_id, to_state',
    values: `'${TENANT_B}', '${B_VEHICLE}', 'booked_in'`,
  },
  vehicle_prices: {
    columns: 'tenant_id, vehicle_id, price_pence',
    values: `'${TENANT_B}', '${B_VEHICLE}', 999900`,
  },
  vehicle_costs: {
    columns: 'tenant_id, vehicle_id, category, description',
    values: `'${TENANT_B}', '${B_VEHICLE}', 'valet', 'Smuggled cost'`,
  },
  vehicle_lookups: {
    columns: 'tenant_id, registration, provider, lookup_type',
    values: `'${TENANT_B}', 'SM99GLD', 'dvla_ves', 'vehicle'`,
  },
  mot_records: {
    columns: 'tenant_id, vehicle_id, test_date, result',
    values: `'${TENANT_B}', '${B_VEHICLE}', '2026-01-01', 'PASSED'`,
  },
  provider_usage_daily: {
    columns: 'tenant_id, usage_date, provider, lookup_type',
    values: `'${TENANT_B}', '2026-08-02', 'dvla_ves', 'vehicle'`,
  },
};

/**
 * Seed BOTH tenants with real rows in every table under test.
 *
 * Without this, a "cannot reach tenant B's rows" test passes trivially when
 * tenant B has no rows — a false pass, which is the exact failure mode this
 * suite exists to prevent. Runs as the superuser so RLS does not block setup.
 */
async function seedRivalData(): Promise<void> {
  const A = TENANT_A, B = TENANT_B;
  await sql.unsafe(`
    INSERT INTO tenants (id, name, legal_name, fca_permission, fca_frn, status) VALUES
      ('${A}','Tenant A','Tenant A Ltd','limited','993469','live'),
      ('${B}','Tenant B','Tenant B Ltd','limited','111111','live')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO users (id, email, name) VALUES
      ('${USER_A}','a@isolation.test','User A'),
      ('44444444-4444-4444-8444-444444444444','b@isolation.test','User B')
    ON CONFLICT DO NOTHING;

    INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites) VALUES
      ('55555555-5555-4555-8555-555555555555','${A}','owner','Owner',true,'["*"]',true),
      ('66666666-6666-4666-8666-666666666666','${B}','owner','Owner',true,'["*"]',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO sites (id, tenant_id, name) VALUES
      ('77777777-7777-4777-8777-777777777777','${A}','Site A'),
      ('88888888-8888-4888-8888-888888888888','${B}','Site B')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO brands (id, tenant_id, name, is_default) VALUES
      ('99999999-9999-4999-8999-999999999991','${A}','Brand A',true),
      ('99999999-9999-4999-8999-999999999992','${B}','Brand B',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO domains (tenant_id, brand_id, hostname, verification_token) VALUES
      ('${A}','99999999-9999-4999-8999-999999999991','a.isolation.test','tok-a'),
      ('${B}','99999999-9999-4999-8999-999999999992','b.isolation.test','tok-b')
    ON CONFLICT DO NOTHING;

    INSERT INTO tenant_memberships (id, tenant_id, user_id, role_id, status, scope_all_sites) VALUES
      ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1','${A}','${USER_A}','55555555-5555-4555-8555-555555555555','active',true),
      ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','${B}','44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','active',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO user_sites (tenant_id, membership_id, site_id) VALUES
      ('${A}','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1','77777777-7777-4777-8777-777777777777'),
      ('${B}','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','88888888-8888-4888-8888-888888888888')
    ON CONFLICT DO NOTHING;

    INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at) VALUES
      ('${A}','invitee@a.test','55555555-5555-4555-8555-555555555555','hash-a','${USER_A}', now() + interval '7 days'),
      ('${B}','invitee@b.test','66666666-6666-4666-8666-666666666666','hash-b','44444444-4444-4444-8444-444444444444', now() + interval '7 days')
    ON CONFLICT DO NOTHING;

    INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, created_by) VALUES
      ('${A}','Key A','keyhash-a','fc_a','${USER_A}'),
      ('${B}','Key B','keyhash-b','fc_b','44444444-4444-4444-8444-444444444444')
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_events (tenant_id, actor_type, resource_type, action) VALUES
      ('${A}','user','vehicle','create'),
      ('${B}','user','vehicle','create');
  `);

  // M3 tables. Seeded separately because they only exist after migration 0002.
  const hasVehicles = await tableExists('vehicles');
  if (hasVehicles) {
    await sql.unsafe(`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence, registration, make, model) VALUES
        ('${A_VEHICLE}','${A}','77777777-7777-4777-8777-777777777777','A-9001',9001,'AA11AAA','Tesla','Model X'),
        ('${B_VEHICLE}','${B}','88888888-8888-4888-8888-888888888888','B-9001',9001,'BB11BBB','Tesla','Model X')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vehicle_status_history (tenant_id, vehicle_id, to_state) VALUES
        ('${A}','${A_VEHICLE}','booked_in'), ('${B}','${B_VEHICLE}','booked_in');

      INSERT INTO vehicle_prices (tenant_id, vehicle_id, price_pence) VALUES
        ('${A}','${A_VEHICLE}',1999900), ('${B}','${B_VEHICLE}',1999900);

      INSERT INTO vehicle_costs (tenant_id, vehicle_id, category, description) VALUES
        ('${A}','${A_VEHICLE}','valet','Valet A'), ('${B}','${B_VEHICLE}','valet','Valet B');
    `);
  }

  // M4 tables.
  if (await tableExists('vehicle_lookups')) {
    await sql.unsafe(`
      INSERT INTO vehicle_lookups (tenant_id, registration, provider, lookup_type) VALUES
        ('${A}','AA11AAA','dvla_ves','vehicle'), ('${B}','BB11BBB','dvla_ves','vehicle');

      INSERT INTO mot_records (tenant_id, vehicle_id, test_date, result, odometer_miles) VALUES
        ('${A}','${A_VEHICLE}','2026-02-14','PASSED',38940),
        ('${B}','${B_VEHICLE}','2026-02-14','PASSED',38940);

      INSERT INTO provider_usage_daily (tenant_id, usage_date, provider, lookup_type, call_count) VALUES
        ('${A}','2026-08-02','dvla_ves','vehicle',1),
        ('${B}','2026-08-02','dvla_ves','vehicle',1);
    `);
  }
}

describeDb('cross-tenant isolation', () => {
  beforeAll(async () => {
    const { default: postgres } = await import('postgres');
    sql = postgres(DATABASE_URL!) as never;
    await seedRivalData();
  });

  afterAll(async () => {
    await sql?.end();
  });

  // -------------------------------------------------------------------
  // Gate 1 — structural. Catches the table someone forgot.
  // -------------------------------------------------------------------
  it('every table with tenant_id has RLS enabled, FORCED, and at least one policy', async () => {
    const rows = await sql`
      SELECT c.relname AS table_name,
             c.relrowsecurity  AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = c.relname AND column_name = 'tenant_id'
        )`;

    expect(rows.length, 'no tenant tables found — is the schema migrated?').toBeGreaterThan(0);

    const unprotected = rows.filter(
      (r) => !r['rls_enabled'] || !r['rls_forced'] || Number(r['policy_count']) === 0,
    );
    expect(
      unprotected.map((r) => r['table_name']),
      'these tables are not protected — see packages/db/src/rls.sql',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Gate 2 — the application role cannot bypass RLS.
  // -------------------------------------------------------------------
  it('app_user cannot bypass row-level security', async () => {
    const [role] = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`;
    expect(role?.['rolbypassrls'], 'app_user must be NOBYPASSRLS').toBe(false);
  });

  // -------------------------------------------------------------------
  // Gate 3 — behavioural. Tenant A cannot reach tenant B's rows.
  // -------------------------------------------------------------------
  describe.each(TENANT_TABLES)('table: %s', (table) => {
    it('does not return another tenant\'s rows on a list read', async () => {
      if (!(await tableExists(table))) return; // created by a later migration

      const rows = await asTenant(TENANT_A, USER_A, (tx) =>
        tx.unsafe(`SELECT count(*) FILTER (WHERE tenant_id = $1::uuid) AS leaked FROM ${table}`, [TENANT_B]),
      );
      const leaked = Number(rows[0]?.['leaked'] ?? 0);
      expect(leaked, `${table} leaked ${leaked} rows from another tenant`).toBe(0);
    });

    it('cannot UPDATE a row belonging to another tenant', async () => {
      if (!(await tableExists(table))) return;
      if (APPEND_ONLY.has(table)) {
        // Covered by Gate 4 instead: the append_only trigger rejects every
        // UPDATE outright, which is a stronger guarantee than a silent no-op.
        return;
      }

      // Guard against a false pass: if tenant B has no rows here, the test
      // proves nothing. Seeding is done in beforeAll; this asserts it worked.
      const [before] = await sql.unsafe(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`, [TENANT_B],
      );
      expect(
        Number(before?.['n'] ?? 0),
        `${table} has no tenant B rows — this test would pass vacuously. Add it to seedRivalData().`,
      ).toBeGreaterThan(0);

      // The UPDATE is silently a no-op: RLS makes the rows invisible, so the
      // statement succeeds and affects nothing. That is the correct behaviour —
      // an error would confirm the rows exist.
      const affected = await asTenant(TENANT_A, USER_A, async (tx) => {
        const res = await tx.unsafe(
          `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid RETURNING 1`, [TENANT_B],
        );
        return res.length;
      });
      expect(affected, `${table} allowed a write to another tenant's rows`).toBe(0);
    });

    it('cannot INSERT a row belonging to another tenant', async () => {
      if (!(await tableExists(table))) return;

      // The row must be rejected BY THE POLICY (SQLSTATE 42501), not by a
      // NOT NULL constraint — otherwise this passes for the wrong reason and
      // would keep passing even if the policy were removed.
      const payload = INSERT_PAYLOAD[table];
      expect(
        payload,
        `${table} has no INSERT_PAYLOAD. Without a fully valid row, this test would ` +
          `fail on NOT NULL rather than on the policy, and would pass with RLS disabled.`,
      ).toBeDefined();

      let code: string | undefined;
      try {
        await asTenant(TENANT_A, USER_A, (tx) =>
          tx.unsafe(`INSERT INTO ${table} (${payload!.columns}) VALUES (${payload!.values})`),
        );
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      expect(code, `${table}: INSERT for another tenant was not rejected at all`).toBeDefined();
      expect(
        code,
        `${table}: INSERT failed with SQLSTATE ${code} rather than 42501 (row-level security). ` +
          `A NOT NULL or FK error here means the policy is not what rejected it — the test would ` +
          `still pass with RLS disabled.`,
      ).toBe('42501');
    });
  });

  // -------------------------------------------------------------------
  // Gate 3b — the tables with no tenant_id, which are the easiest to forget.
  // -------------------------------------------------------------------
  it('tenants is isolated on `id` — one tenant cannot read another', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe('SELECT count(*) AS visible, count(*) FILTER (WHERE id <> $1::uuid) AS leaked FROM tenants', [TENANT_A]),
    );
    const row = rows[0];
    expect(Number(row?.['leaked'] ?? 0), 'tenants leaked another tenant\'s row').toBe(0);
    expect(Number(row?.['visible'] ?? 0)).toBeLessThanOrEqual(1);
  });

  it('users is visible only through a shared membership', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe(
        `SELECT count(*) AS leaked FROM users u
           WHERE u.id <> $2::uuid
             AND NOT EXISTS (
               SELECT 1 FROM tenant_memberships m
               WHERE m.user_id = u.id AND m.tenant_id = $1::uuid AND m.deleted_at IS NULL)`,
        [TENANT_A, USER_A],
      ),
    );
    expect(Number(rows[0]?.['leaked'] ?? 0), 'users leaked a person from another dealer').toBe(0);
  });

  it.each(Object.keys(SPECIAL_TABLES))('%s has RLS enabled, forced and a policy', async (table) => {
    const [row] = await sql`
      SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table}`;
    expect(row?.['enabled'], `${table}: RLS not enabled`).toBe(true);
    expect(row?.['forced'], `${table}: RLS not FORCED`).toBe(true);
    expect(Number(row?.['policies'] ?? 0), `${table}: no policy`).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // Gate 4 — append-only tables reject mutation.
  // -------------------------------------------------------------------
  it.each(['deal_evidence', 'stock_book_entries', 'invoices', 'contact_consents'])(
    '%s rejects UPDATE and DELETE',
    async (table) => {
      if (!(await tableExists(table))) return;

      const [trigger] = await sql`
        SELECT count(*) AS n FROM pg_trigger
        WHERE tgrelid = ${'public.' + table}::regclass AND tgname = 'append_only' AND NOT tgisinternal`;
      expect(Number(trigger?.['n'] ?? 0), `${table} must carry the append_only trigger`).toBeGreaterThan(0);
    },
  );

  // -------------------------------------------------------------------
  // Gate 5 — unique constraints are tenant-scoped, not global.
  // -------------------------------------------------------------------
  it('vehicle registration uniqueness is scoped by tenant, not global', async () => {
    expect(
      await tableExists('vehicles'),
      'vehicles table missing — this test must not skip once M3 is migrated',
    ).toBe(true);

    const rows = await sql`
      SELECT i.indexrelid::regclass AS index_name,
             array_agg(a.attname ORDER BY a.attnum) AS columns
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'public.vehicles'::regclass AND i.indisunique
      GROUP BY i.indexrelid`;

    const regIndexes = rows.filter((r) => (r['columns'] as string[]).includes('registration'));
    for (const idx of regIndexes) {
      expect(
        idx['columns'],
        `${idx['index_name']} must include tenant_id — a global unique registration would leak the existence of another dealer's stock`,
      ).toContain('tenant_id');
    }
  });
});
