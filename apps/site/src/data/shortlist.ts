import { createHash, randomBytes } from 'node:crypto';
import { withTenant, type Tx } from './db.js';
import { toResultVehicle } from './search.js';
import {
  MAX_SHORTLIST_ITEMS,
  SHORTLIST_TOKEN_BYTES,
} from '../../../../packages/domain/src/shortlist.js';
import type { ResultVehicle } from '../render/results.js';
export const validVisitorToken = (token: string | null): token is string =>
  !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
export const mintVisitorToken = () =>
  randomBytes(SHORTLIST_TOKEN_BYTES).toString('base64url');
export const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest('base64url');
const uuid = (value: string) =>
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export interface SavedCar {
  vehicleId: string;
  vehicle: ResultVehicle | null;
  savedAt: string;
}
export async function withVisitor<T>(
  tenantId: string,
  token: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!validVisitorToken(token)) throw new Error('Invalid visitor token');
  return withTenant(tenantId, async (tx) => {
    await tx`SELECT set_config('app.shortlist_token', ${tokenDigest(token)}, true)`;
    return fn(tx);
  });
}
export async function loadSavedCars(
  tenantId: string,
  token: string | null,
): Promise<SavedCar[]> {
  if (!validVisitorToken(token)) return [];
  return withVisitor(tenantId, token, async (tx) => {
    // Unpublished rows are deliberately absent from the join; only the saved opaque ID remains.
    const rows =
      await tx`SELECT i.vehicle_id, i.saved_at, v.id, v.make, v.model, v.derivative, v.registration, v.mileage,
   v.retail_price_pence, v.fuel_type, v.transmission, v.state, v.live_at, v.price_changed_at, v.model_year, v.first_registered_on,
   (SELECT variants FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.published AND m.deleted_at IS NULL AND NOT m.is_disclosure_evidence ORDER BY m.is_hero DESC,m.position LIMIT 1) AS hero_variants,
   (SELECT alt_text FROM vehicle_media m WHERE m.vehicle_id=v.id AND m.published AND m.deleted_at IS NULL AND NOT m.is_disclosure_evidence ORDER BY m.is_hero DESC,m.position LIMIT 1) AS hero_alt
   FROM shortlist_items i JOIN shortlists s ON s.id=i.shortlist_id
   LEFT JOIN vehicles v ON v.id=i.vehicle_id AND v.state IN ('live','reserved') AND v.deleted_at IS NULL
   WHERE i.removed_at IS NULL ORDER BY i.saved_at DESC,i.id LIMIT ${MAX_SHORTLIST_ITEMS}`;
    return rows.map((r) => ({
      vehicleId: String(r['vehicle_id']),
      savedAt: new Date(String(r['saved_at'])).toISOString(),
      vehicle: r['id'] ? toResultVehicle(r) : null,
    }));
  });
}
export async function changeSavedCar(
  tenantId: string,
  token: string,
  vehicleId: string,
  action: string,
): Promise<{ ok: boolean; message: string }> {
  if (
    !uuid(vehicleId) ||
    !['save', 'remove'].includes(action) ||
    !validVisitorToken(token)
  )
    return {
      ok: false,
      message: 'Choose a car from this dealer’s stock and try again.',
    };
  return withVisitor(tenantId, token, async (tx) => {
    if (action === 'save') {
      const [v] =
        await tx`SELECT id FROM vehicles WHERE id=${vehicleId}::uuid AND state IN ('live','reserved') AND deleted_at IS NULL`;
      if (!v)
        return {
          ok: false,
          message:
            'This car is no longer available to save. Browse the current stock instead.',
        };
      await tx`INSERT INTO shortlists (tenant_id,token) VALUES (${tenantId}::uuid,${tokenDigest(token)}) ON CONFLICT (tenant_id,token) WHERE token IS NOT NULL DO NOTHING`;
    }
    const [list] = await tx`SELECT id FROM shortlists FOR UPDATE`;
    if (!list)
      return { ok: true, message: 'Car removed from your saved cars.' };
    const id = String(list['id']);
    const [before] =
      await tx`SELECT id,removed_at FROM shortlist_items WHERE shortlist_id=${id}::uuid AND vehicle_id=${vehicleId}::uuid`;
    const present = !!before && !before['removed_at'];
    if ((action === 'save' && present) || (action === 'remove' && !present))
      return {
        ok: true,
        message:
          action === 'save'
            ? 'This car is already in your saved cars.'
            : 'Car removed from your saved cars.',
      };
    if (action === 'save') {
      const [count] =
        await tx`SELECT count(*)::int AS n FROM shortlist_items WHERE shortlist_id=${id}::uuid AND removed_at IS NULL`;
      if (Number(count?.['n']) >= MAX_SHORTLIST_ITEMS)
        return {
          ok: false,
          message: `Your list is full at ${MAX_SHORTLIST_ITEMS} cars. Remove one to save another.`,
        };
      await tx`INSERT INTO shortlist_items (tenant_id,shortlist_id,vehicle_id) VALUES (${tenantId}::uuid,${id}::uuid,${vehicleId}::uuid)
    ON CONFLICT (tenant_id,shortlist_id,vehicle_id) DO UPDATE SET removed_at=NULL,saved_at=now()`;
    } else
      await tx`UPDATE shortlist_items SET removed_at=now() WHERE shortlist_id=${id}::uuid AND vehicle_id=${vehicleId}::uuid`;
    await tx`UPDATE shortlists SET updated_at=now(),last_seen_at=now() WHERE id=${id}::uuid`;
    await tx`INSERT INTO audit_events (tenant_id,actor_type,resource_type,resource_id,action,diff)
   VALUES (${tenantId}::uuid,'public','shortlist',${id}::uuid,${action},${tx.json({ vehicleId, before: { saved: present }, after: { saved: action === 'save' } })})`;
    return {
      ok: true,
      message:
        action === 'save'
          ? 'Car saved. Your shortlist is ready below.'
          : 'Car removed from your saved cars.',
    };
  });
}
