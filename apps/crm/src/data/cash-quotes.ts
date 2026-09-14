import { approvedDiscount } from './discount-approvals';
import { createHash } from 'node:crypto';
import { holds, authorize } from '@forecourt/domain';
import type { Session } from '@/auth/session';
import { withSession, type Tx } from './db';
import { isId } from './deal-builder';
import { appendToLedger } from './deal-apply';
import { writeAudit } from './audit';
export interface CashQuote {
  customer: string;
  address: string;
  vehicle: string;
  dealer: string;
  branch: string;
  pricePence: string;
  currency: 'GBP';
}
const canRead = (s: Session) =>
  ['deal.read', 'contact.read', 'vehicle.read'].every((p) => holds(s, p));
async function current(tx: Tx, id: string) {
  const [r] =
    await tx`SELECT d.*, concat_ws(' ',c.first_name,c.last_name,c.company_name) AS customer,
    concat_ws(', ',nullif(c.address_line1,''),nullif(c.address_line2,''),nullif(c.locality,''),nullif(c.postcode,'')) AS address,
    concat_ws(' · ',v.registration,v.make,v.model,v.derivative) AS vehicle,v.retail_price_pence,t.name AS dealer,s.name AS branch,
    concat_ws(':',d.updated_at::text,c.updated_at::text,v.updated_at::text,t.updated_at::text,s.updated_at::text) AS revision
    FROM deals d JOIN contacts c ON c.id=d.contact_id AND c.erased_at IS NULL AND c.merged_into_id IS NULL
    JOIN vehicles v ON v.id=d.vehicle_id AND v.deleted_at IS NULL
    JOIN sites s ON s.id=d.site_id JOIN tenants t ON t.id=d.tenant_id WHERE d.id=${id}::uuid`;
  if (!r) return null;
  const quote: CashQuote = {
    customer: String(r['customer']),
    address: String(r['address']),
    vehicle: String(r['vehicle']),
    dealer: String(r['dealer']),
    branch: String(r['branch']),
    pricePence: String(r['vehicle_price_pence'] ?? '0'),
    currency: 'GBP',
  };
  let problem: string | null = null;
  if (
    !['building', 'quoted', 'agreed'].includes(String(r['state'])) ||
    r['invoice_id']
  )
    problem = 'Quotes can only be prepared before contract or invoicing.';
  else if (r['currency'] !== 'GBP' || BigInt(quote.pricePence) <= 0n)
    problem = 'Set a positive GBP cash price on the deal first.';
  else if (!quote.customer.trim())
    problem = 'Add the customer’s name before saving a quotation.';
  else if (
    [
      'part_exchange_pence',
      'part_exchange_settlement_pence',
      'finance_amount_pence',
      'addons_total_pence',
      'deposit_pence',
    ].some((k) => BigInt(r[k] as string) !== 0n)
  )
    problem =
      'This quotation supports cash-only deals. Finance, part-exchange, deposits and add-ons need the full settlement workflow.';
  else if (
    r['retail_price_pence'] == null ||
    (BigInt(quote.pricePence) < BigInt(r['retail_price_pence'] as string) &&
      !(await approvedDiscount(tx, id)))
  )
    problem =
      'Discount approval is needed for this price. Open Discount approval on the deal to request a review.';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(quote))
    .digest('hex');
  return {
    quote,
    revision: String(r['revision']) + ':' + fingerprint,
    fingerprint,
    problem,
    siteId: String(r['site_id']),
    ownerId: r['created_by'] as string,
  };
}
export async function cashQuotePage(s: Session, id: string) {
  if (!canRead(s) || !isId(id)) return null;
  return withSession(s, async (tx) => {
    const source = await current(tx, id);
    if (!source) return null;
    const rows =
      await tx`SELECT sequence,occurred_at,payload FROM deal_evidence WHERE deal_id=${id}::uuid AND kind='note' AND payload->>'event'='cash_quote_saved' ORDER BY sequence DESC`;
    return {
      ...source,
      canSave: authorize(s, 'deal.update', { ownerId: source.ownerId }).allowed,
      versions: rows.map((r, index) => ({
        version: rows.length - index,
        sequence: Number(r['sequence']),
        at: new Date(r['occurred_at'] as Date).toISOString(),
        quote: (r['payload'] as { quote: CashQuote }).quote,
      })),
    };
  });
}
export async function saveCashQuote(
  tx: Tx,
  s: Session,
  id: string,
  revision: string,
): Promise<{ ok: true; sequence: number } | { ok: false; error: string }> {
  if (!canRead(s) || !holds(s, 'deal.update') || !isId(id))
    return {
      ok: false,
      error: 'You do not have access to prepare this quotation.',
    };
  await tx`SELECT id FROM deals WHERE id=${id}::uuid FOR UPDATE`;
  const source = await current(tx, id);
  if (
    !source ||
    !authorize(s, 'deal.update', { ownerId: source.ownerId }).allowed
  )
    return { ok: false, error: 'This deal is unavailable.' };
  if (source.problem) return { ok: false, error: source.problem };
  if (source.revision !== revision)
    return {
      ok: false,
      error: 'The deal details changed. Refresh and review them before saving.',
    };
  const [latest] =
    await tx`SELECT sequence,payload FROM deal_evidence WHERE deal_id=${id}::uuid AND payload->>'event'='cash_quote_saved' ORDER BY sequence DESC LIMIT 1`;
  if (
    (latest?.['payload'] as { fingerprint?: string } | undefined)
      ?.fingerprint === source.fingerprint
  )
    return { ok: true, sequence: Number(latest!['sequence']) };
  const entry = await appendToLedger(tx, s, id, {
    kind: 'note',
    payload: {
      event: 'cash_quote_saved',
      quote: source.quote,
      fingerprint: source.fingerprint,
    },
    documentVersion: 'cash-quote-v1',
    wordingVersion: null,
    occurredAt: new Date(),
  });
  await writeAudit({
    tx,
    session: s,
    resourceType: 'deal',
    resourceId: id,
    action: 'cash_quote_saved',
    after: { sequence: entry.sequence, pricePence: source.quote.pricePence },
    siteId: source.siteId,
  });
  return { ok: true, sequence: entry.sequence };
}
