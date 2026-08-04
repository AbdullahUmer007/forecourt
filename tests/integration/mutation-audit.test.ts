import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withSession, sql, type Tx } from '@/data/db';
import { writeAudit, changedFields } from '@/data/audit';
import { ensureFixtures, session, T } from './fixtures';

/**
 * The definition of done says "audit event on every mutation". This checks the
 * part of that claim which is easy to get wrong and impossible to see: that
 * the audit row and the change it describes live or die TOGETHER.
 *
 * An audit event committed on its own connection survives a rolled-back
 * mutation, and the result is a trail describing something that never
 * happened — worse than no trail, because it is believed.
 *
 * Fixtures are built by this suite rather than read from the demo seed; see
 * `fixtures.ts`.
 */

let ready = false;
let reason = '';

beforeAll(async () => {
  try {
    await ensureFixtures();
    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => { await sql.end(); });

/** Always runs, and fails rather than skipping. */
it('the CRM integration fixtures build', () => {
  expect(ready, `Could not build the integration fixtures: ${reason}`).toBe(true);
});

describe('a mutation and its audit event', () => {
  const NOTE = 'atomicity probe';

  const insertMark = async (tx: Tx) => {
    const [mark] = await tx<{ id: string }[]>`
      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group,
                                    damage_type, severity, notes, created_by)
      VALUES (${T.tenant}::uuid, ${T.appraisal}::uuid, 'osf_door', 'body_panel',
              'dent', 'moderate', ${NOTE}, ${T.user}::uuid)
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

  const counts = async (tx: Tx) => {
    const [m] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM appraisal_damage WHERE notes = ${NOTE}`;
    const [a] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_events
      WHERE resource_type = 'appraisal_damage' AND action = 'test_probe'`;
    return { marks: m!.n, audits: a!.n };
  };

  it('both land inside the transaction', async () => {
    await expect(withSession(session, async (tx) => {
      const before = await counts(tx);
      await insertMark(tx);
      const after = await counts(tx);

      expect(after.marks).toBe(before.marks + 1);
      expect(after.audits).toBe(before.audits + 1);
      throw new Error('__rollback__');
    })).rejects.toThrow('__rollback__');
  });

  it('NEITHER survives when the transaction rolls back', async () => {
    // `audit_events` is append-only and refuses a DELETE outright, so this
    // suite cannot clean up after itself — which makes rolling back the only
    // way to run it repeatedly, and also the thing being tested.
    const before = await withSession(session, counts);

    await expect(withSession(session, async (tx) => {
      await insertMark(tx);
      throw new Error('whatever fails after the write — a constraint, a timeout, a bug');
    })).rejects.toThrow(/whatever fails/);

    const after = await withSession(session, counts);
    expect(after.marks, 'the mark survived a rolled-back transaction').toBe(before.marks);
    expect(after.audits, 'an audit event survived describing a change that never happened')
      .toBe(before.audits);
  });

  it('the audit row records who, what and which tenant', async () => {
    await expect(withSession(session, async (tx) => {
      await insertMark(tx);

      const [event] = await tx<{
        tenant_id: string; actor_id: string; actor_type: string;
        resource_type: string; action: string; diff: unknown;
      }[]>`
        SELECT tenant_id, actor_id, actor_type, resource_type, action, diff
        FROM audit_events
        WHERE resource_type = 'appraisal_damage' AND action = 'test_probe'
        ORDER BY occurred_at DESC LIMIT 1`;

      expect(event!.tenant_id).toBe(T.tenant);
      expect(event!.actor_id).toBe(T.user);
      expect(event!.actor_type).toBe('user');
      expect(event!.diff).toMatchObject({ panel: { to: 'osf_door' } });
      throw new Error('__rollback__');
    })).rejects.toThrow('__rollback__');
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
