'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { inviteStaff, setStaffStatus, type StaffOutcome } from './staff';

export async function invitePerson(formData: FormData): Promise<StaffOutcome> {
  const session = await requireSession();
  const result = await inviteStaff(session, {
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    roleKey: String(formData.get('roleKey') ?? ''),
  });
  if (result.ok) revalidatePath('/settings/staff');
  return result;
}

export async function changeStaffStatus(formData: FormData): Promise<StaffOutcome> {
  const session = await requireSession();
  const next = String(formData.get('status') ?? '') as 'suspended' | 'removed' | 'active';
  const result = await setStaffStatus(session, String(formData.get('membershipId') ?? ''), next);
  if (result.ok) revalidatePath('/settings/staff');
  return result;
}
