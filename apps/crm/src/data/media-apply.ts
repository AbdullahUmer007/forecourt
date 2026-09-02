import { randomUUID } from 'node:crypto';
import { authorize, mediaUrlPath } from '@forecourt/domain';
import { storeVehiclePhoto } from '@/media/store';
import { withSession } from './db';
import type { Session } from '@/auth/session';

export interface VehiclePhoto {
  id: string;
  url: string;
  shot: string;
  published: boolean;
  isHero: boolean;
  isDisclosure: boolean;
  shownToBuyer: boolean;
}

export async function listVehiclePhotos(session: Session, vehicleId: string): Promise<VehiclePhoto[]> {
  return withSession(session, async (tx) => {
    const rows = await tx`
      SELECT id, storage_key, shot::text AS shot, published, is_hero,
             is_disclosure_evidence, shown_to_buyer_at
        FROM vehicle_media
       WHERE vehicle_id = ${vehicleId}::uuid AND deleted_at IS NULL AND kind = 'photo'
       ORDER BY is_hero DESC, position, created_at`;
    return rows.map((r) => ({
      id: String(r['id']),
      url: mediaUrlPath(String(r['storage_key'])),
      shot: String(r['shot']),
      published: Boolean(r['published']),
      isHero: Boolean(r['is_hero']),
      isDisclosure: Boolean(r['is_disclosure_evidence']),
      shownToBuyer: r['shown_to_buyer_at'] !== null,
    }));
  });
}

export type MediaOutcome = { ok: true } | { ok: false; error: string };

export async function addVehiclePhoto(
  session: Session,
  vehicleId: string,
  file: File,
  shot: string,
): Promise<MediaOutcome> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const mediaId = randomUUID();
  const stored = await storeVehiclePhoto(session.tenantId, vehicleId, mediaId, file);
  if (!stored.ok) return stored;

  try {
    await withSession(session, async (tx) => {
      const [vehicle] = await tx<{ site_id: string | null }[]>`
        SELECT site_id FROM vehicles WHERE id = ${vehicleId}::uuid AND deleted_at IS NULL`;
      if (!vehicle) throw new Error('That car is not in your stock.');

      const counted = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM vehicle_media
         WHERE vehicle_id = ${vehicleId}::uuid AND deleted_at IS NULL`;
      const n = counted[0]?.n ?? 0;

      await tx`
        INSERT INTO vehicle_media (
          id, tenant_id, site_id, vehicle_id, kind, shot, status,
          storage_key, content_hash, variants, mime_type, bytes, width, height,
          position, is_hero, published, exif_stripped, created_by, updated_by
        ) VALUES (
          ${mediaId}::uuid, ${session.tenantId}::uuid, ${vehicle.site_id}::uuid,
          ${vehicleId}::uuid, 'photo', ${shot}::shot_kind, 'ready',
          ${stored.key}, ${stored.key.split('/')[5] ?? null},
          ${tx.json([{ width: stored.width, format: 'jpeg', url: mediaUrlPath(stored.key) }])},
          'image/jpeg', ${stored.bytes}, ${stored.width}, ${stored.height},
          ${n}, ${n === 0}, true, true,
          ${session.userId}::uuid, ${session.userId}::uuid
        )`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The photograph could not be saved.' };
  }
  return { ok: true };
}

export async function updateVehiclePhoto(
  session: Session,
  mediaId: string,
  patch: { published?: boolean; hero?: boolean; withdraw?: boolean },
): Promise<MediaOutcome> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  try {
    await withSession(session, async (tx) => {
      const [row] = await tx<{
        vehicle_id: string; is_disclosure_evidence: boolean; shown_to_buyer_at: Date | null;
      }[]>`
        SELECT vehicle_id, is_disclosure_evidence, shown_to_buyer_at
          FROM vehicle_media WHERE id = ${mediaId}::uuid AND deleted_at IS NULL`;
      if (!row) throw new Error('That photograph is not on this car.');

      if (patch.withdraw) {
        if (row.is_disclosure_evidence && row.shown_to_buyer_at) {
          throw new Error(
            'That photograph was shown to a buyer. It is evidence and cannot be withdrawn.',
          );
        }
        await tx`
          UPDATE vehicle_media
             SET deleted_at = now(), published = false, is_hero = false, updated_at = now()
           WHERE id = ${mediaId}::uuid`;
        return;
      }

      if (patch.hero) {
        await tx`
          UPDATE vehicle_media SET is_hero = false, updated_at = now()
           WHERE vehicle_id = ${row.vehicle_id}::uuid AND deleted_at IS NULL`;
        await tx`
          UPDATE vehicle_media
             SET is_hero = true, published = true, updated_at = now()
           WHERE id = ${mediaId}::uuid`;
        return;
      }

      if (patch.published !== undefined) {
        await tx`
          UPDATE vehicle_media
             SET published = ${patch.published},
                 is_hero = CASE WHEN ${patch.published} THEN is_hero ELSE false END,
                 updated_at = now()
           WHERE id = ${mediaId}::uuid`;
      }
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The photograph could not be updated.' };
  }
  return { ok: true };
}
