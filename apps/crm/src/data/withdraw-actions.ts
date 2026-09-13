'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { authorize, allowedTransitions, type VehicleState } from '@forecourt/domain';
import { withSession } from './db';
import { applyVehicleTransition } from './vehicle-apply';

export async function withdrawVehicle(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  if (String(formData.get('confirm') ?? '') !== 'ARCHIVE') {
    return { ok: false, error: 'Type ARCHIVE to confirm. This is deliberate, not a button next to Edit.' };
  }

  const vehicleId = String(formData.get('vehicleId') ?? '');

  const result = await withSession(session, async (tx) => {
    const [row] = await tx<{ state: string }[]>`
      SELECT state::text AS state FROM vehicles
       WHERE id = ${vehicleId}::uuid AND deleted_at IS NULL`;
    if (!row) return { ok: false as const, error: 'That car is not in your stock.' };
    if (row.state === 'sold' || row.state === 'delivered') {
      return {
        ok: false as const,
        error: 'A sold car is not archived from here. It stays in the books.',
      };
    }

    const path = pathToArchived(row.state as VehicleState);
    if (!path) {
      return {
        ok: false as const,
        error: `A car in “${row.state.replace(/_/g, ' ')}” cannot be archived from here.`,
      };
    }

    for (const next of path) {
      const step = await applyVehicleTransition(tx, session, vehicleId, next, '');
      if (!step.ok) return { ok: false as const, error: step.error };
    }

    await tx`
      UPDATE vehicles SET deleted_at = now(), updated_at = now()
       WHERE id = ${vehicleId}::uuid AND state = 'archived'`;
    await tx`
      INSERT INTO audit_events (
        tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
      ) VALUES (
        ${session.tenantId}::uuid, 'user', ${session.userId}::uuid,
        'vehicle', ${vehicleId}::uuid, 'update',
        ${tx.json({ after: { withdrawn: true } })}
      )`;
    return { ok: true as const };
  });

  if (result.ok) {
    revalidatePath('/stock');
    revalidatePath(`/stock/${vehicleId}`);
    redirect('/stock?archived=1');
  }
  return result;
}

const BLOCKED = new Set<VehicleState>(['sold', 'delivered', 'returned']);

function pathToArchived(from: VehicleState): VehicleState[] | null {
  if (from === 'archived') return [];
  const seen = new Set<VehicleState>([from]);
  const queue: { at: VehicleState; path: VehicleState[] }[] = [{ at: from, path: [] }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of allowedTransitions(cur.at)) {
      if (seen.has(next) || BLOCKED.has(next)) continue;
      const path = [...cur.path, next];
      if (next === 'archived') return path;
      seen.add(next);
      queue.push({ at: next, path });
    }
  }
  return null;
}
