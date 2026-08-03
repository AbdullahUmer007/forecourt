/**
 * M11 — the VAT margin scheme stock book.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED VAT SPECIALIST'S SIGN-OFF.
 *
 * This is the record HMRC asks to see on an inspection, and the one thing a
 * dealer using the margin scheme cannot be without: no stock book, no margin
 * scheme, and every sale becomes standard-rated retrospectively.
 *
 * Twelve mandatory fields (VAT Notice 718/1 §5.2), retained at least six
 * years, immutable once the sale is invoiced. Corrections are adjusting
 * entries that reference what they correct — the original is never edited,
 * because an editable stock book is not evidence of anything.
 *
 * The health report is the product feature here. Most dealers discover their
 * stock book is incomplete during an inspection; the point of this module is
 * that they find out on the day the field is missed.
 */

import { type Money, money, subtract, zero, isNegative, format } from './money.js';
import { STOCK_BOOK_REQUIRED_FIELDS, type StockBookField, type VatRule } from './vat.js';

export interface StockBookEntry {
  id: string;
  tenantId: string;
  vehicleId: string | null;
  entryNumber: bigint;

  // Purchase side — completed at book-in.
  purchaseDate: Date | null;
  purchaseInvoiceRef: string | null;
  purchasePrice: Money | null;
  sellerName: string | null;
  sellerAddress: string | null;
  registration: string | null;
  vehicleDescription: string | null;

  // Sale side — completed at invoice.
  saleDate: Date | null;
  saleInvoiceNumber: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  sellingPrice: Money | null;
  margin: Money | null;
  vatDue: Money | null;

  vatRuleVersion: number | null;
  correctsEntryId: string | null;
  correctionReason: string | null;
}

/**
 * Which of the twelve fields this entry is missing.
 *
 * The sale-side fields are only required once the vehicle has sold — a car
 * sitting on the forecourt has a legitimately incomplete entry, and flagging
 * it would train the dealer to ignore the report. That distinction is what
 * makes the health report worth looking at.
 */
export function missingFields(entry: StockBookEntry): StockBookField[] {
  const sold = entry.saleDate !== null || entry.sellingPrice !== null;

  const present: Record<StockBookField, unknown> = {
    entryNumber: entry.entryNumber,
    purchaseDate: entry.purchaseDate,
    purchaseInvoiceRef: entry.purchaseInvoiceRef,
    purchasePrice: entry.purchasePrice,
    sellerName: entry.sellerName,
    registration: entry.registration,
    vehicleDescription: entry.vehicleDescription,
    // Only meaningful once sold.
    saleDate: sold ? entry.saleDate : 'n/a',
    saleInvoiceNumber: sold ? entry.saleInvoiceNumber : 'n/a',
    buyerName: sold ? entry.buyerName : 'n/a',
    sellingPrice: sold ? entry.sellingPrice : 'n/a',
    marginAndVat: sold ? (entry.margin !== null && entry.vatDue !== null ? 'ok' : null) : 'n/a',
  };

  return STOCK_BOOK_REQUIRED_FIELDS.filter((f) => {
    const v = present[f];
    return v === undefined || v === null || v === '';
  });
}

export interface EntryHealth {
  entryNumber: bigint;
  registration: string | null;
  missing: StockBookField[];
  /** True once the vehicle has sold — an incomplete SOLD entry is the serious one. */
  sold: boolean;
  severity: 'ok' | 'incomplete' | 'critical';
}

export interface StockBookHealth {
  entries: number;
  complete: number;
  /** Sold vehicles with a missing mandatory field. These are the ones that bite. */
  critical: EntryHealth[];
  incomplete: EntryHealth[];
  /** Gaps in the entry-number sequence — the first thing an inspector notices. */
  numberGaps: bigint[];
  summary: string;
}

/**
 * The stock book health report.
 *
 * Severity is the whole design: an unsold vehicle missing its sale fields is
 * `ok`; an unsold vehicle missing its PURCHASE fields is `incomplete`, because
 * the dealer can still go and find the paperwork; a SOLD vehicle with anything
 * missing is `critical`, because the margin has already been declared on a
 * record that cannot support it.
 */
export function stockBookHealth(entries: readonly StockBookEntry[]): StockBookHealth {
  const assessed: EntryHealth[] = entries.map((e) => {
    const missing = missingFields(e);
    const sold = e.saleDate !== null || e.sellingPrice !== null;
    return {
      entryNumber: e.entryNumber,
      registration: e.registration,
      missing,
      sold,
      severity: missing.length === 0 ? 'ok' : sold ? 'critical' : 'incomplete',
    };
  });

  const critical = assessed.filter((a) => a.severity === 'critical');
  const incomplete = assessed.filter((a) => a.severity === 'incomplete');
  const complete = assessed.filter((a) => a.severity === 'ok').length;

  const numbers = entries.map((e) => e.entryNumber).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const numberGaps: bigint[] = [];
  if (numbers.length > 0) {
    for (let n = numbers[0]!; n <= numbers[numbers.length - 1]!; n++) {
      if (!numbers.includes(n)) numberGaps.push(n);
    }
  }

  const summary =
    critical.length > 0
      ? `${critical.length} sold ${critical.length === 1 ? 'vehicle is' : 'vehicles are'} missing mandatory stock book details. Fix these first — the margin has already been declared against them.`
      : incomplete.length > 0
        ? `${incomplete.length} ${incomplete.length === 1 ? 'entry needs' : 'entries need'} completing before those cars sell.`
        : numberGaps.length > 0
          ? `Every entry is complete, but there ${numberGaps.length === 1 ? 'is a gap' : 'are gaps'} in the numbering.`
          : 'Every entry is complete.';

  return { entries: entries.length, complete, critical, incomplete, numberGaps, summary };
}

/**
 * Complete the sale side of an entry, computing the margin and its VAT.
 *
 * The margin is never negative for VAT purposes and a loss is NEVER offset
 * against another vehicle — each one stands alone. That is enforced in
 * `calculateMarginScheme`; this function records the result and the rule
 * version that produced it, so a historic entry can be re-derived exactly
 * after the rate changes.
 */
export function completeSale(
  entry: StockBookEntry,
  sale: {
    saleDate: Date;
    saleInvoiceNumber: string;
    buyerName: string;
    buyerAddress: string | null;
    sellingPrice: Money;
  },
  rule: VatRule,
): { entry: StockBookEntry; error: string | null } {
  if (entry.purchasePrice === null) {
    return {
      entry,
      error: 'This entry has no purchase price, so the margin cannot be computed. Add the purchase invoice first.',
    };
  }
  if (entry.saleDate !== null) {
    return {
      entry,
      error: 'This entry is already sold. Corrections are made as an adjusting entry, not by editing this one.',
    };
  }

  const rawMargin = subtract(sale.sellingPrice, entry.purchasePrice);
  const isLoss = isNegative(rawMargin);
  const margin = isLoss ? zero(sale.sellingPrice.currency) : rawMargin;
  const vatDue = isLoss
    ? zero(sale.sellingPrice.currency)
    : money((margin.amount * rule.numerator + rule.denominator / 2n) / rule.denominator,
            margin.currency);

  return {
    entry: {
      ...entry,
      saleDate: sale.saleDate,
      saleInvoiceNumber: sale.saleInvoiceNumber,
      buyerName: sale.buyerName,
      buyerAddress: sale.buyerAddress,
      sellingPrice: sale.sellingPrice,
      margin,
      vatDue,
      vatRuleVersion: Number(rule.effectiveFrom.slice(0, 4)),
    },
    error: null,
  };
}

/**
 * Build an adjusting entry that corrects an earlier one.
 *
 * The original stays exactly as it was. This is the only lawful way to fix a
 * stock book entry after the sale is invoiced, and the reason is mandatory
 * because "why does this say something different?" is the first question
 * anyone will ask about it.
 */
export function correctEntry(
  original: StockBookEntry,
  corrections: Partial<StockBookEntry>,
  reason: string,
  entryNumber: bigint,
): StockBookEntry {
  if (!reason.trim()) {
    throw new Error('A stock book correction must say why. An unexplained adjustment is worse than the error.');
  }
  return {
    ...original,
    ...corrections,
    id: `${original.id}-correction`,
    entryNumber,
    correctsEntryId: original.id,
    correctionReason: reason,
  };
}

/**
 * The VAT return figure for a period: the sum of margin VAT on entries SOLD in
 * that period.
 *
 * Summed per entry from each entry's own stored `vatDue`, never by aggregating
 * margins and applying the fraction once. Those two give different answers —
 * a +£500 and a −£300 margin produce £83.33, not £33.33 — and the second is
 * the one that gets a dealer assessed for underpaid VAT.
 */
export function vatDueForPeriod(
  entries: readonly StockBookEntry[],
  from: Date,
  to: Date,
): { vatDue: Money; entryCount: number; lossMakers: number } {
  const inPeriod = entries.filter((e) =>
    e.saleDate !== null && e.saleDate >= from && e.saleDate <= to && e.correctsEntryId === null);

  const vatDue = inPeriod.reduce(
    (acc, e) => (e.vatDue ? money(acc.amount + e.vatDue.amount, acc.currency) : acc),
    zero('GBP'),
  );

  return {
    vatDue,
    entryCount: inPeriod.length,
    // A loss-maker has a zero margin. Worth surfacing: a dealer seeing several
    // is looking at a buying problem, not a VAT one.
    lossMakers: inPeriod.filter((e) => e.margin?.amount === 0n).length,
  };
}

/** VAT Notice 718/1: stock book and invoices retained at least six years. */
export const STOCK_BOOK_RETENTION_YEARS = 6;

export function retainUntil(saleDate: Date, years = STOCK_BOOK_RETENTION_YEARS): Date {
  const d = new Date(saleDate);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export const describeVatDue = (v: { vatDue: Money; entryCount: number }): string =>
  `${format(v.vatDue)} of margin VAT across ${v.entryCount} ${v.entryCount === 1 ? 'sale' : 'sales'}`;
