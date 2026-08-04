import { withSession, toPence, toInt, toDate } from './db';
import type { Session } from '@/auth/session';
import { money, type Money } from '@forecourt/domain';
import type {
  PrepStage, StageEvent, PrepBlock, PrepTaskStatus, PrepBlockReason,
} from '@forecourt/domain';

/**
 * Reading the prep board. Nothing here computes a duration — every hour on
 * screen comes from `packages/domain/src/prep.ts`, which is where the
 * blocked-versus-working maths is property-tested.
 */

export interface BoardTask {
  id: string;
  description: string;
  category: string;
  status: PrepTaskStatus;
  estimate: Money | null;
  approvalRequired: boolean;
  approvedAt: Date | null;
  source: string;
}

export interface BoardCard {
  id: string;
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  derivative: string | null;
  publishedPhotoCount: number;
  ownerName: string | null;
  budget: Money | null;
  startedAt: Date;
  completedAt: Date | null;
  currentStageId: string | null;
  events: StageEvent[];
  blocks: PrepBlock[];
  tasks: BoardTask[];
}

export interface Board {
  stages: PrepStage[];
  cards: BoardCard[];
  /** The tenant's minimum published photo count, for the photography gate. */
  minimumPhotos: number;
}

const gbp = (v: string | number | null): Money => money(toPence(v), 'GBP');

export async function loadBoard(session: Session): Promise<Board> {
  return withSession(session, async (tx) => {
    const stageRows = await tx<{
      id: string; key: string; name: string; position: number;
      sla_hours: number | null; requires_min_photos: boolean; is_final: boolean;
    }[]>`
      SELECT id, key, name, position, sla_hours, requires_min_photos, is_final
      FROM prep_stages WHERE archived_at IS NULL ORDER BY position`;

    const cardRows = await tx<{
      id: string; vehicle_id: string; registration: string;
      make: string | null; model: string | null; derivative: string | null;
      published_photo_count: number; owner_name: string | null;
      budget_pence: string | null; started_at: Date; completed_at: Date | null;
      current_stage_id: string | null;
    }[]>`
      SELECT c.id, c.vehicle_id, v.registration, v.make, v.model, v.derivative,
             v.published_photo_count, u.name AS owner_name,
             c.budget_pence, c.started_at, c.completed_at, c.current_stage_id
      FROM prep_cards c
      JOIN vehicles v ON v.id = c.vehicle_id
      LEFT JOIN users u ON u.id = c.owner_id
      WHERE c.completed_at IS NULL
      ORDER BY c.started_at`;

    if (cardRows.length === 0) {
      return { stages: toStages(stageRows), cards: [], minimumPhotos: MIN_PHOTOS_DEFAULT };
    }

    const ids = cardRows.map((c) => c.id);

    const [eventRows, blockRows, taskRows] = await Promise.all([
      tx<{ id: string; card_id: string; stage_id: string;
           entered_at: Date; exited_at: Date | null }[]>`
        SELECT id, card_id, stage_id, entered_at, exited_at
        FROM prep_stage_events WHERE card_id = ANY(${ids}::uuid[]) ORDER BY entered_at`,
      tx<{ id: string; card_id: string; reason: string; note: string | null;
           started_at: Date; ended_at: Date | null }[]>`
        SELECT id, card_id, reason, note, started_at, ended_at
        FROM prep_blocks WHERE card_id = ANY(${ids}::uuid[]) ORDER BY started_at`,
      tx<{ id: string; card_id: string; description: string; category: string;
           status: string; estimate_pence: string | null; approval_required: boolean;
           approved_at: Date | null; source: string }[]>`
        SELECT id, card_id, description, category, status, estimate_pence,
               approval_required, approved_at, source
        FROM prep_tasks WHERE card_id = ANY(${ids}::uuid[]) ORDER BY created_at`,
    ]);

    const by = <T extends { card_id: string }>(rows: readonly T[]): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.card_id) ?? [];
        list.push(row);
        map.set(row.card_id, list);
      }
      return map;
    };

    const events = by(eventRows);
    const blocks = by(blockRows);
    const tasks = by(taskRows);

    return {
      stages: toStages(stageRows),
      minimumPhotos: MIN_PHOTOS_DEFAULT,
      cards: cardRows.map((c) => ({
        id: c.id,
        vehicleId: c.vehicle_id,
        registration: c.registration,
        make: c.make,
        model: c.model,
        derivative: c.derivative,
        publishedPhotoCount: toInt(c.published_photo_count) ?? 0,
        ownerName: c.owner_name,
        budget: c.budget_pence === null ? null : gbp(c.budget_pence),
        startedAt: c.started_at,
        completedAt: toDate(c.completed_at),
        currentStageId: c.current_stage_id,
        events: (events.get(c.id) ?? []).map((e) => ({
          id: e.id, stageId: e.stage_id, enteredAt: e.entered_at, exitedAt: toDate(e.exited_at),
        })),
        blocks: (blocks.get(c.id) ?? []).map((b) => ({
          id: b.id, reason: b.reason as PrepBlockReason, note: b.note,
          startedAt: b.started_at, endedAt: toDate(b.ended_at),
        })),
        tasks: (tasks.get(c.id) ?? []).map((t) => ({
          id: t.id, description: t.description, category: t.category,
          status: t.status as PrepTaskStatus,
          estimate: t.estimate_pence === null ? null : gbp(t.estimate_pence),
          approvalRequired: t.approval_required,
          approvedAt: toDate(t.approved_at),
          source: t.source,
        })),
      })),
    };
  });
}

/**
 * The minimum published photographs before a car may leave Photography.
 *
 * A constant for now, and flagged as such: it belongs in tenant settings
 * beside the approval threshold, and M5's `RECOMMENDED_PHOTO_COUNT` is the
 * number a dealer should be aiming at rather than the floor. Hard-coding a
 * FLOOR is defensible; hard-coding it forever is not.
 */
const MIN_PHOTOS_DEFAULT = 8;

const toStages = (rows: readonly {
  id: string; key: string; name: string; position: number;
  sla_hours: number | null; requires_min_photos: boolean; is_final: boolean;
}[]): PrepStage[] =>
  rows.map((s) => ({
    id: s.id, key: s.key, name: s.name, position: s.position,
    slaHours: toInt(s.sla_hours), requiresMinPhotos: s.requires_min_photos,
    isFinal: s.is_final,
  }));
