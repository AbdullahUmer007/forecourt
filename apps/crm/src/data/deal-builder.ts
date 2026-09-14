import { authorize, holds } from '@forecourt/domain';
import type { Session } from '@/auth/session';
import { withSession, type Tx } from './db';
import { writeAudit } from './audit';
import { appendToLedger } from './deal-apply';
export const isId = (s: string) =>
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
export function cashPence(value: string): bigint | null {
  const s = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(s)) return null;
  const [pounds, pennies = ''] = s.split('.');
  const n = BigInt(pounds!) * 100n + BigInt(pennies.padEnd(2, '0'));
  return n > 0n ? n : null;
}
export interface DraftDealInput {
  contactId: string;
  vehicleId: string;
  leadId: string;
  price: string;
}
export type DraftDealOutcome =
  { ok: true; id: string } | { ok: false; error: string };
export const canBuildDeal = (s: Session) =>
  ['deal.create', 'deal.read', 'contact.read', 'vehicle.read'].every((p) =>
    holds(s, p),
  );
export async function dealBuilderOptions(
  session: Session,
  search: string,
  selectedVehicle = '',
  selectedContact = '',
  leadId = '',
) {
  if (!canBuildDeal(session)) return null;
  return withSession(session, async (tx) => {
    let lead: { id: string; contactId: string; vehicleId: string } | null =
      null;
    if (leadId) {
      if (!isId(leadId) || !holds(session, 'lead.read')) return null;
      const [r] =
        await tx`SELECT id,contact_id,vehicle_id FROM leads WHERE id=${leadId}::uuid AND stage NOT IN ('won','lost')`;
      if (!r) return null;
      lead = {
        id: String(r['id']),
        contactId: String(r['contact_id']),
        vehicleId: String(r['vehicle_id'] ?? ''),
      };
      selectedContact = lead.contactId;
      selectedVehicle = lead.vehicleId;
    }
    const q = search.trim().toLowerCase().slice(0, 100);
    const contacts =
      await tx`SELECT id,concat_ws(' ',first_name,last_name,company_name) AS name,email FROM contacts WHERE erased_at IS NULL AND merged_into_id IS NULL
      AND (strpos(lower(concat_ws(' ',first_name,last_name,company_name,email,phone)),${q})>0 OR id::text=${selectedContact}) ORDER BY (id::text=${selectedContact}) DESC,last_name,id LIMIT 50`;
    const vehicles =
      await tx`SELECT id,registration,make,model,retail_price_pence FROM vehicles WHERE deleted_at IS NULL AND state IN ('booked_in','in_prep','ready','live')
      AND (strpos(lower(concat_ws(' ',registration,make,model,stock_number)),${q})>0 OR id::text=${selectedVehicle}) ORDER BY (id::text=${selectedVehicle}) DESC,registration,id LIMIT 50`;
    return {
      lead,
      selectedContact,
      selectedVehicle,
      contacts: contacts.map((r) => ({
        id: String(r['id']),
        label:
          [r['name'], r['email']].filter(Boolean).join(' · ') ||
          'Unnamed customer',
      })),
      vehicles: vehicles.map((r) => ({
        id: String(r['id']),
        label: [r['registration'], r['make'], r['model']]
          .filter(Boolean)
          .join(' · '),
        price:
          r['retail_price_pence'] == null
            ? ''
            : `${BigInt(r['retail_price_pence'] as string) / 100n}.${(BigInt(r['retail_price_pence'] as string) % 100n).toString().padStart(2, '0')}`,
      })),
    };
  });
}
export async function applyDraftDeal(
  tx: Tx,
  session: Session,
  input: DraftDealInput,
): Promise<DraftDealOutcome> {
  if (!authorize(session, 'deal.create').allowed || !canBuildDeal(session))
    return { ok: false, error: 'You do not have permission to create a deal.' };
  if (
    !isId(input.contactId) ||
    !isId(input.vehicleId) ||
    (input.leadId && !isId(input.leadId))
  )
    return { ok: false, error: 'Choose a customer and a car from the lists.' };
  const price = cashPence(input.price);
  if (price === null)
    return {
      ok: false,
      error:
        'Enter a cash price greater than zero, with up to two decimal places.',
    };
  const [v] =
    await tx`SELECT id,site_id,state FROM vehicles WHERE id=${input.vehicleId}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (
    !v ||
    !['booked_in', 'in_prep', 'ready', 'live'].includes(String(v['state']))
  )
    return {
      ok: false,
      error: 'This car is unavailable for a new deal. Refresh the stock list.',
    };
  const [c] =
    await tx`SELECT id FROM contacts WHERE id=${input.contactId}::uuid AND erased_at IS NULL AND merged_into_id IS NULL FOR SHARE`;
  if (!c)
    return {
      ok: false,
      error: 'This customer is unavailable. Choose an active customer.',
    };
  if (input.leadId) {
    if (!holds(session, 'lead.read'))
      return {
        ok: false,
        error: 'You do not have permission to use this enquiry.',
      };
    const [l] =
      await tx`SELECT contact_id,vehicle_id,site_id,stage FROM leads WHERE id=${input.leadId}::uuid FOR SHARE`;
    if (
      !l ||
      l['contact_id'] !== input.contactId ||
      (l['vehicle_id'] && l['vehicle_id'] !== input.vehicleId) ||
      (l['site_id'] && l['site_id'] !== v['site_id']) ||
      ['won', 'lost'].includes(String(l['stage']))
    )
      return {
        ok: false,
        error:
          'The enquiry must be open and match this customer, car and branch.',
      };
  }
  const [existing] =
    await tx`SELECT id,contact_id,state FROM deals WHERE vehicle_id=${input.vehicleId}::uuid AND state NOT IN ('cancelled','unwound') ORDER BY created_at DESC LIMIT 1`;
  if (existing) {
    if (
      existing['contact_id'] === input.contactId &&
      existing['state'] === 'building'
    )
      return { ok: true, id: String(existing['id']) };
    return {
      ok: false,
      error:
        'This car already has a deal. Review its existing deal before starting another.',
    };
  }
  const [row] =
    await tx`INSERT INTO deals (tenant_id,site_id,contact_id,vehicle_id,lead_id,vehicle_price_pence,created_by,updated_by)
    VALUES (${session.tenantId}::uuid,${v['site_id']}::uuid,${input.contactId}::uuid,${input.vehicleId}::uuid,${input.leadId || null}::uuid,${price.toString()},${session.userId}::uuid,${session.userId}::uuid) RETURNING id`;
  const id = String(row!['id']);
  const after = {
    state: 'building',
    contactId: input.contactId,
    vehicleId: input.vehicleId,
    leadId: input.leadId || null,
    vehiclePricePence: price.toString(),
    currency: 'GBP',
  };
  await appendToLedger(tx, session, id, {
    kind: 'note',
    payload: { event: 'draft_created', ...after },
    documentVersion: null,
    wordingVersion: null,
    occurredAt: new Date(),
  });
  await writeAudit({
    tx,
    session,
    resourceType: 'deal',
    resourceId: id,
    action: 'created',
    after,
    siteId: v['site_id'] as string | null,
  });
  return { ok: true, id };
}

export async function draftPriceEditor(session: Session, id: string) {
  if (
    !isId(id) ||
    !holds(session, 'deal.read') ||
    !holds(session, 'deal.update')
  )
    return null;
  return withSession(session, async (tx) => {
    const [r] =
      await tx`SELECT vehicle_price_pence,updated_at::text AS revision,created_by FROM deals WHERE id=${id}::uuid AND state='building' AND invoice_id IS NULL`;
    if (
      !r ||
      !authorize(session, 'deal.update', { ownerId: r['created_by'] as string })
        .allowed
    )
      return null;
    const n =
      r['vehicle_price_pence'] == null
        ? null
        : BigInt(r['vehicle_price_pence'] as string);
    return {
      revision: String(r['revision']),
      price:
        n === null
          ? ''
          : `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`,
    };
  });
}
export async function applyDraftPrice(
  tx: Tx,
  session: Session,
  input: { id: string; revision: string; price: string },
): Promise<DraftDealOutcome> {
  if (!isId(input.id) || !holds(session, 'deal.read'))
    return { ok: false, error: 'Choose an available deal.' };
  const [r] =
    await tx`SELECT state,invoice_id,created_by,vehicle_price_pence,updated_at::text AS revision FROM deals WHERE id=${input.id}::uuid FOR UPDATE`;
  if (
    !r ||
    !authorize(session, 'deal.update', { ownerId: r['created_by'] as string })
      .allowed
  )
    return {
      ok: false,
      error: 'You do not have permission to change this deal.',
    };
  if (r['state'] !== 'building' || r['invoice_id'])
    return {
      ok: false,
      error:
        'Only an uninvoiced draft can be repriced. This deal has moved forward.',
    };
  if (r['revision'] !== input.revision)
    return {
      ok: false,
      error:
        'Someone changed this deal. Refresh and review its current price before saving.',
    };
  const price = cashPence(input.price);
  if (price === null)
    return {
      ok: false,
      error:
        'Enter a cash price greater than zero, with up to two decimal places.',
    };
  const before =
    r['vehicle_price_pence'] == null ? null : String(r['vehicle_price_pence']);
  if (before === price.toString()) return { ok: true, id: input.id };
  await tx`UPDATE deals SET vehicle_price_pence=${price.toString()},updated_at=clock_timestamp(),updated_by=${session.userId}::uuid WHERE id=${input.id}::uuid`;
  await appendToLedger(tx, session, input.id, {
    kind: 'note',
    payload: {
      event: 'draft_price_changed',
      beforePence: before,
      afterPence: price.toString(),
    },
    documentVersion: null,
    wordingVersion: null,
    occurredAt: new Date(),
  });
  await writeAudit({
    tx,
    session,
    resourceType: 'deal',
    resourceId: input.id,
    action: 'draft_price_changed',
    before: { vehiclePricePence: before },
    after: { vehiclePricePence: price.toString() },
  });
  return { ok: true, id: input.id };
}
