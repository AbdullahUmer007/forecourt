import {
  authorize, changeState, convertToStock, currentOffer, nextRevision,
  parsePoundsToPence, money, zero, withManualAllowance, calculateOffer,
  settlementPosition, type SellerType,
} from '@forecourt/domain';
import { withSession } from './db';
import { applyBookIn, type VehicleFormInput } from './vehicle-apply';
import { loadAppraisal } from './appraisals';
import { loadSites } from './stock';
import type { Session } from '@/auth/session';

export type AppraisalWrite = { ok: true; id?: string; vehicleId?: string } | { ok: false; error: string };

const SELLERS: SellerType[] = ['private_individual', 'vat_registered_business', 'non_vat_business'];

export async function createAppraisalDraft(
  session: Session,
  input: { registration: string; mileage: string; sellerType: string; name: string; phone: string; email: string },
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'appraisal.create');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const registration = input.registration.replace(/\s+/g, '').toUpperCase();
  if (registration.length < 5) return { ok: false, error: 'Enter the registration.' };
  const mileage = Number(input.mileage.replace(/,/g, ''));
  if (!Number.isInteger(mileage) || mileage < 0) {
    return { ok: false, error: 'Enter the mileage as a whole number of miles.' };
  }
  const sellerType = SELLERS.includes(input.sellerType as SellerType)
    ? input.sellerType as SellerType
    : 'private_individual';

  try {
    const id = await withSession(session, async (tx) => {
      const [site] = await tx<{ id: string }[]>`SELECT id FROM sites ORDER BY created_at LIMIT 1`;
      let contactId: string | null = null;
      const email = input.email.trim().toLowerCase();
      const name = input.name.trim();
      const siteId = site?.id ?? null;
      if (email || input.phone.trim() || name) {
        const parts = (name || 'Customer').split(/\s+/);
        const first = parts[0] ?? 'Customer';
        const last = parts.slice(1).join(' ') || null;
        const [c] = await tx<{ id: string }[]>`
          INSERT INTO contacts (tenant_id, site_id, first_name, last_name, email, phone)
          VALUES (
            ${session.tenantId}::uuid, ${siteId}::uuid,
            ${first}, ${last},
            ${email || null}, ${input.phone.trim() || null}
          )
          RETURNING id`;
        if (!c) throw new Error('The contact could not be saved.');
        contactId = c.id;
      }

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO appraisals (
          tenant_id, site_id, contact_id, state, seller_type, registration, mileage,
          created_by, updated_by
        ) VALUES (
          ${session.tenantId}::uuid, ${siteId}::uuid, ${contactId}::uuid,
          'draft', ${sellerType}::appraisal_seller_type, ${registration}, ${mileage},
          ${session.userId}::uuid, ${session.userId}::uuid
        )
        RETURNING id`;
      if (!row) throw new Error('The appraisal could not be saved.');

      await tx`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
        ) VALUES (
          ${session.tenantId}::uuid, 'user', ${session.userId}::uuid,
          'appraisal', ${row.id}::uuid, 'create',
          ${tx.json({ after: { registration, mileage, sellerType } })}
        )`;
      return row.id;
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The appraisal could not be saved.' };
  }
}

export async function recordAppraisalOffer(
  session: Session,
  appraisalId: string,
  input: { allowance: string; market: string; days: string },
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'appraisal.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const allowance = parsePoundsToPence(input.allowance);
  if (!allowance.ok || allowance.pence === null) {
    return { ok: false, error: allowance.ok ? 'Enter the allowance.' : allowance.message };
  }
  const market = parsePoundsToPence(input.market);
  if (!market.ok) return { ok: false, error: market.message };

  const detail = await loadAppraisal(session, appraisalId);
  if (!detail) return { ok: false, error: 'That appraisal is not on this desk.' };

  const base = calculateOffer({
    marketValue: market.pence === null ? money(allowance.pence, 'GBP') : money(market.pence, 'GBP'),
    reconEstimate: zero('GBP'),
    targetMargin: zero('GBP'),
    disposalRoute: 'retail',
  });
  const breakdown = withManualAllowance(base, money(allowance.pence, 'GBP'));
  const revision = nextRevision(detail.offers);
  const days = Number(input.days) || 7;
  const expires = new Date(Date.now() + days * 86_400_000);

  try {
    await withSession(session, async (tx) => {
      if (market.pence !== null) {
        await tx`
          INSERT INTO appraisal_valuations (
            tenant_id, appraisal_id, source, trade_pence, currency, captured_at, captured_by
          ) VALUES (
            ${session.tenantId}::uuid, ${appraisalId}::uuid, 'manual',
            ${market.pence.toString()}, 'GBP', now(), ${session.userId}::uuid
          )`;
      }

      await tx`
        INSERT INTO appraisal_offers (
          tenant_id, appraisal_id, revision, allowance_pence,
          market_value_pence, recon_estimate_pence, target_margin_pence, fees_pence,
          over_allowance_pence, disposal_route, offered_by, expires_at
        ) VALUES (
          ${session.tenantId}::uuid, ${appraisalId}::uuid, ${revision},
          ${breakdown.allowance.amount.toString()},
          ${breakdown.marketValue.amount.toString()},
          ${breakdown.reconEstimate.amount.toString()},
          ${breakdown.targetMargin.amount.toString()},
          ${breakdown.fees.amount.toString()},
          ${breakdown.overAllowance.amount.toString()},
          'retail', ${session.userId}::uuid, ${expires}
        )`;

      let state = detail.appraisal.state;
      if (state === 'draft') {
        const toAppraised = changeState(state, 'appraised');
        if (!toAppraised.ok) throw new Error(toAppraised.reason);
        state = 'appraised';
      }
      const toOffered = changeState(state, 'offered');
      if (!toOffered.ok) throw new Error(toOffered.reason);

      await tx`
        UPDATE appraisals SET state = 'offered', appraised_at = coalesce(appraised_at, now()),
               appraised_by = coalesce(appraised_by, ${session.userId}::uuid),
               updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${appraisalId}::uuid`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The offer could not be recorded.' };
  }
  return { ok: true, id: appraisalId };
}

export async function decideAppraisalOffer(
  session: Session,
  appraisalId: string,
  decisionKind: 'accepted' | 'declined',
  reason: string,
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'appraisal.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const detail = await loadAppraisal(session, appraisalId);
  if (!detail) return { ok: false, error: 'That appraisal is not on this desk.' };
  const offer = currentOffer(detail.offers);
  if (!offer) return { ok: false, error: 'Record an offer first.' };

  const next = changeState(detail.appraisal.state, decisionKind, { reason });
  if (!next.ok) return { ok: false, error: next.reason ?? 'That move is not allowed.' };

  const revision = nextRevision(detail.offers);
  try {
    await withSession(session, async (tx) => {
      await tx`
        INSERT INTO appraisal_offers (
          tenant_id, appraisal_id, revision, allowance_pence,
          market_value_pence, recon_estimate_pence, target_margin_pence, fees_pence,
          over_allowance_pence, disposal_route, offered_by, expires_at,
          accepted_at, declined_at, declined_reason
        ) VALUES (
          ${session.tenantId}::uuid, ${appraisalId}::uuid, ${revision},
          ${offer.breakdown.allowance.amount.toString()},
          ${offer.breakdown.marketValue.amount.toString()},
          ${offer.breakdown.reconEstimate.amount.toString()},
          ${offer.breakdown.targetMargin.amount.toString()},
          ${offer.breakdown.fees.amount.toString()},
          ${offer.breakdown.overAllowance.amount.toString()},
          ${offer.breakdown.disposalRoute}, ${session.userId}::uuid,
          ${offer.expiresAt && offer.expiresAt.getTime() > Date.now() ? offer.expiresAt : null},
          ${decisionKind === 'accepted' ? new Date() : null},
          ${decisionKind === 'declined' ? new Date() : null},
          ${decisionKind === 'declined' ? reason : null}
        )`;

      await tx`
        UPDATE appraisals SET
          state = ${decisionKind}::appraisal_state,
          declined_reason = ${decisionKind === 'declined' ? reason : null},
          updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${appraisalId}::uuid`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That decision could not be recorded.' };
  }
  return { ok: true, id: appraisalId };
}

export async function confirmAppraisalDerivative(
  session: Session,
  appraisalId: string,
  input: { make: string; model: string; derivative: string; vatInvoice: string },
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'appraisal.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  try {
    await withSession(session, async (tx) => {
      await tx`
        UPDATE appraisals SET
          make = ${input.make.trim() || null},
          model = ${input.model.trim() || null},
          derivative = ${input.derivative.trim() || null},
          derivative_confirmed = ${input.derivative.trim() !== ''},
          vat_invoice_received = ${input.vatInvoice === 'yes' ? true : input.vatInvoice === 'no' ? false : null},
          updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${appraisalId}::uuid`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That could not be saved.' };
  }
  return { ok: true, id: appraisalId };
}

export async function convertAppraisalToStock(
  session: Session,
  appraisalId: string,
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'vehicle.create');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const detail = await loadAppraisal(session, appraisalId);
  if (!detail) return { ok: false, error: 'That appraisal is not on this desk.' };
  const offer = currentOffer(detail.offers);
  if (!offer || !offer.acceptedAt) {
    return { ok: false, error: 'The customer has not accepted an offer, so there is no purchase price to record.' };
  }
  const settlement = settlementPosition(detail.settlements, new Date());

  let draft;
  try {
    draft = convertToStock({
      appraisal: detail.appraisal,
      offer,
      settlement,
      asAt: new Date(),
      arrivingState: 'purchased',
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'This cannot become stock yet.' };
  }

  const sites = await loadSites(session);
  const siteId = sites[0]?.id;
  if (!siteId) return { ok: false, error: 'This dealership has no site to book the car in at.' };

  const pounds = (pence: bigint): string => (Number(pence) / 100).toFixed(2);
  const iso = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');

  const form: VehicleFormInput = {
    siteId,
    registration: draft.registration,
    vin: draft.vin ?? '',
    make: draft.make ?? '',
    model: draft.model ?? '',
    derivative: draft.derivative ?? '',
    derivativeCandidateCount: '1',
    colour: draft.colour ?? '',
    fuelType: draft.fuelType ?? '',
    bodyStyle: draft.bodyStyle ?? '',
    transmission: draft.transmission ?? '',
    doors: draft.doors === null ? '' : String(draft.doors),
    engineCc: draft.engineCc === null ? '' : String(draft.engineCc),
    mileage: String(draft.mileage),
    highestMotMileage: '',
    firstRegisteredOn: iso(draft.firstRegisteredOn),
    motExpiresOn: iso(draft.motExpiresOn),
    formerKeepers: draft.formerKeepers === null ? '' : String(draft.formerKeepers),
    purchaseSource: 'part_exchange',
    purchaseDate: iso(draft.purchaseDate),
    purchasePrice: pounds(draft.purchasePrice.amount),
    retailPrice: '',
    vatScheme: draft.vatScheme,
    state: draft.state,
    advertHeadline: '',
    advertDescription: '',
    notes: draft.notes ?? '',
    acknowledgeMileage: '',
  };

  try {
    const booked = await withSession(session, async (tx) => {
      const result = await applyBookIn(tx, session, form);
      if (!result.ok) return result;

      const toConverted = changeState('accepted', 'converted');
      if (!toConverted.ok) {
        return { ok: false as const, error: toConverted.reason ?? 'Cannot mark converted.', problems: [] };
      }

      await tx`
        UPDATE appraisals SET
          state = 'converted',
          converted_vehicle_id = ${result.vehicleId}::uuid,
          converted_at = now(),
          updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${appraisalId}::uuid`;
      return result;
    });

    if (!booked.ok) return { ok: false, error: booked.error };
    return { ok: true, id: appraisalId, vehicleId: booked.vehicleId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The car could not be taken into stock.' };
  }
}

export async function withdrawAppraisalDraft(
  session: Session,
  appraisalId: string,
  confirm: string,
  reason: string,
): Promise<AppraisalWrite> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'appraisal.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };
  if (confirm !== 'WITHDRAW') {
    return { ok: false, error: 'Type WITHDRAW to confirm. Offers and valuations stay on file.' };
  }
  if (!reason.trim()) {
    return { ok: false, error: 'Say why this appraisal is being withdrawn.' };
  }

  const detail = await loadAppraisal(session, appraisalId);
  if (!detail) return { ok: false, error: 'That appraisal is not on this desk.' };
  const next = changeState(detail.appraisal.state, 'abandoned', { reason });
  if (!next.ok) return { ok: false, error: next.reason ?? 'This appraisal cannot be withdrawn from here.' };

  try {
    await withSession(session, async (tx) => {
      await tx`
        UPDATE appraisals SET
          state = 'abandoned', abandoned_reason = ${reason.trim()},
          updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${appraisalId}::uuid`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The appraisal could not be withdrawn.' };
  }
  return { ok: true, id: appraisalId };
}
