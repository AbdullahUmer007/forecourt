'use server';

// Nothing but async functions may be exported from this file — Next refuses a
// `'use server'` module that exports anything else, and neither lint nor tsc
// catches it. Types and real work live in ./deal-apply.ts.

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import {
  applyTransition, applyAddonDecision, applyRepair, type DealOutcome,
} from './deal-apply';
import { authorize } from '@forecourt/domain';

async function guard(permission: string): Promise<
  { ok: true; session: Awaited<ReturnType<typeof requireSession>> } | { ok: false; error: string }
> {
  const session = await requireSession();
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, permission);

  return decision.allowed ? { ok: true, session } : { ok: false, error: decision.reason };
}

export async function moveDeal(
  _previous: DealOutcome | null,
  formData: FormData,
): Promise<DealOutcome> {
  const guarded = await guard('deal.update');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const dealId = String(formData.get('dealId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyTransition(tx, guarded.session, {
      dealId,
      to: String(formData.get('to') ?? ''),
      contractFormation: String(formData.get('contractFormation') ?? ''),
      cancellationReason: String(formData.get('cancellationReason') ?? ''),
    }));

  if (result.ok) { revalidatePath('/deals'); revalidatePath(`/deals/${dealId}`); }
  return result;
}

export async function decideAddon(
  _previous: DealOutcome | null,
  formData: FormData,
): Promise<DealOutcome> {
  const guarded = await guard('deal.update');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const dealId = String(formData.get('dealId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyAddonDecision(tx, guarded.session, {
      dealId,
      addonId: String(formData.get('addonId') ?? ''),
      accept: String(formData.get('decision') ?? '') === 'accept',
      demandsAndNeeds: String(formData.get('demandsAndNeeds') ?? ''),
      fairValueReference: String(formData.get('fairValueReference') ?? ''),
    }));

  if (result.ok) revalidatePath(`/deals/${dealId}`);
  return result;
}

export async function recordRepair(
  _previous: DealOutcome | null,
  formData: FormData,
): Promise<DealOutcome> {
  const guarded = await guard('deal.update');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const dealId = String(formData.get('dealId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyRepair(tx, guarded.session, {
      dealId,
      repairId: String(formData.get('repairId') ?? ''),
      faultReported: String(formData.get('faultReported') ?? ''),
      outcome: String(formData.get('outcome') ?? ''),
    }));

  if (result.ok) { revalidatePath('/deals'); revalidatePath(`/deals/${dealId}`); }
  return result;
}
