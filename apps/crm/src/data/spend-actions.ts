'use server';

// Nothing but async functions may be exported from this file.

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import { applyChannelSpend, type SpendOutcome } from './spend-apply';
import { authorize } from '@forecourt/domain';

/**
 * Pounds and pence as typed, to integer pence.
 *
 * Never `parseFloat`: `parseFloat('19.99') * 100` is 1998.9999999999998, which
 * floors to £19.98. Rule 2 exists for exactly this arithmetic.
 */
async function toPenceString(input: string): Promise<string | null> {
  const cleaned = input.replace(/[£,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  return `${sign}${BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))}`;
}

export async function recordChannelSpend(
  _previous: SpendOutcome | null,
  formData: FormData,
): Promise<SpendOutcome> {
  const session = await requireSession();

  // Advertising spend is a financial figure and sits behind its own
  // permission — a sales executive does not set what Auto Trader costs.
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'report.financial.read');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const amount = await toPenceString(String(formData.get('amount') ?? ''));
  if (amount === null) {
    return { ok: false, error: 'Enter the amount in pounds and pence, for example 1250.00.' };
  }

  const result = await withSession(session, (tx) =>
    applyChannelSpend(tx, session, {
      channelLabel: String(formData.get('channelLabel') ?? ''),
      month: String(formData.get('month') ?? ''),
      amountPence: amount,
      estimated: String(formData.get('estimated') ?? '') === 'on',
      note: String(formData.get('note') ?? ''),
    }));

  if (result.ok) { revalidatePath('/reports/channels'); revalidatePath('/'); }
  return result;
}
