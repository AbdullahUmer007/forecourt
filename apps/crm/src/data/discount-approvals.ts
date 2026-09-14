import { createHash } from 'node:crypto';
import { authorize, holds, money, subtract, max, zero } from '@forecourt/domain';
import type { Session } from '@/auth/session';
import { withSession, type Tx } from './db';
import { isId } from './deal-builder';
import { appendToLedger } from './deal-apply';
import { writeAudit } from './audit';
export type DiscountResult = { ok: true } | { ok: false; error: string };
export async function discountContext(tx: Tx, id: string) {
  const [r] =
    await tx`SELECT d.id,d.created_by,d.updated_at::text AS revision,d.state,d.invoice_id,d.currency,d.vehicle_price_pence,d.vehicle_id,d.contact_id,v.retail_price_pence,d.site_id,v.registration FROM deals d JOIN vehicles v ON v.id=d.vehicle_id AND v.deleted_at IS NULL WHERE d.id=${id}::uuid`;
  if (!r) return null;
  const price = BigInt((r['vehicle_price_pence'] as string) ?? '0'),
    retail =
      r['retail_price_pence'] == null
        ? null
        : BigInt(r['retail_price_pence'] as string);
  const binding = createHash('sha256')
    .update(
      JSON.stringify([
        r['revision'],
        r['vehicle_id'],
        r['contact_id'],
        String(price),
        String(retail),
        r['currency'],
      ]),
    )
    .digest('hex');
  const rows =
    await tx`SELECT sequence,actor_id,occurred_at,payload FROM deal_evidence WHERE deal_id=${id}::uuid AND kind='note' AND payload->>'event' IN ('discount_requested','discount_decided') ORDER BY sequence DESC`;
  const request = rows.find(
    (e) =>
      (e['payload'] as Record<string, unknown>)['event'] ===
      'discount_requested',
  );
  const payload = request?.['payload'] as Record<string, unknown> | undefined;
  const decision = request
    ? rows.find(
        (e) =>
          (e['payload'] as Record<string, unknown>)['event'] ===
            'discount_decided' &&
          (e['payload'] as Record<string, unknown>)['requestSequence'] ===
            Number(request['sequence']),
      )
    : undefined;
  const decisionPayload = decision?.['payload'] as
    Record<string, unknown> | undefined;
  const status = !request
    ? 'not_requested'
    : payload?.['binding'] !== binding
      ? 'outdated'
      : decisionPayload?.['decision'] === 'approved'
        ? 'approved'
        : decision
          ? 'declined'
          : 'pending';
  return {
    binding,
    price: price.toString(),
    retail: retail?.toString() ?? null,
    discount:
      retail === null ? '0' : max(subtract(money(retail, 'GBP'), money(price, 'GBP')), zero('GBP')).amount.toString(),
    registration: String(r['registration']),
    ownerId: r['created_by'] as string,
    siteId: String(r['site_id']),
    eligible:
      ['building', 'quoted', 'agreed'].includes(String(r['state'])) &&
      !r['invoice_id'] &&
      r['currency'] === 'GBP' &&
      price > 0n &&
      retail !== null &&
      retail > price,
    status,
    requestSequence: request ? Number(request['sequence']) : null,
    requesterId: request?.['actor_id'] as string | undefined,
    reason: String(payload?.['reason'] ?? ''),
    decisionReason: String(decisionPayload?.['reason'] ?? ''),
    history: rows.map((e) => ({
      sequence: Number(e['sequence']),
      at: new Date(e['occurred_at'] as Date).toISOString(),
      event: String((e['payload'] as Record<string, unknown>)['event']),
      reason: String((e['payload'] as Record<string, unknown>)['reason']),
      decision: String(
        (e['payload'] as Record<string, unknown>)['decision'] ?? 'requested',
      ),
    })),
  };
}
export async function approvedDiscount(tx: Tx, id: string) {
  const c = await discountContext(tx, id);
  return c?.status === 'approved' && BigInt(c.discount) > 0n;
}
async function approvalLimit(
  tx: Tx,
  s: Session,
  c: NonNullable<Awaited<ReturnType<typeof discountContext>>>,
) {
  const [r] =
    await tx`SELECT r.key,r.permissions,r.discount_limit_pence FROM tenant_memberships m JOIN roles r ON r.id=m.role_id WHERE m.id=${s.membershipId}::uuid AND m.user_id=${s.userId}::uuid AND m.status='active' AND m.deleted_at IS NULL`;
  if (
    !r ||
    !authorize(
      { ...s, permissions: r['permissions'] as string[] },
      'deal.discount.approve',
      { ownerId: c.ownerId, siteId: c.siteId },
    ).allowed
  )
    return false;
  return (
    r['key'] === 'owner' ||
    (r['discount_limit_pence'] != null &&
      BigInt(c.discount) <= BigInt(r['discount_limit_pence'] as number))
  );
}
export async function discountPage(s: Session, id: string) {
  if (!isId(id) || !holds(s, 'deal.read') || !holds(s, 'vehicle.read'))
    return null;
  return withSession(s, async (tx) => {
    const c = await discountContext(tx, id);
    if (!c) return null;
    return {
      ...c,
      canRequest: authorize(s, 'deal.update', {
        ownerId: c.ownerId,
        siteId: c.siteId,
      }).allowed,
      canDecide:
        holds(s, 'deal.discount.approve') &&
        c.requesterId !== s.userId &&
        (await approvalLimit(tx, s, c)),
    };
  });
}
export async function applyDiscount(
  tx: Tx,
  s: Session,
  input: {
    id: string;
    binding: string;
    action: string;
    reason: string;
    sequence: string;
  },
): Promise<DiscountResult> {
  if (!isId(input.id) || !holds(s, 'deal.read') || !holds(s, 'vehicle.read'))
    return { ok: false, error: 'This deal is unavailable.' };
  if (!['request', 'approved', 'declined'].includes(input.action))
    return { ok: false, error: 'Choose a valid discount action.' };
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000)
    return {
      ok: false,
      error: 'Give a reason between 5 and 1,000 characters.',
    };
  await tx`SELECT id FROM deals WHERE id=${input.id}::uuid FOR UPDATE`;
  const c = await discountContext(tx, input.id);
  if (!c || !c.eligible)
    return {
      ok: false,
      error:
        'Set a discounted price on an uninvoiced, pre-contract cash deal first.',
    };
  if (c.binding !== input.binding)
    return {
      ok: false,
      error:
        'The deal or advertised price changed. Refresh and review it again.',
    };
  let payload: Record<string, unknown>;
  if (input.action === 'request') {
    if (
      !authorize(s, 'deal.update', { ownerId: c.ownerId, siteId: c.siteId })
        .allowed
    )
      return {
        ok: false,
        error: 'You cannot request a discount on this deal.',
      };
    if (['pending', 'approved'].includes(c.status)) return { ok: true };
    payload = {
      event: 'discount_requested',
      binding: c.binding,
      reason,
      pricePence: c.price,
      retailPence: c.retail,
      discountPence: c.discount,
    };
  } else {
    if (!holds(s, 'deal.discount.approve') || !(await approvalLimit(tx, s, c)))
      return {
        ok: false,
        error:
          'This discount is outside your approval permission or saved role limit.',
      };
    if (c.requesterId === s.userId)
      return {
        ok: false,
        error: 'Another permitted person must review your request.',
      };
    if (
      c.requestSequence === null ||
      String(c.requestSequence) !== input.sequence ||
      c.status === 'outdated'
    )
      return {
        ok: false,
        error: 'This request has changed. Refresh before deciding.',
      };
    if (c.status === input.action) return { ok: true };
    if (c.status !== 'pending')
      return { ok: false, error: 'This request already has a decision.' };
    payload = {
      event: 'discount_decided',
      requestSequence: c.requestSequence,
      binding: c.binding,
      decision: input.action,
      reason,
    };
  }
  await appendToLedger(tx, s, input.id, {
    kind: 'note',
    payload,
    documentVersion: null,
    wordingVersion: null,
    occurredAt: new Date(),
  });
  await writeAudit({
    tx,
    session: s,
    resourceType: 'deal',
    resourceId: input.id,
    action: String(payload['event']),
    after: payload,
    siteId: c.siteId,
  });
  return { ok: true };
}
