import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withSession, sql, type Tx } from '@/data/db';
import { applyMove } from '@/data/prep-apply';
import { ensureFixtures, stages, session, T } from './fixtures';

/**
 * Moving a card, against a real database.
 *
 * The decision itself is unit-tested in `prep.test.ts` via `moveBlockers`.
 * What this covers only exists once there is a database: that the stage
 * history stays coherent through a move. That history IS the days metric, and
 * a card in two stages at once corrupts every number the board reports without
 * anything visibly breaking.
 *
 * The fixtures are built by this suite rather than read from the demo seed —
 * see `fixtures.ts` for why. Every case runs inside a transaction that is
 * rolled back, so the cases cannot affect each other or their order.
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

/**
 * Always runs, and FAILS rather than skipping when the fixtures could not be
 * built. A suite that quietly evaporates reports green, and every CI summary
 * counts that as a pass — which is exactly how these tests passed while
 * asserting nothing on an unseeded database.
 */
it('the prep integration fixtures build', () => {
  expect(ready, `Could not build the integration fixtures: ${reason}`).toBe(true);
});

/** Run the body in a transaction and always roll it back. */
const inRollback = async (fn: (tx: Tx) => Promise<void>) => {
  await expect(withSession(session, async (tx) => {
    await fn(tx);
    throw new Error('__rollback__');
  })).rejects.toThrow('__rollback__');
};

describe('moving a card', () => {
  it('THE photography gate refuses a car with too few pictures', async () => {
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: T.cardPhotos, toStageId: stages['quality_check']!,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/photographs published/);
      // Not overridable — this one cannot be talked past.
      expect(result.needsReason).toBeUndefined();
    });
  });

  it('the gate lifts once the pictures exist', async () => {
    await inRollback(async (tx) => {
      // `published_photo_count` is maintained by M5's trigger in production;
      // set directly here to isolate the gate from the media pipeline.
      await tx`
        UPDATE vehicles SET published_photo_count = 12
        WHERE id = (SELECT vehicle_id FROM prep_cards WHERE id = ${T.cardPhotos}::uuid)`;

      const result = await applyMove(tx, session, {
        cardId: T.cardPhotos, toStageId: stages['quality_check']!,
      });
      expect(result.ok).toBe(true);
    });
  });

  it('leaves EXACTLY ONE open stage event after a move', async () => {
    // The invariant every duration rests on. Two open events means the card is
    // in two stages, and every number after that is wrong.
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: T.cardClean, toStageId: stages['photography']!,
      });
      expect(result.ok).toBe(true);

      const [open] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM prep_stage_events
        WHERE card_id = ${T.cardClean}::uuid AND exited_at IS NULL`;
      expect(open!.n).toBe(1);
    });
  });

  it('closes the old stage at the same instant the new one opens', async () => {
    // A gap between them is time the car existed in no stage at all, and it
    // disappears silently from every per-stage total.
    const at = new Date();
    await inRollback(async (tx) => {
      await applyMove(tx, session, {
        cardId: T.cardClean, toStageId: stages['photography']!, now: at,
      });

      const rows = await tx<{ entered_at: Date; exited_at: Date | null }[]>`
        SELECT entered_at, exited_at FROM prep_stage_events
        WHERE card_id = ${T.cardClean}::uuid ORDER BY entered_at DESC LIMIT 2`;

      expect(rows[0]!.entered_at.getTime()).toBe(at.getTime());
      expect(rows[1]!.exited_at!.getTime()).toBe(at.getTime());
    });
  });

  it('writes an audit event naming both stages', async () => {
    await inRollback(async (tx) => {
      await applyMove(tx, session, {
        cardId: T.cardClean, toStageId: stages['photography']!,
      });

      const [event] = await tx<{ action: string; diff: Record<string, unknown> }[]>`
        SELECT action, diff FROM audit_events
        WHERE resource_type = 'prep_card' AND resource_id = ${T.cardClean}::uuid
        ORDER BY occurred_at DESC LIMIT 1`;

      expect(event!.action).toBe('move_stage');
      expect(event!.diff).toMatchObject({ stage: { from: 'valet', to: 'photography' } });
    });
  });

  it('an open block needs a stated reason, and records it', async () => {
    await inRollback(async (tx) => {
      const refused = await applyMove(tx, session, {
        cardId: T.cardBlocked, toStageId: stages['mot']!,
      });
      expect(refused.ok).toBe(false);
      expect(refused.needsReason?.some((b) => b.code === 'open_block')).toBe(true);

      const allowed = await applyMove(tx, session, {
        cardId: T.cardBlocked, toStageId: stages['mot']!,
        override: 'Wing fitted, block not closed yet',
      });
      expect(allowed.ok).toBe(true);

      const [event] = await tx<{ note: string | null }[]>`
        SELECT note FROM prep_stage_events
        WHERE card_id = ${T.cardBlocked}::uuid ORDER BY entered_at DESC LIMIT 1`;
      expect(event!.note).toBe('Wing fitted, block not closed yet');
    });
  });

  it('unapproved work over the threshold cannot be talked past', async () => {
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: T.cardUnapproved, toStageId: stages['mot']!, override: 'It will be fine',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/approval threshold/);
    });
  });

  it('refuses a move to the stage it is already in', async () => {
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: T.cardClean, toStageId: stages['valet']!,
      });
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
    await inRollback(async (tx) => {
      const result = await applyMove(tx, session, {
        cardId: T.cardClean, toStageId: stages['ready']!, override: 'Finishing up',
      });
      expect(result.ok).toBe(true);

      const [card] = await tx<{ completed_at: Date | null }[]>`
        SELECT completed_at FROM prep_cards WHERE id = ${T.cardClean}::uuid`;
      expect(card!.completed_at).not.toBeNull();
    });
  });
});
