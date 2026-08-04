import type { Tx } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import {
  moveBlockers, type PrepStage, type PrepBlock, type PrepTaskStatus,
} from '@forecourt/domain';

/**
 * Moving a card, without Next.
 *
 * Deliberately separated from the server action. `moveCard` needs a cookie to
 * know who is asking, which makes it unreachable from a test without a request
 * — and the part worth testing is not the cookie, it is that the stage history
 * stays coherent: exactly one open event per card, the old one closed at the
 * same instant the new one opens, and an audit row in the same transaction.
 *
 * That history IS the days metric. A card that ends up in two stages, or in
 * none, silently corrupts every number the board reports.
 */

export interface MoveOutcome {
  ok: boolean;
  error?: string;
  needsReason?: readonly { code: string; message: string }[];
}

export interface MoveRequest {
  cardId: string;
  toStageId: string;
  override?: string;
  /** Injected so a test can move a card at a stated moment. */
  now?: Date;
  minimumPhotos?: number;
}

export async function applyMove(
  tx: Tx,
  session: Session,
  request: MoveRequest,
): Promise<MoveOutcome> {
  const now = request.now ?? new Date();
  const override = (request.override ?? '').trim();

  const [card] = await tx<{
    id: string; site_id: string | null; current_stage_id: string | null;
    published_photo_count: number;
  }[]>`
    SELECT c.id, c.site_id, c.current_stage_id, v.published_photo_count
    FROM prep_cards c
    JOIN vehicles v ON v.id = c.vehicle_id
    WHERE c.id = ${request.cardId}::uuid AND c.completed_at IS NULL`;

  if (!card) {
    return { ok: false, error: 'That card is not on the board, or it is not yours.' };
  }

  const stageRows = await tx<{
    id: string; key: string; name: string; position: number;
    sla_hours: number | null; requires_min_photos: boolean; is_final: boolean;
  }[]>`
    SELECT id, key, name, position, sla_hours, requires_min_photos, is_final
    FROM prep_stages WHERE archived_at IS NULL`;

  const stages = new Map<string, PrepStage>(stageRows.map((s) => [s.id, {
    id: s.id, key: s.key, name: s.name, position: s.position,
    slaHours: s.sla_hours, requiresMinPhotos: s.requires_min_photos, isFinal: s.is_final,
  }]));

  const to = stages.get(request.toStageId);
  const from = card.current_stage_id ? stages.get(card.current_stage_id) : undefined;
  if (!to) return { ok: false, error: 'That stage is not on this board.' };
  if (to.id === from?.id) return { ok: false, error: 'The card is already in that stage.' };

  const tasks = await tx<{
    status: string; description: string;
    approval_required: boolean; approved_at: Date | null;
  }[]>`
    SELECT status, description, approval_required, approved_at
    FROM prep_tasks WHERE card_id = ${request.cardId}::uuid AND status <> 'declined'`;

  const openBlocks = await tx<{
    id: string; reason: string; note: string | null;
    started_at: Date; ended_at: Date | null;
  }[]>`
    SELECT id, reason, note, started_at, ended_at
    FROM prep_blocks WHERE card_id = ${request.cardId}::uuid AND ended_at IS NULL`;

  // The SAME function the board renders, so what the person was shown and
  // what the server enforces cannot drift.
  const blockers = moveBlockers({
    from: from ?? { ...to, requiresMinPhotos: false },
    to,
    publishedPhotoCount: card.published_photo_count ?? 0,
    minimumPhotos: request.minimumPhotos ?? 8,
    openTasks: tasks.map((t) => ({
      status: t.status as PrepTaskStatus,
      description: t.description,
      approvalRequired: t.approval_required,
      approvedAt: t.approved_at,
    })),
    openBlocks: openBlocks.map((b): PrepBlock => ({
      id: b.id, reason: b.reason as PrepBlock['reason'], note: b.note,
      startedAt: b.started_at, endedAt: b.ended_at,
    })),
  });

  const hard = blockers.filter((b) => !b.overridable);
  if (hard.length > 0) return { ok: false, error: hard.map((b) => b.message).join(' ') };

  const soft = blockers.filter((b) => b.overridable);
  if (soft.length > 0 && !override) {
    return {
      ok: false,
      needsReason: soft.map((b) => ({ code: b.code, message: b.message })),
      error: 'This needs a reason before it can move.',
    };
  }

  // Close the open event and open the next one. The partial unique index on
  // prep_stage_events refuses a second open event per card, so a bug here
  // fails loudly rather than producing a card in two stages at once.
  await tx`
    UPDATE prep_stage_events SET exited_at = ${now}
    WHERE card_id = ${request.cardId}::uuid AND exited_at IS NULL`;

  await tx`
    INSERT INTO prep_stage_events (tenant_id, card_id, stage_id, entered_at, moved_by, note)
    VALUES (${session.tenantId}::uuid, ${request.cardId}::uuid, ${request.toStageId}::uuid,
            ${now}, ${session.userId}::uuid, ${override || null})`;

  await tx`
    UPDATE prep_cards
    SET current_stage_id = ${request.toStageId}::uuid,
        completed_at = ${to.isFinal ? now : null},
        updated_at = now(), updated_by = ${session.userId}::uuid
    WHERE id = ${request.cardId}::uuid`;

  await writeAudit({
    tx, session,
    resourceType: 'prep_card',
    resourceId: request.cardId,
    action: 'move_stage',
    siteId: card.site_id,
    before: { stage: from?.key ?? null },
    after: {
      stage: to.key,
      ...(override ? { overrideReason: override } : {}),
      ...(to.isFinal ? { completed: true } : {}),
    },
  });

  return { ok: true };
}
