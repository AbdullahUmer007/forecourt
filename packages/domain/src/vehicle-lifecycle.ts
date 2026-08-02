/**
 * M3 — the vehicle lifecycle.
 *
 * The state machine is the spine of the product. Everything else — pricing,
 * publishing, invoicing, the VAT stock book — hangs off which state a vehicle
 * is in and how long it has been there.
 *
 *   Sourcing → Purchased → In transit → Booked in → In prep → Ready
 *      → Live → Reserved → Sold → Delivered
 *
 * Side states: On hold · Returned (CRA rejection) · Trade disposal ·
 *              Written off · Archived
 *
 * Two rules matter more than the rest:
 *
 *  1. **A vehicle cannot go Live without the go-live requirements.** Mandatory
 *     VAT stock-book fields, at least one published photograph, a retail price,
 *     a VAT scheme, and a completed provenance check. This is not a UI
 *     convenience — it is what stops a dealer advertising a car they cannot
 *     lawfully invoice or evidence.
 *
 *  2. **Every transition is timestamped and attributed.** The durations between
 *     states are the most commercially valuable data in the system: days in
 *     prep, days to live, days to sell.
 */

export const VEHICLE_STATES = [
  'sourcing', 'purchased', 'in_transit', 'booked_in', 'in_prep', 'ready',
  'live', 'reserved', 'sold', 'delivered',
  'on_hold', 'returned', 'trade_disposal', 'written_off', 'archived',
] as const;

export type VehicleState = (typeof VEHICLE_STATES)[number];

/** States in which the vehicle is publicly advertisable. */
export const PUBLISHABLE_STATES: ReadonlySet<VehicleState> = new Set(['live', 'reserved']);

/** States in which the vehicle still represents capital on the forecourt. */
export const IN_STOCK_STATES: ReadonlySet<VehicleState> = new Set([
  'purchased', 'in_transit', 'booked_in', 'in_prep', 'ready', 'live', 'reserved', 'on_hold',
]);

/**
 * Terminal states — no onward transition except archiving.
 *
 * `delivered` is deliberately NOT terminal. A customer has a 30-day short-term
 * right to reject under CRA s.22, so a delivered vehicle can come back. Treating
 * delivery as the end of the line would leave no lawful path to record a
 * rejection, which is the exact scenario the Deal Evidence Ledger exists for.
 */
export const TERMINAL_STATES: ReadonlySet<VehicleState> = new Set([
  'trade_disposal', 'written_off', 'archived',
]);

const TRANSITIONS: Record<VehicleState, readonly VehicleState[]> = {
  sourcing:       ['purchased', 'archived'],
  purchased:      ['in_transit', 'booked_in', 'trade_disposal', 'written_off', 'archived'],
  in_transit:     ['booked_in', 'written_off', 'archived'],
  booked_in:      ['in_prep', 'ready', 'on_hold', 'trade_disposal', 'written_off'],
  in_prep:        ['ready', 'on_hold', 'trade_disposal', 'written_off'],
  ready:          ['live', 'in_prep', 'on_hold', 'trade_disposal', 'reserved', 'sold'],
  live:           ['reserved', 'sold', 'in_prep', 'on_hold', 'ready', 'trade_disposal'],
  reserved:       ['sold', 'live', 'on_hold'],
  sold:           ['delivered', 'live', 'returned'],       // a fallen-through deal goes back to Live
  delivered:      ['returned', 'archived'],
  on_hold:        ['booked_in', 'in_prep', 'ready', 'live', 'trade_disposal', 'written_off'],
  returned:       ['in_prep', 'ready', 'trade_disposal', 'written_off'],
  trade_disposal: ['archived'],
  written_off:    ['archived'],
  archived:       [],
};

export const allowedTransitions = (from: VehicleState): readonly VehicleState[] => TRANSITIONS[from];
export const canTransition = (from: VehicleState, to: VehicleState): boolean =>
  TRANSITIONS[from].includes(to);

// ---------------------------------------------------------------- go-live

/**
 * What the system knows about a vehicle when someone tries to change its state.
 * Deliberately a flat snapshot: the state machine must be pure and testable
 * without touching a database.
 */
export interface VehicleSnapshot {
  state: VehicleState;
  registration: string | null;
  vatScheme: 'margin' | 'qualifying' | 'non_qualifying' | null;
  retailPricePence: bigint | null;
  publishedPhotoCount: number;
  provenanceCheckedAt: Date | null;
  provenanceAdverse: boolean;
  provenanceAcknowledgedBy: string | null;
  missingStockBookFields: readonly string[];
  hasDeposit: boolean;
  hasLinkedDeal: boolean;
  handoverChecklistComplete: boolean;
  dvlaNotified: boolean;
  mileage: number | null;
  highestMotMileage: number | null;
  mileageAnomalyAcknowledgedBy: string | null;
}

export interface Blocker {
  code: string;
  message: string;
  /** Can a manager override this with a recorded reason? */
  overridable: boolean;
}

/**
 * Everything standing between this vehicle and being advertised.
 *
 * Returned as a list rather than a boolean so the UI can show the dealer
 * exactly what to fix — "3 things before this can go live" beats a disabled
 * button with no explanation.
 */
export function goLiveBlockers(v: VehicleSnapshot): Blocker[] {
  const blockers: Blocker[] = [];

  if (!v.registration) {
    blockers.push({ code: 'no_registration', message: 'No registration recorded', overridable: false });
  }
  if (!v.vatScheme) {
    blockers.push({
      code: 'no_vat_scheme',
      message: 'VAT scheme not set — this must be decided at book-in and cannot be changed once invoiced',
      overridable: false,
    });
  }
  if (v.retailPricePence === null || v.retailPricePence <= 0n) {
    blockers.push({ code: 'no_price', message: 'No retail price set', overridable: false });
  }
  if (v.publishedPhotoCount < 1) {
    blockers.push({ code: 'no_photos', message: 'No published photographs', overridable: false });
  }
  if (v.missingStockBookFields.length > 0) {
    blockers.push({
      code: 'stock_book_incomplete',
      message: `VAT stock book incomplete — missing: ${v.missingStockBookFields.join(', ')}`,
      overridable: false,
    });
  }
  if (!v.provenanceCheckedAt) {
    blockers.push({
      code: 'no_provenance_check',
      message: 'No provenance check on file',
      overridable: true, // a tenant may disable the requirement in settings
    });
  }
  if (v.provenanceAdverse && !v.provenanceAcknowledgedBy) {
    blockers.push({
      code: 'provenance_adverse',
      message: 'Provenance check returned an adverse marker — a manager must acknowledge it with a reason',
      overridable: false, // requires acknowledgement, not override
    });
  }
  if (hasMileageAnomaly(v) && !v.mileageAnomalyAcknowledgedBy) {
    blockers.push({
      code: 'mileage_anomaly',
      message: `Recorded mileage (${v.mileage}) is below the highest MOT reading (${v.highestMotMileage}) — acknowledge before advertising`,
      overridable: false,
    });
  }

  return blockers;
}

export const canGoLive = (v: VehicleSnapshot): boolean => goLiveBlockers(v).length === 0;

/** Mileage below the highest recorded MOT reading is a fraud and CRA risk. */
export const hasMileageAnomaly = (v: VehicleSnapshot): boolean =>
  v.mileage !== null && v.highestMotMileage !== null && v.mileage < v.highestMotMileage;

// ---------------------------------------------------------------- validation

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: string; message: string; blockers?: Blocker[] };

export interface TransitionOptions {
  /** A manager overriding an overridable blocker must give a reason. */
  overrideReason?: string;
  overriddenBy?: string;
}

export function validateTransition(
  v: VehicleSnapshot,
  to: VehicleState,
  options: TransitionOptions = {},
): TransitionResult {
  if (v.state === to) {
    return { ok: false, code: 'no_change', message: `Vehicle is already ${to}` };
  }
  if (!canTransition(v.state, to)) {
    return {
      ok: false,
      code: 'invalid_transition',
      message: `Cannot move from ${v.state} to ${to}. Allowed: ${allowedTransitions(v.state).join(', ') || 'none'}`,
    };
  }

  if (to === 'live') {
    const blockers = goLiveBlockers(v);
    const blocking = options.overrideReason
      ? blockers.filter((b) => !b.overridable)
      : blockers;
    if (blocking.length > 0) {
      return {
        ok: false,
        code: 'go_live_blocked',
        message: `${blocking.length} issue${blocking.length === 1 ? '' : 's'} before this can go live`,
        blockers: blocking,
      };
    }
    if (options.overrideReason && !options.overriddenBy) {
      return { ok: false, code: 'override_unattributed', message: 'An override must record who authorised it' };
    }
  }

  if (to === 'reserved' && !v.hasDeposit && !options.overrideReason) {
    return {
      ok: false,
      code: 'no_deposit',
      message: 'Reserving requires a deposit, or a manager override with a reason',
    };
  }

  if (to === 'sold' && !v.hasLinkedDeal) {
    return { ok: false, code: 'no_deal', message: 'A vehicle cannot be marked sold without a linked deal' };
  }

  if (to === 'delivered') {
    if (!v.handoverChecklistComplete) {
      return { ok: false, code: 'handover_incomplete', message: 'The handover checklist is not complete' };
    }
    if (!v.dvlaNotified) {
      return {
        ok: false,
        code: 'dvla_not_notified',
        message: 'DVLA has not been notified of the keeper change, and the V5C/2 handover is unrecorded',
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------- metrics

export interface StateEvent {
  toState: VehicleState;
  occurredAt: Date;
}

const DAY_MS = 86_400_000;
const wholeDays = (from: Date, to: Date): number => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
const firstEntry = (history: readonly StateEvent[], state: VehicleState): Date | null =>
  history.find((e) => e.toState === state)?.occurredAt ?? null;

/**
 * The numbers the dealer actually cares about.
 *
 * `daysToSell` is measured from going LIVE, not from purchase — a car cannot
 * sell before it is advertised, and blaming the sales team for time the car
 * spent in the workshop is how you get a dealer to stop trusting the dashboard.
 * Time before Live is `daysToLive`, which is the prep team's number.
 */
export interface VehicleDaysMetrics {
  daysInStock: number | null;
  daysInPrep: number | null;
  daysToLive: number | null;
  daysToSell: number | null;
  daysSincePriceChange: number | null;
  ageBand: '0-30' | '31-60' | '61-90' | '90+' | null;
  isOverage: boolean;
}

export function calculateDaysMetrics(
  history: readonly StateEvent[],
  now: Date,
  lastPriceChangeAt?: Date | null,
  overageThresholdDays = 90,
): VehicleDaysMetrics {
  const bookedIn = firstEntry(history, 'booked_in') ?? firstEntry(history, 'purchased');
  const inPrep = firstEntry(history, 'in_prep');
  const ready = firstEntry(history, 'ready');
  const live = firstEntry(history, 'live');
  const sold = firstEntry(history, 'sold');

  const stockEnd = sold ?? now;
  const daysInStock = bookedIn ? wholeDays(bookedIn, stockEnd) : null;

  const ageBand: VehicleDaysMetrics['ageBand'] =
    daysInStock === null ? null
    : daysInStock <= 30 ? '0-30'
    : daysInStock <= 60 ? '31-60'
    : daysInStock <= 90 ? '61-90'
    : '90+';

  return {
    daysInStock,
    daysInPrep: inPrep ? wholeDays(inPrep, ready ?? now) : null,
    daysToLive: bookedIn && live ? wholeDays(bookedIn, live) : null,
    daysToSell: live ? wholeDays(live, sold ?? now) : null,
    daysSincePriceChange: lastPriceChangeAt ? wholeDays(lastPriceChangeAt, now) : null,
    ageBand,
    isOverage: daysInStock !== null && daysInStock > overageThresholdDays,
  };
}

// ---------------------------------------------------------------- stock number

/**
 * Stock numbers are per tenant and gapless within a site prefix. They appear on
 * the VAT stock book, so they must be sequential and must never be reused.
 */
export const formatStockNumber = (prefix: string | null, sequence: number, pad = 4): string =>
  `${prefix ? `${prefix}-` : ''}${String(sequence).padStart(pad, '0')}`;

// ---------------------------------------------------------------- advert strength

export interface AdvertStrengthInput {
  publishedPhotoCount: number;
  descriptionLength: number;
  featureCount: number;
  hasVideo: boolean;
  hasSpin: boolean;
  pricePositionPct: number | null;   // our price ÷ market retail × 100
  hasMotHistory: boolean;
  hasProvenanceBadge: boolean;
}

/**
 * A 0–100 score with specific, actionable suggestions.
 *
 * Weighted toward photographs and price position because those are what
 * actually move click-through on a marketplace listing.
 */
export function advertStrength(a: AdvertStrengthInput): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  let score = 0;

  // Photographs — 35
  const photoScore = Math.min(35, Math.round((a.publishedPhotoCount / 12) * 35));
  score += photoScore;
  if (a.publishedPhotoCount < 8) {
    suggestions.push(`Add more photographs — ${a.publishedPhotoCount} of a recommended 12`);
  }

  // Description — 15
  if (a.descriptionLength >= 400) score += 15;
  else if (a.descriptionLength >= 150) { score += 8; suggestions.push('Lengthen the description — aim for 400+ characters'); }
  else suggestions.push('Write a description — this advert has almost none');

  // Features — 10
  if (a.featureCount >= 10) score += 10;
  else { score += Math.round(a.featureCount); suggestions.push('List more equipment and options'); }

  // Price position — 20
  if (a.pricePositionPct === null) {
    suggestions.push('No market valuation — price position is unknown');
  } else if (a.pricePositionPct <= 103) {
    score += 20;
  } else if (a.pricePositionPct <= 108) {
    score += 10;
    suggestions.push(`Priced ${a.pricePositionPct}% of market — consider a reduction`);
  } else {
    suggestions.push(`Priced ${a.pricePositionPct}% of market — significantly above, expect a slow sale`);
  }

  // Trust content — 20 (free data most dealers never show)
  if (a.hasMotHistory) score += 7; else suggestions.push('Show the MOT history — it is free public data and reassures buyers');
  if (a.hasProvenanceBadge) score += 7; else suggestions.push('Show the provenance check you already paid for');
  if (a.hasVideo || a.hasSpin) score += 6; else suggestions.push('Add a video walkaround — the cheapest conversion win available');

  return { score: Math.max(0, Math.min(100, score)), suggestions };
}
