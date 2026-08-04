'use server';

// NOTE: nothing but async functions may be exported from this file — it
// carries `'use server'`, and Next refuses a module that exports anything
// else ("can only export async functions, found number"). Neither lint nor
// tsc catches it; the failure only appears when the action is invoked. The
// types and the real work live in ./prep-apply.ts for that reason, and
// because a function that needs a cookie cannot be tested without a request.

import { revalidatePath } from 'next/cache';
import { withSession } from './db';
import { requireSession } from '@/auth/session';
import { applyMove, type MoveOutcome } from './prep-apply';
import { authorize } from '@forecourt/domain';

/**
 * Move a card to another stage.
 *
 * This wrapper does exactly three things — resolve who is asking, check they
 * may, and commit. Everything else is `applyMove`, which takes a transaction
 * and is therefore testable against a real database.
 */
export async function moveCard(
  _previous: MoveOutcome | null,
  formData: FormData,
): Promise<MoveOutcome> {
  const session = await requireSession();

  // Server-side. The board hides the control from a role that cannot move a
  // card; this is the control.
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.update');

  if (!decision.allowed) return { ok: false, error: decision.reason };

  const result = await withSession(session, (tx) => applyMove(tx, session, {
    cardId: String(formData.get('cardId') ?? ''),
    toStageId: String(formData.get('toStageId') ?? ''),
    override: String(formData.get('override') ?? ''),
  }));

  if (result.ok) revalidatePath('/prep');
  return result;
}
