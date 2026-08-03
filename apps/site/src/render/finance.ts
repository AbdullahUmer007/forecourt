/**
 * M8 — `<FinancePromotion>`: the only path to a cost-of-credit figure.
 *
 * The signature is the control. `renderFinancePromotion` takes an
 * `ApprovedPromotion`, a type that can only be constructed by
 * `approvePromotion()` in the domain layer, which refuses unless the rule is
 * signed off, the example is approved, in date, and reconciles arithmetically.
 *
 * So there is no code path — in this renderer or any future one — that emits a
 * payment figure without the example beside it. Not by convention: you cannot
 * call the function without the proof, and you cannot make the proof without
 * the example. A golden-file test asserts the output, and the VDP refuses a
 * plain string where this object is expected.
 *
 * PROMINENCE (CONC 3.5.6R): the representative APR must be given greater
 * prominence than any other rate or cost-of-credit figure in the promotion —
 * including the monthly payment that triggered it. That is enforced here as a
 * property of the markup (`fp-prominent` on exactly one item) and asserted in
 * the theme by comparing the actual font sizes, rather than left to whoever
 * next edits the CSS.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED FCA COMPLIANCE CONSULTANT'S SIGN-OFF.
 */

import { html, raw, esc } from './html.js';
import type {
  ApprovedPromotion, ExampleField, FinanceQuote, RepresentativeExample, FinanceFee,
} from '../../../../packages/domain/src/finance.js';
import { PRODUCT_LABELS } from '../../../../packages/domain/src/finance.js';

export interface FinancePromotionInput {
  promotion: ApprovedPromotion;
  /** The vehicle's own indicative quote. Omit to show the example alone. */
  quote?: FinanceQuote | null;
  dealer: {
    name: string;
    fcaFrn: string | null;
    /** Set when the dealer trades under a principal's permission (SUP 12). */
    principalName: string | null;
    principalFrn: string | null;
    isCreditBroker: boolean;
  };
}

const money = (p: bigint): string =>
  `£${(Number(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const moneyRounded = (p: bigint): string =>
  `£${(Number(p) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const feeList = (fees: readonly FinanceFee[]): string =>
  fees.length === 0
    ? 'None'
    : fees.map((f) => `${f.label} ${money(f.amountPence)}`).join(', ');

/**
 * One row of the representative example.
 *
 * The order comes from the rule record, not from this function — CONC 3.5.5R
 * prescribes a sequence, and CP26/15 may change it. Reordering must be a data
 * change the compliance consultant signs off, not an edit here.
 */
function exampleRow(field: ExampleField, e: RepresentativeExample, prominent: boolean): string {
  const rows: Record<ExampleField, { label: string; value: string; gloss: string }> = {
    interestRate: {
      label: 'Rate of interest',
      value: `${e.interestRatePercent.toFixed(1)}% ${e.interestRateFixed ? 'fixed' : 'variable'}`,
      gloss: e.interestRateFixed
        ? 'Fixed, so this rate cannot change during the agreement.'
        : 'Variable, so this rate can change during the agreement.',
    },
    otherCharges: {
      label: 'Other charges',
      value: feeList(e.otherCharges),
      gloss: e.otherCharges.length === 0
        ? 'No arrangement, option or completion fees on this agreement.'
        : 'Fees payable on top of the repayments below.',
    },
    amountOfCredit: {
      label: 'Total amount of credit',
      value: money(e.amountOfCreditPence),
      gloss: 'What you are borrowing, after your deposit comes off the cash price.',
    },
    representativeApr: {
      label: 'Representative APR',
      value: `${e.representativeAprPercent.toFixed(1)}% APR`,
      gloss: 'The total cost of borrowing as a yearly rate — the one figure to compare lenders on.',
    },
    cashPriceAndAdvance: {
      label: 'Cash price / advance payment',
      value: `${money(e.cashPricePence)} / ${money(e.advancePaymentPence)}`,
      gloss: 'The price of the car, and the deposit you put down.',
    },
    duration: {
      label: 'Duration of agreement',
      value: `${e.termMonths} months`,
      gloss: 'How long you are committed to paying.',
    },
    totalAmountPayable: {
      label: 'Total amount payable',
      value: money(e.totalAmountPayablePence),
      // The statutory definition, restated for a buyer who would otherwise
      // reasonably assume it includes what they handed over on day one.
      gloss: 'The credit plus everything it costs you. This figure excludes your deposit.',
    },
    repaymentAmount: {
      label: 'Amount of each repayment',
      value: e.finalPaymentPence && e.finalPaymentPence > 0n
        ? `${e.termMonths} × ${money(e.monthlyPaymentPence)}, then an optional final payment of ${money(e.finalPaymentPence)}`
        : `${e.termMonths} × ${money(e.monthlyPaymentPence)}`,
      gloss: e.finalPaymentPence && e.finalPaymentPence > 0n
        ? 'The monthly payment, then the balloon payment if you keep the car.'
        : 'What leaves your account each month.',
    },
  };
  const row = rows[field];
  // The gloss is a sibling of the <dt>, not inside it: the label is the
  // rule's wording and must stay exactly that, byte for byte, so the
  // prominence and ordering tests can assert against it.
  return html`<div class="fp-row${prominent ? ' fp-prominent' : ''}">
    <dt>${row.label}</dt><dd>${row.value}</dd>
    <p class="fp-gloss">${row.gloss}</p>
  </div>`;
}

/**
 * Render the promotion.
 *
 * Returns a string, but it can only be reached with an `ApprovedPromotion`, so
 * the string cannot exist without the example that legitimises it.
 */
export function renderFinancePromotion(input: FinancePromotionInput): string {
  const { promotion, quote, dealer } = input;
  const { example: e, rule } = promotion;

  const fields = rule.requiredFields;
  const orderedRows = fields.map((f) => exampleRow(f, e, f === rule.prominentField)).join('');

  // The lender is named. "Finance available" without a named lender is exactly
  // the vague claim CONC 3.3 treats as misleading.
  const lenderLine = quote
    // The product type is on the terms line directly above; naming it here as
    // well printed "Hire Purchase" twice in consecutive lines.
    ? `Provided by ${esc(quote.lenderName)}`
    : null;

  // Broker, not lender — CONC 4.2 initial disclosure, stated on the promotion
  // itself and not only on a page nobody clicks.
  const brokerLine = dealer.principalName
    ? `${esc(dealer.name)} is an Appointed Representative of ${esc(dealer.principalName)}` +
      `${dealer.principalFrn ? ` (FRN ${esc(dealer.principalFrn)})` : ''}, which is authorised and regulated by the Financial Conduct Authority. ` +
      `We are a credit broker, not a lender.`
    : `${esc(dealer.name)}${dealer.fcaFrn ? ` (FRN ${esc(dealer.fcaFrn)})` : ''} is authorised and regulated by the Financial Conduct Authority. ` +
      `We are a credit broker, not a lender, and we introduce you to a limited number of finance providers.`;

  // CONC 3.5.6R made structural: the APR is the LEAD figure of the block, at
  // display size, and the payment sits beneath it in a quieter card. The old
  // layout led with the payment and gave the APR a larger row inside the
  // table — compliant on font size alone, but the payment still read as the
  // headline. Prominence is about what the eye lands on first.
  const aprText = `${e.representativeAprPercent.toFixed(1)}%`;

  return html`<section class="card finance" id="finance" aria-labelledby="fp-heading">
    <div class="fp-lead">
      <!-- This heading deliberately avoids the example's exact label wording:
           that label belongs to the row below, whose position is fixed by
           CONC 3.5.5R, and a duplicate earlier in the document would make the
           mandated sequence unverifiable. -->
      <h2 id="fp-heading" class="fp-label">Finance from</h2>
      <p class="fp-apr">${aprText}</p>
      <p class="fp-apr-sub">${aprText} APR representative</p>
      <p class="fp-apr-note">This is the rate at least 51% of buyers taking this deal are expected to get. Yours depends on your circumstances, and we will tell you your own APR in writing before you sign.</p>

      ${raw(quote ? `<div class="fp-payment">
        <p class="fp-label">Your likely monthly payment</p>
        <p><span class="fp-payment-amount">${esc(money(quote.monthlyPaymentPence))}</span> <span class="fp-payment-period">a month</span></p>
        <p class="fp-payment-terms">${esc(PRODUCT_LABELS[quote.productType])} · ${quote.termMonths} months · ${esc(moneyRounded(quote.depositPence))} deposit</p>
        ${lenderLine ? `<p class="fp-lender">${lenderLine}</p>` : ''}
      </div>` : '')}
    </div>

    <!-- The example. Items in the order the rule record prescribes; the
         representative APR carries fp-prominent, which the theme renders
         larger than the payment figure beside it. -->
    <div class="fp-example">
      <h3 class="fp-example-head">${rule.heading}</h3>
      <p class="fp-example-note">The whole cost of this agreement, in the order the FCA sets. Nothing here is hidden or abbreviated.</p>
      <dl class="fp-rows">${raw(orderedRows)}</dl>

      <p class="fp-small">
        ${raw(brokerLine)}
        We may receive a commission from the lender for introducing you, which does not affect the amount you pay.
        You can ask us for the amount of that commission at any time.
        Finance is subject to status and affordability. Terms and conditions apply. Applicants must be 18 or over.
        ${quote ? `A guarantee may be required. This quotation was prepared on ${esc(quote.quotedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))} and is not an offer of finance.` : ''}
        <a href="/initial-disclosure">Read our initial disclosure</a>.
      </p>
    </div>
  </section>`;
}

/**
 * What to show when there is NO valid example.
 *
 * Not an error, and not silence pretending finance does not exist — an honest
 * invitation with no figure in it. A page with no cost-of-credit figure needs
 * no representative example, so this is always safe to render.
 */
export function renderFinanceUnavailable(dealer: { name: string; fcaReference?: string | null }): string {
  return html`<section class="fp-absent" id="finance">
    <div class="fp-absent-main">
      <p class="fp-absent-eyebrow"><span aria-hidden="true">◌</span>Finance illustration unavailable</p>
      <h2>We will quote this one by hand, with the figures in writing.</h2>
      <p class="fp-apr-note">A monthly payment has to come with a full representative example, and we do not have an approved one for this car yet. Ring us or send an enquiry and we will quote you properly — including what your part-exchange is worth against it.</p>
      <p class="fp-absent-cta"><a class="btn btn-primary" href="#enquire">Ask for a quote</a></p>
    </div>
    <p class="fp-small">${dealer.name}${dealer.fcaReference ? ` (FRN ${dealer.fcaReference})` : ''} is authorised and regulated by the Financial Conduct Authority as a credit broker, not a lender. We work with a panel of lenders and may receive a commission for introducing you, the amount of which is disclosed to you in writing before you sign.
      <a href="/initial-disclosure">Read our initial disclosure</a>.</p>
  </section>`;
}
