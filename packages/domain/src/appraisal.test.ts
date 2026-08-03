import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  panelGroupFor, KNOWN_PANELS, assessTyres, LEGAL_TREAD_TENTHS_MM,
  resolveStandard, estimateRecon, MIN_OBSERVED_SAMPLE,
  valuationPanel, VALUATION_MILEAGE_TOLERANCE,
  calculateOffer, withManualAllowance, customerFacingOffer, currentOffer,
  offerExpired, nextRevision,
  settlementPosition, equityPosition, partExchangeForDeal,
  vatSchemeForSeller, conversionBlockers, convertToStock,
  changeState, isTerminal,
  type DamageMark, type ReconStandard, type Valuation, type Offer,
  type Settlement, type Appraisal,
} from './appraisal.js';
import { money, zero, add, subtract } from './money.js';
import { balanceToFinance, type Deal } from './deals.js';

const AUG = (d: number, h = 12): Date => new Date(Date.UTC(2026, 7, d, h));

/**
 * What an API boundary would actually put on the wire. Money holds a bigint,
 * which plain `JSON.stringify` refuses outright — which is why `money.ts` ships
 * `serialise`, and why a payload assertion has to go through the same door a
 * real response does rather than inventing its own.
 */
const payload = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

// ------------------------------------------------------------- fixtures

const mark = (over: Partial<DamageMark> = {}): DamageMark => ({
  id: 'mark-1', panel: 'nsf_door', panelGroup: 'body_panel',
  damageType: 'dent', severity: 'moderate',
  sizeMm: 40, notes: null, photoKey: null,
  ...over,
});

const standard = (over: Partial<ReconStandard> = {}): ReconStandard => ({
  id: 'std-1', damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
  cost: money(12_000n), source: 'tenant_default', sampleSize: null,
  effectiveFrom: AUG(1), effectiveTo: null,
  ...over,
});

const valuation = (over: Partial<Valuation> = {}): Valuation => ({
  id: 'val-1', source: 'cap_hpi',
  trade: money(450_000n), retail: money(590_000n), private: money(520_000n),
  valuedAtMileage: 42_000, forecastDaysToSell: 38, capturedAt: AUG(3),
  ...over,
});

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'offer-1', revision: 1,
  breakdown: calculateOffer({
    marketValue: money(450_000n), reconEstimate: money(40_000n),
    targetMargin: money(60_000n), disposalRoute: 'retail',
  }),
  offeredAt: AUG(3), expiresAt: AUG(10), acceptedAt: AUG(3, 14),
  declinedAt: null, declinedReason: null,
  ...over,
});

const settlement = (over: Partial<Settlement> = {}): Settlement => ({
  id: 'set-1', lenderName: 'Black Horse', agreementReference: 'BH-99120',
  settlement: money(310_000n), dailyAccrual: null,
  source: 'lender_portal', verified: true,
  quotedAt: AUG(3), validUntil: AUG(17), paidAt: null,
  ...over,
});

const appraisal = (over: Partial<Appraisal> = {}): Appraisal => ({
  id: 'app-1', state: 'accepted', sellerType: 'private_individual',
  registration: 'WN22HNL', vin: 'WBA1234567890', make: 'BMW', model: '3 Series',
  derivative: '320i M Sport 4dr Step Auto', derivativeConfirmed: true,
  bodyStyle: 'Saloon', doors: 4, transmission: 'Automatic', fuelType: 'Petrol',
  colour: 'Mineral Grey', engineCc: 1998, firstRegisteredOn: AUG(1),
  mileage: 42_500, motExpiresOn: AUG(28), formerKeepers: 2,
  serviceHistoryType: 'full_franchise', keyCount: 2, v5cPresent: true,
  conditionNotes: 'Kerbed nearside alloys.',
  expiresAt: AUG(10), convertedVehicleId: null,
  ...over,
});

// ------------------------------------------------------------ damage map

describe('the damage map', () => {
  it('maps a tapped panel to its costing group', () => {
    expect(panelGroupFor('nsf_door')).toBe('body_panel');
    expect(panelGroupFor('front_bumper')).toBe('bumper');
    expect(panelGroupFor('osr_alloy')).toBe('wheel');
    expect(panelGroupFor('windscreen')).toBe('glass');
  });

  it('tolerates the casing and padding a form will send', () => {
    expect(panelGroupFor('  NSF_Door ')).toBe('body_panel');
  });

  it('returns null for an unknown panel rather than guessing a group', () => {
    // A mark priced against the wrong group is a wrong estimate that looks
    // entirely normal on the screen.
    expect(panelGroupFor('spoiler')).toBeNull();
    expect(panelGroupFor('')).toBeNull();
  });

  it('every known panel resolves to a group', () => {
    for (const panel of KNOWN_PANELS) expect(panelGroupFor(panel)).not.toBeNull();
  });
});

describe('tyre assessment', () => {
  it('flags a tyre below the legal minimum', () => {
    const findings = assessTyres({ nsf: 15, osf: 32, nsr: 25, osr: 16 });
    expect(findings.find((f) => f.position === 'nsf')?.illegal).toBe(true);
    // Exactly at the limit is legal, not illegal.
    expect(findings.find((f) => f.position === 'osr')?.illegal).toBe(false);
  });

  it('separates illegal from merely below a retail prep standard', () => {
    const findings = assessTyres({ nsf: 25 });
    expect(findings[0]!.illegal).toBe(false);
    expect(findings[0]!.advisory).toBe(true);
  });

  it('holds depths in tenths so the 1.6mm limit is an integer comparison', () => {
    expect(LEGAL_TREAD_TENTHS_MM).toBe(16);
    expect(assessTyres({ nsf: LEGAL_TREAD_TENTHS_MM - 1 })[0]!.illegal).toBe(true);
  });
});

// -------------------------------------------------------- recon estimate

describe('resolving a standard cost', () => {
  it('picks the most recently effective standard whose window covers the date', () => {
    const old = standard({ id: 'old', cost: money(10_000n), effectiveFrom: AUG(1) });
    const current = standard({ id: 'new', cost: money(14_000n), effectiveFrom: AUG(2) });
    const resolved = resolveStandard([old, current], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3));
    expect(resolved?.id).toBe('new');
  });

  it('ignores a standard whose window has not opened yet', () => {
    const future = standard({ id: 'future', effectiveFrom: AUG(20) });
    expect(resolveStandard([future], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3))).toBeNull();
  });

  it('ignores a standard whose window has closed', () => {
    const closed = standard({ effectiveFrom: AUG(1), effectiveTo: AUG(2) });
    expect(resolveStandard([closed], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3))).toBeNull();
  });

  it('refuses an observed average built from too small a sample', () => {
    // Same rule as the representative-APR report: a confident number from four
    // data points is worse than admitting there is not enough evidence yet.
    const thin = standard({
      id: 'thin', source: 'observed_average', sampleSize: MIN_OBSERVED_SAMPLE - 1,
    });
    expect(resolveStandard([thin], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3))).toBeNull();
  });

  it('accepts an observed average once the sample is large enough', () => {
    const solid = standard({
      id: 'solid', source: 'observed_average', sampleSize: MIN_OBSERVED_SAMPLE,
    });
    expect(resolveStandard([solid], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3))?.id).toBe('solid');
  });

  it('falls back to a usable standard when the newest one has too thin a sample', () => {
    const thin = standard({
      id: 'thin', source: 'observed_average', sampleSize: 2, effectiveFrom: AUG(2),
    });
    const fallback = standard({ id: 'default', effectiveFrom: AUG(1) });
    expect(resolveStandard([thin, fallback], {
      damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel',
    }, AUG(3))?.id).toBe('default');
  });

  it('does not cross damage types, severities or groups', () => {
    const s = standard();
    const key = { damageType: 'dent', severity: 'moderate', panelGroup: 'body_panel' } as const;
    expect(resolveStandard([s], { ...key, damageType: 'scratch' }, AUG(3))).toBeNull();
    expect(resolveStandard([s], { ...key, severity: 'heavy' }, AUG(3))).toBeNull();
    expect(resolveStandard([s], { ...key, panelGroup: 'bumper' }, AUG(3))).toBeNull();
  });
});

describe('the recon estimate', () => {
  it('prices every mark it has a standard for', () => {
    const estimate = estimateRecon({
      marks: [mark({ id: 'a' }), mark({ id: 'b' })],
      standards: [standard()],
      asAt: AUG(3),
    });
    expect(estimate.lines).toHaveLength(2);
    expect(estimate.total).toEqual(money(24_000n));
    expect(estimate.incomplete).toBe(false);
  });

  it('REPORTS a mark it cannot price instead of costing it at zero', () => {
    // The failure that matters. A silent zero makes a damaged car look clean
    // and pushes the allowance up by exactly the repair bill.
    const estimate = estimateRecon({
      marks: [mark({ id: 'priced' }), mark({ id: 'exotic', damageType: 'corrosion' })],
      standards: [standard()],
      asAt: AUG(3),
    });

    expect(estimate.lines).toHaveLength(1);
    expect(estimate.unpriced).toHaveLength(1);
    expect(estimate.unpriced[0]!.markId).toBe('exotic');
    expect(estimate.incomplete).toBe(true);
    // The unpriced mark contributed nothing — which is exactly why the caller
    // must be told, and why `incomplete` reaches the offer.
    expect(estimate.total).toEqual(money(12_000n));
  });

  it('names what it could not price and what to do about it', () => {
    const estimate = estimateRecon({
      marks: [mark({ damageType: 'crack', severity: 'heavy', panelGroup: 'glass' })],
      standards: [],
      asAt: AUG(3),
    });
    expect(estimate.unpriced[0]!.reason).toMatch(/heavy crack/);
    expect(estimate.unpriced[0]!.reason).toMatch(/glass/);
    expect(estimate.unpriced[0]!.reason).toMatch(/Price it manually/);
  });

  it('adds manual lines the map does not know about', () => {
    const estimate = estimateRecon({
      marks: [mark()],
      standards: [standard()],
      asAt: AUG(3),
      manualLines: [money(28_000n), money(9_500n)],
    });
    expect(estimate.standardTotal).toEqual(money(12_000n));
    expect(estimate.manualTotal).toEqual(money(37_500n));
    expect(estimate.total).toEqual(money(49_500n));
  });

  it('an empty map costs nothing and is not incomplete', () => {
    const estimate = estimateRecon({ marks: [], standards: [], asAt: AUG(3) });
    expect(estimate.total).toEqual(zero());
    expect(estimate.incomplete).toBe(false);
  });

  it('property: the total is exactly the sum of its priced lines', () => {
    fc.assert(fc.property(
      fc.array(fc.bigInt(0n, 500_000n), { minLength: 0, maxLength: 12 }),
      (costs) => {
        const standards = costs.map((c, i) =>
          standard({ id: `s${i}`, severity: 'light', cost: money(c) }));
        // One mark per standard, each keyed to its own severity slot via id.
        const estimate = estimateRecon({
          marks: costs.map((_, i) => mark({ id: `m${i}`, severity: 'light' })),
          standards: standards.slice(0, 1),
          asAt: AUG(3),
        });
        const expected = money(
          BigInt(estimate.lines.length) * (standards[0]?.cost.amount ?? 0n));
        expect(estimate.total).toEqual(expected);
      },
    ));
  });
});

// ------------------------------------------------------- valuation panel

describe('the valuation panel', () => {
  it('shows the most recent valuation', () => {
    const panel = valuationPanel({
      valuations: [
        valuation({ id: 'old', trade: money(400_000n), capturedAt: AUG(1) }),
        valuation({ id: 'new', trade: money(450_000n), capturedAt: AUG(3) }),
      ],
      mileage: 42_000, asAt: AUG(3),
    });
    expect(panel.trade).toEqual(money(450_000n));
    expect(panel.basis).toBe('provider');
  });

  it('INVENTS NOTHING when there is no valuation', () => {
    // cap hpi is contract-blocked. A product that fabricates a guide price is
    // doing the exact thing we audit competitors for.
    const panel = valuationPanel({ valuations: [], mileage: 42_000, asAt: AUG(3) });
    expect(panel.basis).toBe('none');
    expect(panel.trade).toBeNull();
    expect(panel.retail).toBeNull();
    expect(panel.private).toBeNull();
    expect(panel.warnings[0]).toMatch(/must record its own basis/);
  });

  it('warns when the valuation has gone stale', () => {
    const panel = valuationPanel({
      valuations: [valuation({ capturedAt: AUG(1) })],
      mileage: 42_000, asAt: AUG(20),
    });
    expect(panel.stale).toBe(true);
    expect(panel.ageDays).toBe(19);
    expect(panel.warnings.some((w) => /19 days old/.test(w))).toBe(true);
  });

  it('warns when the valuation assumed a materially different mileage', () => {
    const panel = valuationPanel({
      valuations: [valuation({ valuedAtMileage: 42_000 })],
      mileage: 42_000 + VALUATION_MILEAGE_TOLERANCE + 1,
      asAt: AUG(3),
    });
    expect(panel.mileageDelta).toBe(VALUATION_MILEAGE_TOLERANCE + 1);
    expect(panel.warnings.some((w) => /Adjust before offering/.test(w))).toBe(true);
  });

  it('does not warn on a mileage difference within tolerance', () => {
    const panel = valuationPanel({
      valuations: [valuation({ valuedAtMileage: 42_000 })],
      mileage: 42_500, asAt: AUG(3),
    });
    expect(panel.warnings).toHaveLength(0);
  });

  it('marks a manual valuation as a manual basis', () => {
    const panel = valuationPanel({
      valuations: [valuation({ source: 'manual' })], mileage: 42_000, asAt: AUG(3),
    });
    expect(panel.basis).toBe('manual');
  });
});

// ---------------------------------------------------------------- offer

describe('calculating the offer', () => {
  it('is market value less recon, margin and fees', () => {
    const breakdown = calculateOffer({
      marketValue: money(450_000n), reconEstimate: money(40_000n),
      targetMargin: money(60_000n), fees: money(5_000n), disposalRoute: 'retail',
    });
    expect(breakdown.allowance).toEqual(money(345_000n));
    expect(breakdown.ceiling).toEqual(money(345_000n));
    expect(breakdown.overAllowance).toEqual(zero());
  });

  it('floors the allowance at zero and says the car is worth nothing to us', () => {
    const breakdown = calculateOffer({
      marketValue: money(50_000n), reconEstimate: money(120_000n),
      targetMargin: money(30_000n), disposalRoute: 'trade',
    });
    expect(breakdown.ceilingBelowZero).toBe(true);
    expect(breakdown.allowance).toEqual(zero());
    // The ceiling itself is kept negative — that is the diagnostic.
    expect(breakdown.ceiling).toEqual(money(-100_000n));
  });

  it('carries the incomplete-recon flag through to the offer', () => {
    const estimate = estimateRecon({ marks: [mark()], standards: [], asAt: AUG(3) });
    const breakdown = calculateOffer({
      marketValue: money(450_000n), reconEstimate: estimate.total,
      targetMargin: money(60_000n), disposalRoute: 'retail',
      reconIncomplete: estimate.incomplete,
    });
    expect(breakdown.basedOnIncompleteRecon).toBe(true);
  });

  it('property: the allowance is never negative, whatever the inputs', () => {
    fc.assert(fc.property(
      fc.bigInt(0n, 5_000_000n), fc.bigInt(0n, 5_000_000n), fc.bigInt(0n, 5_000_000n),
      (market, recon, margin) => {
        const breakdown = calculateOffer({
          marketValue: money(market), reconEstimate: money(recon),
          targetMargin: money(margin), disposalRoute: 'retail',
        });
        expect(breakdown.allowance.amount >= 0n).toBe(true);
      },
    ));
  });

  it('property: the ceiling reconciles exactly with its components', () => {
    fc.assert(fc.property(
      fc.bigInt(0n, 5_000_000n), fc.bigInt(0n, 500_000n),
      fc.bigInt(0n, 500_000n), fc.bigInt(0n, 50_000n),
      (market, recon, margin, fees) => {
        const b = calculateOffer({
          marketValue: money(market), reconEstimate: money(recon),
          targetMargin: money(margin), fees: money(fees), disposalRoute: 'retail',
        });
        expect(b.ceiling).toEqual(
          subtract(subtract(subtract(money(market), money(recon)), money(margin)), money(fees)));
      },
    ));
  });
});

describe('an over-allowance', () => {
  it('records how far above the ceiling the allowance was pushed', () => {
    // Extremely common and entirely legitimate: the customer wants £5,000 for a
    // £4,600 car and the sale car carries it. What must not happen is the
    // over-allowance disappearing.
    const base = calculateOffer({
      marketValue: money(500_000n), reconEstimate: money(20_000n),
      targetMargin: money(20_000n), disposalRoute: 'retail',
    });
    expect(base.ceiling).toEqual(money(460_000n));

    const raised = withManualAllowance(base, money(500_000n));
    expect(raised.allowance).toEqual(money(500_000n));
    expect(raised.overAllowance).toEqual(money(40_000n));
  });

  it('is zero when the allowance is below the ceiling, never negative', () => {
    const base = calculateOffer({
      marketValue: money(500_000n), reconEstimate: money(20_000n),
      targetMargin: money(20_000n), disposalRoute: 'retail',
    });
    expect(withManualAllowance(base, money(400_000n)).overAllowance).toEqual(zero());
  });

  it('refuses a negative allowance outright', () => {
    const base = calculateOffer({
      marketValue: money(500_000n), reconEstimate: zero(),
      targetMargin: zero(), disposalRoute: 'retail',
    });
    expect(() => withManualAllowance(base, money(-1n)))
      .toThrow(/cannot be negative/);
  });
});

describe('what the customer is shown', () => {
  it('carries the allowance and nothing else', () => {
    const view = customerFacingOffer(offer());
    expect(view.allowance).toEqual(money(350_000n));
    expect(view.revision).toBe(1);
    expect(view.expiresAt).toEqual(AUG(10));
  });

  it('contains NO cost data at all', () => {
    // Built, not filtered — there is no key to forget to delete. The roles
    // table is explicit that a sales executive has no cost prices unless
    // granted, and market value, recon and target margin are all cost data.
    const view = customerFacingOffer(offer()) as unknown as Record<string, unknown>;
    const keys = Object.keys(view);
    expect(keys.sort()).toEqual(['allowance', 'expiresAt', 'offeredAt', 'revision']);

    const serialised = payload(view);
    for (const forbidden of ['marketValue', 'reconEstimate', 'targetMargin',
      'ceiling', 'overAllowance', 'disposalRoute', 'fees']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('does not leak the market value through the serialised payload', () => {
    const raised = withManualAllowance(
      calculateOffer({
        marketValue: money(999_999n), reconEstimate: zero(),
        targetMargin: zero(), disposalRoute: 'retail',
      }),
      money(100_000n),
    );
    const view = customerFacingOffer(offer({ breakdown: raised }));
    expect(payload(view)).not.toContain('999999');
  });
});

describe('offer revisions', () => {
  it('supersedes rather than edits', () => {
    const first = offer({ id: 'o1', revision: 1 });
    const second = offer({ id: 'o2', revision: 2 });
    expect(currentOffer([first, second])?.id).toBe('o2');
    expect(nextRevision([first, second])).toBe(3);
  });

  it('skips a declined revision when finding the offer in force', () => {
    const live = offer({ id: 'o1', revision: 1 });
    const declined = offer({
      id: 'o2', revision: 2, acceptedAt: null,
      declinedAt: AUG(4), declinedReason: 'Customer wanted £400 more',
    });
    expect(currentOffer([live, declined])?.id).toBe('o1');
  });

  it('starts at revision 1', () => {
    expect(nextRevision([])).toBe(1);
  });

  it('knows when an offer has lapsed', () => {
    const o = offer({ expiresAt: AUG(10) });
    expect(offerExpired(o, AUG(9))).toBe(false);
    expect(offerExpired(o, AUG(11))).toBe(true);
    // An offer with no expiry never lapses — which is why the screen asks for one.
    expect(offerExpired(offer({ expiresAt: null }), AUG(99))).toBe(false);
  });
});

// ----------------------------------------------------------- settlement

describe('the settlement position', () => {
  it('reports nothing when there is no outstanding finance', () => {
    const position = settlementPosition([], AUG(3));
    expect(position.present).toBe(false);
    expect(position.settlement).toBeNull();
    expect(position.warnings).toHaveLength(0);
  });

  it('takes the most recent quote', () => {
    const position = settlementPosition([
      settlement({ id: 'old', settlement: money(320_000n), quotedAt: AUG(1) }),
      settlement({ id: 'new', settlement: money(310_000n), quotedAt: AUG(3) }),
    ], AUG(4));
    expect(position.settlement).toEqual(money(310_000n));
  });

  it('flags a lapsed quote and says who pays for it', () => {
    const position = settlementPosition(
      [settlement({ validUntil: AUG(10) })], AUG(14));
    expect(position.expired).toBe(true);
    expect(position.warnings.some((w) => /accrues to the dealership/.test(w))).toBe(true);
  });

  it('refuses to treat what the customer remembers as a figure', () => {
    const position = settlementPosition(
      [settlement({ source: 'customer_stated', verified: false })], AUG(4));
    expect(position.verified).toBe(false);
    expect(position.warnings.some((w) => /what the customer recalled/.test(w))).toBe(true);
  });

  it('projects the accrual forward only when the lender stated a daily rate', () => {
    const withRate = settlementPosition(
      [settlement({ dailyAccrual: money(250n), quotedAt: AUG(3) })], AUG(13));
    // Ten days at £2.50.
    expect(withRate.projected).toEqual(money(312_500n));

    const withoutRate = settlementPosition(
      [settlement({ dailyAccrual: null })], AUG(13));
    expect(withoutRate.projected).toEqual(withoutRate.settlement);
  });

  it('never projects backwards for a quote dated in the future', () => {
    const position = settlementPosition(
      [settlement({ dailyAccrual: money(250n), quotedAt: AUG(10) })], AUG(3));
    expect(position.projected).toEqual(money(310_000n));
  });

  it('counts days until expiry', () => {
    const position = settlementPosition(
      [settlement({ validUntil: AUG(17) })], AUG(10));
    expect(position.daysUntilExpiry).toBe(7);
  });
});

describe('equity', () => {
  it('states positive equity in pounds', () => {
    const position = equityPosition(money(450_000n), money(310_000n));
    expect(position.equity).toEqual(money(140_000n));
    expect(position.negative).toBe(false);
    expect(position.summary).toMatch(/£1,400\.00 towards the new car/);
  });

  it('states negative equity as a figure to carry, not a mystery', () => {
    const position = equityPosition(money(300_000n), money(450_000n));
    expect(position.negative).toBe(true);
    expect(position.equity).toEqual(money(-150_000n));
    expect(position.summary).toMatch(/£1,500\.00 of negative equity/);
  });
});

describe('handing the part-exchange to the deal', () => {
  it('keeps the settlement SEPARATE from the allowance', () => {
    const handoff = partExchangeForDeal(
      offer(), settlementPosition([settlement()], AUG(4)));
    expect(handoff.partExchange).toEqual(money(350_000n));
    expect(handoff.partExchangeSettlement).toEqual(money(310_000n));
  });

  it('passes the accrued figure when the lender gave a rate', () => {
    const handoff = partExchangeForDeal(
      offer(), settlementPosition(
        [settlement({ dailyAccrual: money(250n), quotedAt: AUG(3) })], AUG(13)));
    expect(handoff.partExchangeSettlement).toEqual(money(312_500n));
  });

  it('property: the settlement never reduces what the customer has to find', () => {
    // The rule M12 settled, verified end to end through the real deal
    // calculation: money still owed on the part-exchange has to reach the
    // customer's lender, so it ADDS. Netting it off understates the balance by
    // exactly the settlement, and the customer discovers that at the desk.
    fc.assert(fc.property(
      fc.bigInt(0n, 2_000_000n), fc.bigInt(0n, 2_000_000n),
      (allowance, owed) => {
        const handoff = partExchangeForDeal(
          offer({
            breakdown: withManualAllowance(
              calculateOffer({
                marketValue: money(allowance), reconEstimate: zero(),
                targetMargin: zero(), disposalRoute: 'retail',
              }),
              money(allowance)),
          }),
          settlementPosition([settlement({ settlement: money(owed) })], AUG(4)),
        );

        const base: Deal = {
          id: 'd', tenantId: 't', contactId: 'c', vehicleId: 'v',
          state: 'building', contractFormation: null,
          vehiclePrice: money(1_200_000n),
          partExchange: handoff.partExchange,
          partExchangeSettlement: handoff.partExchangeSettlement,
          deposit: zero(), financeAmount: zero(), addons: [],
          quotedAt: null, contractedAt: null, deliveredAt: null,
          cancelledAt: null, cancellationReason: null,
        };
        const withoutSettlement: Deal = { ...base, partExchangeSettlement: zero() };

        const delta = subtract(balanceToFinance(base), balanceToFinance(withoutSettlement));
        expect(delta).toEqual(money(owed));
      },
    ));
  });
});

// ------------------------------------------------------------ VAT scheme

describe('the VAT scheme of the resulting stock record', () => {
  it('a private individual is always a margin car', () => {
    const decision = vatSchemeForSeller('private_individual');
    expect(decision.scheme).toBe('margin');
    expect(decision.needsInput).toBe(false);
  });

  it('an unregistered business is always a margin car', () => {
    expect(vatSchemeForSeller('non_vat_business').scheme).toBe('margin');
  });

  it('a VAT-registered business is NOT decided by its registration alone', () => {
    // They may have sold to us under the margin scheme themselves, in which
    // case there is no input VAT to reclaim. Assuming `qualifying` would have
    // us charge VAT on the full selling price of a car we never reclaimed on.
    const decision = vatSchemeForSeller('vat_registered_business');
    expect(decision.scheme).toBeNull();
    expect(decision.needsInput).toBe(true);
    expect(decision.reason).toMatch(/margin scheme themselves/);
  });

  it('a VAT invoice makes it qualifying; the absence of one makes it margin', () => {
    expect(vatSchemeForSeller('vat_registered_business', true).scheme).toBe('qualifying');
    expect(vatSchemeForSeller('vat_registered_business', false).scheme).toBe('margin');
  });
});

// ------------------------------------------------------------ conversion

const clean = () => ({
  appraisal: appraisal(),
  offer: offer(),
  settlement: settlementPosition([settlement()], AUG(4)),
  asAt: AUG(4),
});

describe('conversion blockers', () => {
  it('a complete appraisal has none', () => {
    expect(conversionBlockers(clean())).toHaveLength(0);
  });

  it('refuses without an accepted offer', () => {
    const blockers = conversionBlockers({
      ...clean(), offer: offer({ acceptedAt: null }),
    });
    expect(blockers.find((b) => b.code === 'no_accepted_offer')?.overridable).toBe(false);
  });

  it('refuses an unconfirmed derivative, and will not guess one', () => {
    const blockers = conversionBlockers({
      ...clean(), appraisal: appraisal({ derivativeConfirmed: false }),
    });
    const blocker = blockers.find((b) => b.code === 'derivative_unconfirmed');
    expect(blocker?.overridable).toBe(false);
    expect(blocker?.message).toMatch(/Several trims share one DVLA record/);
  });

  it('refuses without a mileage — it is a stock-book field', () => {
    const blockers = conversionBlockers({
      ...clean(), appraisal: appraisal({ mileage: null }),
    });
    expect(blockers.find((b) => b.code === 'no_mileage')?.overridable).toBe(false);
  });

  it('refuses without a seller type, because it decides the VAT scheme', () => {
    const blockers = conversionBlockers({
      ...clean(), appraisal: appraisal({ sellerType: null }),
    });
    expect(blockers.find((b) => b.code === 'no_seller_type')?.overridable).toBe(false);
  });

  it('refuses when the VAT scheme cannot be derived', () => {
    const blockers = conversionBlockers({
      ...clean(),
      appraisal: appraisal({ sellerType: 'vat_registered_business' }),
    });
    expect(blockers.find((b) => b.code === 'vat_scheme_undecided')?.overridable).toBe(false);
  });

  it('refuses a second conversion of the same appraisal', () => {
    const blockers = conversionBlockers({
      ...clean(), appraisal: appraisal({ convertedVehicleId: 'veh-1' }),
    });
    expect(blockers.find((b) => b.code === 'already_converted')?.overridable).toBe(false);
  });

  it('an unverified settlement is overridable — it costs money, it is not wrong', () => {
    const blockers = conversionBlockers({
      ...clean(),
      settlement: settlementPosition(
        [settlement({ source: 'customer_stated', verified: false })], AUG(4)),
    });
    expect(blockers.find((b) => b.code === 'settlement_unverified')?.overridable).toBe(true);
  });

  it('a lapsed settlement is overridable and says why it matters', () => {
    const blockers = conversionBlockers({
      ...clean(),
      settlement: settlementPosition([settlement({ validUntil: AUG(2) })], AUG(4)),
      asAt: AUG(4),
    });
    const blocker = blockers.find((b) => b.code === 'settlement_expired');
    expect(blocker?.overridable).toBe(true);
    expect(blocker?.message).toMatch(/interest has accrued/);
  });

  it('a lapsed offer is overridable', () => {
    const blockers = conversionBlockers({
      ...clean(), offer: offer({ expiresAt: AUG(4) }), asAt: AUG(6),
    });
    expect(blockers.find((b) => b.code === 'offer_expired')?.overridable).toBe(true);
  });
});

describe('converting to a stock record', () => {
  it('re-keys nothing — every captured field lands on the vehicle', () => {
    const draft = convertToStock(clean());
    expect(draft.registration).toBe('WN22HNL');
    expect(draft.make).toBe('BMW');
    expect(draft.model).toBe('3 Series');
    expect(draft.derivative).toBe('320i M Sport 4dr Step Auto');
    expect(draft.mileage).toBe(42_500);
    expect(draft.colour).toBe('Mineral Grey');
    expect(draft.keyCount).toBe(2);
    expect(draft.v5cPresent).toBe(true);
    expect(draft.sourceAppraisalId).toBe('app-1');
    expect(draft.notes).toBe('Kerbed nearside alloys.');
  });

  it('normalises the registration the same way the vehicles table does', () => {
    const draft = convertToStock({
      ...clean(), appraisal: appraisal({ registration: 'wn22 hnl' }),
    });
    expect(draft.registration).toBe('WN22HNL');
  });

  it('books it in as a part-exchange purchase', () => {
    const draft = convertToStock(clean());
    expect(draft.purchaseSource).toBe('part_exchange');
    expect(draft.state).toBe('purchased');
  });

  it('THE PURCHASE PRICE IS THE ALLOWANCE, not the market value', () => {
    // The figure the VAT stock book carries is the amount actually given in
    // exchange. Recording the market value instead would understate the
    // purchase price and overstate the margin when the car sells — which is a
    // VAT assessment, not a reporting quirk.
    const draft = convertToStock(clean());
    expect(draft.purchasePrice).toEqual(money(350_000n));
    expect(draft.purchasePrice).not.toEqual(money(450_000n));
  });

  it('an over-allowance is still the purchase price, and is carried visibly', () => {
    const raised = withManualAllowance(
      calculateOffer({
        marketValue: money(460_000n), reconEstimate: zero(),
        targetMargin: zero(), disposalRoute: 'retail',
      }),
      money(500_000n));

    const draft = convertToStock({
      ...clean(), offer: offer({ breakdown: raised }),
    });
    expect(draft.purchasePrice).toEqual(money(500_000n));
    expect(draft.overAllowance).toEqual(money(40_000n));
  });

  it('derives the VAT scheme from the seller', () => {
    expect(convertToStock(clean()).vatScheme).toBe('margin');
    expect(convertToStock({
      ...clean(),
      appraisal: appraisal({ sellerType: 'vat_registered_business', vatInvoiceReceived: true }),
    }).vatScheme).toBe('qualifying');
  });

  it('throws on a non-overridable blocker and names every one of them', () => {
    expect(() => convertToStock({
      ...clean(),
      appraisal: appraisal({ derivativeConfirmed: false, mileage: null }),
    })).toThrow(/derivative[\s\S]*mileage|mileage[\s\S]*derivative/i);
  });

  it('refuses an overridable blocker until a reason is recorded', () => {
    const args = {
      ...clean(),
      settlement: settlementPosition(
        [settlement({ source: 'customer_stated', verified: false })], AUG(4)),
    };
    expect(() => convertToStock(args)).toThrow(/needs a recorded reason/);

    const draft = convertToStock({
      ...args,
      overrides: { settlement_unverified: 'Lender closed; customer producing the letter Monday.' },
    });
    expect(draft.overriddenBlockers).toContain('settlement_unverified');
  });

  it('an override cannot get past a non-overridable blocker', () => {
    expect(() => convertToStock({
      ...clean(),
      appraisal: appraisal({ derivativeConfirmed: false }),
      overrides: { derivative_unconfirmed: 'It is definitely the M Sport' },
    })).toThrow(/cannot become a stock record yet/);
  });

  it('records the purchase date as the day the offer was accepted', () => {
    const draft = convertToStock(clean());
    expect(draft.purchaseDate).toEqual(AUG(3, 14));
  });
});

// -------------------------------------------------------- state machine

describe('the appraisal state machine', () => {
  it('walks the normal path', () => {
    expect(changeState('draft', 'appraised').ok).toBe(true);
    expect(changeState('appraised', 'offered').ok).toBe(true);
    expect(changeState('offered', 'accepted').ok).toBe(true);
    expect(changeState('accepted', 'converted').ok).toBe(true);
  });

  it('lets a declined appraisal be re-offered', () => {
    // The customer who walked away over £200 comes back on Saturday. That is
    // the same car and the same appraisal, not a new one.
    expect(changeState('declined', 'offered').ok).toBe(true);
  });

  it('lets an offer be revised without leaving the offered state', () => {
    expect(changeState('offered', 'offered').ok).toBe(true);
  });

  it('refuses a nonsensical jump', () => {
    const result = changeState('draft', 'converted');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot go from draft to converted/);
  });

  it('demands a reason before declining or abandoning', () => {
    expect(changeState('offered', 'declined').ok).toBe(false);
    expect(changeState('offered', 'declined', { reason: '   ' }).ok).toBe(false);
    expect(changeState('offered', 'declined', { reason: 'Wanted £400 more' }).ok).toBe(true);
  });

  it('explains why the reason is mandatory', () => {
    expect(changeState('offered', 'declined').reason).toMatch(/how a dealer learns/);
  });

  it('converted and abandoned are terminal', () => {
    expect(isTerminal('converted')).toBe(true);
    expect(isTerminal('abandoned')).toBe(true);
    expect(isTerminal('declined')).toBe(false);
  });

  it('a converted appraisal cannot go anywhere', () => {
    expect(changeState('converted', 'offered').ok).toBe(false);
  });
});
