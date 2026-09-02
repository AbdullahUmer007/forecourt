'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import {
  createAppraisalDraft, recordAppraisalOffer, decideAppraisalOffer,
  confirmAppraisalDerivative, convertAppraisalToStock, withdrawAppraisalDraft,
  type AppraisalWrite,
} from './appraisal-apply';

export async function createAppraisal(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const result = await createAppraisalDraft(session, {
    registration: String(formData.get('registration') ?? ''),
    mileage: String(formData.get('mileage') ?? ''),
    sellerType: String(formData.get('sellerType') ?? 'private_individual'),
    name: String(formData.get('name') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
  });
  if (result.ok && result.id) {
    revalidatePath('/appraisals');
    redirect(`/appraisals/${result.id}`);
  }
  return result;
}

export async function saveAppraisalOffer(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const id = String(formData.get('appraisalId') ?? '');
  const result = await recordAppraisalOffer(session, id, {
    allowance: String(formData.get('allowance') ?? ''),
    market: String(formData.get('market') ?? ''),
    days: String(formData.get('days') ?? '7'),
  });
  if (result.ok) revalidatePath(`/appraisals/${id}`);
  return result;
}

export async function decideOffer(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const id = String(formData.get('appraisalId') ?? '');
  const kind = String(formData.get('decision') ?? '') === 'declined' ? 'declined' : 'accepted';
  const result = await decideAppraisalOffer(session, id, kind, String(formData.get('reason') ?? ''));
  if (result.ok) revalidatePath(`/appraisals/${id}`);
  return result;
}

export async function saveAppraisalIdentity(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const id = String(formData.get('appraisalId') ?? '');
  const result = await confirmAppraisalDerivative(session, id, {
    make: String(formData.get('make') ?? ''),
    model: String(formData.get('model') ?? ''),
    derivative: String(formData.get('derivative') ?? ''),
    vatInvoice: String(formData.get('vatInvoice') ?? ''),
  });
  if (result.ok) revalidatePath(`/appraisals/${id}`);
  return result;
}

export async function takeIntoStock(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const id = String(formData.get('appraisalId') ?? '');
  const result = await convertAppraisalToStock(session, id);
  if (result.ok && result.vehicleId) {
    revalidatePath('/appraisals');
    revalidatePath('/stock');
    redirect(`/stock/${result.vehicleId}?booked=1`);
  }
  return result;
}

export async function withdrawAppraisal(formData: FormData): Promise<AppraisalWrite> {
  const session = await requireSession();
  const id = String(formData.get('appraisalId') ?? '');
  const result = await withdrawAppraisalDraft(
    session, id,
    String(formData.get('confirm') ?? ''),
    String(formData.get('reason') ?? ''),
  );
  if (result.ok) {
    revalidatePath('/appraisals');
    revalidatePath(`/appraisals/${id}`);
  }
  return result;
}
