/**
 * Reading appraisals, and assembling exactly what the M13 domain functions
 * need. Nothing here computes a figure — the estimate, the offer, the
 * settlement position and the conversion blockers all come from
 * `packages/domain/src/appraisal.ts`, which is where they are tested.
 */

import { withSession, toPence, toInt, toDate, type Tx } from './db';
import type { Session } from '../session';
import { money, type Money } from '@forecourt/domain';
import type {
  Appraisal, DamageMark, ReconStandard, Valuation, Offer, Settlement,
  AppraisalState, DamageType, DamageSeverity, PanelGroup,
  ValuationSource, SettlementSource, ReconStandardSource, DisposalRoute,
} from '@forecourt/domain';

export interface AppraisalSummary {
  id: string;
  state: AppraisalState;
  registration: string;
  make: string | null;
  model: string | null;
  derivative: string | null;
  mileage: number | null;
  contactName: string | null;
  allowance: Money | null;
  offerRevision: number | null;
  updatedAt: Date;
}

const gbp = (v: string | number | null): Money => money(toPence(v), 'GBP');

export async function listAppraisals(session: Session): Promise<AppraisalSummary[]> {
  return withSession(session, async (tx) => {
    const rows = await tx<{
      id: string; state: string; registration: string;
      make: string | null; model: string | null; derivative: string | null;
      mileage: number | null; contact_name: string | null;
      allowance_pence: string | null; revision: number | null; updated_at: Date;
    }[]>`
      SELECT a.id, a.state, a.registration, a.make, a.model, a.derivative, a.mileage,
             nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name,
             o.allowance_pence, o.revision, a.updated_at
      FROM appraisals a
      LEFT JOIN contacts c ON c.id = a.contact_id
      -- The offer in force: highest revision that has not been declined.
      LEFT JOIN LATERAL (
        SELECT allowance_pence, revision
        FROM appraisal_offers ao
        WHERE ao.appraisal_id = a.id AND ao.declined_at IS NULL
        ORDER BY ao.revision DESC
        LIMIT 1
      ) o ON true
      ORDER BY a.updated_at DESC
      LIMIT 200`;

    return rows.map((r) => ({
      id: r.id,
      state: r.state as AppraisalState,
      registration: r.registration,
      make: r.make,
      model: r.model,
      derivative: r.derivative,
      mileage: toInt(r.mileage),
      contactName: r.contact_name,
      allowance: r.allowance_pence === null ? null : gbp(r.allowance_pence),
      offerRevision: r.revision,
      updatedAt: r.updated_at,
    }));
  });
}

export interface AppraisalDetail {
  appraisal: Appraisal;
  contactName: string | null;
  marks: DamageMark[];
  standards: ReconStandard[];
  valuations: Valuation[];
  offers: Offer[];
  settlements: Settlement[];
  tyreDepths: Record<string, number>;
}

export async function loadAppraisal(
  session: Session,
  id: string,
): Promise<AppraisalDetail | null> {
  return withSession(session, async (tx) => {
    const [row] = await tx<Record<string, never>[]>`
      SELECT a.*, nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS contact_name
      FROM appraisals a
      LEFT JOIN contacts c ON c.id = a.contact_id
      WHERE a.id = ${id}::uuid`;

    // No row means it does not exist OR it belongs to another tenant — and the
    // CRM must not be able to tell those apart. RLS has already made them
    // identical here; the route turns both into the same 404.
    if (!row) return null;

    const r = row as unknown as Record<string, string | number | boolean | Date | null>;

    const [marks, standards, valuations, offers, settlements] = await Promise.all([
      loadMarks(tx, id),
      loadStandards(tx),
      loadValuations(tx, id),
      loadOffers(tx, id),
      loadSettlements(tx, id),
    ]);

    const appraisal: Appraisal = {
      id: String(r['id']),
      state: r['state'] as AppraisalState,
      sellerType: (r['seller_type'] as Appraisal['sellerType']) ?? null,
      registration: String(r['registration']),
      vin: (r['vin'] as string | null),
      make: r['make'] as string | null,
      model: r['model'] as string | null,
      derivative: r['derivative'] as string | null,
      derivativeConfirmed: Boolean(r['derivative_confirmed']),
      bodyStyle: r['body_style'] as string | null,
      doors: toInt(r['doors'] as number | null),
      transmission: r['transmission'] as string | null,
      fuelType: r['fuel_type'] as string | null,
      colour: r['colour'] as string | null,
      engineCc: toInt(r['engine_cc'] as number | null),
      firstRegisteredOn: toDate(r['first_registered_on'] as Date | null),
      mileage: toInt(r['mileage'] as number | null),
      motExpiresOn: toDate(r['mot_expires_on'] as Date | null),
      formerKeepers: toInt(r['former_keepers'] as number | null),
      serviceHistoryType: r['service_history_type'] as string | null,
      keyCount: toInt(r['key_count'] as number | null),
      v5cPresent: r['v5c_present'] as boolean | null,
      conditionNotes: r['condition_notes'] as string | null,
      expiresAt: toDate(r['expires_at'] as Date | null),
      convertedVehicleId: r['converted_vehicle_id'] as string | null,
      ...(r['vat_invoice_received'] === null
        ? {}
        : { vatInvoiceReceived: Boolean(r['vat_invoice_received']) }),
    };

    return {
      appraisal,
      contactName: r['contact_name'] as string | null,
      marks,
      standards,
      valuations,
      offers,
      settlements,
      tyreDepths: (r['tyre_depths_tenths_mm'] as unknown as Record<string, number>) ?? {},
    };
  });
}

async function loadMarks(tx: Tx, id: string): Promise<DamageMark[]> {
  const rows = await tx<{
    id: string; panel: string; panel_group: string; damage_type: string;
    severity: string; size_mm: number | null; notes: string | null; photo_key: string | null;
  }[]>`
    SELECT id, panel, panel_group, damage_type, severity, size_mm, notes, photo_key
    FROM appraisal_damage WHERE appraisal_id = ${id}::uuid ORDER BY created_at`;

  return rows.map((r) => ({
    id: r.id,
    panel: r.panel,
    panelGroup: r.panel_group as PanelGroup,
    damageType: r.damage_type as DamageType,
    severity: r.severity as DamageSeverity,
    sizeMm: toInt(r.size_mm),
    notes: r.notes,
    photoKey: r.photo_key,
  }));
}

async function loadStandards(tx: Tx): Promise<ReconStandard[]> {
  const rows = await tx<{
    id: string; damage_type: string; severity: string; panel_group: string;
    cost_pence: string; source: string; sample_size: number | null;
    effective_from: Date; effective_to: Date | null;
  }[]>`
    SELECT id, damage_type, severity, panel_group, cost_pence, source, sample_size,
           effective_from, effective_to
    FROM recon_cost_standards`;

  return rows.map((r) => ({
    id: r.id,
    damageType: r.damage_type as DamageType,
    severity: r.severity as DamageSeverity,
    panelGroup: r.panel_group as PanelGroup,
    cost: gbp(r.cost_pence),
    source: r.source as ReconStandardSource,
    sampleSize: toInt(r.sample_size),
    effectiveFrom: r.effective_from,
    effectiveTo: toDate(r.effective_to),
  }));
}

async function loadValuations(tx: Tx, id: string): Promise<Valuation[]> {
  const rows = await tx<{
    id: string; source: string; trade_pence: string | null; retail_pence: string | null;
    private_pence: string | null; valued_at_mileage: number | null;
    forecast_days_to_sell: number | null; captured_at: Date;
  }[]>`
    SELECT id, source, trade_pence, retail_pence, private_pence,
           valued_at_mileage, forecast_days_to_sell, captured_at
    FROM appraisal_valuations WHERE appraisal_id = ${id}::uuid
    ORDER BY captured_at DESC`;

  return rows.map((r) => ({
    id: r.id,
    source: r.source as ValuationSource,
    trade: r.trade_pence === null ? null : gbp(r.trade_pence),
    retail: r.retail_pence === null ? null : gbp(r.retail_pence),
    private: r.private_pence === null ? null : gbp(r.private_pence),
    valuedAtMileage: toInt(r.valued_at_mileage),
    forecastDaysToSell: toInt(r.forecast_days_to_sell),
    capturedAt: r.captured_at,
  }));
}

async function loadOffers(tx: Tx, id: string): Promise<Offer[]> {
  const rows = await tx<{
    id: string; revision: number; allowance_pence: string;
    market_value_pence: string | null; recon_estimate_pence: string | null;
    target_margin_pence: string | null; fees_pence: string;
    over_allowance_pence: string | null; disposal_route: string | null;
    offered_at: Date; expires_at: Date | null; accepted_at: Date | null;
    declined_at: Date | null; declined_reason: string | null;
  }[]>`
    SELECT id, revision, allowance_pence, market_value_pence, recon_estimate_pence,
           target_margin_pence, fees_pence, over_allowance_pence, disposal_route,
           offered_at, expires_at, accepted_at, declined_at, declined_reason
    FROM appraisal_offers WHERE appraisal_id = ${id}::uuid ORDER BY revision`;

  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    breakdown: {
      allowance: gbp(r.allowance_pence),
      marketValue: gbp(r.market_value_pence),
      reconEstimate: gbp(r.recon_estimate_pence),
      targetMargin: gbp(r.target_margin_pence),
      fees: gbp(r.fees_pence),
      disposalRoute: (r.disposal_route as DisposalRoute) ?? 'retail',
      ceiling: money(
        toPence(r.market_value_pence) - toPence(r.recon_estimate_pence)
          - toPence(r.target_margin_pence) - toPence(r.fees_pence), 'GBP'),
      overAllowance: gbp(r.over_allowance_pence),
      ceilingBelowZero:
        toPence(r.market_value_pence) - toPence(r.recon_estimate_pence)
          - toPence(r.target_margin_pence) - toPence(r.fees_pence) < 0n,
      basedOnIncompleteRecon: false,
    },
    offeredAt: r.offered_at,
    expiresAt: toDate(r.expires_at),
    acceptedAt: toDate(r.accepted_at),
    declinedAt: toDate(r.declined_at),
    declinedReason: r.declined_reason,
  }));
}

async function loadSettlements(tx: Tx, id: string): Promise<Settlement[]> {
  const rows = await tx<{
    id: string; lender_name: string; agreement_reference: string | null;
    settlement_pence: string; daily_accrual_pence: string | null;
    source: string; verified: boolean; quoted_at: Date;
    valid_until: Date | null; paid_at: Date | null;
  }[]>`
    SELECT id, lender_name, agreement_reference, settlement_pence, daily_accrual_pence,
           source, verified, quoted_at, valid_until, paid_at
    FROM appraisal_settlements WHERE appraisal_id = ${id}::uuid ORDER BY quoted_at DESC`;

  return rows.map((r) => ({
    id: r.id,
    lenderName: r.lender_name,
    agreementReference: r.agreement_reference,
    settlement: gbp(r.settlement_pence),
    dailyAccrual: r.daily_accrual_pence === null ? null : gbp(r.daily_accrual_pence),
    source: r.source as SettlementSource,
    verified: r.verified,
    quotedAt: r.quoted_at,
    validUntil: toDate(r.valid_until),
    paidAt: toDate(r.paid_at),
  }));
}
