/**
 * The invoice document — the ONE renderer.
 *
 * This exists because the golden-file test that guards rule 6 was rendering
 * through a template defined inside the test. That test is the most expensive
 * one in the codebase to get wrong — showing VAT separately on a margin-scheme
 * invoice makes the WHOLE sale standard-rated, which on a £12,000 car is
 * £2,000 the dealer never collected and now owes HMRC — and it was guarding a
 * fixture. Whatever the product actually printed was unguarded.
 *
 * So the renderer moved into the product and the test points at it. There is
 * one code path from an `Invoice` to something a buyer can read, it is this
 * one, and the golden file is now a statement about the product.
 *
 * Pure: an `Invoice` in, a string out. No I/O, no dates read from the clock,
 * no currency arithmetic — every figure was computed by `buildInvoice` in
 * integer minor units before it got here.
 */

import { format, type Money } from './money.js';
import { assertMarginInvoiceShowsNoVat } from './vat.js';
import type { Invoice } from './invoicing.js';

export interface InvoiceParty {
  name: string;
  /** Multi-line; rendered as written. */
  address: string;
  vatNumber?: string | null;
  /** Companies House number, where the dealer is a limited company. */
  companyNumber?: string | null;
}

export interface InvoiceDocumentInput {
  invoice: Invoice;
  seller: InvoiceParty;
  /** VAT Notice 718/1 requires the buyer's name and address ON the document. */
  buyer: InvoiceParty;
  /** Rendered date. Passed in rather than read from a clock — a document that
   *  re-dates itself when reprinted is not a record. */
  issuedOn: string;
  /** The vehicle, described well enough to identify it years later. */
  vehicleDescription?: string | null;
  registration?: string | null;
  vin?: string | null;
  /** The stock book entry this sale is recorded against. VAT Notice 718/1
   *  requires the invoice to cross-reference it. */
  stockBookNumber?: string | null;
  notes?: string | null;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const lines = (s: string): string =>
  escape(s).split(/\r?\n/).filter(Boolean).map((l) => `<span>${l}</span>`).join('<br />');

/**
 * The exact wording that has to appear on a margin-scheme invoice.
 *
 * HMRC's requirement, and the reason no VAT figure appears above it. Note it
 * contains the word "VAT" twice — which is why the golden-file test looks for
 * a VAT *figure* rather than banning the string, and why anyone tightening
 * that test must not simplify it into a substring check.
 */
export const MARGIN_SCHEME_NOTICE =
  'Margin scheme — second-hand goods. This invoice does not give the buyer the '
  + 'right to reclaim VAT.';

const partyBlock = (party: InvoiceParty, role: string): string => `
    <section class="party party--${role}">
      <h2>${role === 'seller' ? 'From' : 'To'}</h2>
      <p class="party-name">${escape(party.name)}</p>
      <p class="party-address">${lines(party.address)}</p>
      ${party.companyNumber ? `<p class="party-company">Company number ${escape(party.companyNumber)}</p>` : ''}
      ${party.vatNumber ? `<p class="party-vat">VAT registration ${escape(party.vatNumber)}</p>` : ''}
    </section>`;

const amount = (m: Money): string => escape(format(m));

/**
 * Render an invoice.
 *
 * On a margin-scheme sale the document emits NO VAT column, NO VAT row and no
 * VAT figure anywhere — not a zero, not a dash. That is construction, not
 * validation: there is no branch that could print one. `buildInvoice` has
 * already forced every line to zero VAT, and the assertion below fires if
 * something upstream ever stops doing that.
 */
export function renderInvoice(input: InvoiceDocumentInput): string {
  const { invoice } = input;
  const isMargin = invoice.vatScheme === 'margin';

  // Belt and braces. `buildInvoice` cannot produce a VAT-bearing margin line,
  // and this refuses to RENDER one if it ever does — throwing beats printing.
  // Asserted from the scheme rather than from a calculation, because a draft
  // has no purchase price yet and a credit note carries the original's scheme
  // rather than its own calculation; fabricating a calculation to satisfy a
  // signature would be inventing the very figure the rule is about.
  if (isMargin) assertMarginInvoiceShowsNoVat(invoice.lines);

  const body = invoice.lines.map((l) => `
        <tr>
          <td class="line-description">${escape(l.description)}</td>
          <td class="line-quantity tnum">${l.quantity}</td>
          <td class="line-net tnum">${amount(l.net)}</td>${isMargin ? '' : `
          <td class="line-vat tnum">${amount(l.vatAmount)}</td>`}
          <td class="line-gross tnum">${amount(l.gross)}</td>
        </tr>`).join('');

  const totals = isMargin
    ? `
        <tr class="total"><th scope="row">Total</th><td class="tnum">${amount(invoice.grossTotal)}</td></tr>`
    : `
        <tr><th scope="row">Net</th><td class="tnum">${amount(invoice.netTotal)}</td></tr>
        <tr><th scope="row">VAT</th><td class="tnum">${amount(invoice.vatTotal)}</td></tr>
        <tr class="total"><th scope="row">Total</th><td class="tnum">${amount(invoice.grossTotal)}</td></tr>`;

  const heading = invoice.kind === 'credit_note' ? 'Credit note' : 'Invoice';

  return `<article class="invoice invoice--${invoice.vatScheme}">
  <header>
    <h1>${heading} ${escape(invoice.reference ?? '(draft — not yet issued)')}</h1>
    <p class="issued-on">${escape(input.issuedOn)}</p>
  </header>
${partyBlock(input.seller, 'seller')}
${partyBlock(input.buyer, 'buyer')}
  <section class="vehicle">
    <h2>Vehicle</h2>
    <p class="vehicle-description">${escape(input.vehicleDescription ?? '')}</p>
    ${input.registration ? `<p class="vehicle-registration">Registration ${escape(formatRegistration(input.registration))}</p>` : ''}
    ${input.vin ? `<p class="vehicle-vin">VIN ${escape(input.vin)}</p>` : ''}
  </section>
  <table class="lines">
    <thead>
      <tr>
        <th scope="col">Description</th>
        <th scope="col">Qty</th>
        <th scope="col">Net</th>${isMargin ? '' : `
        <th scope="col">VAT</th>`}
        <th scope="col">Amount</th>
      </tr>
    </thead>
    <tbody>${body}
    </tbody>
    <tfoot>${totals}
    </tfoot>
  </table>
${isMargin ? `  <p class="vat-note">${escape(MARGIN_SCHEME_NOTICE)}</p>\n` : ''}${
  input.stockBookNumber
    ? `  <p class="stock-book-ref">Stock book entry ${escape(input.stockBookNumber)}</p>\n`
    : ''}${input.notes ? `  <p class="invoice-notes">${lines(input.notes)}</p>\n` : ''}</article>`;
}

/**
 * A registration as a human reads it.
 *
 * Registrations are STORED normalised — uppercase, no spaces — so that search
 * tolerates however somebody typed it. They are DISPLAYED with the space,
 * because "WD21KXR" is not what is on the plate and a customer checking an
 * invoice against their own logbook should not have to squint.
 *
 * Lives here rather than inline in a React component because the invoice is
 * not a React component, and two implementations of "how do we write a
 * registration" is how a document and a screen come to disagree.
 *
 * Current-format plates (AB12 CDE) split 4 + 3. Every other UK format —
 * prefix, suffix, dateless, Northern Ireland — is left alone rather than
 * guessed at: a wrong space is worse than none.
 */
export const formatRegistration = (value: string): string => {
  const normalised = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(normalised)
    ? `${normalised.slice(0, 4)} ${normalised.slice(4)}`
    : normalised;
};
