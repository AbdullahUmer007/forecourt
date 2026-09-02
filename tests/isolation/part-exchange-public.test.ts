/**
 * A public part-exchange write is tenant-scoped. The shopfront role can INSERT
 * a contact, lead and draft appraisal for the resolved host, and cannot read
 * another dealer's desk.
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

const TENANT_A = 'ffffffff-0000-4000-8000-0000000000d1';
const TENANT_B = 'ffffffff-0000-4000-8000-0000000000d2';
const USER_A = 'ffffffff-0000-4000-8000-0000000000d3';
const USER_B = 'ffffffff-0000-4000-8000-0000000000d4';
const ROLE_A = 'ffffffff-0000-4000-8000-0000000000d5';
const ROLE_B = 'ffffffff-0000-4000-8000-0000000000d6';

async function asPublic<T>(tenantId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE app_public');
    await tx.unsafe('SELECT set_tenant_context($1::uuid, NULL, $2::uuid[], $3::boolean)', [
      tenantId, [], true,
    ]);
    return fn(tx);
  });
}

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
  let contactId = '';
  let leadId = '';
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
        (${USER_A}::uuid, 'px-a@example.com', 'Px A', 'active'),
        (${USER_B}::uuid, 'px-b@example.com', 'Px B', 'active')
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
    if (appraisalId) await sql`DELETE FROM appraisals WHERE id = ${appraisalId}::uuid`;
    if (leadId) {
      await sql`DELETE FROM lead_events WHERE lead_id = ${leadId}::uuid`;
      await sql`DELETE FROM leads WHERE id = ${leadId}::uuid`;
    }
    if (contactId) await sql`DELETE FROM contacts WHERE id = ${contactId}::uuid`;
    await sql`DELETE FROM tenant_memberships WHERE user_id IN (${USER_A}::uuid, ${USER_B}::uuid)`;
    await sql`DELETE FROM roles WHERE id IN (${ROLE_A}::uuid, ${ROLE_B}::uuid)`;
    await sql`DELETE FROM users WHERE id IN (${USER_A}::uuid, ${USER_B}::uuid)`;
    await sql`DELETE FROM tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
    await sql.end();
  });

  it('app_public can insert a draft for the resolved tenant', async () => {
    const created = await asPublic(TENANT_A, async (tx) => {
      const [c] = await tx`
        INSERT INTO contacts (tenant_id, first_name, last_name, email, phone)
        VALUES (${TENANT_A}::uuid, 'Isolation', 'Buyer', 'px-iso@example.com', '07700900000')
        RETURNING id`;
      if (!c) throw new Error('contact');
      const [l] = await tx`
        INSERT INTO leads (tenant_id, contact_id, source, message)
        VALUES (${TENANT_A}::uuid, ${String(c['id'])}::uuid, 'website_part_ex', 'Isolation PX')
        RETURNING id`;
      if (!l) throw new Error('lead');
      await tx`
        INSERT INTO lead_events (tenant_id, lead_id, kind, to_stage, detail)
        VALUES (${TENANT_A}::uuid, ${String(l['id'])}::uuid, 'created', 'new', 'test')`;
      const [a] = await tx`
        INSERT INTO appraisals (tenant_id, contact_id, lead_id, state, seller_type, registration, mileage)
        VALUES (
          ${TENANT_A}::uuid, ${String(c['id'])}::uuid, ${String(l['id'])}::uuid,
          'draft', 'private_individual', 'AB12CDE', 12000
        )
        RETURNING id`;
      if (!a) throw new Error('appraisal');
      return { contactId: String(c['id']), leadId: String(l['id']), appraisalId: String(a['id']) };
    });
    contactId = created.contactId;
    leadId = created.leadId;
    appraisalId = created.appraisalId;
    expect(appraisalId).toBeTruthy();
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
