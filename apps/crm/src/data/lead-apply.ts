/**
 * The lead mutations, as functions that take a transaction.
 *
 * Kept out of the `'use server'` file for the reason recorded in
 * `prep-move.ts`: a module carrying that directive may export nothing but
 * async functions, and a function that needs a cookie cannot be tested against
 * a real database. Everything here takes `tx` and is therefore testable.
 *
 * Three things happen inside one transaction on every change: the row moves,
 * a `lead_events` row is appended, and an audit event is written. Same
 * transaction on purpose — a history row committed separately can survive a
 * rolled-back change and describe something that never happened.
 */

import type { Tx } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import { toDate } from './db';
import {
  changeStage, reopen, TERMINAL_STAGES, LOSS_REASON_LABELS,
  type Lead, type LeadStage, type LeadSource, type LossReason,
} from '@forecourt/domain';

export interface LeadOutcome {
  ok: boolean;
  error?: string;
  /** What actually changed, so the screen can say so rather than just refresh. */
  message?: string;
}

export interface StageInput {
  leadId: string;
  stage: string;
  lossReason: string;
  lossDetail: string;
  lostTo: string;
}

const isLossReason = (v: string): v is LossReason =>
  Object.prototype.hasOwnProperty.call(LOSS_REASON_LABELS, v);

async function readLead(tx: Tx, id: string): Promise<Lead | null> {
  const [row] = await tx`SELECT * FROM leads WHERE id = ${id}::uuid`;
  if (!row) return null;
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    contactId: String(row['contact_id']),
    vehicleId: row['vehicle_id'] === null ? null : String(row['vehicle_id']),
    source: row['source'] as LeadSource,
    sourceReference: row['source_reference'] === null ? null : String(row['source_reference']),
    stage: row['stage'] as LeadStage,
    assignedTo: row['assigned_to'] === null ? null : String(row['assigned_to']),
    receivedAt: toDate(row['received_at'] as Date) as Date,
    firstResponseAt: toDate(row['first_response_at'] as Date | null),
    dueAt: toDate(row['due_at'] as Date | null),
    closedAt: toDate(row['closed_at'] as Date | null),
    lossReason: (row['loss_reason'] as LossReason | null) ?? null,
    lossDetail: row['loss_detail'] === null ? null : String(row['loss_detail']),
    lostTo: row['lost_to'] === null ? null : String(row['lost_to']),
  };
}

/**
 * Move a lead to another stage.
 *
 * The refusal that matters is `lost` with no reason. It is enforced three
 * times over — by `changeStage` in the domain, by this function, and by a
 * CHECK constraint on the table — because the reason is never filled in later
 * and the only moment anybody knows the answer is this one.
 */
export async function applyStageChange(
  tx: Tx,
  session: Session,
  input: StageInput,
): Promise<LeadOutcome> {
  const before = await readLead(tx, input.leadId);
  if (!before) return { ok: false, error: 'That lead no longer exists. It may have been merged.' };

  const stage = input.stage as LeadStage;
  const reasonText = input.lossReason.trim();

  if (stage === 'lost' && !isLossReason(reasonText)) {
    return {
      ok: false,
      error: 'Choose why this lead was lost. It is the only way to see what is costing you sales.',
    };
  }

  const result = changeStage(before, {
    stage,
    at: new Date(),
    ...(stage === 'lost' && isLossReason(reasonText) ? { lossReason: reasonText } : {}),
    ...(input.lossDetail.trim() ? { lossDetail: input.lossDetail.trim() } : {}),
    ...(input.lostTo.trim() ? { lostTo: input.lostTo.trim() } : {}),
  });

  if (!result.ok) return { ok: false, error: result.error ?? 'That change is not allowed.' };
  if (result.lead.stage === before.stage) return { ok: true, message: 'No change.' };

  const after = result.lead;

  await tx`
    UPDATE leads SET
      stage = ${after.stage}::lead_stage,
      closed_at = ${after.closedAt},
      loss_reason = ${after.lossReason},
      loss_detail = ${after.lossDetail},
      lost_to = ${after.lostTo},
      updated_at = now(), updated_by = ${session.userId}::uuid
    WHERE id = ${input.leadId}::uuid`;

  await tx`
    INSERT INTO lead_events (tenant_id, lead_id, kind, from_stage, to_stage, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${input.leadId}::uuid, 'stage_changed',
            ${before.stage}::lead_stage, ${after.stage}::lead_stage,
            ${after.lossReason ? LOSS_REASON_LABELS[after.lossReason] : null},
            ${session.userId}::uuid)`;

  await writeAudit({
    tx, session, resourceType: 'lead', resourceId: input.leadId, action: 'stage_changed',
    before: { stage: before.stage, closedAt: before.closedAt, lossReason: before.lossReason },
    after: { stage: after.stage, closedAt: after.closedAt, lossReason: after.lossReason },
  });

  return {
    ok: true,
    message: TERMINAL_STAGES.includes(after.stage)
      ? `Closed as ${after.stage}.`
      : `Moved to ${after.stage.replace(/_/g, ' ')}.`,
  };
}

/** Reopening a closed lead is explicit, and is its own event in the history. */
export async function applyReopen(
  tx: Tx,
  session: Session,
  leadId: string,
): Promise<LeadOutcome> {
  const before = await readLead(tx, leadId);
  if (!before) return { ok: false, error: 'That lead no longer exists.' };

  const result = reopen(before);
  if (!result.ok) return { ok: false, error: result.error ?? 'That lead is already open.' };

  await tx`
    UPDATE leads SET stage = ${result.lead.stage}::lead_stage,
      closed_at = NULL, loss_reason = NULL, loss_detail = NULL, lost_to = NULL,
      updated_at = now(), updated_by = ${session.userId}::uuid
    WHERE id = ${leadId}::uuid`;

  await tx`
    INSERT INTO lead_events (tenant_id, lead_id, kind, from_stage, to_stage, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${leadId}::uuid, 'reopened',
            ${before.stage}::lead_stage, ${result.lead.stage}::lead_stage,
            ${before.lossReason ? `was lost: ${LOSS_REASON_LABELS[before.lossReason]}` : null},
            ${session.userId}::uuid)`;

  await writeAudit({
    tx, session, resourceType: 'lead', resourceId: leadId, action: 'reopened',
    before: { stage: before.stage, lossReason: before.lossReason },
    after: { stage: result.lead.stage, lossReason: null },
  });

  return { ok: true, message: 'Reopened.' };
}

export async function applyAssign(
  tx: Tx,
  session: Session,
  leadId: string,
  assignTo: string,
): Promise<LeadOutcome> {
  const before = await readLead(tx, leadId);
  if (!before) return { ok: false, error: 'That lead no longer exists.' };

  const to = assignTo.trim() === '' ? null : assignTo.trim();
  if (to === before.assignedTo) return { ok: true, message: 'No change.' };

  if (to !== null) {
    // Not a foreign-key check — the FK already stops a nonexistent user. This
    // stops a user from ANOTHER tenant, which the FK cannot see. RLS on
    // tenant_memberships is what makes the read safe.
    const [member] = await tx`
      SELECT 1 FROM tenant_memberships WHERE user_id = ${to}::uuid AND status = 'active'`;
    if (!member) {
      return { ok: false, error: 'That person is not on this dealership’s staff list.' };
    }
  }

  await tx`
    UPDATE leads SET assigned_to = ${to}, updated_at = now(),
      updated_by = ${session.userId}::uuid
    WHERE id = ${leadId}::uuid`;

  await tx`
    INSERT INTO lead_events (tenant_id, lead_id, kind, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${leadId}::uuid, 'assigned',
            ${to === null ? 'unassigned' : `assigned to ${to}`}, ${session.userId}::uuid)`;

  await writeAudit({
    tx, session, resourceType: 'lead', resourceId: leadId, action: 'assigned',
    before: { assignedTo: before.assignedTo }, after: { assignedTo: to },
  });

  return { ok: true, message: to === null ? 'Unassigned.' : 'Assigned.' };
}

export async function applyNote(
  tx: Tx,
  session: Session,
  leadId: string,
  note: string,
): Promise<LeadOutcome> {
  const text = note.trim();
  if (text.length === 0) return { ok: false, error: 'Write something before saving the note.' };

  const before = await readLead(tx, leadId);
  if (!before) return { ok: false, error: 'That lead no longer exists.' };

  await tx`
    INSERT INTO lead_events (tenant_id, lead_id, kind, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${leadId}::uuid, 'note', ${text}, ${session.userId}::uuid)`;

  await writeAudit({
    tx, session, resourceType: 'lead', resourceId: leadId, action: 'note_added',
    after: { note: text },
  });

  return { ok: true, message: 'Note saved.' };
}
