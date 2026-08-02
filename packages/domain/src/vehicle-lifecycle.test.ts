import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  VEHICLE_STATES, TERMINAL_STATES, IN_STOCK_STATES, PUBLISHABLE_STATES,
  allowedTransitions, canTransition, goLiveBlockers, canGoLive, hasMileageAnomaly,
  validateTransition, calculateDaysMetrics, formatStockNumber, advertStrength,
  type VehicleSnapshot, type VehicleState, type StateEvent,
} from './vehicle-lifecycle.js';

/** A vehicle that satisfies every go-live requirement. */
const ready = (over: Partial<VehicleSnapshot> = {}): VehicleSnapshot => ({
  state: 'ready',
  registration: 'WN22HNL',
  vatScheme: 'margin',
  retailPricePence: 1_999_900n,
  publishedPhotoCount: 14,
  provenanceCheckedAt: new Date('2026-07-20T09:00:00Z'),
  provenanceAdverse: false,
  provenanceAcknowledgedBy: null,
  missingStockBookFields: [],
  hasDeposit: false,
  hasLinkedDeal: false,
  handoverChecklistComplete: false,
  dvlaNotified: false,
  mileage: 40_470,
  highestMotMileage: 39_800,
  mileageAnomalyAcknowledgedBy: null,
  ...over,
});

describe('the state machine', () => {
  it('every state has a transition entry', () => {
    for (const s of VEHICLE_STATES) expect(allowedTransitions(s)).toBeDefined();
  });

  it('only ever transitions to a real state', () => {
    for (const s of VEHICLE_STATES) {
      for (const t of allowedTransitions(s)) expect(VEHICLE_STATES).toContain(t);
    }
  });

  it('terminal states go nowhere except archived', () => {
    for (const s of TERMINAL_STATES) {
      const onward = allowedTransitions(s).filter((t) => t !== 'archived');
      expect(onward, `${s} should be terminal`).toEqual([]);
    }
  });

  it('archived is absorbing', () => {
    expect(allowedTransitions('archived')).toEqual([]);
  });

  it('never transitions to itself', () => {
    for (const s of VEHICLE_STATES) expect(allowedTransitions(s)).not.toContain(s);
  });

  it('every non-terminal state can reach archived eventually', () => {
    // Breadth-first: no state should be a dead end that traps a vehicle.
    for (const start of VEHICLE_STATES) {
      const seen = new Set<VehicleState>([start]);
      const queue: VehicleState[] = [start];
      let reached = start === 'archived';
      while (queue.length && !reached) {
        const cur = queue.shift()!;
        for (const next of allowedTransitions(cur)) {
          if (next === 'archived') { reached = true; break; }
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(reached, `${start} cannot reach archived — vehicles would be trapped`).toBe(true);
    }
  });

  it('a fallen-through deal can return a sold car to Live', () => {
    expect(canTransition('sold', 'live')).toBe(true);
  });

  it('publishable states are a subset of in-stock states', () => {
    for (const s of PUBLISHABLE_STATES) expect(IN_STOCK_STATES.has(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Go-live gating — the rule that stops a dealer advertising a car they cannot
// lawfully invoice or evidence.
// ---------------------------------------------------------------------------
describe('go-live requirements', () => {
  it('a fully prepared vehicle can go live', () => {
    expect(canGoLive(ready())).toBe(true);
    expect(validateTransition(ready(), 'live').ok).toBe(true);
  });

  it.each([
    ['no_price', { retailPricePence: null }],
    ['no_photos', { publishedPhotoCount: 0 }],
    ['no_vat_scheme', { vatScheme: null }],
    ['no_registration', { registration: null }],
    ['no_provenance_check', { provenanceCheckedAt: null }],
  ] as const)('blocks go-live: %s', (code, patch) => {
    const blockers = goLiveBlockers(ready(patch as Partial<VehicleSnapshot>));
    expect(blockers.map((b) => b.code)).toContain(code);
    expect(validateTransition(ready(patch as Partial<VehicleSnapshot>), 'live').ok).toBe(false);
  });

  it('blocks go-live when the VAT stock book is incomplete, and names the fields', () => {
    const v = ready({ missingStockBookFields: ['sellerName', 'purchaseInvoiceRef'] });
    const blocker = goLiveBlockers(v).find((b) => b.code === 'stock_book_incomplete');
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain('sellerName');
    expect(blocker!.message).toContain('purchaseInvoiceRef');
    expect(blocker!.overridable, 'a dealer must not be able to override an incomplete stock book').toBe(false);
  });

  it('an adverse provenance marker blocks until a manager acknowledges it', () => {
    const flagged = ready({ provenanceAdverse: true });
    expect(canGoLive(flagged)).toBe(false);
    // Not overridable — it requires a recorded acknowledgement, not a bypass.
    const blocker = goLiveBlockers(flagged).find((b) => b.code === 'provenance_adverse')!;
    expect(blocker.overridable).toBe(false);
    expect(canGoLive(ready({ provenanceAdverse: true, provenanceAcknowledgedBy: 'u-manager' }))).toBe(true);
  });

  it('an override cannot bypass a non-overridable blocker', () => {
    const v = ready({ retailPricePence: null });
    const result = validateTransition(v, 'live', { overrideReason: 'customer waiting', overriddenBy: 'u1' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.blockers?.map((b) => b.code)).toContain('no_price');
  });

  it('an override CAN bypass a missing provenance check, but must be attributed', () => {
    const v = ready({ provenanceCheckedAt: null });
    expect(validateTransition(v, 'live').ok).toBe(false);
    expect(validateTransition(v, 'live', { overrideReason: 'check pending', overriddenBy: 'u-manager' }).ok).toBe(true);
    // An override with no named person is refused.
    const unattributed = validateTransition(v, 'live', { overrideReason: 'check pending' });
    expect(unattributed.ok).toBe(false);
    expect(unattributed.ok === false && unattributed.code).toBe('override_unattributed');
  });
});

describe('mileage anomaly', () => {
  it('detects mileage below the highest MOT reading', () => {
    expect(hasMileageAnomaly(ready({ mileage: 30_000, highestMotMileage: 39_800 }))).toBe(true);
    expect(hasMileageAnomaly(ready())).toBe(false);
  });

  it('blocks go-live until acknowledged — it is a fraud and CRA risk', () => {
    const clocked = ready({ mileage: 30_000, highestMotMileage: 39_800 });
    expect(canGoLive(clocked)).toBe(false);
    expect(canGoLive({ ...clocked, mileageAnomalyAcknowledgedBy: 'u-manager' })).toBe(true);
  });

  it('does not flag when MOT history is absent', () => {
    expect(hasMileageAnomaly(ready({ highestMotMileage: null }))).toBe(false);
  });
});

describe('transition guards beyond go-live', () => {
  it('reserving requires a deposit, or an override', () => {
    const live = ready({ state: 'live' });
    expect(validateTransition(live, 'reserved').ok).toBe(false);
    expect(validateTransition(ready({ state: 'live', hasDeposit: true }), 'reserved').ok).toBe(true);
    expect(validateTransition(live, 'reserved', { overrideReason: 'paying on collection' }).ok).toBe(true);
  });

  it('selling requires a linked deal', () => {
    const live = ready({ state: 'live' });
    expect(validateTransition(live, 'sold').ok).toBe(false);
    expect(validateTransition(ready({ state: 'live', hasLinkedDeal: true }), 'sold').ok).toBe(true);
  });

  it('delivering requires the handover checklist AND the DVLA notification', () => {
    const sold = ready({ state: 'sold', hasLinkedDeal: true });
    expect(validateTransition(sold, 'delivered').ok).toBe(false);
    expect(validateTransition({ ...sold, handoverChecklistComplete: true }, 'delivered').ok).toBe(false);
    expect(validateTransition({ ...sold, handoverChecklistComplete: true, dvlaNotified: true }, 'delivered').ok).toBe(true);
  });

  it('refuses a transition that is not in the machine', () => {
    const r = validateTransition(ready({ state: 'sourcing' }), 'live');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('invalid_transition');
  });

  it('refuses a no-op', () => {
    const r = validateTransition(ready(), 'ready');
    expect(r.ok === false && r.code).toBe('no_change');
  });

  it('never allows an illegal transition, for any pair', () => {
    fc.assert(
      fc.property(fc.constantFrom(...VEHICLE_STATES), fc.constantFrom(...VEHICLE_STATES), (from, to) => {
        const v = ready({
          state: from, hasDeposit: true, hasLinkedDeal: true,
          handoverChecklistComplete: true, dvlaNotified: true,
        });
        const result = validateTransition(v, to);
        if (result.ok) expect(canTransition(from, to)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe('days metrics', () => {
  const d = (s: string): Date => new Date(s);
  const history: StateEvent[] = [
    { toState: 'purchased', occurredAt: d('2026-05-01T10:00:00Z') },
    { toState: 'booked_in', occurredAt: d('2026-05-03T10:00:00Z') },
    { toState: 'in_prep',   occurredAt: d('2026-05-04T10:00:00Z') },
    { toState: 'ready',     occurredAt: d('2026-05-12T10:00:00Z') },
    { toState: 'live',      occurredAt: d('2026-05-13T10:00:00Z') },
    { toState: 'sold',      occurredAt: d('2026-06-20T10:00:00Z') },
  ];

  it('measures each stage from the right anchor', () => {
    const m = calculateDaysMetrics(history, d('2026-07-01T10:00:00Z'));
    expect(m.daysInPrep).toBe(8);    // in_prep → ready
    expect(m.daysToLive).toBe(10);   // booked_in → live
    expect(m.daysToSell).toBe(38);   // live → sold
    expect(m.daysInStock).toBe(48);  // booked_in (3 May) → sold (20 Jun)
  });

  it('measures days to sell from LIVE, not from purchase', () => {
    // Otherwise the sales team is blamed for time the car spent in the workshop,
    // and the dealer stops trusting the dashboard.
    const m = calculateDaysMetrics(history, d('2026-07-01T10:00:00Z'));
    expect(m.daysToSell).toBeLessThan(m.daysInStock!);
  });

  it('counts to now while still in stock', () => {
    const partial = history.slice(0, 5); // no sale
    const m = calculateDaysMetrics(partial, d('2026-06-15T10:00:00Z'));
    expect(m.daysInStock).toBe(43);
    expect(m.daysToSell).toBe(33);
  });

  it('bands age and flags overage', () => {
    const banded = (days: number) =>
      calculateDaysMetrics(
        [{ toState: 'booked_in', occurredAt: d('2026-01-01T00:00:00Z') }],
        new Date(d('2026-01-01T00:00:00Z').getTime() + days * 86_400_000),
      );
    expect(banded(10).ageBand).toBe('0-30');
    expect(banded(45).ageBand).toBe('31-60');
    expect(banded(75).ageBand).toBe('61-90');
    expect(banded(120).ageBand).toBe('90+');
    expect(banded(75).isOverage).toBe(false);
    expect(banded(120).isOverage).toBe(true);
  });

  it('returns nulls rather than guessing when history is empty', () => {
    const m = calculateDaysMetrics([], new Date());
    expect(m.daysInStock).toBeNull();
    expect(m.daysToSell).toBeNull();
    expect(m.ageBand).toBeNull();
    expect(m.isOverage).toBe(false);
  });

  it('never returns a negative duration', () => {
    fc.assert(
      fc.property(fc.integer({ min: -400, max: 400 }), (offset) => {
        const base = d('2026-05-01T00:00:00Z');
        const m = calculateDaysMetrics(
          [{ toState: 'booked_in', occurredAt: base }],
          new Date(base.getTime() + offset * 86_400_000),
        );
        expect(m.daysInStock).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('stock numbers', () => {
  it('pads and prefixes', () => {
    expect(formatStockNumber('BLE', 7)).toBe('BLE-0007');
    expect(formatStockNumber(null, 42)).toBe('0042');
    expect(formatStockNumber('BLE', 12345)).toBe('BLE-12345'); // never truncates
  });
});

describe('advert strength', () => {
  const base = {
    publishedPhotoCount: 14, descriptionLength: 600, featureCount: 12,
    hasVideo: true, hasSpin: false, pricePositionPct: 99,
    hasMotHistory: true, hasProvenanceBadge: true,
  };

  it('scores a complete advert highly', () => {
    const { score, suggestions } = advertStrength(base);
    expect(score).toBeGreaterThanOrEqual(95);
    expect(suggestions).toEqual([]);
  });

  it('scores a bare advert low and says exactly what to fix', () => {
    const { score, suggestions } = advertStrength({
      publishedPhotoCount: 2, descriptionLength: 20, featureCount: 1,
      hasVideo: false, hasSpin: false, pricePositionPct: 115,
      hasMotHistory: false, hasProvenanceBadge: false,
    });
    expect(score).toBeLessThan(30);
    expect(suggestions.length).toBeGreaterThanOrEqual(5);
    expect(suggestions.join(' ')).toMatch(/photograph/i);
    expect(suggestions.join(' ')).toMatch(/MOT history/i);
  });

  it('always returns a score between 0 and 100', () => {
    fc.assert(
      fc.property(
        fc.record({
          publishedPhotoCount: fc.integer({ min: 0, max: 60 }),
          descriptionLength: fc.integer({ min: 0, max: 5000 }),
          featureCount: fc.integer({ min: 0, max: 80 }),
          hasVideo: fc.boolean(),
          hasSpin: fc.boolean(),
          pricePositionPct: fc.option(fc.integer({ min: 50, max: 200 }), { nil: null }),
          hasMotHistory: fc.boolean(),
          hasProvenanceBadge: fc.boolean(),
        }),
        (input) => {
          const { score } = advertStrength(input);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 300 },
    );
  });
});
