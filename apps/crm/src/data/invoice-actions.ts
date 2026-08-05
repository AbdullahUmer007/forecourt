'use server';

// Nothing but async functions may be exported from this file.

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import {
  applyCreateDraft, applyIssue, applyCreditNote, applyPayment,
  type InvoiceOutcome,
} from './invoice-apply';
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

/**
 * Pounds and pence as typed, to integer pence.
 *
 * Parsed here rather than in the browser, and never through `parseFloat`:
 * `parseFloat('19.99') * 100` is 1998.9999999999998, which floors to £19.98.
 * A penny per invoice is a real reconciliation problem and it is entirely
 * avoidable — rule 2 exists for this exact arithmetic.
 */
async function toPenceString(input: string): Promise<string | null> {
  const cleaned = input.replace(/[£,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const pence = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return `${sign}${pence}`;
}

export async function createDraftInvoice(
  _previous: InvoiceOutcome | null,
  formData: FormData,
): Promise<InvoiceOutcome> {
  const guarded = await guard('invoice.create');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const price = await toPenceString(String(formData.get('vehiclePrice') ?? ''));
  if (price === null) {
    return { ok: false, error: 'Enter the price in pounds and pence, for example 12995.00.' };
  }

  const lines = [{
    description: String(formData.get('description') ?? 'Motor vehicle'),
    unitPricePence: price,
  }];

  const extraDescription = String(formData.get('extraDescription') ?? '').trim();
  if (extraDescription) {
    const extra = await toPenceString(String(formData.get('extraPrice') ?? ''));
    if (extra === null) {
      return { ok: false, error: 'Enter the second line’s price in pounds and pence.' };
    }
    lines.push({ description: extraDescription, unitPricePence: extra });
  }

  const result = await withSession(guarded.session, (tx) =>
    applyCreateDraft(tx, guarded.session, {
      dealId: String(formData.get('dealId') ?? ''),
      vehicleId: String(formData.get('vehicleId') ?? ''),
      contactId: String(formData.get('contactId') ?? ''),
      buyerName: String(formData.get('buyerName') ?? ''),
      buyerAddress: String(formData.get('buyerAddress') ?? ''),
      vatScheme: String(formData.get('vatScheme') ?? 'margin'),
      lines,
    }));

  if (result.ok) { revalidatePath('/invoices'); revalidatePath('/deals'); }
  return result;
}

export async function issueInvoiceAction(
  _previous: InvoiceOutcome | null,
  formData: FormData,
): Promise<InvoiceOutcome> {
  // `invoice.create`, not an invented `invoice.issue`. The catalogue in
  // permissions.ts is read, delete, void, refund — raising and issuing are one
  // act of creating a document, and adding a permission key silently changes
  // what nine role definitions grant.
  const guarded = await guard('invoice.create');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const invoiceId = String(formData.get('invoiceId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyIssue(tx, guarded.session, invoiceId));

  if (result.ok) {
    revalidatePath('/invoices');
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath('/vat/stock-book');
  }
  return result;
}

export async function creditInvoiceAction(
  _previous: InvoiceOutcome | null,
  formData: FormData,
): Promise<InvoiceOutcome> {
  // Cancelling an issued invoice is a void, and it is separately grantable.
  const guarded = await guard('invoice.void');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const invoiceId = String(formData.get('invoiceId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyCreditNote(tx, guarded.session, invoiceId, String(formData.get('reason') ?? '')));

  if (result.ok) {
    revalidatePath('/invoices');
    revalidatePath(`/invoices/${invoiceId}`);
  }
  return result;
}

export async function recordPaymentAction(
  _previous: InvoiceOutcome | null,
  formData: FormData,
): Promise<InvoiceOutcome> {
  // A refund is a different permission from taking money, and deliberately so.
  const direction = String(formData.get('direction') ?? 'in');
  const guarded = await guard(direction === 'out' ? 'payment.refund' : 'payment.create');
  if (!guarded.ok) return { ok: false, error: guarded.error };

  const amount = await toPenceString(String(formData.get('amount') ?? ''));
  if (amount === null) {
    return { ok: false, error: 'Enter the amount in pounds and pence, for example 250.00.' };
  }

  const invoiceId = String(formData.get('invoiceId') ?? '');
  const result = await withSession(guarded.session, (tx) =>
    applyPayment(tx, guarded.session, {
      invoiceId,
      amountPence: amount,
      method: String(formData.get('method') ?? ''),
      direction,
      reason: String(formData.get('reason') ?? ''),
      reference: String(formData.get('reference') ?? ''),
      overrideReason: String(formData.get('overrideReason') ?? ''),
      overrideAuthorisedBy: String(formData.get('overrideAuthorisedBy') ?? ''),
    }));

  if (result.ok) { revalidatePath('/invoices'); revalidatePath(`/invoices/${invoiceId}`); }
  return result;
}
