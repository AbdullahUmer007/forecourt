/**
 * M13 — the part-exchange appraisal.
 *
 * The sale car's price is published, negotiated and argued over in public. The
 * part-exchange number is invented at the kerbside in four minutes by someone
 * holding a phone in the rain, and it is the figure that decides whether the
 * deal happens and whether it made any money.
 *
 * Four things here are load-bearing:
 *
 *   1. A MARK WE CANNOT PRICE IS REPORTED, NEVER PRICED AT ZERO. A missing
 *      standard cost silently costed at nothing makes a damaged car look
 *      clean and pushes the allowance up by exactly the repair bill. The
 *      estimate carries its own list of what it could not price.
 *
 *   2. THE ALLOWANCE IS THE PURCHASE PRICE. Not the market value, not what the
 *      car is "really" worth — the amount actually given in exchange is what
 *      goes in the VAT stock book, and an over-allowance used to close a deal
 *      is recorded as such rather than quietly re-based.
 *
 *   3. SETTLEMENT NEVER NETS OFF. M12 settled this for the deal; here is where
 *      the figure is captured, and it carries an expiry and a source, because
 *      a lapsed quote accrues interest the dealer pays and a figure the
 *      customer recalled from memory is not a figure at all.
 *
 *   4. THE BREAKDOWN IS COST DATA. The customer is told one number. Market
 *      value, recon and target margin are exactly the figures a sales
 *      executive may not see unless granted, so the customer-facing view is
 *      BUILT, not filtered — there is no key to forget to delete.
 */

import {
  type Money, money, add, subtract, sum, zero, max as maxMoney, isNegative, format,
} from './money.js';
import type { VatScheme } from './vat.js';
import type { VehicleState } from './vehicle-lifecycle.js';

// ------------------------------------------------------------------ types

export type AppraisalState =
  | 'draft' | 'appraised' | 'offered' | 'accepted'
  | 'declined' | 'expired' | 'converted' | 'abandoned';

export type SellerType =
  | 'private_individual' | 'vat_registered_business' | 'non_vat_business';

export type DamageType =
  | 'scratch' | 'dent' | 'scuff' | 'chip' | 'crack' | 'corrosion' | 'missing'
  | 'paint_mismatch' | 'kerbing' | 'tear' | 'stain' | 'warning_light' | 'wear';

export type DamageSeverity = 'light' | 'moderate' | 'heavy';

export type PanelGroup =
  | 'body_panel' | 'bumper' | 'glass' | 'wheel' | 'tyre'
  | 'interior' | 'mechanical' | 'electrical';

export type ValuationSource =
  | 'cap_hpi' | 'trade_guide' | 'auction_comparable' | 'own_history' | 'manual';

export type DisposalRoute = 'retail' | 'trade' | 'auction';

export type SettlementSource =
  | 'customer_stated' | 'lender_letter' | 'lender_portal' | 'provenance_check';

export type ReconStandardSource = 'tenant_default' | 'observed_average' | 'manual';

// ------------------------------------------------------------ damage map
//
// The specific spot tapped on the map is free text, because it varies by body
// style and a three-door should not need a migration. What a standard cost is
// keyed on is the GROUP, and that mapping lives here.

const PANEL_GROUPS: Record<string, PanelGroup> = {
  bonnet: 'body_panel', roof: 'body_panel', tailgate: 'body_panel', boot_lid: 'body_panel',
  nsf_wing: 'body_panel', osf_wing: 'body_panel', nsr_quarter: 'body_panel', osr_quarter: 'body_panel',
  nsf_door: 'body_panel', osf_door: 'body_panel', nsr_door: 'body_panel', osr_door: 'body_panel',
  nsf_sill: 'body_panel', osf_sill: 'body_panel',

  front_bumper: 'bumper', rear_bumper: 'bumper',

  windscreen: 'glass', rear_screen: 'glass', nsf_window: 'glass', osf_window: 'glass',
  nsr_window: 'glass', osr_window: 'glass', ns_mirror: 'glass', os_mirror: 'glass',

  nsf_alloy: 'wheel', osf_alloy: 'wheel', nsr_alloy: 'wheel', osr_alloy: 'wheel', spare_wheel: 'wheel',
  nsf_tyre: 'tyre', osf_tyre: 'tyre', nsr_tyre: 'tyre', osr_tyre: 'tyre',

  driver_seat: 'interior', passenger_seat: 'interior', rear_seats: 'interior',
  dashboard: 'interior', headlining: 'interior', carpet: 'interior', boot_trim: 'interior',

  engine: 'mechanical', gearbox: 'mechanical', clutch: 'mechanical',
  brakes: 'mechanical', suspension: 'mechanical', exhaust: 'mechanical',

  infotainment: 'electrical', air_conditioning: 'electrical', warning_lights: 'electrical',
};

/**
 * The costing group for a tapped panel. Returns null rather than guessing —
 * an unrecognised panel priced against the wrong group is a wrong estimate
 * that looks completely normal on the screen.
 */
export const panelGroupFor = (panel: string): PanelGroup | null =>
  PANEL_GROUPS[panel.trim().toLowerCase()] ?? null;

export const KNOWN_PANELS: readonly string[] = Object.keys(PANEL_GROUPS);

export interface DamageMark {
  id: string;
  panel: string;
  panelGroup: PanelGroup;
  damageType: DamageType;
  severity: DamageSeverity;
  sizeMm?: number | null;
  notes?: string | null;
  photoKey?: string | null;
}

/** The legal minimum tread depth, in tenths of a millimetre. */
export const LEGAL_TREAD_TENTHS_MM = 16;
/** Below this a tyre is legal but will not survive a retail prep standard. */
export const ADVISORY_TREAD_TENTHS_MM = 30;

export interface TyreFinding {
  position: string;
  tenthsMm: number;
  illegal: boolean;
  advisory: boolean;
}

/**
 * Tread depths are held in tenths of a millimetre so the 1.6mm minimum is an
 * integer comparison. A tyre at 1.59mm as a float is a coin toss.
 */
export function assessTyres(depths: Readonly<Record<string, number>>): TyreFinding[] {
  return Object.entries(depths).map(([position, tenthsMm]) => ({
    position,
    tenthsMm,
    illegal: tenthsMm < LEGAL_TREAD_TENTHS_MM,
    advisory: tenthsMm >= LEGAL_TREAD_TENTHS_MM && tenthsMm < ADVISORY_TREAD_TENTHS_MM,
  }));
}

// -------------------------------------------------------- recon estimate

export interface ReconStandard {
  id: string;
  damageType: DamageType;
  severity: DamageSeverity;
  panelGroup: PanelGroup;
  cost: Money;
  source: ReconStandardSource;
  sampleSize: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Below this many observed prep jobs, an "observed average" is not reported as
 * an average. Same rule as the representative-APR governance report and for
 * the same reason: a confident number built from four data points is worse
 * than admitting there is no number yet, because someone acts on it.
 */
export const MIN_OBSERVED_SAMPLE = 8;

const covers = (s: ReconStandard, asAt: Date): boolean =>
  s.effectiveFrom.getTime() <= asAt.getTime() &&
  (s.effectiveTo === null || s.effectiveTo.getTime() > asAt.getTime());

const usableStandard = (s: ReconStandard): boolean =>
  s.source !== 'observed_average' || (s.sampleSize ?? 0) >= MIN_OBSERVED_SAMPLE;

/**
 * The standard cost in force for a mark at a moment.
 *
 * Prefers the most recently effective usable standard, the same way the
 * compliance-rule resolver prefers the highest version whose window covers the
 * date: overlapping open windows are normal, and the newest one wins.
 */
export function resolveStandard(
  standards: readonly ReconStandard[],
  key: { damageType: DamageType; severity: DamageSeverity; panelGroup: PanelGroup },
  asAt: Date,
): ReconStandard | null {
  const candidates = standards
    .filter(
      (s) =>
        s.damageType === key.damageType &&
        s.severity === key.severity &&
        s.panelGroup === key.panelGroup &&
        covers(s, asAt) &&
        usableStandard(s),
    )
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  return candidates[0] ?? null;
}

export interface ReconLine {
  markId: string;
  panel: string;
  description: string;
  category: string;
  estimate: Money;
  standardId: string;
  source: 'standard';
}

export interface UnpricedMark {
  markId: string;
  panel: string;
  description: string;
  reason: string;
}

export interface ReconEstimate {
  lines: readonly ReconLine[];
  manualTotal: Money;
  standardTotal: Money;
  /** Standard lines plus any manual lines passed in. */
  total: Money;
  /**
   * Marks with no usable standard cost. NEVER folded into the total as zero:
   * a silent zero makes a damaged car look clean and inflates the allowance by
   * exactly the repair bill.
   */
  unpriced: readonly UnpricedMark[];
  /** True when anything is unpriced — the screen must say so before an offer. */
  incomplete: boolean;
}

const CATEGORY_FOR_GROUP: Record<PanelGroup, string> = {
  body_panel: 'bodywork', bumper: 'bodywork', glass: 'parts', wheel: 'bodywork',
  tyre: 'tyres', interior: 'valet', mechanical: 'mechanical', electrical: 'mechanical',
};

const describeMark = (m: DamageMark): string =>
  `${m.severity} ${m.damageType.replace(/_/g, ' ')} — ${m.panel.replace(/_/g, ' ')}`;

/**
 * Build the recon estimate from the damage map and the tenant's standard costs.
 *
 * `manualLines` are what the buyer knows and the map does not — an MOT advisory
 * pulled from M4's history, a cambelt due, a missing service book.
 */
export function estimateRecon(input: {
  marks: readonly DamageMark[];
  standards: readonly ReconStandard[];
  asAt: Date;
  manualLines?: readonly Money[];
  currency?: 'GBP' | 'EUR';
}): ReconEstimate {
  const currency = input.currency ?? 'GBP';
  const lines: ReconLine[] = [];
  const unpriced: UnpricedMark[] = [];

  for (const mark of input.marks) {
    const standard = resolveStandard(input.standards, mark, input.asAt);

    if (!standard) {
      unpriced.push({
        markId: mark.id,
        panel: mark.panel,
        description: describeMark(mark),
        reason:
          `No standard cost for a ${mark.severity} ${mark.damageType.replace(/_/g, ' ')} ` +
          `on ${mark.panelGroup.replace(/_/g, ' ')}. Price it manually before offering.`,
      });
      continue;
    }

    lines.push({
      markId: mark.id,
      panel: mark.panel,
      description: describeMark(mark),
      category: CATEGORY_FOR_GROUP[mark.panelGroup],
      estimate: standard.cost,
      standardId: standard.id,
      source: 'standard',
    });
  }

  const standardTotal = sum(lines.map((l) => l.estimate), currency);
  const manualTotal = sum(input.manualLines ?? [], currency);

  return {
    lines,
    standardTotal,
    manualTotal,
    total: add(standardTotal, manualTotal),
    unpriced,
    incomplete: unpriced.length > 0,
  };
}

// ------------------------------------------------------- valuation panel

export interface Valuation {
  id: string;
  source: ValuationSource;
  trade: Money | null;
  retail: Money | null;
  private: Money | null;
  valuedAtMileage: number | null;
  forecastDaysToSell: number | null;
  capturedAt: Date;
}

export interface ValuationPanel {
  basis: 'provider' | 'manual' | 'none';
  source: ValuationSource | null;
  trade: Money | null;
  retail: Money | null;
  private: Money | null;
  forecastDaysToSell: number | null;
  capturedAt: Date | null;
  ageDays: number | null;
  stale: boolean;
  /** The valuation's assumed mileage versus the car in front of us. */
  mileageDelta: number | null;
  warnings: readonly string[];
}

/** A trade valuation older than this is not a current view of the market. */
export const VALUATION_STALE_DAYS = 7;
/** A mileage difference this large makes the valuation a different car. */
export const VALUATION_MILEAGE_TOLERANCE = 2_000;

const DAY_MS = 86_400_000;
const wholeDaysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * The valuation panel, from whatever sources exist.
 *
 * Deliberately returns `basis: 'none'` rather than inventing a figure when
 * there is nothing to show. cap hpi is contract-blocked (M4's paid half), and
 * a product that fabricates a guide price is doing the exact thing we audit
 * competitors for. A manual offer with a stated basis is legitimate; a
 * fictional market value is not.
 */
export function valuationPanel(input: {
  valuations: readonly Valuation[];
  mileage: number | null;
  asAt: Date;
  staleAfterDays?: number;
}): ValuationPanel {
  const staleAfter = input.staleAfterDays ?? VALUATION_STALE_DAYS;
  const latest = [...input.valuations].sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
  )[0];

  if (!latest) {
    return {
      basis: 'none', source: null, trade: null, retail: null, private: null,
      forecastDaysToSell: null, capturedAt: null, ageDays: null, stale: false,
      mileageDelta: null,
      warnings: [
        'No valuation on file. Any offer must record its own basis — what it was ' +
          'built from is what explains it later.',
      ],
    };
  }

  const warnings: string[] = [];
  const ageDays = wholeDaysBetween(latest.capturedAt, input.asAt);
  const stale = ageDays > staleAfter;
  if (stale) {
    warnings.push(
      `This valuation is ${ageDays} days old. Trade values move weekly — re-check before offering.`,
    );
  }

  let mileageDelta: number | null = null;
  if (latest.valuedAtMileage !== null && input.mileage !== null) {
    mileageDelta = input.mileage - latest.valuedAtMileage;
    if (Math.abs(mileageDelta) > VALUATION_MILEAGE_TOLERANCE) {
      warnings.push(
        `Valued at ${latest.valuedAtMileage.toLocaleString('en-GB')} miles; this car has ` +
          `${input.mileage.toLocaleString('en-GB')}. Adjust before offering.`,
      );
    }
  }

  return {
    basis: latest.source === 'manual' ? 'manual' : 'provider',
    source: latest.source,
    trade: latest.trade,
    retail: latest.retail,
    private: latest.private,
    forecastDaysToSell: latest.forecastDaysToSell,
    capturedAt: latest.capturedAt,
    ageDays,
    stale,
    mileageDelta,
    warnings,
  };
}

// ---------------------------------------------------------------- offer

export interface OfferBreakdown {
  /** THE number, and the only one the customer is told. */
  allowance: Money;

  // Internal. Cost data — see `customerFacingOffer`.
  marketValue: Money;
  reconEstimate: Money;
  targetMargin: Money;
  fees: Money;
  disposalRoute: DisposalRoute;
  /** market − recon − margin − fees. What the car is worth to us. */
  ceiling: Money;
  /** How far above the ceiling the allowance was pushed to close the deal. */
  overAllowance: Money;
  /** True when the numbers say this car is worth nothing to us. */
  ceilingBelowZero: boolean;
  basedOnIncompleteRecon: boolean;
}

/**
 * What we can pay, from the numbers.
 *
 * The allowance is floored at zero: a negative allowance is not a thing anyone
 * can be offered, and the honest response to a negative ceiling is to decline
 * the part-exchange or route it to trade, not to invent a number.
 */
export function calculateOffer(input: {
  marketValue: Money;
  reconEstimate: Money;
  targetMargin: Money;
  fees?: Money;
  disposalRoute: DisposalRoute;
  reconIncomplete?: boolean;
}): OfferBreakdown {
  const currency = input.marketValue.currency;
  const fees = input.fees ?? zero(currency);

  const ceiling = subtract(
    subtract(subtract(input.marketValue, input.reconEstimate), input.targetMargin),
    fees,
  );
  const allowance = maxMoney(ceiling, zero(currency));

  return {
    allowance,
    marketValue: input.marketValue,
    reconEstimate: input.reconEstimate,
    targetMargin: input.targetMargin,
    fees,
    disposalRoute: input.disposalRoute,
    ceiling,
    overAllowance: zero(currency),
    ceilingBelowZero: isNegative(ceiling),
    basedOnIncompleteRecon: input.reconIncomplete ?? false,
  };
}

/**
 * Push the allowance above the ceiling to close the deal.
 *
 * This is a legitimate and extremely common move — the customer wants £5,000
 * for a £4,600 car and the sale car has the margin to carry it. What must not
 * happen is the over-allowance disappearing: it is economically a discount on
 * the sale car, and a dealer who cannot see it believes their part-exchanges
 * are more profitable than they are.
 */
export function withManualAllowance(base: OfferBreakdown, allowance: Money): OfferBreakdown {
  if (isNegative(allowance)) {
    throw new RangeError('An allowance cannot be negative. Decline the part-exchange instead.');
  }
  const over = subtract(allowance, base.ceiling);
  return {
    ...base,
    allowance,
    overAllowance: maxMoney(over, zero(allowance.currency)),
  };
}

export interface Offer {
  id: string;
  revision: number;
  breakdown: OfferBreakdown;
  offeredAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  declinedReason: string | null;
}

/**
 * Everything the customer may be shown, and nothing else.
 *
 * BUILT rather than filtered. A `delete offer.marketValue` approach leaves the
 * cost data one forgotten key away from a payload, and the roles table is
 * explicit that a sales executive has no cost prices unless granted — so the
 * type itself has nowhere to put them.
 */
export interface CustomerFacingOffer {
  revision: number;
  allowance: Money;
  offeredAt: Date;
  expiresAt: Date | null;
}

export const customerFacingOffer = (offer: Offer): CustomerFacingOffer => ({
  revision: offer.revision,
  allowance: offer.breakdown.allowance,
  offeredAt: offer.offeredAt,
  expiresAt: offer.expiresAt,
});

/** The offer in force: the highest revision that has not been declined. */
export function currentOffer(offers: readonly Offer[]): Offer | null {
  return (
    [...offers]
      .filter((o) => o.declinedAt === null)
      .sort((a, b) => b.revision - a.revision)[0] ?? null
  );
}

export const offerExpired = (offer: Offer, asAt: Date): boolean =>
  offer.expiresAt !== null && offer.expiresAt.getTime() <= asAt.getTime();

/** A revision never edits its predecessor — it supersedes it. */
export function nextRevision(offers: readonly Offer[]): number {
  return offers.reduce((n, o) => Math.max(n, o.revision), 0) + 1;
}

// ----------------------------------------------------------- settlement

export interface Settlement {
  id: string;
  lenderName: string;
  agreementReference: string | null;
  settlement: Money;
  dailyAccrual: Money | null;
  source: SettlementSource;
  verified: boolean;
  quotedAt: Date;
  validUntil: Date | null;
  paidAt: Date | null;
}

export interface SettlementPosition {
  present: boolean;
  lenderName: string | null;
  source: SettlementSource | null;
  /** The figure as quoted. */
  settlement: Money | null;
  /** The figure with accrual applied to `asAt`, where the lender stated a rate. */
  projected: Money | null;
  verified: boolean;
  expired: boolean;
  daysUntilExpiry: number | null;
  paid: boolean;
  warnings: readonly string[];
}

/**
 * Where the outstanding finance stands, at a stated moment.
 *
 * `asAt` is a required argument for the same reason M9's `consentPosition`
 * requires it: the handover desk and the accounts run want different moments,
 * and a default of "now" silently gives one of them the other's answer.
 */
export function settlementPosition(
  settlements: readonly Settlement[],
  asAt: Date,
): SettlementPosition {
  const latest = [...settlements].sort((a, b) => b.quotedAt.getTime() - a.quotedAt.getTime())[0];

  if (!latest) {
    return {
      present: false, lenderName: null, source: null, settlement: null, projected: null,
      verified: false, expired: false, daysUntilExpiry: null, paid: false, warnings: [],
    };
  }

  const warnings: string[] = [];
  const expired = latest.validUntil !== null && latest.validUntil.getTime() < asAt.getTime();
  const daysUntilExpiry =
    latest.validUntil === null ? null : wholeDaysBetween(asAt, latest.validUntil);

  if (expired) {
    warnings.push(
      `${latest.lenderName}'s settlement quote lapsed. Request a fresh figure — the ` +
        `difference accrues to the dealership, not the customer.`,
    );
  }
  if (!latest.verified) {
    warnings.push(
      latest.source === 'customer_stated'
        ? 'This figure is what the customer recalled owing. Confirm it with the lender before contracting.'
        : 'This settlement has not been verified against the lender.',
    );
  }

  // Accrual only where the lender actually stated a daily rate. Estimating one
  // would put a number on the screen that nobody can be held to.
  let projected = latest.settlement;
  if (latest.dailyAccrual !== null) {
    const days = Math.max(0, wholeDaysBetween(latest.quotedAt, asAt));
    projected = add(latest.settlement, money(latest.dailyAccrual.amount * BigInt(days),
      latest.settlement.currency));
  }

  return {
    present: true,
    lenderName: latest.lenderName,
    source: latest.source,
    settlement: latest.settlement,
    projected,
    verified: latest.verified,
    expired,
    daysUntilExpiry,
    paid: latest.paidAt !== null,
    warnings,
  };
}

export interface EquityPosition {
  allowance: Money;
  settlement: Money;
  /** allowance − settlement. Negative means the customer owes more than the car is worth. */
  equity: Money;
  negative: boolean;
  summary: string;
}

/**
 * Negative equity, stated plainly.
 *
 * This is the single most common unpleasant surprise at a handover desk, and
 * it is entirely predictable weeks earlier. Saying it in pounds beats leaving
 * the customer to work it out from two figures on different screens.
 */
export function equityPosition(allowance: Money, settlement: Money): EquityPosition {
  const equity = subtract(allowance, settlement);
  const negative = isNegative(equity);
  return {
    allowance,
    settlement,
    equity,
    negative,
    summary: negative
      ? `${format(allowance)} allowed, ${format(settlement)} still owed — ` +
        `${format(money(-equity.amount, equity.currency))} of negative equity to carry into the deal.`
      : `${format(allowance)} allowed, ${format(settlement)} still owed — ` +
        `${format(equity)} towards the new car.`,
  };
}

/**
 * The two figures M12's deal needs, kept SEPARATE.
 *
 * The settlement is returned as its own value and never folded into the
 * allowance. `balanceToFinance` adds it to what the customer owes, because the
 * money has to reach their lender; netting it off here would understate the
 * balance by exactly the settlement figure, and the customer would find out at
 * the desk.
 */
export function partExchangeForDeal(
  offer: Offer,
  position: SettlementPosition,
): { partExchange: Money; partExchangeSettlement: Money } {
  const allowance = offer.breakdown.allowance;
  return {
    partExchange: allowance,
    partExchangeSettlement: position.projected ?? position.settlement ?? zero(allowance.currency),
  };
}

// ------------------------------------------------------------ VAT scheme

export interface VatSchemeDecision {
  scheme: VatScheme | null;
  reason: string;
  /** True when the answer cannot be derived and a human must state it. */
  needsInput: boolean;
}

/**
 * Which VAT scheme the resulting stock record goes on.
 *
 * A private individual and an unregistered business cannot charge VAT, so
 * nothing is recoverable and the car goes on the margin scheme — which is the
 * overwhelmingly common part-exchange, and it is decided.
 *
 * A VAT-registered business is NOT decided by its registration alone: it may
 * sell to us under the margin scheme itself, in which case no input VAT exists
 * to reclaim. The deciding fact is whether a VAT invoice was actually issued,
 * so the function asks rather than assuming. Assuming `qualifying` would have
 * us charge VAT on the full selling price of a car we never reclaimed it on.
 */
export function vatSchemeForSeller(
  sellerType: SellerType,
  vatInvoiceReceived?: boolean,
): VatSchemeDecision {
  if (sellerType === 'private_individual') {
    return {
      scheme: 'margin',
      reason: 'Bought from a private individual — no VAT was chargeable, so nothing is recoverable.',
      needsInput: false,
    };
  }
  if (sellerType === 'non_vat_business') {
    return {
      scheme: 'margin',
      reason: 'Bought from an unregistered business — no VAT was chargeable, so nothing is recoverable.',
      needsInput: false,
    };
  }
  if (vatInvoiceReceived === undefined) {
    return {
      scheme: null,
      reason:
        'Bought from a VAT-registered business. Confirm whether they issued a VAT invoice: ' +
        'they may have sold under the margin scheme themselves, in which case there is no ' +
        'input VAT to reclaim and this car is a margin car.',
      needsInput: true,
    };
  }
  return vatInvoiceReceived
    ? {
        scheme: 'qualifying',
        reason: 'A VAT invoice was received, so input VAT was reclaimable — VAT qualifying.',
        needsInput: false,
      }
    : {
        scheme: 'margin',
        reason:
          'No VAT invoice was received; the seller sold under the margin scheme, so nothing ' +
          'was recoverable.',
        needsInput: false,
      };
}

// ------------------------------------------------------------ conversion

export interface Appraisal {
  id: string;
  state: AppraisalState;
  sellerType: SellerType | null;
  vatInvoiceReceived?: boolean;

  registration: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  derivative: string | null;
  derivativeConfirmed: boolean;
  bodyStyle: string | null;
  doors: number | null;
  transmission: string | null;
  fuelType: string | null;
  colour: string | null;
  engineCc: number | null;
  firstRegisteredOn: Date | null;
  mileage: number | null;
  motExpiresOn: Date | null;
  formerKeepers: number | null;
  serviceHistoryType: string | null;
  keyCount: number | null;
  v5cPresent: boolean | null;
  conditionNotes: string | null;

  expiresAt: Date | null;
  convertedVehicleId: string | null;
}

export interface ConversionBlocker {
  code: string;
  message: string;
  /**
   * Overridable blockers cost money; non-overridable ones produce a wrong
   * record. Same shape as M3's go-live blockers, and for the same reason: the
   * dealer needs to see exactly what to fix, not a boolean.
   */
  overridable: boolean;
}

/**
 * What stands between this appraisal and a stock record.
 */
export function conversionBlockers(input: {
  appraisal: Appraisal;
  offer: Offer | null;
  settlement: SettlementPosition;
  asAt: Date;
}): ConversionBlocker[] {
  const { appraisal, offer, settlement, asAt } = input;
  const blockers: ConversionBlocker[] = [];

  if (appraisal.convertedVehicleId !== null || appraisal.state === 'converted') {
    blockers.push({
      code: 'already_converted',
      message: 'This appraisal has already become a stock record. Open the vehicle instead.',
      overridable: false,
    });
  }

  if (!offer || offer.acceptedAt === null) {
    blockers.push({
      code: 'no_accepted_offer',
      message: 'The customer has not accepted an offer, so there is no purchase price to record.',
      overridable: false,
    });
  } else if (offerExpired(offer, asAt)) {
    blockers.push({
      code: 'offer_expired',
      message:
        `The accepted offer lapsed on ${offer.expiresAt?.toISOString().slice(0, 10)}. ` +
        'Re-offer, or convert on the lapsed figure with a recorded reason.',
      overridable: true,
    });
  }

  if (!appraisal.registration.trim()) {
    blockers.push({
      code: 'no_registration',
      message: 'A registration is a mandatory VAT stock-book field.',
      overridable: false,
    });
  }

  if (appraisal.mileage === null) {
    blockers.push({
      code: 'no_mileage',
      message: 'Record the mileage. It is a stock-book field and it decides the price.',
      overridable: false,
    });
  }

  if (!appraisal.derivativeConfirmed) {
    blockers.push({
      code: 'derivative_unconfirmed',
      message:
        'The derivative has not been confirmed. Several trims share one DVLA record, and a ' +
        'guessed derivative is a wrong price and a mis-described vehicle. Pick from the list.',
      overridable: false,
    });
  }

  if (appraisal.sellerType === null) {
    blockers.push({
      code: 'no_seller_type',
      message:
        'Record who the car is being bought from. It decides the VAT scheme, and that cannot ' +
        'be worked out afterwards.',
      overridable: false,
    });
  } else {
    const vat = vatSchemeForSeller(appraisal.sellerType, appraisal.vatInvoiceReceived);
    if (vat.needsInput) {
      blockers.push({ code: 'vat_scheme_undecided', message: vat.reason, overridable: false });
    }
  }

  if (settlement.present && !settlement.verified) {
    blockers.push({
      code: 'settlement_unverified',
      message:
        `The outstanding finance with ${settlement.lenderName} has not been confirmed with the ` +
        'lender. Convert anyway only with a recorded reason — the shortfall is paid out of margin.',
      overridable: true,
    });
  }

  if (settlement.present && settlement.expired) {
    blockers.push({
      code: 'settlement_expired',
      message:
        `${settlement.lenderName}'s settlement quote has lapsed and interest has accrued since. ` +
        'Request a fresh figure.',
      overridable: true,
    });
  }

  return blockers;
}

export interface VehicleDraft {
  registration: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  derivative: string | null;
  bodyStyle: string | null;
  doors: number | null;
  transmission: string | null;
  fuelType: string | null;
  colour: string | null;
  engineCc: number | null;
  firstRegisteredOn: Date | null;
  mileage: number;
  motExpiresOn: Date | null;
  formerKeepers: number | null;
  serviceHistoryType: string | null;
  keyCount: number | null;
  v5cPresent: boolean;

  state: VehicleState;
  purchaseSource: 'part_exchange';
  /** The amount actually given in exchange — see the note on `convertToStock`. */
  purchasePrice: Money;
  purchaseDate: Date;
  vatScheme: VatScheme;

  sourceAppraisalId: string;
  /** Carried so the margin panel stays honest about what was really paid. */
  overAllowance: Money;
  notes: string | null;
  overriddenBlockers: readonly string[];
}

/**
 * Turn an accepted appraisal into a stock record, re-keying nothing.
 *
 * THE PURCHASE PRICE IS THE ALLOWANCE. Not the market value, not the ceiling,
 * not what the car is "really" worth. For a part-exchange the purchase price
 * is the amount allowed for the vehicle taken in exchange, and that is the
 * figure the VAT stock book carries and the margin is computed against when it
 * sells. An over-allowance is economically a discount on the sale car and is
 * carried across separately, visible, rather than re-basing the purchase price
 * to something more flattering.
 *
 * Arriving state is `purchased`, not `booked_in`: the deal may be agreed
 * weeks before the customer actually hands the keys over, and book-in is what
 * starts the prep clock.
 */
export function convertToStock(input: {
  appraisal: Appraisal;
  offer: Offer;
  settlement: SettlementPosition;
  asAt: Date;
  /** Blocker codes the dealer has explicitly overridden, each with a reason. */
  overrides?: Readonly<Record<string, string>>;
  arrivingState?: Extract<VehicleState, 'purchased' | 'in_transit' | 'booked_in'>;
}): VehicleDraft {
  const { appraisal, offer } = input;
  const overrides = input.overrides ?? {};

  const blockers = conversionBlockers({
    appraisal, offer, settlement: input.settlement, asAt: input.asAt,
  });

  const hard = blockers.filter((b) => !b.overridable);
  if (hard.length > 0) {
    throw new Error(
      `This appraisal cannot become a stock record yet:\n` +
        hard.map((b) => `  • ${b.message}`).join('\n'),
    );
  }

  const unresolved = blockers.filter((b) => b.overridable && !overrides[b.code]);
  if (unresolved.length > 0) {
    throw new Error(
      `Converting past these needs a recorded reason:\n` +
        unresolved.map((b) => `  • ${b.message}`).join('\n'),
    );
  }

  const vat = vatSchemeForSeller(appraisal.sellerType!, appraisal.vatInvoiceReceived);
  if (vat.scheme === null) {
    // Unreachable via the blockers above; kept so a future edit to
    // `conversionBlockers` cannot silently produce a scheme-less stock record.
    throw new Error(vat.reason);
  }

  return {
    registration: appraisal.registration.replace(/\s+/g, '').toUpperCase(),
    vin: appraisal.vin,
    make: appraisal.make,
    model: appraisal.model,
    derivative: appraisal.derivative,
    bodyStyle: appraisal.bodyStyle,
    doors: appraisal.doors,
    transmission: appraisal.transmission,
    fuelType: appraisal.fuelType,
    colour: appraisal.colour,
    engineCc: appraisal.engineCc,
    firstRegisteredOn: appraisal.firstRegisteredOn,
    mileage: appraisal.mileage!,
    motExpiresOn: appraisal.motExpiresOn,
    formerKeepers: appraisal.formerKeepers,
    serviceHistoryType: appraisal.serviceHistoryType,
    keyCount: appraisal.keyCount,
    v5cPresent: appraisal.v5cPresent ?? false,

    state: input.arrivingState ?? 'purchased',
    purchaseSource: 'part_exchange',
    purchasePrice: offer.breakdown.allowance,
    purchaseDate: offer.acceptedAt ?? offer.offeredAt,
    vatScheme: vat.scheme,

    sourceAppraisalId: appraisal.id,
    overAllowance: offer.breakdown.overAllowance,
    notes: appraisal.conditionNotes,
    overriddenBlockers: Object.keys(overrides),
  };
}

// ------------------------------------------------------- state machine

const TRANSITIONS: Record<AppraisalState, readonly AppraisalState[]> = {
  draft: ['appraised', 'abandoned'],
  appraised: ['offered', 'abandoned', 'expired'],
  offered: ['accepted', 'declined', 'expired', 'offered'],
  accepted: ['converted', 'declined', 'abandoned'],
  declined: ['offered'],
  expired: ['appraised', 'offered', 'abandoned'],
  converted: [],
  abandoned: [],
};

/**
 * Named for this module rather than `TransitionResult`, which `deals.ts` and
 * `vehicle-lifecycle.ts` both already export. A `export *` barrel silently
 * DROPS an ambiguous name rather than failing, so a third collision here would
 * have quietly removed the type from the package's public surface.
 */
export interface AppraisalTransitionResult {
  ok: boolean;
  state: AppraisalState;
  reason?: string;
}

/**
 * A declined appraisal can be re-offered — a customer who walked away over
 * £200 comes back on Saturday, and that is a normal part of the trade rather
 * than a new appraisal of the same car.
 */
export function changeState(
  from: AppraisalState,
  to: AppraisalState,
  context: { reason?: string } = {},
): AppraisalTransitionResult {
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      state: from,
      reason: `An appraisal cannot go from ${from} to ${to}.`,
    };
  }
  if ((to === 'declined' || to === 'abandoned') && !context.reason?.trim()) {
    return {
      ok: false,
      state: from,
      reason:
        `A ${to} appraisal needs a reason. Why the customer walked is how a dealer learns ` +
        'what their part-exchange values are costing them.',
    };
  }
  return { ok: true, state: to };
}

export const isTerminal = (state: AppraisalState): boolean => TRANSITIONS[state].length === 0;
