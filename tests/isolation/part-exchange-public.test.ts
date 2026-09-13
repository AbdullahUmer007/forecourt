/**
 * A public part-exchange write is tenant-scoped. The shopfront role can INSERT
 * a contact, lead and draft appraisal for the resolved host, and cannot read
 * another dealer's desk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { submitPartExchange } from '../../apps/site/src/data/part-exchange';
import { sql as publicSql } from '../../apps/site/src/data/db';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

type Row = Record<string, unknown>;
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  end: () => Promise<void>;
  unsafe: (q: string, v?: unknown[]) => Promise<Row[]>;
  begin: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
};

let sql: Sql;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();
const ROLE_A = randomUUID();
const ROLE_B = randomUUID();

async function asUser<T>(tenantId: string, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE app_user');
    await tx.unsafe('SELECT set_tenant_context($1::uuid, $2::uuid, $3::uuid[], $4::boolean)', [
      tenantId, userId, [], true,
    ]);
    return fn(tx);
  });
}

describeDb('a public part-exchange write cannot leak between dealers', () => {
  let appraisalId = '';

  beforeAll(async () => {
    const postgres = (await import('postgres')).default;
    sql = postgres(DATABASE_URL!, { max: 2, onnotice: () => {} }) as unknown as Sql;

    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform');
      for (const [id, name] of [[TENANT_A, 'Px A'], [TENANT_B, 'Px B']] as const) {
        await tx`
          INSERT INTO tenants (id, name, legal_name, status)
          VALUES (${id}::uuid, ${name}, ${`${name} Ltd`}, 'live')
          ON CONFLICT (id) DO NOTHING`;
      }
    });

    await sql`
      INSERT INTO users (id, email, name, status)
      VALUES
        (${USER_A}::uuid, ${`${USER_A}@example.test`}, 'Px A', 'active'),
        (${USER_B}::uuid, ${`${USER_B}@example.test`}, 'Px B', 'active')
      ON CONFLICT (id) DO NOTHING`;

    await sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE app_platform');
      await tx`
        INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites)
        VALUES
          (${ROLE_A}::uuid, ${TENANT_A}::uuid, 'owner', 'Owner', true, '["*"]'::jsonb, true),
          (${ROLE_B}::uuid, ${TENANT_B}::uuid, 'owner', 'Owner', true, '["*"]'::jsonb, true)
        ON CONFLICT (id) DO NOTHING`;
      await tx`
        INSERT INTO tenant_memberships (tenant_id, user_id, role_id, scope_all_sites, status)
        VALUES
          (${TENANT_A}::uuid, ${USER_A}::uuid, ${ROLE_A}::uuid, true, 'active'),
          (${TENANT_B}::uuid, ${USER_B}::uuid, ${ROLE_B}::uuid, true, 'active')`;
    });
  });

  afterAll(async () => {
    // History is append-only. Fresh IDs let repeated scratch-DB runs retain it.
    await publicSql.end();
    await sql.end();
  });

  it('app_public can insert a draft for the resolved tenant', async () => {
    expect(await submitPartExchange(TENANT_A, { registration: 'AB12CDE', mileage: '12000', name: 'Isolation Buyer', email: 'px-iso@example.test', phone: '07700900000' })).toEqual({ ok: true });
    const [created] = await asUser(TENANT_A, USER_A, tx => tx`
      SELECT a.id FROM appraisals a JOIN leads l ON l.id=a.lead_id
      WHERE a.tenant_id=${TENANT_A}::uuid AND l.source='website_part_ex'`);
    appraisalId = String(created?.['id'] ?? '');
    expect(appraisalId).toBeTruthy();
  });

  it('does not interpret blank mileage as zero', async () => {
    expect((await submitPartExchange(TENANT_A, { registration: 'AB12CDE', mileage: '', name: 'Buyer', email: 'px@example.test', phone: '07700900000' })).ok).toBe(false);
  });

  it('tenant B cannot see that draft', async () => {
    const rows = await asUser(TENANT_B, USER_B, (tx) =>
      tx`SELECT id FROM appraisals WHERE id = ${appraisalId}::uuid`);
    expect(rows).toHaveLength(0);
  });

  it('tenant A can see its own draft', async () => {
    const rows = await asUser(TENANT_A, USER_A, (tx) =>
      tx`SELECT id FROM appraisals WHERE id = ${appraisalId}::uuid`);
    expect(rows).toHaveLength(1);
  });
});
