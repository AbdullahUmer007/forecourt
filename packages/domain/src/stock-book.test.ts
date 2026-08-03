import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  missingFields, stockBookHealth, completeSale, correctEntry, vatDueForPeriod,
  retainUntil, STOCK_BOOK_RETENTION_YEARS,
  type StockBookEntry,
} from './stock-book.js';
import { money } from './money.js';
import type { VatRule } from './vat.js';

const RULE: VatRule = {
  key: 'vat.margin_fraction', effectiveFrom: '2011-01-04',
  numerator: 1n, denominator: 6n, standardRateBps: 2000,
  sourceUrl: 'https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181',
};

const D = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const entry = (over: Partial<StockBookEntry> = {}): StockBookEntry => ({
  id: 'e1', tenantId: 't1', vehicleId: 'v1', entryNumber: 1n,
  purchaseDate: D('2026-06-01'), purchaseInvoiceRef: 'PI-1001',
  purchasePrice: money(1_000_000n), sellerName: 'Auction House Ltd',
  sellerAddress: '1 Auction Way', registration: 'WN22HNL',
  vehicleDescription: '2022 Tesla Model X, VIN 5YJ...',
  saleDate: null, saleInvoiceNumber: null, buyerName: null, buyerAddress: null,
  sellingPrice: null, margin: null, vatDue: null,
  vatRuleVersion: null, correctsEntryId: null, correctionReason: null,
  ...over,
});

const sold = (over: Partial<StockBookEntry> = {}): StockBookEntry => entry({
  saleDate: D('2026-07-15'), saleInvoiceNumber: 'KEN-000042',
  buyerName: 'Dave Smith', sellingPrice: money(1_200_000n),
  margin: money(200_000n), vatDue: money(33_333n), vatRuleVersion: 2011,
  ...over,
});

// ------------------------------------------------------------- completeness
describe('the twelve mandatory fields', () => {
  it('treats an unsold vehicle’s missing sale fields as fine', () => {
    // A car on the forecourt has a legitimately incomplete entry. Flagging it
    // would train the dealer to ignore the report.
    expect(missingFields(entry())).toEqual([]);
  });

  it('requires the purchase side even before sale', () => {
    expect(missingFields(entry({ purchaseInvoiceRef: null }))).toContain('purchaseInvoiceRef');
    expect(missingFields(entry({ sellerName: null }))).toContain('sellerName');
  });

  it('requires the sale side once sold', () => {
    expect(missingFields(sold({ buyerName: null }))).toContain('buyerName');
    expect(missingFields(sold({ margin: null }))).toContain('marginAndVat');
  });

  it('passes a complete sold entry', () => {
    expect(missingFields(sold())).toEqual([]);
  });
});

// ------------------------------------------------------------ health report
describe('the stock book health report', () => {
  it('rates a SOLD incomplete entry as critical', () => {
    // The margin has already been declared against a record that cannot
    // support it. This is the one that bites in an inspection.
    const h = stockBookHealth([sold({ buyerName: null })]);
    expect(h.critical).toHaveLength(1);
    expect(h.critical[0]!.missing).toContain('buyerName');
    expect(h.summary).toMatch(/sold vehicle is missing/i);
  });

  it('rates an unsold incomplete entry as merely incomplete', () => {
    const h = stockBookHealth([entry({ purchaseInvoiceRef: null })]);
    expect(h.critical).toHaveLength(0);
    expect(h.incomplete).toHaveLength(1);
    expect(h.summary).toMatch(/before those cars sell/);
  });

  it('reports a clean book plainly', () => {
    const h = stockBookHealth([entry(), sold({ entryNumber: 2n })]);
    expect(h.complete).toBe(2);
    expect(h.summary).toBe('Every entry is complete.');
  });

  it('finds a gap in the entry numbers', () => {
    // The first thing an inspector notices.
    const h = stockBookHealth([entry({ entryNumber: 1n }), entry({ entryNumber: 3n })]);
    expect(h.numberGaps).toEqual([2n]);
  });

  it('leads with the critical count when there is one', () => {
    const h = stockBookHealth([sold({ buyerName: null }), entry({ entryNumber: 2n, sellerName: null })]);
    expect(h.summary).toMatch(/Fix these first/);
  });
});

// ------------------------------------------------------------ completing
describe('completing the sale side', () => {
  it('computes the margin and its VAT', () => {
    // HMRC's own worked example shape: £2,000 margin → £333.33.
    const r = completeSale(entry(), {
      saleDate: D('2026-07-15'), saleInvoiceNumber: 'KEN-000042',
      buyerName: 'Dave Smith', buyerAddress: '2 Buyer Street',
      sellingPrice: money(1_200_000n),
    }, RULE);
    expect(r.error).toBeNull();
    expect(r.entry.margin?.amount).toBe(200_000n);
    expect(r.entry.vatDue?.amount).toBe(33_333n);
  });

  it('gives a loss-making sale a zero margin and zero VAT', () => {
    const r = completeSale(entry({ purchasePrice: money(1_300_000n) }), {
      saleDate: D('2026-07-15'), saleInvoiceNumber: 'KEN-000042',
      buyerName: 'Dave', buyerAddress: null, sellingPrice: money(1_200_000n),
    }, RULE);
    expect(r.entry.margin?.amount).toBe(0n);
    expect(r.entry.vatDue?.amount).toBe(0n);
  });

  it('refuses without a purchase price, and says what to do', () => {
    const r = completeSale(entry({ purchasePrice: null }), {
      saleDate: D('2026-07-15'), saleInvoiceNumber: 'X', buyerName: 'D',
      buyerAddress: null, sellingPrice: money(1_200_000n),
    }, RULE);
    expect(r.error).toMatch(/purchase invoice first/);
  });

  it('refuses to re-sell an already-sold entry', () => {
    const r = completeSale(sold(), {
      saleDate: D('2026-08-01'), saleInvoiceNumber: 'Y', buyerName: 'E',
      buyerAddress: null, sellingPrice: money(1_300_000n),
    }, RULE);
    expect(r.error).toMatch(/adjusting entry/);
  });
});

// ------------------------------------------------------------ corrections
describe('corrections', () => {
  it('leaves the original untouched and points back at it', () => {
    const original = sold();
    const fix = correctEntry(original, { buyerName: 'David Smith' }, 'Name misspelled at sale', 99n);
    expect(original.buyerName).toBe('Dave Smith');
    expect(fix.buyerName).toBe('David Smith');
    expect(fix.correctsEntryId).toBe(original.id);
    expect(fix.entryNumber).toBe(99n);
  });

  it('demands a reason', () => {
    expect(() => correctEntry(sold(), {}, '   ', 99n)).toThrow(/must say why/);
  });
});

// --------------------------------------------------------------- VAT return
describe('the VAT return figure', () => {
  it('sums per entry, never by aggregating margins first', () => {
    // THE invariant from calculations.md §2: a +£500 and a −£300 margin
    // produce £83.33, not £33.33. The second is how a dealer gets assessed.
    const plus = completeSale(entry({ entryNumber: 1n, purchasePrice: money(100_000n) }), {
      saleDate: D('2026-07-10'), saleInvoiceNumber: 'A', buyerName: 'A',
      buyerAddress: null, sellingPrice: money(150_000n),
    }, RULE).entry;
    const minus = completeSale(entry({ id: 'e2', entryNumber: 2n, purchasePrice: money(100_000n) }), {
      saleDate: D('2026-07-11'), saleInvoiceNumber: 'B', buyerName: 'B',
      buyerAddress: null, sellingPrice: money(70_000n),
    }, RULE).entry;

    const v = vatDueForPeriod([plus, minus], D('2026-07-01'), D('2026-07-31'));
    expect(v.vatDue.amount).toBe(8_333n);   // £500 × 1/6, the loss ignored
    expect(v.lossMakers).toBe(1);
  });

  it('counts only sales inside the period', () => {
    const v = vatDueForPeriod([sold()], D('2026-08-01'), D('2026-08-31'));
    expect(v.entryCount).toBe(0);
    expect(v.vatDue.amount).toBe(0n);
  });

  it('excludes adjusting entries from the total', () => {
    // An adjusting entry restates; counting both would double the VAT.
    const fix = correctEntry(sold(), { vatDue: money(40_000n) }, 'Price corrected', 2n);
    const v = vatDueForPeriod([sold(), fix], D('2026-07-01'), D('2026-07-31'));
    expect(v.entryCount).toBe(1);
  });
});

describe('retention', () => {
  it('keeps the record six years from the sale', () => {
    expect(retainUntil(D('2026-07-15')).toISOString().slice(0, 10)).toBe('2032-07-15');
    expect(STOCK_BOOK_RETENTION_YEARS).toBe(6);
  });
});

// ------------------------------------------------------------- properties
describe('stock book money properties', () => {
  it('margin VAT is never negative, for any purchase and sale pair', () => {
    fc.assert(fc.property(
      fc.bigInt(1n, 9_000_000n), fc.bigInt(1n, 9_000_000n),
      (purchase, sale) => {
        const r = completeSale(entry({ purchasePrice: money(purchase) }), {
          saleDate: D('2026-07-15'), saleInvoiceNumber: 'X', buyerName: 'B',
          buyerAddress: null, sellingPrice: money(sale),
        }, RULE);
        expect(r.entry.margin!.amount >= 0n).toBe(true);
        expect(r.entry.vatDue!.amount >= 0n).toBe(true);
      },
    ), { numRuns: 500 });
  });

  it('a loss NEVER reduces the VAT owed on another vehicle', () => {
    // Each vehicle stands alone. This is the property that makes the whole
    // per-entry design necessary rather than merely tidy.
    fc.assert(fc.property(
      fc.bigInt(1n, 5_000_000n), fc.bigInt(1n, 5_000_000n),
      (profitMargin, lossSize) => {
        const winner = completeSale(entry({ entryNumber: 1n, purchasePrice: money(1_000_000n) }), {
          saleDate: D('2026-07-10'), saleInvoiceNumber: 'A', buyerName: 'A',
          buyerAddress: null, sellingPrice: money(1_000_000n + profitMargin),
        }, RULE).entry;
        const loser = completeSale(entry({ id: 'e2', entryNumber: 2n, purchasePrice: money(1_000_000n + lossSize) }), {
          saleDate: D('2026-07-11'), saleInvoiceNumber: 'B', buyerName: 'B',
          buyerAddress: null, sellingPrice: money(1_000_000n),
        }, RULE).entry;

        const both = vatDueForPeriod([winner, loser], D('2026-07-01'), D('2026-07-31'));
        const aloneWithWinner = vatDueForPeriod([winner], D('2026-07-01'), D('2026-07-31'));
        expect(both.vatDue.amount).toBe(aloneWithWinner.vatDue.amount);
      },
    ), { numRuns: 400 });
  });
});
