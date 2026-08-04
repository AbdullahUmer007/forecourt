/**
 * Demo data for the prep board.
 *
 * Seeds the ten default stages, then puts real stock on the board in states
 * that are worth LOOKING at rather than states that are tidy:
 *
 *   - one car sailing through, no blocks;
 *   - one that has sat nine of its eleven days waiting for a wing, which is
 *     the number the whole module exists to surface;
 *   - one blocked on two things at once, so the merge is visible on screen
 *     and not only in a unit test;
 *   - one held at Photography with too few pictures, hitting the gate;
 *   - one over budget with unapproved work on it.
 *
 * Idempotent. Run after `pnpm db:seed` and `pnpm db:seed:crm`.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';

const STAGES = [
  ['awaiting_collection', 'Awaiting collection', 1, 72, false, false],
  ['booked_in', 'Booked in', 2, 24, false, false],
  ['mechanical', 'Mechanical', 3, 48, false, false],
  ['bodywork', 'Bodywork / SMART', 4, 72, false, false],
  ['mot', 'MOT', 5, 24, false, false],
  ['parts_on_order', 'Parts on order', 6, null, false, false],
  ['valet', 'Valet', 7, 24, false, false],
  ['photography', 'Photography', 8, 24, true, false],
  ['quality_check', 'Quality check', 9, 24, false, false],
  ['ready', 'Ready', 10, null, false, true],
];

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(46)}`);
  await fn();
  console.log('ok');
};

async function seed() {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) throw new Error('Run `pnpm db:seed` first — this seeds onto Kennington.');

  const [site] = await sql`SELECT id FROM sites WHERE tenant_id = ${TENANT}::uuid LIMIT 1`;

  await step('prep stages', async () => {
    for (const [key, name, position, sla, photos, final] of STAGES) {
      await sql`
        INSERT INTO prep_stages (tenant_id, key, name, position, sla_hours,
                                 requires_min_photos, is_final)
        VALUES (${TENANT}::uuid, ${key}, ${name}, ${position}, ${sla}, ${photos}, ${final})
        ON CONFLICT (tenant_id, key) DO NOTHING`;
    }
  });

  const stages = Object.fromEntries(
    (await sql`SELECT key, id FROM prep_stages WHERE tenant_id = ${TENANT}::uuid`)
      .map((r) => [r.key, r.id]),
  );

  // Real stock from the demo seed, so the board shows cars a dealer recognises.
  const vehicles = await sql`
    SELECT id, registration, make, model FROM vehicles
    WHERE tenant_id = ${TENANT}::uuid AND deleted_at IS NULL
    ORDER BY registration LIMIT 5`;

  if (vehicles.length < 5) {
    console.log('\n  (only', vehicles.length, 'vehicles — seeding what there is)');
  }

  /** One card, its stage history, its tasks and its blocks. */
  const card = async (vehicle, spec) => {
    const [existing] = await sql`
      SELECT id FROM prep_cards
      WHERE tenant_id = ${TENANT}::uuid AND vehicle_id = ${vehicle.id}::uuid`;
    if (existing) return existing.id;

    const [created] = await sql`
      INSERT INTO prep_cards (tenant_id, site_id, vehicle_id, current_stage_id, owner_id,
                              budget_pence, started_at)
      VALUES (${TENANT}::uuid, ${site?.id ?? null}, ${vehicle.id}::uuid,
              ${stages[spec.stage]}::uuid, ${OWNER}::uuid, ${spec.budgetPence},
              now() - ${`${spec.startedHoursAgo} hours`}::interval)
      RETURNING id`;

    let cursor = spec.startedHoursAgo;
    for (const [stageKey, hours] of spec.history) {
      const enteredAgo = cursor;
      cursor -= hours;
      await sql`
        INSERT INTO prep_stage_events (tenant_id, card_id, stage_id, entered_at, exited_at, moved_by)
        VALUES (${TENANT}::uuid, ${created.id}::uuid, ${stages[stageKey]}::uuid,
                now() - ${`${enteredAgo} hours`}::interval,
                ${cursor > 0 ? sql`now() - ${`${cursor} hours`}::interval` : null},
                ${OWNER}::uuid)`;
    }

    for (const task of spec.tasks ?? []) {
      await sql`
        INSERT INTO prep_tasks (tenant_id, card_id, description, category, status, source,
                                source_detail, estimate_pence, approval_required, approved_at)
        VALUES (${TENANT}::uuid, ${created.id}::uuid, ${task.description}, ${task.category},
                ${task.status}, ${task.source ?? 'manual'}, ${task.sourceDetail ?? null},
                ${task.estimatePence ?? null}, ${task.approvalRequired ?? false},
                ${task.approved ? sql`now()` : null})`;
    }

    for (const b of spec.blocks ?? []) {
      await sql`
        INSERT INTO prep_blocks (tenant_id, card_id, reason, note, started_at, ended_at, raised_by)
        VALUES (${TENANT}::uuid, ${created.id}::uuid, ${b.reason}::prep_block_reason,
                ${b.note ?? null},
                now() - ${`${b.startedHoursAgo} hours`}::interval,
                ${b.endedHoursAgo !== undefined
                  ? sql`now() - ${`${b.endedHoursAgo} hours`}::interval` : null},
                ${OWNER}::uuid)`;
    }

    return created.id;
  };

  await step('card 1 — moving through cleanly', async () => {
    if (!vehicles[0]) return;
    await card(vehicles[0], {
      stage: 'valet', startedHoursAgo: 52, budgetPence: 60_000,
      history: [['booked_in', 6], ['mechanical', 22], ['bodywork', 18], ['valet', 6]],
      tasks: [
        { description: 'Full service and oil change', category: 'mechanical',
          status: 'done', estimatePence: 18_000 },
        { description: 'Machine polish and valet', category: 'valet',
          status: 'in_progress', estimatePence: 12_000 },
      ],
    });
  });

  await step('card 2 — nine of eleven days waiting for a wing', async () => {
    if (!vehicles[1]) return;
    await card(vehicles[1], {
      stage: 'bodywork', startedHoursAgo: 264, budgetPence: 85_000,
      history: [['booked_in', 8], ['mechanical', 16], ['bodywork', 240]],
      tasks: [
        { description: 'Replace nearside front wing', category: 'bodywork',
          status: 'blocked', estimatePence: 42_000 },
      ],
      blocks: [
        { reason: 'awaiting_parts', note: 'NSF wing on back-order — supplier ETA Thursday',
          startedHoursAgo: 216 },
      ],
    });
  });

  await step('card 3 — blocked on two things at once', async () => {
    if (!vehicles[2]) return;
    await card(vehicles[2], {
      stage: 'mechanical', startedHoursAgo: 120, budgetPence: 45_000,
      history: [['booked_in', 6], ['mechanical', 114]],
      tasks: [
        { description: 'Cambelt and water pump', category: 'mechanical',
          status: 'blocked', estimatePence: 55_000,
          approvalRequired: true, approved: false },
      ],
      // Overlapping deliberately: the merged blocked time is 72h, not 96h.
      blocks: [
        { reason: 'awaiting_parts', note: 'Cambelt kit', startedHoursAgo: 96, endedHoursAgo: 24 },
        { reason: 'awaiting_approval', note: 'Over the £500 threshold',
          startedHoursAgo: 72, endedHoursAgo: 0 },
      ],
    });
  });

  await step('card 4 — held at the photography gate', async () => {
    if (!vehicles[3]) return;
    await card(vehicles[3], {
      stage: 'photography', startedHoursAgo: 96, budgetPence: 40_000,
      history: [['booked_in', 6], ['mechanical', 20], ['valet', 40], ['photography', 30]],
      tasks: [
        { description: 'Nearside front tyre worn close to the legal limit',
          category: 'tyres', status: 'done', source: 'mot_advisory',
          sourceDetail: 'Nearside front tyre worn close to the legal limit',
          estimatePence: 11_000 },
      ],
    });
  });

  await step('card 5 — over budget, work unapproved', async () => {
    if (!vehicles[4]) return;
    await card(vehicles[4], {
      stage: 'mechanical', startedHoursAgo: 72, budgetPence: 30_000,
      history: [['booked_in', 8], ['mechanical', 64]],
      tasks: [
        { description: 'Replace both front discs and pads', category: 'mechanical',
          status: 'planned', estimatePence: 38_000,
          approvalRequired: true, approved: false },
        { description: 'Diagnostics — intermittent ABS light', category: 'mechanical',
          status: 'done', estimatePence: 9_000 },
      ],
    });
  });

  console.log('\n✓ Prep board seeded.');
  console.log('  pnpm dev:crm → http://localhost:3002/prep');
}

try {
  await seed();
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
