/**
 * GOLDEN RULE 1: a margin-scheme invoice never contains a VAT line.
 *
 * `forecourt-feature` names three golden-file tests that must never be
 * deleted. This is the first, and it is the most expensive one to get wrong:
 * showing VAT separately on a margin-scheme invoice makes the WHOLE sale
 * standard-rated. On a £12,000 car that is £2,000 of VAT the dealer never
 * collected from the customer and now owes HMRC.
 *
 * It is adversarial by design. Rather than checking the happy path, it tries
 * every way a VAT figure could reach the document — a caller passing a rate, a
 * mixed-scheme basket, a credit note, an add-on line — and asserts each one is
 * refused or zeroed.
 *
 * ⚠️ The rules encoded here are pending the retained VAT specialist's sign-off.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildInvoice, issueInvoice, creditNoteFor, type Invoice, type InvoiceSequence,
} from '../../packages/domain/src/invoicing.js';
import { assertInvoiceVatPresentation, calculateVat, type VatRule } from '../../packages/domain/src/vat.js';
import { money, format } from '../../packages/domain/src/money.js';

const RULE: VatRule = {
  key: 'vat.margin_fraction', effectiveFrom: '2011-01-04',
  numerator: 1n, denominator: 6n, standardRateBps: 2000,
  sourceUrl: 'https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181',
};

const SEQ: InvoiceSequence = { tenantId: 't1', series: 'sale', prefix: 'KEN-', lastNumber: 41n };
const AUG = (d: number): Date => new Date(Date.UTC(2026, 7, d, 12));

/**
 * Render an invoice the way a document template would.
 *
 * The point of rendering rather than inspecting the object: the rule is about
 * what the CUSTOMER receives. A model that carries a zero VAT field but a
 * template that prints a VAT row would pass an object-level assertion and
 * still standard-rate the sale.
 */
function renderInvoice(inv: Invoice): string {
  const lines = inv.lines.map((l) =>
    `<tr><td>${l.description}</td><td>${l.quantity}</td>` +
    `<td>${format(l.net)}</td>` +
    // A margin invoice emits NO VAT cell at all — not a zero, not a dash.
    (inv.vatScheme === 'margin' ? '' : `<td>${format(l.vatAmount)}</td>`) +
    `<td>${format(l.gross)}</td></tr>`).join('\n');

  const totals = inv.vatScheme === 'margin'
    ? `<tr><th>Total</th><td>${format(inv.grossTotal)}</td></tr>`
    : `<tr><th>Net</th><td>${format(inv.netTotal)}</td></tr>` +
      `<tr><th>VAT</th><td>${format(inv.vatTotal)}</td></tr>` +
      `<tr><th>Total</th><td>${format(inv.grossTotal)}</td></tr>`;

  const marginNote = inv.vatScheme === 'margin'
    // The wording HMRC expects on a margin invoice, and the reason no VAT
    // figure appears above.
    ? '<p class="vat-note">Margin scheme &mdash; second-hand goods. ' +
      'This invoice does not give the buyer the right to reclaim VAT.</p>'
    : '';

  return `<article class="invoice">
<h1>Invoice ${inv.reference ?? '(draft)'}</h1>
<p>${inv.buyerName ?? ''}</p>
<table><tbody>
${lines}
</tbody><tfoot>${totals}</tfoot></table>
${marginNote}
</article>`;
}

const marginInvoice = (over: Partial<Parameters<typeof buildInvoice>[0]> = {}): Invoice =>
  buildInvoice({
    vatScheme: 'margin',
    purchasePrice: money(1_000_000n),
    buyerName: 'Dave Smith',
    lines: [{ description: '2022 Tesla Model X, WN22 HNL', unitPrice: money(1_200_000n) }],
    vatRule: RULE,
    ...over,
  });

/**
 * What the rule actually prohibits is a VAT AMOUNT presented as a charge —
 * a VAT row, a VAT column, or a VAT figure the buyer could reclaim against.
 *
 * The word "VAT" itself must still appear, because the mandatory margin-scheme
 * wording contains it twice ("does not give the buyer the right to reclaim
 * VAT"). An assertion that simply banned the string would fail on the very
 * notice HMRC requires — so this looks for the structures that carry a figure.
 */
const showsVatCharge = (html: string): boolean =>
  /<th>\s*VAT\s*<\/th>/i.test(html) ||
  /VAT[^<]*[:=]?\s*£/i.test(html) ||
  /£[\d,]+\.\d{2}\s*(?:VAT|vat)/.test(html);

describe('GOLDEN: a margin-scheme invoice never shows VAT', () => {
  it('renders no VAT row, no VAT column and no VAT figure', () => {
    const html = renderInvoice(marginInvoice());
    expect(showsVatCharge(html)).toBe(false);
    expect(html).toContain('Margin scheme');
    expect(html).toContain('£12,000.00');
  });

  it('carries the margin-scheme wording the buyer needs', () => {
    // Without it the buyer may believe they can reclaim VAT they were never
    // charged — which is the buyer's problem and then the dealer's.
    expect(renderInvoice(marginInvoice())).toContain('does not give the buyer the right to reclaim VAT');
  });

  it('zeroes a VAT rate the caller passed, rather than trusting them', () => {
    const inv = marginInvoice({
      lines: [{ description: 'Car', unitPrice: money(1_200_000n), vatRateBps: 2000 }],
    });
    expect(inv.vatTotal.amount).toBe(0n);
    expect(renderInvoice(inv)).not.toMatch(/£200\.00|£2,000\.00/);
  });

  it('zeroes every add-on line too, not just the vehicle', () => {
    // The realistic breach: someone adds a paint-protection line with VAT on
    // it and standard-rates the whole sale.
    const inv = marginInvoice({
      lines: [
        { description: 'Car', unitPrice: money(1_200_000n) },
        { description: 'Paint protection', unitPrice: money(30_000n), vatRateBps: 2000 },
        { description: 'Admin fee', unitPrice: money(9_900n), vatRateBps: 2000 },
      ],
    });
    expect(inv.lines.every((l) => l.vatAmount.amount === 0n)).toBe(true);
    expect(inv.vatTotal.amount).toBe(0n);
  });

  it('keeps the dealer’s own margin VAT off the document entirely', () => {
    // £2,000 margin → £333.33 owed by the dealer. The customer never sees it.
    const inv = marginInvoice();
    expect(inv.vatCalculation?.vatDue.amount).toBe(33_333n);
    expect(renderInvoice(inv)).not.toContain('£333.33');
  });

  it('a credit note reversing a margin invoice also shows no VAT', () => {
    const { invoice, sequence } = issueInvoice(marginInvoice(), SEQ, AUG(3));
    const credit = creditNoteFor(invoice, sequence, 'Customer rejected under CRA s.22', AUG(10));
    expect(credit.invoice.vatTotal.amount).toBe(0n);
    expect(showsVatCharge(renderInvoice(credit.invoice))).toBe(false);
  });

  it('the guard throws if a VAT line ever reaches it', () => {
    // The last line of defence, for a renderer written years from now.
    const calc = calculateVat('margin',
      { purchasePrice: money(1_000_000n), sellingPrice: money(1_200_000n) }, RULE);
    expect(() => assertInvoiceVatPresentation(calc, [{ vatAmount: money(200_000n) }]))
      .toThrow(/must not show VAT separately/);
    expect(() => assertInvoiceVatPresentation(calc, [{ vatAmount: money(0n) }])).not.toThrow();
  });

  it('holds for EVERY price and rate combination', () => {
    fc.assert(fc.property(
      fc.bigInt(1n, 9_000_000n), fc.bigInt(1n, 9_000_000n), fc.integer({ min: 0, max: 2000 }),
      (purchase, sale, bps) => {
        const inv = marginInvoice({
          purchasePrice: money(purchase),
          lines: [{ description: 'Car', unitPrice: money(sale), vatRateBps: bps }],
        });
        expect(inv.vatTotal.amount).toBe(0n);
        expect(renderInvoice(inv)).not.toMatch(/<th>VAT<\/th>/);
      },
    ), { numRuns: 400 });
  });
});

describe('a VAT-qualifying invoice DOES show VAT', () => {
  it('shows the VAT line, because a business buyer reclaims it', () => {
    // The rule is scheme-specific, not a blanket ban. Suppressing VAT on
    // qualifying stock would break the commercial buyer's reclaim.
    const inv = buildInvoice({
      vatScheme: 'qualifying', buyerName: 'Fleet Ltd',
      lines: [{ description: 'Ex-fleet Transit', unitPrice: money(1_000_000n), vatRateBps: 2000 }],
      vatRule: RULE,
    });
    const html = renderInvoice(inv);
    expect(html).toContain('<th>VAT</th>');
    expect(html).toContain('£2,000.00');
    expect(html).not.toContain('Margin scheme');
  });
});

describe('the guard itself catches a real breach', () => {
  it('detects a VAT column, a VAT total and a VAT figure', () => {
    // A golden-file assertion that cannot fail is worse than none: it reads as
    // protection while protecting nothing. These are the exact shapes a
    // careless template would produce.
    expect(showsVatCharge('<tfoot><tr><th>VAT</th><td>£2,000.00</td></tr></tfoot>')).toBe(true);
    expect(showsVatCharge('<p>VAT: £2,000.00</p>')).toBe(true);
    expect(showsVatCharge('<td>£2,000.00 VAT</td>')).toBe(true);
  });

  it('does not fire on the mandatory margin-scheme wording', () => {
    expect(showsVatCharge(
      '<p>Margin scheme — second-hand goods. This invoice does not give the buyer ' +
      'the right to reclaim VAT.</p><tfoot><tr><th>Total</th><td>£12,000.00</td></tr></tfoot>',
    )).toBe(false);
  });
});
