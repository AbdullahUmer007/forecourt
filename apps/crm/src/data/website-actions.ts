'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { saveWebsiteSettings, type WebsiteOutcome } from './website';

export async function updateWebsite(formData: FormData): Promise<WebsiteOutcome> {
  const session = await requireSession();
  const result = await saveWebsiteSettings(session, formData);
  if (result.ok) {
    revalidatePath('/settings/website');
    revalidatePath('/settings/website/preview');
  }
  return result;
}
