import { sql, type Tx } from '@/data/db';
import type { Session } from '@/auth/session';

/**
 * Fixtures for the CRM integration suites.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE SUITES BUILD THEIR OWN WORLD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * They used to read the Kennington demo tenant, which exists only after
 * `pnpm db:seed` and `pnpm db:seed:crm`. That passes on a developer's machine
 * and fails in CI, which applies migrations and nothing else — and it failed
 * exactly that way on the first push after they were written.
 *
 * Worse than the failure was its shape: the prep suite's cases guarded with
 * `if (!cardId) return`, so on an unseeded database they reported PASS while
 * asserting nothing. A test that quietly evaporates is the same problem as the
 * isolation suite's skipped-but-green run, and the fix is the same — own your
 * fixtures, and fail loudly when you cannot build them.
 *
 * The id space is `eeeeeeee-…`, distinct from the demo tenant (`11111111-…`),
 * the CRM seed (`22222222-…` upward) and the isolation suite (`ffffffff-…`).
 * Those must never overlap: the isolation suite's own incident was caused by
 * sharing an id with a seed.
 */

export const T = {
  tenant: 'eeeeeeee-0000-4000-8000-000000000001',
  site: 'eeeeeeee-0000-4000-8000-000000000002',
  role: 'eeeeeeee-0000-4000-8000-000000000003',
  user: 'eeeeeeee-0000-4000-8000-000000000004',
  membership: 'eeeeeeee-0000-4000-8000-000000000005',
  contact: 'eeeeeeee-0000-4000-8000-000000000006',
  appraisal: 'eeeeeeee-0000-4000-8000-000000000007',
  /** In Valet with nothing blocking it. */
  cardClean: 'eeeeeeee-0000-4000-8000-000000000010',
  /** In Photography with too few published photographs. */
  cardPhotos: 'eeeeeeee-0000-4000-8000-000000000011',
  /** In Bodywork with an open "waiting for parts" block. */
  cardBlocked: 'eeeeeeee-0000-4000-8000-000000000012',
  /** In Mechanical with work over the approval threshold, unapproved. */
  cardUnapproved: 'eeeeeeee-0000-4000-8000-000000000013',
} as const;

/**
 * A vehicle per card, listed explicitly rather than derived from the card id.
 * Deriving one produced `…00000001v`, which is not hex and therefore not a
 * UUID — caught immediately, because the fixture builder fails loudly.
 */
const VEHICLE: Record<string, string> = {
  [T.cardClean]: 'eeeeeeee-0000-4000-8000-000000000020',
  [T.cardPhotos]: 'eeeeeeee-0000-4000-8000-000000000021',
  [T.cardBlocked]: 'eeeeeeee-0000-4000-8000-000000000022',
  [T.cardUnapproved]: 'eeeeeeee-0000-4000-8000-000000000023',
};

export const session: Session = {
  sessionId: 'eeeeeeee-0000-4000-8000-0000000000f1',
  userId: T.user,
  membershipId: T.membership,
  tenantId: T.tenant,
  roleKey: 'owner',
  permissions: ['*'],
  scope: 'all_sites',
  siteIds: [],
  displayName: 'Integration Owner',
  email: 'integration@example.test',
  tenantName: 'Integration Motors',
  mfaSatisfiedAt: null,
  stepUpSatisfiedAt: null,
  stepUpValid: false,
};

/** Stage ids, filled by `ensureFixtures`. */
export const stages: Record<string, string> = {};

const STAGE_SPEC: readonly (readonly [
  key: string, name: string, position: number,
  sla: number | null, photos: boolean, final: boolean,
])[] = [
  ['mechanical', 'Mechanical', 3, 48, false, false],
  ['bodywork', 'Bodywork / SMART', 4, 72, false, false],
  ['mot', 'MOT', 5, 24, false, false],
  ['valet', 'Valet', 7, 24, false, false],
  ['photography', 'Photography', 8, 24, true, false],
  ['quality_check', 'Quality check', 9, 24, false, false],
  ['ready', 'Ready', 10, null, false, true],
];

/**
 * An arbitrary constant. Any caller using the same number serialises against
 * the others.
 */
const FIXTURE_LOCK = 8_140_014;

/**
 * Build everything these suites need — idempotently, and safely under
 * concurrency.
 *
 * The advisory lock is not decoration. Vitest runs test FILES in parallel, so
 * two suites call this at the same instant against the same database. On an
 * already-built database every statement is a no-op and nothing collides; on a
 * PRISTINE one they race and one loses on a unique index. That reproduces only
 * on a fresh database — which is to say, only in CI, which is the one place
 * nobody is watching. The lock is transaction-scoped, so it releases on commit
 * or rollback with no cleanup path that can be missed.
 */
export async function ensureFixtures(): Promise<void> {
  await sql.begin(async (tx: Tx) => {
    await tx`SELECT pg_advisory_xact_lock(${FIXTURE_LOCK})`;
    await build(tx);
  });
}

async function build(tx: Tx): Promise<void> {
  await tx`
    INSERT INTO tenants (id, name, legal_name)
    VALUES (${T.tenant}::uuid, 'Integration Motors', 'Integration Motors Ltd')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO sites (id, tenant_id, name)
    VALUES (${T.site}::uuid, ${T.tenant}::uuid, 'Integration site')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites)
    VALUES (${T.role}::uuid, ${T.tenant}::uuid, 'owner', 'Owner', true,
            ${tx.json(['*'])}, true)
    ON CONFLICT DO NOTHING`;

  // Unqualified ON CONFLICT throughout: `users` has a unique index on
  // lower(email) as well as its primary key, and naming only (id) leaves the
  // other one to raise under concurrency.
  await tx`
    INSERT INTO users (id, email, name)
    VALUES (${T.user}::uuid, 'integration@example.test', 'Integration Owner')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO tenant_memberships (id, tenant_id, user_id, role_id, scope_all_sites, status)
    VALUES (${T.membership}::uuid, ${T.tenant}::uuid, ${T.user}::uuid, ${T.role}::uuid,
            true, 'active')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO contacts (id, tenant_id, kind, first_name, last_name)
    VALUES (${T.contact}::uuid, ${T.tenant}::uuid, 'individual', 'Integration', 'Customer')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO appraisals (id, tenant_id, site_id, contact_id, state, seller_type,
                            registration, make, model, derivative, derivative_confirmed, mileage)
    VALUES (${T.appraisal}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${T.contact}::uuid,
            'appraised', 'private_individual', 'IT01EGR', 'Integration', 'Model',
            '1.0 Test', true, 40000)
    ON CONFLICT DO NOTHING`;

  for (const [key, name, position, sla, photos, final] of STAGE_SPEC) {
    await tx`
      INSERT INTO prep_stages (tenant_id, key, name, position, sla_hours,
                               requires_min_photos, is_final)
      VALUES (${T.tenant}::uuid, ${key}, ${name}, ${position}, ${sla}, ${photos}, ${final})
      ON CONFLICT DO NOTHING`;
  }

  const stageRows = await tx<{ key: string; id: string }[]>`
    SELECT key, id FROM prep_stages WHERE tenant_id = ${T.tenant}::uuid`;
  for (const row of stageRows) stages[row.key] = row.id;

  await card(tx, T.cardClean, 'IT02CLN', 'valet', 12);
  // Two published photographs against a minimum of eight — the gate.
  await card(tx, T.cardPhotos, 'IT03PHO', 'photography', 2);
  await card(tx, T.cardBlocked, 'IT04BLK', 'bodywork', 12);
  await card(tx, T.cardUnapproved, 'IT05UNA', 'mechanical', 12);

  await tx`
    INSERT INTO prep_blocks (tenant_id, card_id, reason, note, started_at)
    SELECT ${T.tenant}::uuid, ${T.cardBlocked}::uuid, 'awaiting_parts',
           'NSF wing on back-order', now() - interval '48 hours'
    WHERE NOT EXISTS (
      SELECT 1 FROM prep_blocks WHERE card_id = ${T.cardBlocked}::uuid)`;

  await tx`
    INSERT INTO prep_tasks (tenant_id, card_id, description, category, status,
                            estimate_pence, approval_required, approved_at)
    SELECT ${T.tenant}::uuid, ${T.cardUnapproved}::uuid, 'Cambelt and water pump',
           'mechanical', 'planned', 55000, true, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM prep_tasks WHERE card_id = ${T.cardUnapproved}::uuid)`;
}

/** One vehicle, one open prep card in a named stage, one open stage event. */
async function card(
  tx: Tx,
  cardId: string,
  registration: string,
  stageKey: string,
  publishedPhotos: number,
): Promise<void> {
  const vehicleId = VEHICLE[cardId];
  const stageId = stages[stageKey];
  if (!vehicleId) throw new Error(`No vehicle id registered for card ${cardId}.`);
  if (!stageId) {
    throw new Error(
      `No prep stage "${stageKey}" — the stage fixtures did not build, so the card cannot.`,
    );
  }

  await tx`
    INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                          registration, make, model, published_photo_count, state)
    VALUES (${vehicleId}::uuid, ${T.tenant}::uuid, ${T.site}::uuid,
            ${registration}, ${Number.parseInt(registration.slice(2, 4), 10)},
            ${registration}, 'Integration', 'Model', ${publishedPhotos}, 'in_prep')
    ON CONFLICT (id) DO UPDATE SET published_photo_count = EXCLUDED.published_photo_count`;

  await tx`
    INSERT INTO prep_cards (id, tenant_id, site_id, vehicle_id, current_stage_id,
                            budget_pence, started_at)
    VALUES (${cardId}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${vehicleId}::uuid,
            ${stageId}::uuid, 60000, now() - interval '72 hours')
    ON CONFLICT DO NOTHING`;

  await tx`
    INSERT INTO prep_stage_events (tenant_id, card_id, stage_id, entered_at)
    SELECT ${T.tenant}::uuid, ${cardId}::uuid, ${stageId}::uuid, now() - interval '24 hours'
    WHERE NOT EXISTS (
      SELECT 1 FROM prep_stage_events WHERE card_id = ${cardId}::uuid)`;
}
