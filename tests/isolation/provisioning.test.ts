/**
 * Provisioning isolation.
 *
 * A newly created dealership must be invisible to every other tenant the
 * moment it exists. The executor runs as `app_platform` (BYPASSRLS); the
 * guarantee after that is the same four layers as every other write.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

type Row = Record<string, unknown>;
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  end: () => Promise<void>;
  unsafe: (q: string, v?: unknown[]) => Promise<Row[]>;
  begin: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
};

let sql: Sql;

const TENANT_A = 'ffffffff-0000-4000-8000-00000000000a';
const USER_A = 'ffffffff-0000-4000-8000-0000000000a1';
const NEW_TENANT = 'ffffffff-0000-4000-8000-0000000000c1';
const NEW_SITE = 'ffffffff-0000-4000-8000-0000000000c2';
const NEW_BRAND = 'ffffffff-0000-4000-8000-0000000000c3';
const NEW_ROLE = 'ffffffff-0000-4000-8000-0000000000c4';

async function asTenant<T>(tenantId: string, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE app_user');
    await tx.unsafe('SELECT set_tenant_context($1::uuid, $2::uuid, $3::uuid[], $4::boolean)', [
      tenantId, userId, [], true,
    ]);
    return fn(tx);
  });
}

describeDb('a provisioned dealership is invisible to every other tenant', () => {
  beforeAll(async () => {
    const postgres = (await import('postgres')).default;
    sql = postgres(DATABASE_URL!, { max: 2, onnotice: () => {} }) as unknown as Sql;

    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform');
      await tx`
        INSERT INTO tenants (id, name, legal_name, status)
        VALUES (${NEW_TENANT}::uuid, 'Isolation Motors', 'Isolation Motors Ltd', 'provisioning')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
      await tx`
        INSERT INTO sites (id, tenant_id, name)
        VALUES (${NEW_SITE}::uuid, ${NEW_TENANT}::uuid, 'Isolation Forecourt')
        ON CONFLICT (id) DO NOTHING`;
      await tx`
        INSERT INTO brands (id, tenant_id, name, is_default)
        VALUES (${NEW_BRAND}::uuid, ${NEW_TENANT}::uuid, 'Isolation Motors', true)
        ON CONFLICT (id) DO NOTHING`;
      await tx`
        INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites)
        VALUES (${NEW_ROLE}::uuid, ${NEW_TENANT}::uuid, 'owner', 'Owner', true, '["*"]'::jsonb, true)
        ON CONFLICT (id) DO NOTHING`;
    });
  });

  afterAll(async () => {
    await sql`DELETE FROM roles WHERE id = ${NEW_ROLE}::uuid`;
    await sql`DELETE FROM brands WHERE id = ${NEW_BRAND}::uuid`;
    await sql`DELETE FROM sites WHERE id = ${NEW_SITE}::uuid`;
    await sql`DELETE FROM tenants WHERE id = ${NEW_TENANT}::uuid`;
    await sql.end();
  });

  it('tenant A cannot list the new dealership’s sites', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx`SELECT id FROM sites WHERE id = ${NEW_SITE}::uuid`);
    expect(rows).toHaveLength(0);
  });

  it('tenant A cannot list the new dealership’s roles', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx`SELECT id FROM roles WHERE id = ${NEW_ROLE}::uuid`);
    expect(rows).toHaveLength(0);
  });

  it('app_platform can still see the new dealership — that is the directory', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform');
      return tx`SELECT id FROM tenants WHERE id = ${NEW_TENANT}::uuid`;
    });
    expect(rows).toHaveLength(1);
  });
});
