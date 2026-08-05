/**
 * M12 — the deal: state machine, margin panel, add-ons and the statutory
 * clocks it starts.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED FCA COMPLIANCE CONSULTANT'S SIGN-OFF.
 *
 * Two things here are load-bearing:
 *
 *   1. CONTRACT FORMATION is mandatory before a deal can be contracted, and it
 *      decides whether a 14-day cancellation right exists at all. An online
 *      enquiry that ends with a signature in the showroom is an ON-PREMISES
 *      sale with NO cancellation right — and a distance sale treated as
 *      on-premises denies a customer a right they have. Both directions are
 *      expensive, so it cannot be defaulted or inferred.
 *
 *   2. ADD-ONS are never pre-ticked. `offered` and `accepted` are separate
 *      timestamps, each add-on carries its own demands-and-needs statement,
 *      and an acceptance that precedes its offer is refused — because that is
 *      exactly what a pre-ticked box looks like once it reaches the data.
 */

import {
  type Money, add, subtract, sum, zero, isNegative, format,
} from './money.js';
import {
  calculateClocks, type ContractFormation, type ConsumerRightsRule,
  type RepairAttempt, type ConsumerRightsClocks,
} from './clocks.js';

export type DealState =
  | 'building' | 'quoted' | 'agreed' | 'contracted'
  | 'delivered' | 'completed' | 'cancelled' | 'unwound';

export interface DealAddon {
  productCode: string;
  productName: string;
  price: Money;
  cost: Money | null;
  demandsAndNeeds: string | null;
  fairValueReference: string | null;
  offeredAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
}

export interface Deal {
  id: string;
  tenantId: string;
  contactId: string;
  vehicleId: string | null;
  state: DealState;
  contractFormation: ContractFormation | null;

  vehiclePrice: Money | null;
  partExchange: Money;
  partExchangeSettlement: Money;
  deposit: Money;
  financeAmount: Money;
  addons: readonly DealAddon[];

  quotedAt: Date | null;
  contractedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

// --------------------------------------------------------- state machine

const TRANSITIONS: Record<DealState, readonly DealState[]> = {
  building: ['quoted', 'agreed', 'cancelled'],
  quoted: ['building', 'agreed', 'cancelled'],
  agreed: ['quoted', 'contracted', 'cancelled'],
  contracted: ['delivered', 'cancelled', 'unwound'],
  // Delivered is NOT terminal: a CRA s.22 rejection must be able to return it,
  // and modelling delivery as final would leave no lawful path to record one.
  delivered: ['completed', 'unwound'],
  completed: ['unwound'],
  cancelled: [],
  unwound: [],
};

/**
 * Which states a deal may move to from where it is.
 *
 * Exported so a screen can offer exactly the moves that will be allowed rather
 * than offering all eight and refusing six of them after the click. The table
 * itself stays private: it is the single source, and a caller that could read
 * it directly could also be tempted to reason about it.
 */
export function allowedDealTransitions(from: DealState): readonly DealState[] {
  return TRANSITIONS[from];
}

export interface DealTransitionResult {
  ok: boolean;
  deal: Deal;
  error: string | null;
}

/**
 * Move a deal to a new state.
 *
 * The gate that matters is `contracted`: it requires contract formation to be
 * recorded, because that single field decides whether the customer has a
 * 14-day cancellation right. Defaulting it either way is wrong — assume
 * on-premises and you deny a right; assume distance and you grant a
 * cancellation window on a showroom sale and unwind deals that were final.
 */
export function transition(
  deal: Deal,
  to: DealState,
  at: Date,
  opts: { cancellationReason?: string } = {},
): DealTransitionResult {
  if (to === deal.state) return { ok: true, deal, error: null };

  if (!TRANSITIONS[deal.state].includes(to)) {
    return {
      ok: false, deal,
      error: `A deal cannot move from ${deal.state} to ${to}.`,
    };
  }

  if (to === 'contracted' && deal.contractFormation === null) {
    return {
      ok: false, deal,
      error:
        'Record where this contract was formed before contracting it — on the forecourt, ' +
        'at a distance, or off-premises. It decides whether the customer has a 14-day ' +
        'cancellation right, and it cannot be worked out afterwards.',
    };
  }

  if ((to === 'cancelled' || to === 'unwound') && !opts.cancellationReason) {
    return { ok: false, deal, error: `Give a reason for marking this deal ${to}.` };
  }

  // An accepted add-on without its own demands-and-needs statement is a
  // PRIN 2A problem, and contracting is the last moment it can be caught.
  if (to === 'contracted') {
    const bad = deal.addons.filter((a) => a.acceptedAt !== null && !a.demandsAndNeeds);
    if (bad.length > 0) {
      return {
        ok: false, deal,
        error:
          `Add a demands and needs statement for ${bad.map((a) => a.productName).join(', ')}. ` +
          `Each add-on needs its own — one covering the bundle is not enough.`,
      };
    }
  }

  return {
    ok: true, error: null,
    deal: {
      ...deal,
      state: to,
      quotedAt: to === 'quoted' ? at : deal.quotedAt,
      contractedAt: to === 'contracted' ? at : deal.contractedAt,
      deliveredAt: to === 'delivered' ? at : deal.deliveredAt,
      cancelledAt: to === 'cancelled' || to === 'unwound' ? at : deal.cancelledAt,
      cancellationReason: opts.cancellationReason ?? deal.cancellationReason,
    },
  };
}

// ---------------------------------------------------------- add-ons

export interface AddonResult {
  ok: boolean;
  addon: DealAddon | null;
  error: string | null;
}

/**
 * Accept an add-on.
 *
 * Refuses an acceptance dated before the offer, and refuses one with no
 * demands-and-needs statement. Both are the data shape of a pre-ticked box —
 * a product the customer never actively chose — which PRIN 2A treats as a
 * fair-value failure and which is exactly what "the box was already ticked"
 * looks like in a database.
 */
export function acceptAddon(
  addon: DealAddon,
  at: Date,
  demandsAndNeeds: string,
): AddonResult {
  if (addon.declinedAt !== null) {
    return { ok: false, addon: null, error: 'This add-on was declined. Offer it again to change that.' };
  }
  if (at < addon.offeredAt) {
    return {
      ok: false, addon: null,
      error: 'An add-on cannot be accepted before it was offered.',
    };
  }
  if (!demandsAndNeeds.trim()) {
    return {
      ok: false, addon: null,
      error: `Record why ${addon.productName} meets this customer's demands and needs. Each product needs its own statement.`,
    };
  }
  return { ok: true, error: null, addon: { ...addon, acceptedAt: at, demandsAndNeeds } };
}

export const declineAddon = (addon: DealAddon, at: Date): DealAddon =>
  ({ ...addon, declinedAt: at, acceptedAt: null });

/** Only accepted add-ons count towards anything. */
export const acceptedAddons = (deal: Deal): readonly DealAddon[] =>
  deal.addons.filter((a) => a.acceptedAt !== null);

// ------------------------------------------------------- the margin panel

export interface MarginPanel {
  /** What the customer pays for the car itself. */
  vehiclePrice: Money;
  addonsTotal: Money;
  /** Cash price of everything, before the part-exchange comes off. */
  totalPrice: Money;

  /** Everything the vehicle cost us — purchase, prep, transport, funding. */
  vehicleCost: Money;
  vehicleGross: Money;
  addonGross: Money;
  financeCommission: Money;
  /** Shown as PROJECTED until the part-exchange itself actually sells. */
  partExchangeProjected: Money;

  dealGross: Money;
  /** True when any component is a projection rather than a realised figure. */
  containsProjection: boolean;
}

/**
 * The live margin panel.
 *
 * Every figure is computed here, server-side, from integer minor units. The
 * browser never derives a margin: it would drift from the server value, and a
 * dealer who spots that stops trusting the whole dashboard.
 *
 * The part-exchange contribution is deliberately kept SEPARATE and flagged as
 * a projection. Its real margin is not known until that vehicle sells, and
 * presenting a forecast as realised profit is how a dealer ends up believing
 * a month was better than it was.
 */
export function marginPanel(input: {
  deal: Deal;
  vehicleCost: Money;
  financeCommission?: Money;
  partExchangeProjectedMargin?: Money;
}): MarginPanel {
  const currency = input.vehicleCost.currency;
  const vehiclePrice = input.deal.vehiclePrice ?? zero(currency);

  const accepted = acceptedAddons(input.deal);
  const addonsTotal = sum(accepted.map((a) => a.price), currency);
  const addonCost = sum(
    accepted.map((a) => a.cost ?? zero(currency)), currency);

  const vehicleGross = subtract(vehiclePrice, input.vehicleCost);
  const addonGross = subtract(addonsTotal, addonCost);
  const financeCommission = input.financeCommission ?? zero(currency);
  const partExchangeProjected = input.partExchangeProjectedMargin ?? zero(currency);

  return {
    vehiclePrice,
    addonsTotal,
    totalPrice: add(vehiclePrice, addonsTotal),
    vehicleCost: input.vehicleCost,
    vehicleGross,
    addonGross,
    financeCommission,
    partExchangeProjected,
    dealGross: sum([vehicleGross, addonGross, financeCommission, partExchangeProjected], currency),
    containsProjection: partExchangeProjected.amount !== 0n,
  };
}

/**
 * What the customer actually has to find, after everything comes off.
 *
 * Part-exchange settlement ADDS to the balance rather than reducing it: money
 * still owed on the car they are trading in has to be paid to their lender,
 * and a system that nets it off silently understates what the customer owes by
 * exactly the settlement figure.
 */
export function balanceToFinance(deal: Deal): Money {
  const currency = deal.deposit.currency;
  const vehiclePrice = deal.vehiclePrice ?? zero(currency);
  const addonsTotal = sum(acceptedAddons(deal).map((a) => a.price), currency);

  const gross = add(add(vehiclePrice, addonsTotal), deal.partExchangeSettlement);
  const paid = add(add(deal.partExchange, deal.deposit), deal.financeAmount);
  return subtract(gross, paid);
}

// -------------------------------------------------------------- clocks

export interface DealClocks extends ConsumerRightsClocks {
  /** Plain English for the deal screen — a date alone is not an instruction. */
  summary: string;
}

/**
 * The statutory clocks a delivered deal is running.
 *
 * The maths lives in `clocks.ts` (M1) — this adds the deal context and the
 * wording. Recomputed on read rather than stored: a repair attempt logged
 * today moves a deadline set weeks ago, and a stored date would silently be
 * wrong from the moment the repair opened.
 */
export function dealClocks(
  deal: Deal,
  repairAttempts: readonly RepairAttempt[],
  rule: ConsumerRightsRule,
  tzOffsetMinutes = 0,
): DealClocks | null {
  if (deal.deliveredAt === null || deal.contractFormation === null) return null;

  const clocks = calculateClocks({
    deliveredAt: deal.deliveredAt,
    contractFormation: deal.contractFormation,
    repairAttempts,
    rule,
    tzOffsetMinutes,
  });

  const parts: string[] = [];
  if (clocks.rejectWindowPaused) {
    parts.push('The 30-day right to reject is paused while a repair is open');
  } else if (clocks.rejectWindowEndsAt) {
    parts.push(`Short-term right to reject until ${clocks.rejectWindowEndsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  }
  if (clocks.cancellationRightApplies && clocks.cancellationDeadline) {
    parts.push(`14-day cancellation right until ${clocks.cancellationDeadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  } else {
    parts.push('No cancellation right — the contract was formed on the forecourt');
  }

  return { ...clocks, summary: parts.join(' · ') };
}

/**
 * Whether a customer's rejection is inside the short-term window.
 *
 * Returns a reason either way. A refusal a dealer cannot explain to a customer
 * standing in front of them is a refusal that turns into a complaint.
 */
export function assessRejection(
  clocks: DealClocks | null,
  requestedAt: Date,
): { withinWindow: boolean; reason: string } {
  if (!clocks) {
    return { withinWindow: false, reason: 'This deal has not been delivered, so no rejection window has started.' };
  }
  if (clocks.rejectWindowPaused) {
    return {
      withinWindow: true,
      reason: 'A repair is open, so the 30-day clock is paused and the right to reject still stands.',
    };
  }
  if (clocks.rejectWindowEndsAt && requestedAt <= clocks.rejectWindowEndsAt) {
    return { withinWindow: true, reason: 'Inside the 30-day short-term right to reject.' };
  }
  return {
    withinWindow: false,
    reason:
      'Outside the 30-day short-term right to reject. The customer may still have a right to ' +
      'repair or replacement, and the six-month reversed burden of proof may still apply.',
  };
}

export const describeMargin = (p: MarginPanel): string =>
  `${format(p.dealGross)} total gross${p.containsProjection ? ' (includes a projected part-exchange margin)' : ''}`;

export const isLossMaking = (p: MarginPanel): boolean => isNegative(p.dealGross);
