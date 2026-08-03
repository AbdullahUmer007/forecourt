import type { Tx } from './db';
import type { Session } from '@/auth/session';

/**
 * An audit event per mutation, with a before/after diff.
 *
 * The definition of done says "audit event on every mutation", and the only
 * way that holds is if writing one is easier than not writing one — so this
 * takes the transaction the mutation is already in. Same transaction matters:
 * an audit row committed separately can survive a rolled-back change, which
 * produces a trail describing something that never happened.
 */

export interface AuditInput {
  tx: Tx;
  session: Session;
  resourceType: string;
  resourceId: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  siteId?: string | null;
}

/**
 * Only the fields that actually changed, with both sides.
 *
 * A diff that repeats every column makes the one changed value impossible to
 * find, which is the same as not having recorded it.
 */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | null {
  if (!before && !after) return null;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    // JSON comparison so Dates and nested objects compare by value. bigint is
    // stringified because JSON.stringify refuses it outright — the same trap
    // the appraisal payload test ran into.
    const encode = (v: unknown) =>
      JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
    if (encode(from) !== encode(to)) diff[key] = { from: from ?? null, to: to ?? null };
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const diff = changedFields(input.before, input.after);

  await input.tx`
    INSERT INTO audit_events (tenant_id, site_id, actor_type, actor_id,
                              resource_type, resource_id, action, diff, occurred_at)
    VALUES (${input.session.tenantId}::uuid,
            ${input.siteId ?? null},
            'user',
            ${input.session.userId}::uuid,
            ${input.resourceType},
            ${input.resourceId},
            ${input.action},
            ${diff ? input.tx.json(diff as never) : null},
            now())`;
}
