'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { addVehiclePhoto, updateVehiclePhoto, type MediaOutcome } from './media-apply';

export async function uploadVehiclePhoto(formData: FormData): Promise<MediaOutcome> {
  const session = await requireSession();
  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a photograph to upload.' };
  }
  const vehicleId = String(formData.get('vehicleId') ?? '');
  const shot = String(formData.get('shot') ?? 'other');
  const result = await addVehiclePhoto(session, vehicleId, file, shot);
  if (result.ok) {
    revalidatePath('/stock');
    revalidatePath(`/stock/${vehicleId}`);
    revalidatePath(`/stock/${vehicleId}/edit`);
  }
  return result;
}

export async function manageVehiclePhoto(formData: FormData): Promise<MediaOutcome> {
  const session = await requireSession();
  const mediaId = String(formData.get('mediaId') ?? '');
  const vehicleId = String(formData.get('vehicleId') ?? '');
  const action = String(formData.get('action') ?? '');
  const patch: { published?: boolean; hero?: boolean; withdraw?: boolean } = {};
  if (action === 'publish') patch.published = true;
  if (action === 'unpublish') patch.published = false;
  if (action === 'hero') patch.hero = true;
  if (action === 'withdraw') patch.withdraw = true;
  if (!['publish', 'unpublish', 'hero', 'withdraw'].includes(action)) return { ok: false, error: 'Choose a photograph action.' };
  const result = await updateVehiclePhoto(session, mediaId, patch);
  if (result.ok) { revalidatePath('/stock'); revalidatePath(`/stock/${vehicleId}`); }
  return result;
}
