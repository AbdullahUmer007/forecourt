'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { withSession } from './db';
import { saveCashQuote } from './cash-quotes';
export async function createCashQuote(form: FormData) {
  const s = await requireSession(),
    id = String(form.get('dealId') ?? '');
  const result = await withSession(s, (tx) =>
    saveCashQuote(tx, s, id, String(form.get('revision') ?? '')),
  );
  if (result.ok) {
    revalidatePath(`/deals/${id}`);
    revalidatePath(`/deals/${id}/quotes`);
  }
  return result;
}
