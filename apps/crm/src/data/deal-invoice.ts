import { approvedDiscount } from './discount-approvals';
import { authorize, holds } from '@forecourt/domain';
import type { Session } from '@/auth/session';
import { withSession, type Tx } from './db';
import { isId } from './deal-builder';
import { applyCreateDraft, type InvoiceOutcome } from './invoice-apply';
const permitted = (s: Session) =>
  [
    'deal.read',
    'invoice.read',
    'invoice.create',
    'contact.read',
    'vehicle.read',
  ].every((p) => holds(s, p));
async function source(tx: Tx, id: string) {
  const [r] =
    await tx`SELECT d.id,d.state,d.invoice_id,d.vehicle_price_pence,concat_ws(':',d.updated_at::text,c.updated_at::text,v.updated_at::text) AS revision,d.contact_id,d.vehicle_id,d.part_exchange_pence,d.part_exchange_settlement_pence,d.finance_amount_pence,d.addons_total_pence,d.deposit_pence,
   concat_ws(' ',c.first_name,c.last_name,c.company_name) AS buyer_name,concat_ws(', ',nullif(c.address_line1,''),nullif(c.address_line2,''),nullif(c.locality,''),nullif(c.postcode,'')) AS buyer_address,c.address_line1,c.postcode,
   v.registration,v.make,v.model,v.vat_scheme,v.retail_price_pence
   FROM deals d JOIN contacts c ON c.id=d.contact_id AND c.erased_at IS NULL AND c.merged_into_id IS NULL
   JOIN vehicles v ON v.id=d.vehicle_id AND v.deleted_at IS NULL WHERE d.id=${id}::uuid`;
  return r;
}
function problem(r: Awaited<ReturnType<typeof source>>) {
  if (!r)
    return 'This deal, customer or vehicle is unavailable in your branch.';
  if (r['invoice_id']) return null;
  if (!['agreed', 'contracted'].includes(String(r['state'])))
    return 'Agree the deal before preparing an invoice.';
  if (
    !String(r['buyer_name'] ?? '').trim() ||
    !String(r['address_line1'] ?? '').trim() ||
    !String(r['postcode'] ?? '').trim()
  )
    return 'Add the customer’s name, street address and postcode before preparing their invoice.';
  if (
    !['margin', 'qualifying', 'non_qualifying'].includes(
      String(r['vat_scheme']),
    )
  )
    return 'Record the vehicle’s VAT scheme before preparing an invoice.';
  if (
    r['vehicle_price_pence'] == null ||
    BigInt(r['vehicle_price_pence'] as string) <= 0n
  )
    return 'The deal needs a positive cash price.';
  if (
    [
      'part_exchange_pence',
      'part_exchange_settlement_pence',
      'finance_amount_pence',
      'addons_total_pence',
      'deposit_pence',
    ].some((k) => BigInt(r[k] as string) !== 0n)
  )
    return 'This deal includes part-exchange, finance, add-ons or a deposit. Its invoice needs the full settlement workflow, which is not available here yet.';
  return null;
}
export async function invoiceDraftReview(session: Session, id: string) {
  if (!permitted(session) || !isId(id)) return null;
  return withSession(session, async (tx) => {
    const r = await source(tx, id);
    if (!r) return null;
    const n =
      r['vehicle_price_pence'] == null
        ? 0n
        : BigInt(r['vehicle_price_pence'] as string);
    return {
      id,
      revision: String(r['revision']),
      invoiceId: r['invoice_id'] as string | null,
      customerId: String(r['contact_id']),
      vehicleId: String(r['vehicle_id']),
      buyerName: String(r['buyer_name']),
      buyerAddress: String(r['buyer_address']),
      vehicle: [r['registration'], r['make'], r['model']]
        .filter(Boolean)
        .join(' · '),
      price: `£${(n / 100n).toLocaleString('en-GB')}.${(n % 100n).toString().padStart(2, '0')}`,
      problem:
        problem(r) ??
        (r['retail_price_pence'] != null &&
        n < BigInt(r['retail_price_pence'] as string) &&
        !r['invoice_id'] &&
        !(await approvedDiscount(tx, id))
          ? 'Discount approval is needed before preparing this invoice.'
          : null),
    };
  });
}
export async function applyDealInvoice(
  tx: Tx,
  session: Session,
  id: string,
  revision: string,
): Promise<InvoiceOutcome> {
  if (!permitted(session) || !authorize(session, 'invoice.create').allowed)
    return {
      ok: false,
      error: 'You do not have permission to prepare invoices.',
    };
  if (!isId(id)) return { ok: false, error: 'Choose an available deal.' };
  await tx`SELECT id FROM deals WHERE id=${id}::uuid FOR UPDATE`;
  const r = await source(tx, id),
    error = problem(r);
  if (error || !r) return { ok: false, error: error ?? 'Deal unavailable.' };
  if (r['invoice_id'])
    return {
      ok: true,
      invoiceId: String(r['invoice_id']),
      message: 'The existing invoice is ready to review.',
    };
  if (
    r['retail_price_pence'] != null &&
    BigInt(r['vehicle_price_pence'] as string) <
      BigInt(r['retail_price_pence'] as string) &&
    !(await approvedDiscount(tx, id))
  )
    return {
      ok: false,
      error: 'Discount approval is needed before preparing this invoice.',
    };
  if (r['revision'] !== revision)
    return {
      ok: false,
      error:
        'This deal changed after you opened the preview. Refresh and review it before creating the invoice.',
    };
  const result = await applyCreateDraft(tx, session, {
    dealId: id,
    vehicleId: String(r['vehicle_id']),
    contactId: String(r['contact_id']),
    buyerName: String(r['buyer_name']),
    buyerAddress: String(r['buyer_address']),
    vatScheme: String(r['vat_scheme']),
    lines: [
      {
        description: [r['registration'], r['make'], r['model']]
          .filter(Boolean)
          .join(' '),
        unitPricePence: String(r['vehicle_price_pence']),
        unitPriceIncludesVat: true,
      },
    ],
  });
  return result;
}
