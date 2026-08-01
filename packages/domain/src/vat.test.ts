import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fromPounds, money, format, allocate, sum, zero } from './money.js';
import { calculateMarginScheme, calculateQualifying, assertInvoiceVatPresentation, type VatRule } from './vat.js';

/** The rule as it would be resolved from `compliance_rules` for a 2026 sale date. */
const RULE_2026: VatRule = {
  key: 'vat.margin_fraction',
  effectiveFrom: '2011-01-04',
  numerator: 1n,
  denominator: 6n,
  standardRateBps: 2000,
  sourceUrl: 'https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181',
};

describe('margin scheme', () => {
  it('charges VAT on the margin at one sixth', () => {
    // HMRC's own worked example: buy 1,500, sell 2,000, margin 500, VAT 83.33
    const calc = calculateMarginScheme(fromPounds('1500.00'), fromPounds('2000.00'), RULE_2026);
    expect(format(calc.margin)).toBe('£500.00');
    expect(format(calc.vatDue)).toBe('£83.33');
    expect(calc.showVatOnInvoice).toBe(false);
  });

  it('charges no VAT on a loss and records it as a loss', () => {
    const calc = calculateMarginScheme(fromPounds('9800.00'), fromPounds('9500.00'), RULE_2026);
    expect(calc.isLoss).toBe(true);
    expect(format(calc.margin)).toBe('£0.00');
    expect(format(calc.vatDue)).toBe('£0.00');
  });

  it('NEVER offsets a negative margin against another vehicle', () => {
    // Two vehicles: +£500 and −£300. Correct total VAT is £83.33, not £33.33.
    const profitable = calculateMarginScheme(fromPounds('1500'), fromPounds('2000'), RULE_2026);
    const lossMaking = calculateMarginScheme(fromPounds('1800'), fromPounds('1500'), RULE_2026);
    const total = sum([profitable.vatDue, lossMaking.vatDue]);
    expect(format(total)).toBe('£83.33');
    expect(format(total)).not.toBe('£33.33');
  });

  it('rounds half-up at the penny', () => {
    // margin £0.03 → 0.5p → rounds to 1p
    const calc = calculateMarginScheme(money(0n), money(3n), RULE_2026);
    expect(calc.vatDue.amount).toBe(1n);
  });
});

describe('VAT-qualifying stock', () => {
  it('charges VAT on the full selling price and shows it', () => {
    const calc = calculateQualifying(fromPounds('12000.00'), RULE_2026);
    expect(format(calc.net)).toBe('£10,000.00');
    expect(format(calc.vatDue)).toBe('£2,000.00');
    expect(calc.showVatOnInvoice).toBe(true);
  });
});

describe('invoice presentation guard (golden rule)', () => {
  it('throws if a margin-scheme invoice would show VAT', () => {
    const calc = calculateMarginScheme(fromPounds('1500'), fromPounds('2000'), RULE_2026);
    expect(() => assertInvoiceVatPresentation(calc, [{ vatAmount: fromPounds('83.33') }])).toThrow(
      /must not show VAT separately/,
    );
  });

  it('passes when a margin-scheme invoice shows no VAT', () => {
    const calc = calculateMarginScheme(fromPounds('1500'), fromPounds('2000'), RULE_2026);
    expect(() => assertInvoiceVatPresentation(calc, [{ vatAmount: zero() }])).not.toThrow();
  });
});

describe('money properties', () => {
  it('never loses a penny when allocating', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 1, max: 24 }), (pence, parts) => {
        const parted = allocate(money(BigInt(pence)), parts);
        expect(parted).toHaveLength(parts);
        expect(sum(parted).amount).toBe(BigInt(pence));
      }),
      { numRuns: 500 },
    );
  });

  it('margin VAT is never more than the margin, and never negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (purchase, sell) => {
          const calc = calculateMarginScheme(money(BigInt(purchase)), money(BigInt(sell)), RULE_2026);
          expect(calc.vatDue.amount).toBeGreaterThanOrEqual(0n);
          expect(calc.vatDue.amount).toBeLessThanOrEqual(calc.margin.amount);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('parses pounds without float drift', () => {
    expect(fromPounds('0.1').amount).toBe(10n);
    expect(fromPounds('0.2').amount).toBe(20n);
    expect(sum([fromPounds('0.1'), fromPounds('0.2')]).amount).toBe(30n); // 0.1 + 0.2 === 0.3
    expect(fromPounds('£12,499.99').amount).toBe(1_249_999n);
    expect(fromPounds('19999').amount).toBe(1_999_900n);
  });

  it('formats compactly for stat tiles', () => {
    expect(format(fromPounds('4200000'), { compact: true })).toBe('£4.2M');
    expect(format(fromPounds('12900'), { compact: true })).toBe('£12.9K');
    expect(format(fromPounds('19999'), { pence: false })).toBe('£19,999');
  });
});
