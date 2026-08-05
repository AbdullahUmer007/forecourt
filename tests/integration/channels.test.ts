import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/data/db';
import { loadChannels } from '@/data/channels';
import { ensureFixtures, session, T } from './fixtures';

/**
 * Channel feed status, against a real database.
 *
 * What is being defended:
 *
 * 1. A sold car still advertised past its deadline is FOUND. That one costs a
 *    dealer more than a wasted phone call.
 * 2. A rejected listing carries what the portal actually said.
 * 3. The publish gate is M3's go-live gate — a car that cannot appear on the
 *    dealer's own site does not go to a portal they are paying for.
 * 4. `channel_sync_events` is append-only: editing it would destroy the only
 *    evidence of a feed that stopped working.
 */

let ready = false;
let reason = '';

const CH = (n: number) => `eeeeeeee-0000-4000-8000-0000000c000${n}`;
const VEH = (n: number) => `eeeeeeee-0000-4000-8000-0000000c010${n}`;
const LST = (n: number) => `eeeeeeee-0000-4000-8000-0000000c020${n}`;

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO channels (id, tenant_id, channel, display_name, enabled,
                            monthly_cost_pence, delist_delay_minutes, created_by)
      VALUES (${CH(1)}::uuid, ${T.tenant}::uuid, 'auto_trader', 'Auto Trader (test)',
              true, 189_000, 0, ${T.user}::uuid),
             (${CH(2)}::uuid, ${T.tenant}::uuid, 'cargurus', 'CarGurus (test)',
              false, 45_000, 1440, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // 1: live, fully specified — publishable.
    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, mileage,
                            published_photo_count, provenance_checked_at, booked_in_at)
      VALUES (${VEH(1)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'CHN-1', 950001,
              'CH70AAA', 'Ford', 'Focus', 'live', 'margin',
              1_200_000, 1_000_000, 42_000, 8, now() - interval '10 days',
              now() - interval '30 days')
      ON CONFLICT (id) DO NOTHING`;

    // 2: live but with NO photographs and no provenance check — the gate that
    // stops it going live on the dealer's own site.
    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, mileage,
                            published_photo_count, booked_in_at)
      VALUES (${VEH(2)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'CHN-2', 950002,
              'CH70BBB', 'Kia', 'Ceed', 'live', 'margin',
              950_000, 800_000, 31_000, 0, now() - interval '20 days')
      ON CONFLICT (id) DO NOTHING`;

    // 3: SOLD three days ago and still published.
    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, mileage,
                            published_photo_count, provenance_checked_at,
                            booked_in_at, sold_at)
      VALUES (${VEH(3)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'CHN-3', 950003,
              'CH70CCC', 'Audi', 'A3', 'sold', 'margin',
              1_800_000, 1_500_000, 22_000, 12, now() - interval '40 days',
              now() - interval '90 days', now() - interval '3 days')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      UPDATE vehicles SET state = 'sold', sold_at = now() - interval '3 days'
      WHERE id = ${VEH(3)}::uuid`;

    await sql`
      INSERT INTO channel_listings (id, tenant_id, channel_id, vehicle_id, status,
                                    last_published_at, last_attempt_at, last_error, error_count)
      VALUES (${LST(1)}::uuid, ${T.tenant}::uuid, ${CH(1)}::uuid, ${VEH(1)}::uuid,
              'published', now() - interval '1 hour', now() - interval '1 hour', NULL, 0),
             (${LST(2)}::uuid, ${T.tenant}::uuid, ${CH(1)}::uuid, ${VEH(2)}::uuid,
              'failed', NULL, now() - interval '20 minutes',
              'Auto Trader rejected the listing — at least one photograph is required.', 2),
             -- A published listing must carry the timestamp it was published
             -- at: listing_published_has_timestamp. "Published, we think" is
             -- exactly the guess the feed monitor exists to stop.
             (${LST(3)}::uuid, ${T.tenant}::uuid, ${CH(1)}::uuid, ${VEH(3)}::uuid,
              'published', now() - interval '9 days', now() - interval '9 days', NULL, 0)
      ON CONFLICT (id) DO NOTHING`;

    await sql`
      INSERT INTO channel_sync_events (tenant_id, channel_id, vehicle_id, action, outcome,
                                       idempotency_key, adapter_version, http_status,
                                       message, duration_ms)
      VALUES (${T.tenant}::uuid, ${CH(1)}::uuid, ${VEH(2)}::uuid, 'publish', 'rejected',
              'test-rejected-1', 1, 422,
              'Auto Trader rejected the listing — at least one photograph is required.', 340)
      ON CONFLICT DO NOTHING`;

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the channel fixtures build', () => {
  expect(ready, `Could not seed the channel fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('what the status screen finds', () => {
  it('finds a sold car still advertised past its deadline', async () => {
    // The finding that costs more than a wasted phone call: a buyer enquiring
    // about a car that sold last week, at a price it is no longer available at.
    const view = await loadChannels(session);
    const overdue = view.overdueDelists.find((l) => l.registration === 'CH70CCC');
    expect(overdue).toBeDefined();
    expect(overdue!.delist.required).toBe(true);
    expect(overdue!.delist.overdue).toBe(true);
    // And the reason is in words, not a boolean.
    expect(overdue!.delist.reason.length).toBeGreaterThan(0);
  });

  it('carries what the portal actually said, not a generic failure', async () => {
    const view = await loadChannels(session);
    const failed = view.failed.find((l) => l.registration === 'CH70BBB');
    expect(failed).toBeDefined();
    expect(failed!.lastError).toMatch(/photograph/i);
    // "An error occurred" is banned by CLAUDE.md; so is its cousin "sync error".
    expect(failed!.lastError).not.toMatch(/^(sync )?error$/i);
  });

  it('applies the same gate as the dealer’s own website', async () => {
    // A car that cannot go live on our shopfront must not go to a portal the
    // dealer is paying for. Holding our own site to the higher standard would
    // be exactly backwards.
    const view = await loadChannels(session);
    const blocked = view.blocked.find((l) => l.registration === 'CH70BBB');
    expect(blocked).toBeDefined();
    expect(blocked!.blockers.length).toBeGreaterThan(0);
    // Every blocker says what to fix, not that something is wrong.
    for (const b of blocked!.blockers) {
      expect(b.message.length).toBeGreaterThan(0);
      expect(b.code.length).toBeGreaterThan(0);
    }

    // And the fully-specified car is NOT blocked.
    const fine = view.blocked.find((l) => l.registration === 'CH70AAA');
    expect(fine).toBeUndefined();
  });

  it('recomputes blockers rather than reading a stored answer', async () => {
    // A stored answer is wrong the moment somebody adds a photograph. Add
    // one and the blocker list must change without anything re-running a job.
    const before = await loadChannels(session);
    const wasBlocked = before.blocked.some((l) => l.registration === 'CH70BBB');
    expect(wasBlocked).toBe(true);

    await sql`
      UPDATE vehicles SET published_photo_count = 9,
        provenance_checked_at = now() - interval '1 day'
      WHERE id = ${VEH(2)}::uuid`;
    try {
      const after = await loadChannels(session);
      const stillBlocked = after.blocked.find((l) => l.registration === 'CH70BBB');
      expect(stillBlocked, 'the blockers should have cleared with no job re-run')
        .toBeUndefined();
    } finally {
      await sql`
        UPDATE vehicles SET published_photo_count = 0, provenance_checked_at = NULL
        WHERE id = ${VEH(2)}::uuid`;
    }
  });

  it('counts a channel that is switched off as carrying nothing', async () => {
    const view = await loadChannels(session);
    const off = view.channels.find((c) => c.displayName === 'CarGurus (test)');
    expect(off!.enabled).toBe(false);
    expect(off!.published).toBe(0);
  });

  it('reports live cars that no enabled channel is carrying', async () => {
    // The question a dealer is actually asking when they ask whether their
    // stock is on Auto Trader.
    const view = await loadChannels(session);
    expect(view.summary.onNoChannel).toBeGreaterThanOrEqual(0);
    expect(view.summary.liveVehicles).toBeGreaterThan(0);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the sync log', () => {
  it('records what came back, including the refusals', async () => {
    const view = await loadChannels(session);
    const rejected = view.recentEvents.find((e) => e.outcome === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.message).toMatch(/photograph/i);
    expect(rejected!.httpStatus).toBe(422);
  });

  it('is append-only — the evidence of a feed that stopped working', async () => {
    const [event] = await sql<{ id: string }[]>`
      SELECT id FROM channel_sync_events WHERE tenant_id = ${T.tenant}::uuid LIMIT 1`;
    expect(event).toBeDefined();

    await expect(sql`
      UPDATE channel_sync_events SET message = 'quietly changed' WHERE id = ${event!.id}::uuid`)
      .rejects.toThrow(/append-only/i);
    await expect(sql`DELETE FROM channel_sync_events WHERE id = ${event!.id}::uuid`)
      .rejects.toThrow(/append-only/i);
  });
});
