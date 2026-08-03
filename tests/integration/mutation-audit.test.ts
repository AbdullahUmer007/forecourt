import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withSession, sql } from '@/data/db';
import { writeAudit, changedFields } from '@/data/audit';
import type { Session } from '@/auth/session';

/**
 * The definition of done says "audit event on every mutation". This checks the
 * part of that claim which is easy to get wrong and impossible to see: that the
 * audit row and the change it describes live or die TOGETHER.
 *
 * An audit event committed on its own connection survives a rolled-back
 * mutation, and the result is a trail describing something that never
 * happened — which is worse than no trail, because it is believed.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'; // Kennington
const USER = '22222222-0000-4000-8000-000000000001';
const APPRAISAL = '55555555-0000-4000-8000-00000000000a';

const session: Session = {
  sessionId: '00000000-0000-4000-8000-00000000ffff',
  userId: USER,
  membershipId: '00000000-0000-4000-8000-00000000fffe',
  tenantId: TENANT,
  roleKey: 'owner',
  permissions: ['*'],
  scope: 'all_sites',
  siteIds: [],
  displayName: 'Dealer Principal',
  email: 'owner@kenningtoncarsales.co.uk',
  tenantName: 'Kennington Car Sales',
  mfaSatisfiedAt: null,
  stepUpSatisfiedAt: null,
  stepUpValid: false,
};

const NOTE = 'atomicity probe — safe to delete';

let seeded = false;

beforeAll(async () => {
  const [row] = await sql`SELECT id FROM appraisals WHERE id = ${APPRAISAL}::uuid`;
  seeded = Boolean(row);
});

afterAll(async () => {
  if (seeded) {
    await sql`DELETE FROM appraisal_damage WHERE notes = ${NOTE}`;
    // The audit rows are deliberately NOT cleaned up: `audit_events` is
    // append-only and the trigger refuses a DELETE outright. Writing this
    // teardown was how that got confirmed against the real database rather
    // than against the migration that claims it.
  }
  await sql.end();
});

/**
 * Always runs. A suite that silently skips because the database was not seeded
 * reports green, and every CI summary counts a skipped suite as a success —
 * the exact failure the isolation suite had on 3 August.
 */
it('the CRM integration gate can run', () => {
  expect(
    seeded,
    'Kennington demo data missing. Run `pnpm db:setup`, `pnpm db:seed`, then `pnpm db:seed:crm`.',
  ).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('a mutation and its audit event', () => {
  const insertMark = async (tx: Parameters<Parameters<typeof withSession>[1]>[0]) => {
    const [mark] = await tx<{ id: string }[]>`
      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group,
                                    damage_type, severity, notes, created_by)
      VALUES (${TENANT}::uuid, ${APPRAISAL}::uuid, 'osf_door', 'body_panel',
              'dent', 'moderate', ${NOTE}, ${USER}::uuid)
      RETURNING id`;
    await writeAudit({
      tx, session,
      resourceType: 'appraisal_damage',
      resourceId: mark!.id,
      action: 'test_probe',
      after: { panel: 'osf_door', severity: 'moderate' },
    });
    return mark!.id;
  };

  const counts = async () => {
    const [m] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM appraisal_damage WHERE notes = ${NOTE}`;
    const [a] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_events
      WHERE resource_type = 'appraisal_damage' AND action = 'test_probe'`;
    return { marks: m!.n, audits: a!.n };
  };

  it('both land when the transaction commits', async () => {
    const before = await counts();
    await withSession(session, insertMark);
    const after = await counts();

    expect(after.marks).toBe(before.marks + 1);
    expect(after.audits).toBe(before.audits + 1);
  });

  it('NEITHER lands when the transaction rolls back', async () => {
    const before = await counts();

    await expect(withSession(session, async (tx) => {
      await insertMark(tx);
      // Whatever fails after the write — a constraint, a timeout, a bug.
      throw new Error('deliberate failure after the mark and its audit row');
    })).rejects.toThrow(/deliberate failure/);

    const after = await counts();
    expect(after.marks, 'the mark survived a rolled-back transaction').toBe(before.marks);
    expect(after.audits, 'an audit event survived describing a change that never happened')
      .toBe(before.audits);
  });

  it('the audit row records who, what and which tenant', async () => {
    await withSession(session, insertMark);
    const [event] = await sql<{
      tenant_id: string; actor_id: string; actor_type: string;
      resource_type: string; action: string; diff: unknown;
    }[]>`
      SELECT tenant_id, actor_id, actor_type, resource_type, action, diff
      FROM audit_events
      WHERE resource_type = 'appraisal_damage' AND action = 'test_probe'
      ORDER BY occurred_at DESC LIMIT 1`;

    expect(event!.tenant_id).toBe(TENANT);
    expect(event!.actor_id).toBe(USER);
    expect(event!.actor_type).toBe('user');
    expect(event!.diff).toMatchObject({ panel: { to: 'osf_door' } });
  });
});

describe('the audit diff', () => {
  it('records both sides of every field that changed', () => {
    expect(changedFields({ price: 100, colour: 'red' }, { price: 120, colour: 'red' }))
      .toEqual({ price: { from: 100, to: 120 } });
  });

  it('says nothing when nothing changed', () => {
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('omits unchanged fields, so the one that moved is findable', () => {
    const diff = changedFields(
      { a: 1, b: 2, c: 3, d: 4, e: 5 },
      { a: 1, b: 2, c: 3, d: 4, e: 6 },
    );
    expect(Object.keys(diff!)).toEqual(['e']);
  });

  it('compares by value, not by reference', () => {
    expect(changedFields({ at: new Date('2026-08-03') }, { at: new Date('2026-08-03') }))
      .toBeNull();
  });

  it('survives a bigint, which plain JSON.stringify refuses outright', () => {
    // Money is bigint everywhere in this codebase, so an audit diff that
    // throws on one is an audit diff that never gets written.
    expect(() => changedFields({ pence: 1200n }, { pence: 1500n })).not.toThrow();
    expect(changedFields({ pence: 1200n }, { pence: 1500n }))
      .toEqual({ pence: { from: 1200n, to: 1500n } });
  });

  it('treats a newly-set field as a change from nothing', () => {
    expect(changedFields(null, { panel: 'osf_door' }))
      .toEqual({ panel: { from: null, to: 'osf_door' } });
  });
});
