import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withSession, sql } from '@/data/db';
import { applyMove } from '@/data/prep-apply';
import type { Session } from '@/auth/session';

/**
 * Moving a card, against the real database.
 *
 * The decision itself is unit-tested in `prep.test.ts` via `moveBlockers`.
 * What this covers is the part that only exists once there is a database: that
 * the stage history stays coherent through a move, because that history IS the
 * days metric, and a card in two stages at once corrupts every number the
 * board reports without anything visibly breaking.
 *
 * Every case runs inside a transaction that is rolled back, so the seeded
 * board is exactly as it was afterwards.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-0000-4000-8000-000000000001';

const session: Session = {
  sessionId: '00000000-0000-4000-8000-00000000ff01',
  userId: USER,
  membershipId: '00000000-0000-4000-8000-00000000ff02',
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

let stages: Record<string, string> = {};
let seeded = false;

/** A card sitting in a named stage, or null when the board is not seeded. */
const cardIn = async (stageKey: string): Promise<string | null> => {
  const [row] = await sql<{ id: string }[]>`
    SELECT c.id FROM prep_cards c
    JOIN prep_stages s ON s.id = c.current_stage_id
    WHERE c.completed_at IS NULL AND s.key = ${stageKey} AND c.tenant_id = ${TENANT}::uuid
    LIMIT 1`;
  return row?.id ?? null;
};

beforeAll(async () => {
  const rows = await sql<{ key: string; id: string }[]>`
    SELECT key, id FROM prep_stages WHERE tenant_id = ${TENANT}::uuid`;
  stages = Object.fromEntries(rows.map((r) => [r.key, r.id]));
  seeded = rows.length > 0 && (await cardIn('photography')) !== null;
});

afterAll(async () => { await sql.end(); });

/** Always runs — a suite that silently skips reports green. */
it('the prep board gate can run', () => {
  expect(
    seeded,
    'Prep board not seeded. Run `pnpm db:seed`, `pnpm db:seed:crm`, then `pnpm db:seed:prep`.',
  ).toBe(true);
});

/** Runs the body inside a transaction and always rolls it back. */
const inRollback = async (fn: (tx: Parameters<Parameters<typeof withSession>[1]>[0]) => Promise<void>) => {
  await expect(withSession(session, async (tx) => {
    await fn(tx);
    throw new Error('__rollback__');
  })).rejects.toThrow('__rollback__');
};

describe.runIf(process.env['DATABASE_URL'])('moving a card', () => {
  it('THE photography gate refuses a car with too few pictures', async () => {
    const cardId = await cardIn('photography');
    if (!cardId) return;

    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId, toStageId: stages['quality_check']!,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/photographs published/);
      // Not overridable — this one cannot be talked past.
      expect(result.needsReason).toBeUndefined();
    });
  });

  it('the gate lifts once the pictures exist', async () => {
    const cardId = await cardIn('photography');
    if (!cardId) return;

    await inRollback(async (tx) => {
      // published_photo_count is maintained by M5's trigger in production;
      // here it is set directly to isolate the gate from the media pipeline.
      await tx`
        UPDATE vehicles SET published_photo_count = 12
        WHERE id = (SELECT vehicle_id FROM prep_cards WHERE id = ${cardId}::uuid)`;

      const result = await applyMove(tx, session, {
        cardId, toStageId: stages['quality_check']!,
      });
      expect(result.ok).toBe(true);
    });
  });

  it('leaves EXACTLY ONE open stage event after a move', async () => {
    // The invariant the whole days metric rests on. Two open events means the
    // card is in two stages, and every duration after that is wrong.
    const cardId = await cardIn('valet');
    if (!cardId) return;

    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId, toStageId: stages['photography']!,
      });
      expect(result.ok).toBe(true);

      const [open] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM prep_stage_events
        WHERE card_id = ${cardId}::uuid AND exited_at IS NULL`;
      expect(open!.n).toBe(1);
    });
  });

  it('closes the old stage at the same instant the new one opens', async () => {
    // A gap between them is time the car existed in no stage at all, and it
    // silently disappears from every per-stage total.
    const cardId = await cardIn('valet');
    if (!cardId) return;
    const at = new Date();

    await inRollback(async (tx) => {
      await applyMove(tx, session, { cardId, toStageId: stages['photography']!, now: at });

      const rows = await tx<{ entered_at: Date; exited_at: Date | null }[]>`
        SELECT entered_at, exited_at FROM prep_stage_events
        WHERE card_id = ${cardId}::uuid ORDER BY entered_at DESC LIMIT 2`;

      expect(rows[0]!.entered_at.getTime()).toBe(at.getTime());
      expect(rows[1]!.exited_at!.getTime()).toBe(at.getTime());
    });
  });

  it('writes an audit event naming both stages', async () => {
    const cardId = await cardIn('valet');
    if (!cardId) return;

    await inRollback(async (tx) => {
      await applyMove(tx, session, { cardId, toStageId: stages['photography']! });

      const [event] = await tx<{ action: string; diff: Record<string, unknown> }[]>`
        SELECT action, diff FROM audit_events
        WHERE resource_type = 'prep_card' AND resource_id = ${cardId}::uuid
        ORDER BY occurred_at DESC LIMIT 1`;

      expect(event!.action).toBe('move_stage');
      expect(event!.diff).toMatchObject({ stage: { from: 'valet', to: 'photography' } });
    });
  });

  it('an open block needs a stated reason, and records it', async () => {
    const cardId = await cardIn('bodywork');   // seeded blocked on a wing
    if (!cardId) return;

    await inRollback(async (tx) => {
      const refused = await applyMove(tx, session, { cardId, toStageId: stages['mot']! });
      expect(refused.ok).toBe(false);
      expect(refused.needsReason?.some((b) => b.code === 'open_block')).toBe(true);

      const allowed = await applyMove(tx, session, {
        cardId, toStageId: stages['mot']!, override: 'Wing fitted, block not closed yet',
      });
      expect(allowed.ok).toBe(true);

      const [event] = await tx<{ note: string | null }[]>`
        SELECT note FROM prep_stage_events
        WHERE card_id = ${cardId}::uuid ORDER BY entered_at DESC LIMIT 1`;
      expect(event!.note).toBe('Wing fitted, block not closed yet');
    });
  });

  it('unapproved work over the threshold cannot be talked past', async () => {
    const cardId = await cardIn('mechanical');
    if (!cardId) return;

    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId, toStageId: stages['mot']!, override: 'It will be fine',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/approval threshold/);
    });
  });

  it('refuses a move to the stage it is already in', async () => {
    const cardId = await cardIn('valet');
    if (!cardId) return;
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, { cardId, toStageId: stages['valet']! });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already in that stage/);
    });
  });

  it('refuses a card that is not ours — RLS makes it simply absent', async () => {
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: '00000000-0000-4000-8000-0000000000aa',
        toStageId: stages['valet']!,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not on the board, or it is not yours/);
    });
  });

  it('reaching the final stage completes the card', async () => {
    const cardId = await cardIn('valet');
    if (!cardId) return;

    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId, toStageId: stages['ready']!, override: 'Finishing up',
      });
      expect(result.ok).toBe(true);

      const [card] = await tx<{ completed_at: Date | null }[]>`
        SELECT completed_at FROM prep_cards WHERE id = ${cardId}::uuid`;
      expect(card!.completed_at).not.toBeNull();
    });
  });
});
