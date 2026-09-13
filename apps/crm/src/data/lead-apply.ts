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
  authorize, changeStage, reopen, TERMINAL_STAGES, LOSS_REASON_LABELS,
  type Lead, type LeadStage, type LeadSource, type LossReason,
} from '@forecourt/domain';

export interface LeadOutcome {
  ok: boolean;
  error?: string;
  /** What actually changed, so the screen can say so rather than just refresh. */
  message?: string;
  leadId?: string;
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
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await tx`SELECT * FROM leads WHERE id = ${id}::uuid FOR UPDATE`;
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

  if (!['new', 'contacted', 'qualified', 'appointment', 'test_drive', 'negotiating', 'won', 'lost'].includes(input.stage)) return { ok: false, error: 'Choose a valid lead stage.' };
  if (input.lossDetail.length > 2000 || input.lostTo.length > 200) return { ok: false, error: 'Shorten the loss details before saving.' };
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
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(to)) return { ok: false, error: 'Choose someone from the staff list.' };
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
  if (text.length > 2000) return { ok: false, error: 'Keep the note to 2,000 characters.' };
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

/** Optimistic task version plus a row lock prevents a stale form completing a replacement task. */
export async function applyFollowUp(tx: Tx, session: Session, input: {
  leadId: string; version: string; operation: string; at: string; note: string;
}): Promise<LeadOutcome> {
  const decision = authorize({ ...session }, 'lead.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };
  if (!['schedule', 'complete', 'cancel'].includes(input.operation)) return { ok: false, error: 'Choose a follow-up action.' };
  if (!/^\d{1,9}$/.test(input.version)) return { ok: false, error: 'Refresh this lead before saving.' };
  const note = input.note.trim();
  if (!note || note.length > 2000) return { ok: false, error: 'Add a description or outcome of up to 2,000 characters.' };
  const at = new Date(input.at);
  if (input.operation === 'schedule' && (!/Z$|[+-]\d{2}:\d{2}$/.test(input.at) || !Number.isFinite(at.getTime()) || at.getTime() <= Date.now())) {
    return { ok: false, error: 'Choose a valid future date and time.' };
  }
  const lead = await readLead(tx, input.leadId);
  if (!lead) return { ok: false, error: 'That lead is unavailable.' };
  if (lead.closedAt) return { ok: false, error: 'Reopen this lead before changing its follow-up.' };
  const [current] = await tx`SELECT follow_up_at, follow_up_note, follow_up_version FROM leads WHERE id = ${input.leadId}::uuid`;
  if (Number(current?.['follow_up_version']) !== Number(input.version)) return { ok: false, error: 'Another colleague changed this follow-up. Refresh the page and review it before saving.' };
  if (input.operation !== 'schedule' && !current?.['follow_up_at']) return { ok: false, error: 'There is no scheduled follow-up to complete or cancel.' };
  const nextAt = input.operation === 'schedule' ? at : null;
  await tx`UPDATE leads SET follow_up_at = ${nextAt}, follow_up_note = ${nextAt ? note : null},
    follow_up_version = follow_up_version + 1, updated_at = now(), updated_by = ${session.userId}::uuid
    WHERE id = ${input.leadId}::uuid`;
  const detail = input.operation === 'schedule'
    ? `Follow-up scheduled for ${at.toLocaleString('en-GB', { timeZone: 'Europe/London' })} (UK time): ${note}`
    : `Follow-up ${input.operation === 'complete' ? 'completed' : 'cancelled'}: ${current?.['follow_up_note']}. Outcome: ${note}`;
  await tx`INSERT INTO lead_events (tenant_id, lead_id, kind, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${input.leadId}::uuid, 'note', ${detail}, ${session.userId}::uuid)`;
  await writeAudit({ tx, session, resourceType: 'lead', resourceId: input.leadId,
    action: `follow_up_${input.operation}`, before: { at: current?.['follow_up_at'], note: current?.['follow_up_note'] },
    after: { at: nextAt, note: nextAt ? note : null, outcome: nextAt ? null : note } });
  return { ok: true, message: input.operation === 'schedule' ? 'Follow-up scheduled.' : input.operation === 'complete' ? 'Follow-up completed and outcome recorded.' : 'Follow-up cancelled and reason recorded.' };
}

export async function applyCreateLead(tx: Tx, session: Session, input: {
  siteId: string; contactId: string; firstName: string; lastName: string;
  email: string; phone: string; source: string; message: string;
}): Promise<LeadOutcome> {
  const decision = authorize({ ...session }, 'lead.create');
  if (!decision.allowed) return { ok: false, error: decision.reason };
  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.siteId) || (input.contactId && !uuid.test(input.contactId))) return { ok: false, error: 'Choose a valid site and customer.' };
  if (!['phone', 'walk_in', 'autotrader', 'ebay', 'cargurus', 'facebook', 'other_marketplace'].includes(input.source)) return { ok: false, error: 'Choose where the enquiry came from.' };
  if (input.message.length > 4000 || input.firstName.length > 100 || input.lastName.length > 100 || input.email.length > 254 || input.phone.length > 40) return { ok: false, error: 'Shorten the customer details or enquiry before saving.' };
  if (session.scope !== 'all_sites' && !session.siteIds.includes(input.siteId)) return { ok: false, error: 'Choose a site you have access to.' };
  const [site] = await tx`SELECT id FROM sites WHERE id = ${input.siteId}::uuid`;
  if (!site) return { ok: false, error: 'That site is unavailable.' };
  let contactId = input.contactId;
  if (contactId) {
    const [contact] = await tx`SELECT id FROM contacts WHERE id = ${contactId}::uuid AND erased_at IS NULL AND merged_into_id IS NULL`;
    if (!contact) return { ok: false, error: 'That customer is unavailable. Search again.' };
  } else {
    const canCreateContact = authorize({ ...session }, 'contact.create');
    if (!canCreateContact.allowed) return { ok: false, error: 'Choose an existing customer. Your role cannot create customer records.' };
    const first = input.firstName.trim(), last = input.lastName.trim(), email = input.email.trim().toLowerCase(), phone = input.phone.trim();
    if (!first && !last && !email && !phone) return { ok: false, error: 'Enter a customer name, email or phone number.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
    if (email || phone) {
      const [duplicate] = await tx`SELECT id FROM contacts WHERE erased_at IS NULL AND merged_into_id IS NULL
        AND ((${email} <> '' AND lower(email) = ${email}) OR (${phone} <> '' AND phone = ${phone})) LIMIT 1`;
      if (duplicate) return { ok: false, error: 'A customer with these contact details already exists. Use the customer search to link their record.' };
    }
    const [contact] = await tx`INSERT INTO contacts (tenant_id, site_id, first_name, last_name, email, phone, created_by, updated_by)
      VALUES (${session.tenantId}::uuid, ${input.siteId}::uuid, ${first || null}, ${last || null}, ${email || null}, ${phone || null}, ${session.userId}::uuid, ${session.userId}::uuid) RETURNING id`;
    contactId = String(contact?.['id']);
    await writeAudit({ tx, session, resourceType: 'contact', resourceId: contactId, action: 'created', after: { firstName: first, lastName: last, email, phone }, siteId: input.siteId });
  }
  const [lead] = await tx`INSERT INTO leads (tenant_id, site_id, contact_id, source, message, assigned_to, created_by, updated_by)
    VALUES (${session.tenantId}::uuid, ${input.siteId}::uuid, ${contactId}::uuid, ${input.source}::lead_source,
      ${input.message.trim() || null}, ${session.userId}::uuid, ${session.userId}::uuid, ${session.userId}::uuid) RETURNING id`;
  const leadId = String(lead?.['id']);
  await tx`INSERT INTO lead_events (tenant_id, lead_id, kind, detail, actor_id)
    VALUES (${session.tenantId}::uuid, ${leadId}::uuid, 'created', 'Enquiry entered by staff and assigned to its creator.', ${session.userId}::uuid)`;
  await writeAudit({ tx, session, resourceType: 'lead', resourceId: leadId, action: 'created', after: { contactId, source: input.source, assignedTo: session.userId }, siteId: input.siteId });
  return { ok: true, leadId, message: 'Enquiry created.' };
}
