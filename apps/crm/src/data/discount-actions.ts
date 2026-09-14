'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { withSession } from './db';
import { applyDiscount } from './discount-approvals';
export async function submitDiscount(form: FormData) {
  const s = await requireSession(),
    id = String(form.get('id') ?? '');
  const r = await withSession(s, (tx) =>
    applyDiscount(tx, s, {
      id,
      binding: String(form.get('binding') ?? ''),
      action: String(form.get('action') ?? ''),
      reason: String(form.get('reason') ?? ''),
      sequence: String(form.get('sequence') ?? ''),
    }),
  );
  if (r.ok) {
    for (const suffix of ['', '/discount', '/quotes', '/invoice'])
      revalidatePath(`/deals/${id}${suffix}`);
  }
  return r;
}
