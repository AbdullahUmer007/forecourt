'use server';

// NOTE: nothing but async functions may be exported from this file. Next
// refuses a module carrying `'use server'` that exports anything else, and
// neither lint nor tsc catches it — the failure only appears when the action
// is invoked. Types and real work live in ./lead-apply.ts.

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import { applyStageChange, applyReopen, applyAssign, applyNote, type LeadOutcome } from './lead-apply';
import { authorize } from '@forecourt/domain';

/** Resolve who is asking and whether they may. The UI hiding a control is a
 *  convenience; this is the control. */
async function guard(): Promise<
  { ok: true; session: Awaited<ReturnType<typeof requireSession>> } | { ok: false; error: string }
> {
  const session = await requireSession();
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'lead.update');

  return decision.allowed ? { ok: true, session } : { ok: false, error: decision.reason };
}

export async function changeLeadStage(
  _previous: LeadOutcome | null,
  formData: FormData,
): Promise<LeadOutcome> {
  const guarded = await guard();
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const leadId = String(formData.get('leadId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyStageChange(tx, guarded.session, {
      leadId,
      stage: String(formData.get('stage') ?? ''),
      lossReason: String(formData.get('lossReason') ?? ''),
      lossDetail: String(formData.get('lossDetail') ?? ''),
      lostTo: String(formData.get('lostTo') ?? ''),
    }));

  if (result.ok) { revalidatePath('/leads'); revalidatePath(`/leads/${leadId}`); }
  return result;
}

export async function reopenLead(
  _previous: LeadOutcome | null,
  formData: FormData,
): Promise<LeadOutcome> {
  const guarded = await guard();
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const leadId = String(formData.get('leadId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyReopen(tx, guarded.session, leadId));

  if (result.ok) { revalidatePath('/leads'); revalidatePath(`/leads/${leadId}`); }
  return result;
}

export async function assignLead(
  _previous: LeadOutcome | null,
  formData: FormData,
): Promise<LeadOutcome> {
  const guarded = await guard();
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const leadId = String(formData.get('leadId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyAssign(tx, guarded.session, leadId, String(formData.get('assignTo') ?? '')));

  if (result.ok) { revalidatePath('/leads'); revalidatePath(`/leads/${leadId}`); }
  return result;
}

export async function addLeadNote(
  _previous: LeadOutcome | null,
  formData: FormData,
): Promise<LeadOutcome> {
  const guarded = await guard();
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const leadId = String(formData.get('leadId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyNote(tx, guarded.session, leadId, String(formData.get('note') ?? '')));

  if (result.ok) revalidatePath(`/leads/${leadId}`);
  return result;
}
