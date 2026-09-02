import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PURCHASE_SOURCES,
  assessBookIn,
  isPlausibleRegistration,
  isPurchaseSource,
  normaliseRegistration,
  parsePoundsToPence,
  suggestVatScheme,
  validateReprice,
  type BookInDraft,
  type PurchaseSource,
} from './vehicle-intake.js';

const NOW = new Date('2026-09-02T10:00:00Z');

const draft = (over: Partial<BookInDraft> = {}): BookInDraft => ({
  registration: 'WN22HNL',
  vin: null,
  make: 'Volkswagen',
  model: 'Golf',
  derivative: '1.5 TSI EVO Match 5dr',
  derivativeCandidateCount: 1,
  colour: 'Reflex Silver',
  fuelType: 'Petrol',
  mileage: 42_000,
  highestMotMileage: 41_500,
  mileageAnomalyAcknowledged: false,
  firstRegisteredOn: '2022-04-01',
  purchaseSource: 'private',
  purchaseDate: '2026-08-20',
  purchasePricePence: 950_000n,
  vatScheme: 'margin',
  retailPricePence: 1_249_500n,
  ...over,
});

const codes = (d: BookInDraft): string[] =>
  assessBookIn(d, NOW).problems.map((p) => p.code);

describe('registrations', () => {
  it('normalises to the stored form', () => {
    expect(normaliseRegistration('wn22 hnl')).toBe('WN22HNL');
    expect(normaliseRegistration(' Wn22-Hnl ')).toBe('WN22HNL');
    expect(normaliseRegistration('wn22.hnl')).toBe('WN22HNL');
  });

  it('accepts the plate formats a UK dealer actually buys', () => {
    // Current, prefix, suffix, Northern Ireland, dateless, personalised.
    for (const reg of ['WN22HNL', 'A123BCD', 'ABC123D', 'ABC1234', '1ABC', 'K9DOG']) {
      expect(isPlausibleRegistration(reg), reg).toBe(true);
    }
  });

  it('rejects input that cannot be a plate', () => {
    expect(isPlausibleRegistration('')).toBe(false);
    expect(isPlausibleRegistration('W')).toBe(false);
    expect(isPlausibleRegistration('THIS-IS-FAR-TOO-LONG')).toBe(false);
    expect(isPlausibleRegistration('WN22!!!')).toBe(false);
  });

  it('normalising is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(normaliseRegistration(normaliseRegistration(s))).toBe(normaliseRegistration(s));
      }),
      { numRuns: 200 },
    );
  });
});

describe('purchase sources', () => {
  it('narrows a string safely', () => {
    expect(isPurchaseSource('auction')).toBe(true);
    expect(isPurchaseSource('ebay')).toBe(false);
  });

  it('has a suggestion for every source and for none at all', () => {
    for (const source of [...PURCHASE_SOURCES, null]) {
      const s = suggestVatScheme(source as PurchaseSource | null);
      expect(s.reason.length, String(source)).toBeGreaterThan(20);
    }
  });
});

describe('the VAT scheme is suggested, never chosen', () => {
  it('is confident only about a private purchase', () => {
    // The one case where no VAT can have been recoverable, whatever the
    // paperwork says. Everything else depends on what the seller invoiced.
    const confident = [...PURCHASE_SOURCES].filter((s) => suggestVatScheme(s).confident);
    expect(confident).toEqual(['private']);
  });

  it('suggests margin for a private seller', () => {
    const s = suggestVatScheme('private');
    expect(s.suggested).toBe('margin');
    expect(s.reason).toMatch(/must not show VAT separately/);
  });

  it('suggests margin for a part-exchange but refuses to be sure', () => {
    // A VAT-registered customer part-exchanging a car is qualifying, and this
    // code cannot see their VAT registration. M13 refuses to guess the same way.
    const s = suggestVatScheme('part_exchange');
    expect(s.suggested).toBe('margin');
    expect(s.confident).toBe(false);
  });

  it('offers no scheme at all where the source genuinely does not say', () => {
    for (const source of ['auction', 'trade', 'consignment'] as const) {
      expect(suggestVatScheme(source).suggested, source).toBeNull();
    }
  });

  it('treats ex-fleet and lease returns as probably qualifying', () => {
    for (const source of ['fleet', 'lease_return'] as const) {
      expect(suggestVatScheme(source).suggested, source).toBe('qualifying');
      expect(suggestVatScheme(source).confident, source).toBe(false);
    }
  });
});

describe('booking a car in', () => {
  it('accepts a complete draft', () => {
    const result = assessBookIn(draft(), NOW);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.normalisedRegistration).toBe('WN22HNL');
  });

  it('needs almost nothing — a registration alone is a lawful book-in', () => {
    // A dealer standing in an auction hall knows the plate and the price.
    // Refusing the record until they know the derivative would mean the car
    // exists on the forecourt and not in the system, which is the worst place
    // for it to be.
    const result = assessBookIn(draft({
      vin: null, make: null, model: null, derivative: null,
      colour: null, fuelType: null, mileage: null, highestMotMileage: null,
      firstRegisteredOn: null, purchaseSource: null, purchaseDate: null,
      purchasePricePence: null, vatScheme: null, retailPricePence: null,
    }), NOW);

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('refuses a missing registration', () => {
    const result = assessBookIn(draft({ registration: '  ' }), NOW);
    expect(result.ok).toBe(false);
    expect(codes(draft({ registration: '' }))).toContain('registration_missing');
  });

  it('refuses a registration that cannot be one', () => {
    expect(codes(draft({ registration: 'WN22!!!' }))).toContain('registration_implausible');
    expect(assessBookIn(draft({ registration: 'WN22!!!' }), NOW).normalisedRegistration).toBeNull();
  });

  it('stores the registration normalised', () => {
    expect(assessBookIn(draft({ registration: ' wn22 hnl ' }), NOW).normalisedRegistration)
      .toBe('WN22HNL');
  });

  it('names the error message rather than saying something went wrong', () => {
    // CLAUDE.md bans "An error occurred". Every message must say what to do.
    for (const source of PURCHASE_SOURCES) {
      for (const p of assessBookIn(draft({ purchaseSource: source, vatScheme: null }), NOW).problems) {
        expect(p.message).not.toMatch(/an error occurred/i);
        expect(p.message.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('the derivative is never guessed', () => {
  it('blocks when the lookup was ambiguous and nobody picked', () => {
    const result = assessBookIn(draft({ derivative: null, derivativeCandidateCount: 4 }), NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('derivative_ambiguous');
    expect(result.errors[0]?.message).toMatch(/4 derivatives/);
  });

  it('allows an unknown derivative when the lookup returned exactly one candidate', () => {
    // One candidate and no pick means the lookup simply did not resolve a
    // trim, which is the normal DVLA case. That is a gap to fill later, not a
    // decision somebody dodged.
    expect(assessBookIn(draft({ derivative: null, derivativeCandidateCount: 1 }), NOW).ok).toBe(true);
  });

  it('allows an ambiguous lookup once the dealer has chosen', () => {
    expect(assessBookIn(draft({ derivative: '1.5 TSI Life', derivativeCandidateCount: 4 }), NOW).ok)
      .toBe(true);
  });
});

describe('mileage against the MOT history', () => {
  it('blocks a reading below the highest MOT reading', () => {
    const result = assessBookIn(draft({ mileage: 30_000, highestMotMileage: 41_500 }), NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('mileage_anomaly');
  });

  it('quotes both numbers, because the dealer needs to see which is wrong', () => {
    const result = assessBookIn(draft({ mileage: 30_000, highestMotMileage: 41_500 }), NOW);
    const anomaly = result.errors.find((e) => e.code === 'mileage_anomaly');
    expect(anomaly?.message).toMatch(/41,500/);
    expect(anomaly?.message).toMatch(/30,000/);
  });

  it('lets an acknowledgement through', () => {
    expect(assessBookIn(
      draft({ mileage: 30_000, highestMotMileage: 41_500, mileageAnomalyAcknowledged: true }),
      NOW,
    ).ok).toBe(true);
  });

  it('says nothing when there is no MOT history to compare against', () => {
    expect(codes(draft({ mileage: 30_000, highestMotMileage: null })))
      .not.toContain('mileage_anomaly');
  });

  it('is fine when the reading is above the MOT history, which is the normal case', () => {
    expect(codes(draft({ mileage: 55_000, highestMotMileage: 41_500 })))
      .not.toContain('mileage_anomaly');
  });

  it('refuses a negative reading', () => {
    expect(codes(draft({ mileage: -1 }))).toContain('mileage_negative');
  });

  it('warns rather than blocks on an implausibly high reading', () => {
    // A 500,000-mile taxi exists. An extra digit is more likely, but refusing
    // the real car to catch the typo is the wrong trade.
    const result = assessBookIn(draft({ mileage: 999_999, highestMotMileage: null }), NOW);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('mileage_implausible');
  });
});

describe('dates', () => {
  it('refuses a purchase date in the future', () => {
    expect(codes(draft({ purchaseDate: '2026-12-25' }))).toContain('purchase_date_future');
  });

  it('accepts today as a purchase date', () => {
    // A car bought this morning is the common case, and an off-by-one here
    // would reject it.
    expect(codes(draft({ purchaseDate: '2026-09-02' }))).not.toContain('purchase_date_future');
  });

  it('refuses a first registration in the future', () => {
    expect(codes(draft({ firstRegisteredOn: '2027-01-01' })))
      .toContain('first_registered_future');
  });

  it('warns on a first registration before UK records', () => {
    const result = assessBookIn(draft({ firstRegisteredOn: '1804-01-01' }), NOW);
    expect(result.warnings.map((w) => w.code)).toContain('first_registered_implausible');
    expect(result.ok).toBe(true);
  });
});

describe('money', () => {
  it('refuses negative prices', () => {
    expect(codes(draft({ purchasePricePence: -1n }))).toContain('purchase_price_negative');
    expect(codes(draft({ retailPricePence: -1n }))).toContain('retail_price_negative');
  });

  it('warns when the stock book fields are missing rather than blocking the book-in', () => {
    const result = assessBookIn(draft({
      purchasePricePence: null, purchaseDate: null, purchaseSource: null,
    }), NOW);
    expect(result.ok).toBe(true);
    const warned = result.warnings.map((w) => w.code);
    expect(warned).toContain('no_purchase_price');
    expect(warned).toContain('no_purchase_date');
    expect(warned).toContain('no_purchase_source');
  });

  it('accepts a zero purchase price, because a gifted or written-down car is real', () => {
    expect(codes(draft({ purchasePricePence: 0n }))).not.toContain('purchase_price_negative');
  });
});

describe('the VAT scheme at book-in', () => {
  it('warns rather than blocks when it is not set', () => {
    const result = assessBookIn(draft({ vatScheme: null }), NOW);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('no_vat_scheme');
  });

  it('carries the suggestion into the warning, so the answer is on screen', () => {
    const result = assessBookIn(draft({ vatScheme: null, purchaseSource: 'private' }), NOW);
    const warning = result.warnings.find((w) => w.code === 'no_vat_scheme');
    expect(warning?.message).toMatch(/margin scheme applies/);
  });

  it('does not pretend to know when the source does not say', () => {
    const result = assessBookIn(draft({ vatScheme: null, purchaseSource: 'auction' }), NOW);
    const warning = result.warnings.find((w) => w.code === 'no_vat_scheme');
    expect(warning?.message).toMatch(/must be decided before this car can go live/);
  });
});

describe('parsing pounds into pence', () => {
  it('reads whole pounds', () => {
    expect(parsePoundsToPence('8995')).toEqual({ ok: true, pence: 899_500n });
  });

  it('reads pounds and pence', () => {
    expect(parsePoundsToPence('8995.50')).toEqual({ ok: true, pence: 899_550n });
  });

  it('pads a single decimal, so 8995.5 is fifty pence and not five', () => {
    expect(parsePoundsToPence('8995.5')).toEqual({ ok: true, pence: 899_550n });
  });

  it('tolerates what a person actually types', () => {
    expect(parsePoundsToPence(' £8,995.50 ')).toEqual({ ok: true, pence: 899_550n });
    expect(parsePoundsToPence('£12,499')).toEqual({ ok: true, pence: 1_249_900n });
  });

  it('reads a bare decimal', () => {
    expect(parsePoundsToPence('.50')).toEqual({ ok: true, pence: 50n });
  });

  it('treats empty as absent, not as zero', () => {
    // A dealer who has not entered a purchase price has not said it was free.
    // The stock book and the go-live gate both need to tell those apart.
    expect(parsePoundsToPence('')).toEqual({ ok: true, pence: null });
    expect(parsePoundsToPence('   ')).toEqual({ ok: true, pence: null });
  });

  it('reads an explicit zero as zero', () => {
    expect(parsePoundsToPence('0')).toEqual({ ok: true, pence: 0n });
    expect(parsePoundsToPence('0.00')).toEqual({ ok: true, pence: 0n });
  });

  it('refuses text, and says what a valid amount looks like', () => {
    const result = parsePoundsToPence('nine thousand');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/8995.50/);
  });

  it('refuses more than two decimal places rather than silently rounding', () => {
    // Rounding here would be this code inventing a price. Two decimals is
    // what a price is; a third is a typo the dealer should see.
    expect(parsePoundsToPence('8995.505').ok).toBe(false);
  });

  it('refuses a negative amount', () => {
    expect(parsePoundsToPence('-100').ok).toBe(false);
  });

  it('never loses a penny — the float route does', () => {
    // Math.round(parseFloat('8995.10') * 100) is 899510 by luck and
    // parseFloat('1.005') * 100 is 100.49999999999999 by design. This path
    // constructs no float at all, so it round-trips exactly for every value.
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 99_999_999n }),
        (pence) => {
          const pounds = pence / 100n;
          const remainder = pence % 100n;
          const text = `${pounds}.${String(remainder).padStart(2, '0')}`;
          expect(parsePoundsToPence(text)).toEqual({ ok: true, pence });
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('repricing', () => {
  it('accepts a rise and reports the delta', () => {
    expect(validateReprice(1_000_000n, 1_050_000n)).toEqual({ ok: true, deltaPence: 50_000n });
  });

  it('accepts a drop and reports it as negative', () => {
    expect(validateReprice(1_000_000n, 950_000n)).toEqual({ ok: true, deltaPence: -50_000n });
  });

  it('treats a first price as a rise from nothing', () => {
    expect(validateReprice(null, 1_000_000n)).toEqual({ ok: true, deltaPence: 1_000_000n });
  });

  it('refuses a negative price', () => {
    expect(validateReprice(1_000_000n, -1n).ok).toBe(false);
  });

  it('refuses zero, because a published £0 car is an advert for a free car', () => {
    const result = validateReprice(1_000_000n, 0n);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/take the car off sale/);
  });

  it('refuses a no-op rather than appending a history row that says nothing happened', () => {
    // vehicle_prices is append-only and the public site's price-drop badge
    // reads it. An identical row is a lie about a reprice that never occurred.
    const result = validateReprice(1_000_000n, 1_000_000n);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already at/);
  });

  it('the delta always reconciles the two prices', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        (current, next) => {
          const result = validateReprice(current, next);
          if (result.ok) {
            expect(current + result.deltaPence!).toBe(next);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
