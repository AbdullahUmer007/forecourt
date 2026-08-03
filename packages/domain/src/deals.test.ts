import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  transition, acceptAddon, declineAddon, acceptedAddons, marginPanel,
  balanceToFinance, dealClocks, assessRejection, isLossMaking,
  type Deal, type DealAddon,
} from './deals.js';
import { money, zero } from './money.js';
import type { ConsumerRightsRule } from './clocks.js';

const RULE: ConsumerRightsRule = {
  rejectWindowDays: 30, repairResumeMinimumDays: 7,
  burdenOfProofMonths: 6, cancellationWindowDays: 14,
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/22',
};

const AUG = (d: number, h = 12): Date => new Date(Date.UTC(2026, 7, d, h));

const addon = (over: Partial<DealAddon> = {}): DealAddon => ({
  productCode: 'GAP', productName: 'GAP insurance',
  price: money(39_900n), cost: money(15_000n),
  demandsAndNeeds: null, fairValueReference: 'FV-2026-11',
  offeredAt: AUG(3, 10), acceptedAt: null, declinedAt: null,
  ...over,
});

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1', tenantId: 't1', contactId: 'p1', vehicleId: 'v1',
  state: 'building', contractFormation: null,
  vehiclePrice: money(1_200_000n),
  partExchange: zero(), partExchangeSettlement: zero(),
  deposit: zero(), financeAmount: zero(),
  addons: [],
  quotedAt: null, contractedAt: null, deliveredAt: null,
  cancelledAt: null, cancellationReason: null,
  ...over,
});

// --------------------------------------------------------- state machine
describe('the deal state machine', () => {
  it('walks the normal path', () => {
    let d = deal();
    for (const [to, at] of [['quoted', AUG(3)], ['agreed', AUG(4)]] as const) {
      const r = transition(d, to, at);
      expect(r.ok, `${to} should be allowed`).toBe(true);
      d = r.deal;
    }
  });

  it('REFUSES to contract without contract formation recorded', () => {
    // The field decides whether a 14-day cancellation right exists at all.
    const agreed = deal({ state: 'agreed' });
    const r = transition(agreed, 'contracted', AUG(5));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/where this contract was formed/);
    expect(r.error).toMatch(/14-day cancellation right/);
  });

  it('contracts once formation is recorded', () => {
    const agreed = deal({ state: 'agreed', contractFormation: 'on_premises' });
    const r = transition(agreed, 'contracted', AUG(5));
    expect(r.ok).toBe(true);
    expect(r.deal.contractedAt).toEqual(AUG(5));
  });

  it('keeps delivered NON-terminal, so a CRA rejection can unwind it', () => {
    // Modelling delivery as final would leave no lawful path to record a
    // rejection — the exact scenario the evidence ledger exists for.
    const delivered = deal({ state: 'delivered', contractFormation: 'distance', deliveredAt: AUG(6) });
    expect(transition(delivered, 'unwound', AUG(20), { cancellationReason: 'CRA s.22 rejection' }).ok)
      .toBe(true);
  });

  it('demands a reason for cancelling or unwinding', () => {
    expect(transition(deal(), 'cancelled', AUG(4)).ok).toBe(false);
    expect(transition(deal(), 'cancelled', AUG(4), { cancellationReason: 'Customer withdrew' }).ok)
      .toBe(true);
  });

  it('refuses a nonsensical jump', () => {
    expect(transition(deal(), 'delivered', AUG(4)).error).toMatch(/cannot move from building to delivered/);
  });

  it('blocks contracting when an accepted add-on has no demands and needs', () => {
    // PRIN 2A. Contracting is the last moment this can be caught.
    const bad = deal({
      state: 'agreed', contractFormation: 'on_premises',
      addons: [addon({ acceptedAt: AUG(3, 11), demandsAndNeeds: null })],
    });
    const r = transition(bad, 'contracted', AUG(5));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/GAP insurance/);
    expect(r.error).toMatch(/one covering the bundle is not enough/);
  });
});

// ---------------------------------------------------------------- add-ons
describe('add-ons are never pre-ticked', () => {
  it('refuses an acceptance dated before the offer', () => {
    // This is what a pre-ticked box looks like once it reaches the data.
    const r = acceptAddon(addon({ offeredAt: AUG(3, 10) }), AUG(3, 9), 'Wanted cover');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/before it was offered/);
  });

  it('refuses an acceptance with no demands and needs statement', () => {
    const r = acceptAddon(addon(), AUG(3, 11), '   ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/demands and needs/);
    expect(r.error).toMatch(/GAP insurance/);
  });

  it('accepts a properly offered and justified add-on', () => {
    const r = acceptAddon(addon(), AUG(3, 11), 'Customer has a high-value car on finance');
    expect(r.ok).toBe(true);
    expect(r.addon?.acceptedAt).toEqual(AUG(3, 11));
  });

  it('will not re-accept something already declined', () => {
    const r = acceptAddon(addon({ declinedAt: AUG(3, 11) }), AUG(3, 12), 'Changed mind');
    expect(r.ok).toBe(false);
  });

  it('counts only accepted add-ons', () => {
    const d = deal({
      addons: [
        addon({ productCode: 'GAP', acceptedAt: AUG(3, 11), demandsAndNeeds: 'x' }),
        declineAddon(addon({ productCode: 'PAINT' }), AUG(3, 11)),
        addon({ productCode: 'TYRE' }),
      ],
    });
    expect(acceptedAddons(d)).toHaveLength(1);
  });
});

// ----------------------------------------------------------- margin panel
describe('the margin panel', () => {
  const panel = () => marginPanel({
    deal: deal({
      addons: [addon({ acceptedAt: AUG(3, 11), demandsAndNeeds: 'x' })],
    }),
    vehicleCost: money(1_000_000n),
    financeCommission: money(45_000n),
  });

  it('splits vehicle, add-on and commission gross', () => {
    const p = panel();
    expect(p.vehicleGross.amount).toBe(200_000n);      // 12,000 − 10,000
    expect(p.addonGross.amount).toBe(24_900n);         // 399 − 150
    expect(p.financeCommission.amount).toBe(45_000n);
    expect(p.dealGross.amount).toBe(269_900n);
  });

  it('flags a projected part-exchange margin rather than banking it', () => {
    // Presenting a forecast as realised profit is how a dealer ends up
    // believing a month was better than it was.
    const p = marginPanel({
      deal: deal(), vehicleCost: money(1_000_000n),
      partExchangeProjectedMargin: money(80_000n),
    });
    expect(p.containsProjection).toBe(true);
    expect(p.dealGross.amount).toBe(280_000n);
    expect(marginPanel({ deal: deal(), vehicleCost: money(1_000_000n) }).containsProjection)
      .toBe(false);
  });

  it('reports a loss-making deal as one', () => {
    const p = marginPanel({ deal: deal(), vehicleCost: money(1_300_000n) });
    expect(isLossMaking(p)).toBe(true);
  });
});

describe('the balance the customer has to find', () => {
  it('deducts part-exchange, deposit and finance', () => {
    const d = deal({
      partExchange: money(300_000n), deposit: money(100_000n), financeAmount: money(700_000n),
    });
    expect(balanceToFinance(d).amount).toBe(100_000n);
  });

  it('ADDS outstanding settlement rather than netting it off', () => {
    // Money still owed on the trade-in has to reach their lender. Netting it
    // silently understates what the customer owes by exactly that figure.
    const d = deal({ partExchange: money(300_000n), partExchangeSettlement: money(500_000n) });
    expect(balanceToFinance(d).amount).toBe(1_400_000n);   // 12,000 + 5,000 − 3,000
  });

  it('includes accepted add-ons', () => {
    const d = deal({ addons: [addon({ acceptedAt: AUG(3, 11), demandsAndNeeds: 'x' })] });
    expect(balanceToFinance(d).amount).toBe(1_239_900n);
  });
});

// ---------------------------------------------------------------- clocks
describe('the statutory clocks a delivered deal runs', () => {
  const delivered = (formation: Deal['contractFormation']) =>
    deal({ state: 'delivered', contractFormation: formation, deliveredAt: AUG(1) });

  it('gives a distance sale a 14-day cancellation right', () => {
    const c = dealClocks(delivered('distance'), [], RULE)!;
    expect(c.cancellationRightApplies).toBe(true);
    expect(c.summary).toMatch(/14-day cancellation right/);
  });

  it('gives an ON-PREMISES sale no cancellation right, and says so', () => {
    // An online enquiry that ends with a showroom signature is on-premises.
    const c = dealClocks(delivered('on_premises'), [], RULE)!;
    expect(c.cancellationRightApplies).toBe(false);
    expect(c.summary).toMatch(/No cancellation right/);
  });

  it('returns nothing before delivery', () => {
    expect(dealClocks(deal({ contractFormation: 'distance' }), [], RULE)).toBeNull();
  });

  it('pauses the reject window while a repair is open', () => {
    const c = dealClocks(delivered('on_premises'), [{ startedAt: AUG(10), completedAt: null }], RULE)!;
    expect(c.rejectWindowPaused).toBe(true);
    expect(c.summary).toMatch(/paused while a repair is open/);
  });
});

describe('assessing a rejection', () => {
  const delivered = deal({ state: 'delivered', contractFormation: 'on_premises', deliveredAt: AUG(1) });

  it('allows one inside the 30 days', () => {
    const c = dealClocks(delivered, [], RULE);
    expect(assessRejection(c, AUG(20)).withinWindow).toBe(true);
  });

  it('refuses one outside it, but explains what rights remain', () => {
    // A refusal a dealer cannot explain becomes a complaint.
    const c = dealClocks(delivered, [], RULE);
    const r = assessRejection(c, new Date(Date.UTC(2026, 9, 1)));
    expect(r.withinWindow).toBe(false);
    expect(r.reason).toMatch(/repair or replacement/);
    expect(r.reason).toMatch(/six-month reversed burden of proof/);
  });

  it('holds the window open while a repair is running', () => {
    const c = dealClocks(delivered, [{ startedAt: AUG(10), completedAt: null }], RULE);
    expect(assessRejection(c, new Date(Date.UTC(2026, 11, 1))).withinWindow).toBe(true);
  });
});

// ------------------------------------------------------------ properties
describe('deal money properties', () => {
  it('deal gross is always the sum of its parts', () => {
    fc.assert(fc.property(
      fc.bigInt(0n, 5_000_000n), fc.bigInt(0n, 5_000_000n), fc.bigInt(0n, 200_000n),
      (price, cost, commission) => {
        const p = marginPanel({
          deal: deal({ vehiclePrice: money(price) }),
          vehicleCost: money(cost),
          financeCommission: money(commission),
        });
        expect(p.dealGross.amount).toBe(
          p.vehicleGross.amount + p.addonGross.amount +
          p.financeCommission.amount + p.partExchangeProjected.amount);
      },
    ), { numRuns: 400 });
  });

  it('a settlement never reduces what the customer owes', () => {
    fc.assert(fc.property(
      fc.bigInt(0n, 2_000_000n),
      (settlement) => {
        const without = balanceToFinance(deal());
        const with_ = balanceToFinance(deal({ partExchangeSettlement: money(settlement) }));
        expect(with_.amount >= without.amount).toBe(true);
      },
    ), { numRuns: 300 });
  });

  it('contracting is impossible without contract formation, for every state', () => {
    fc.assert(fc.property(
      fc.constantFrom<Deal['state']>('building', 'quoted', 'agreed'),
      (state) => {
        expect(transition(deal({ state }), 'contracted', AUG(5)).ok).toBe(false);
      },
    ), { numRuns: 30 });
  });
});
