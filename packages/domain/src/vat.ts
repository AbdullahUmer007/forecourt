/**
 * VAT — the second-hand margin scheme and VAT-qualifying stock.
 *
 * The rules that must never be got wrong (see the forecourt-domain skill §3):
 *  - Margin VAT = gross margin × 1/6 at a 20% standard rate
 *  - A negative margin produces NO VAT and CANNOT be offset against another vehicle
 *  - A margin-scheme invoice must NOT show VAT separately
 *
 * Every rate and fraction comes from `compliance_rules`, keyed on the sale date.
 * There is deliberately no exported constant for the VAT fraction.
 */

import { type Money, money, multiply, subtract, zero, isNegative } from './money.js';

export type VatScheme = 'margin' | 'qualifying' | 'non_qualifying';

/** Resolved from `compliance_rules` for the relevant date. Never hard-code these. */
export interface VatRule {
  readonly key: 'vat.margin_fraction';
  readonly effectiveFrom: string; // ISO date
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly standardRateBps: number; // 2000 = 20%
  readonly sourceUrl: string;
}

export interface MarginCalculation {
  readonly scheme: 'margin';
  readonly purchasePrice: Money;
  readonly sellingPrice: Money;
  /** Never negative. A loss-making vehicle has a zero margin for VAT purposes. */
  readonly margin: Money;
  /** True when the vehicle sold at or below cost. Recorded, never offset. */
  readonly isLoss: boolean;
  readonly vatDue: Money;
  readonly ruleApplied: VatRule;
  /** A margin-scheme invoice must not show VAT separately. */
  readonly showVatOnInvoice: false;
}

export interface QualifyingCalculation {
  readonly scheme: 'qualifying';
  readonly sellingPrice: Money; // VAT-inclusive
  readonly net: Money;
  readonly vatDue: Money;
  readonly ruleApplied: VatRule;
  readonly showVatOnInvoice: true;
}

export type VatCalculation = MarginCalculation | QualifyingCalculation;

/**
 * Margin scheme.
 *
 * A negative margin yields zero VAT. The loss is recorded on the calculation
 * so it can be reported, but it is never available for offset — each vehicle
 * stands alone. There is no code path in this module that aggregates margins
 * before applying the fraction.
 */
export function calculateMarginScheme(
  purchasePrice: Money,
  sellingPrice: Money,
  rule: VatRule,
): MarginCalculation {
  const rawMargin = subtract(sellingPrice, purchasePrice);
  const isLoss = isNegative(rawMargin);
  const margin = isLoss ? zero(sellingPrice.currency) : rawMargin;
  const vatDue = isLoss
    ? zero(sellingPrice.currency)
    : multiply(margin, rule.numerator, rule.denominator, 'half-up');

  return {
    scheme: 'margin',
    purchasePrice,
    sellingPrice,
    margin,
    isLoss,
    vatDue,
    ruleApplied: rule,
    showVatOnInvoice: false,
  };
}

/** VAT-qualifying stock — VAT charged on the full selling price. */
export function calculateQualifying(sellingPriceInclusive: Money, rule: VatRule): QualifyingCalculation {
  const denominator = BigInt(10_000 + rule.standardRateBps);
  const net = multiply(sellingPriceInclusive, 10_000n, denominator, 'half-up');
  const vatDue = subtract(sellingPriceInclusive, net);
  return {
    scheme: 'qualifying',
    sellingPrice: sellingPriceInclusive,
    net,
    vatDue,
    ruleApplied: rule,
    showVatOnInvoice: true,
  };
}

export function calculateVat(
  scheme: VatScheme,
  { purchasePrice, sellingPrice }: { purchasePrice: Money; sellingPrice: Money },
  rule: VatRule,
): VatCalculation {
  switch (scheme) {
    case 'margin':
      return calculateMarginScheme(purchasePrice, sellingPrice, rule);
    case 'qualifying':
      return calculateQualifying(sellingPrice, rule);
    case 'non_qualifying':
      return {
        scheme: 'qualifying',
        sellingPrice,
        net: sellingPrice,
        vatDue: money(0n, sellingPrice.currency),
        ruleApplied: rule,
        showVatOnInvoice: true,
      };
  }
}

/**
 * Guard used by the invoice renderer and asserted by a golden-file test.
 * A margin-scheme invoice containing a VAT line must fail the build.
 */
export function assertInvoiceVatPresentation(
  calc: VatCalculation,
  invoiceLines: readonly { vatAmount: Money }[],
): void {
  if (calc.scheme === 'margin') assertMarginInvoiceShowsNoVat(invoiceLines);
}

/**
 * The same rule, reachable without a calculation in hand.
 *
 * The renderer knows the scheme but does not always have the margin figure —
 * a draft has no purchase price yet, and a credit note carries the original's
 * scheme rather than its own calculation. Rather than fabricating a
 * calculation object to satisfy a signature, both entry points delegate here,
 * so there is ONE implementation of "a margin invoice shows no VAT" and one
 * message.
 */
export function assertMarginInvoiceShowsNoVat(
  invoiceLines: readonly { vatAmount: Money }[],
): void {
  if (invoiceLines.some((l) => l.vatAmount.amount !== 0n)) {
    throw new Error(
      'A margin-scheme invoice must not show VAT separately. Showing it makes the ' +
        'whole sale standard-rated. See VAT Notice 718/1.',
    );
  }
}

/** The 12 mandatory HMRC stock-book fields. Enforced at book-in and at invoice. */
export const STOCK_BOOK_REQUIRED_FIELDS = [
  'entryNumber',
  'purchaseDate',
  'purchaseInvoiceRef',
  'purchasePrice',
  'sellerName',
  'registration',
  'vehicleDescription',
  'saleDate',
  'saleInvoiceNumber',
  'buyerName',
  'sellingPrice',
  'marginAndVat',
] as const;

export type StockBookField = (typeof STOCK_BOOK_REQUIRED_FIELDS)[number];

export const missingStockBookFields = (entry: Partial<Record<StockBookField, unknown>>): StockBookField[] =>
  STOCK_BOOK_REQUIRED_FIELDS.filter((f) => entry[f] === undefined || entry[f] === null || entry[f] === '');
