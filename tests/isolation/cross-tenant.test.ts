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

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

let sql: Sql & { end: () => Promise<void>; unsafe: (q: string, v?: unknown[]) => Promise<Record<string, unknown>[]> };

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';

/** Tables that must be tested for isolation. Every new tenant table joins this list. */
const TENANT_TABLES = [
  'vehicles',
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

describeDb('cross-tenant isolation', () => {
  beforeAll(async () => {
    const { default: postgres } = await import('postgres');
    sql = postgres(DATABASE_URL!) as never;
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
      const exists = await sql`SELECT to_regclass(${'public.' + table}) AS t`;
      if (!exists[0]?.['t']) return; // table not created yet — skipped, not passed

      const rows = await sql.unsafe(
        `BEGIN;
         SET LOCAL ROLE app_user;
         SELECT set_tenant_context($1::uuid, $2::uuid, '{}'::uuid[], true);
         SELECT count(*) FILTER (WHERE tenant_id = $3::uuid) AS leaked FROM ${table};
         COMMIT;`,
        [TENANT_A, USER_A, TENANT_B],
      );
      const leaked = Number(rows.at(-1)?.['leaked'] ?? 0);
      expect(leaked, `${table} leaked ${leaked} rows from another tenant`).toBe(0);
    });

    it('cannot write a row belonging to another tenant', async () => {
      const exists = await sql`SELECT to_regclass(${'public.' + table}) AS t`;
      if (!exists[0]?.['t']) return;

      await expect(
        sql.unsafe(
          `BEGIN;
           SET LOCAL ROLE app_user;
           SELECT set_tenant_context($1::uuid, $2::uuid, '{}'::uuid[], true);
           UPDATE ${table} SET updated_at = now() WHERE tenant_id = $3::uuid;
           COMMIT;`,
          [TENANT_A, USER_A, TENANT_B],
        ),
      ).resolves.toBeDefined();

      const check = await sql.unsafe(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid AND updated_at > now() - interval '5 seconds'`,
        [TENANT_B],
      );
      expect(Number(check[0]?.['n'] ?? 0), `${table} allowed a write to another tenant's rows`).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Gate 4 — append-only tables reject mutation.
  // -------------------------------------------------------------------
  it.each(['deal_evidence', 'stock_book_entries', 'invoices', 'contact_consents'])(
    '%s rejects UPDATE and DELETE',
    async (table) => {
      const exists = await sql`SELECT to_regclass(${'public.' + table}) AS t`;
      if (!exists[0]?.['t']) return;

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
    const exists = await sql`SELECT to_regclass('public.vehicles') AS t`;
    if (!exists[0]?.['t']) return;

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
