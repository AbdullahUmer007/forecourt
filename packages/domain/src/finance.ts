/**
 * M8 — finance quotes, APR verification and the representative example.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It does not originate quotes. The finance platform (iVendi, Codeweavers or
 * the lender directly) calculates the payment and the APR, and carries the
 * regulatory responsibility for that calculation. We store and display.
 * `calculations.md` §7 settled this and it has not changed.
 *
 * What we DO is verify. A quote that fails its own arithmetic must never
 * reach a buyer, because the moment we render it, it is OUR financial
 * promotion — the lender's mistake becomes our breach. `verifyQuote` re-derives
 * every figure from the cashflows and refuses anything that does not reconcile.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE RULE LIVES IN DATA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * CONC 3.5 is under active FCA review. CP26/15 (opened 29 April 2026, closed
 * 17 June 2026) asks whether the mandatory representative example supports
 * consumer understanding at all, and whether the 51% threshold for a
 * representative APR is still appropriate. As of 2 August 2026 no policy
 * statement has been published, so the current rules stand — but they may not
 * stand for long.
 *
 * So the required field list, their order, the prominence rule and the
 * threshold are a VERSIONED RECORD, not constants. When the FCA moves we ship
 * a data change signed off by the compliance consultant, not a release.
 *
 * ⚠️ NOTHING HERE MAY GO LIVE WITHOUT THE RETAINED FCA COMPLIANCE CONSULTANT'S
 * SIGN-OFF. The structure is built so that what they sign off is a rule record
 * with a source URL, which is a reviewable artefact — not a diff.
 */

export type FinanceProductType = 'hp' | 'pcp' | 'personal_loan' | 'lease_purchase';

export const PRODUCT_LABELS: Readonly<Record<FinanceProductType, string>> = {
  hp: 'Hire Purchase',
  pcp: 'Personal Contract Purchase',
  personal_loan: 'Personal loan',
  lease_purchase: 'Lease Purchase',
};

/**
 * A quote exactly as the lender or finance platform returned it.
 *
 * Every money field is bigint pence. `aprPercent` and `flatRatePercent` are
 * numbers because they are rates, not amounts — but they are compared with an
 * explicit tolerance, never for equality.
 */
export interface FinanceQuote {
  quoteId: string;
  provider: string;
  lenderName: string;
  productType: FinanceProductType;

  cashPricePence: bigint;
  depositPence: bigint;
  partExchangePence: bigint;
  amountOfCreditPence: bigint;

  termMonths: number;
  monthlyPaymentPence: bigint;
  /** PCP only: the optional final payment / guaranteed future value. */
  finalPaymentPence: bigint | null;
  /** Fees inside the total charge for credit, e.g. documentation, option-to-purchase. */
  fees: readonly FinanceFee[];

  aprPercent: number;
  flatRatePercent: number | null;
  fixedRate: boolean;

  totalChargeForCreditPence: bigint;
  totalAmountPayablePence: bigint;

  annualMileage: number | null;
  excessPencePerMile: number | null;

  quotedAt: Date;
  expiresAt: Date;
}

export interface FinanceFee {
  label: string;
  amountPence: bigint;
  /** Month it falls due. 1 = with the first payment; `termMonths` = with the last. */
  dueAtMonth: number;
}

// ---------------------------------------------------------------- APR

export interface Cashflow {
  /** Months from drawdown. 0 = at drawdown. */
  atMonth: number;
  amountPence: bigint;
}

/** APR is expressed to one decimal place (CONC App 1.2 / CCD Annex I). */
export const roundApr = (apr: number): number => Math.round(apr * 10) / 10;

/**
 * The APR implied by a set of cashflows, by the Consumer Credit Directive
 * equation: the rate X at which the discounted drawdowns equal the discounted
 * repayments, with time measured in years.
 *
 *   Σ Ck (1+X)^(−tk)  =  Σ Dl (1+X)^(−sl)
 *
 * Solved by bisection rather than Newton–Raphson. Bisection cannot diverge,
 * cannot land on a spurious root, and 200 iterations over a bracket of
 * [0%, 1000%] gives far more precision than the one decimal place the answer
 * is reported to. Speed is irrelevant here; being unable to produce a wrong
 * answer is not.
 *
 * USED FOR VERIFICATION ONLY. We do not originate quotes — see the header.
 */
export function impliedApr(advancePence: bigint, repayments: readonly Cashflow[]): number | null {
  if (advancePence <= 0n) return null;
  const total = repayments.reduce((sum, r) => sum + r.amountPence, 0n);
  if (total <= advancePence) return null;   // no charge for credit: no APR to imply

  const advance = Number(advancePence);
  const npv = (rate: number): number =>
    repayments.reduce((sum, r) => sum + Number(r.amountPence) / Math.pow(1 + rate, r.atMonth / 12), 0) - advance;

  let low = 0;
  let high = 10;                     // 1000% — well beyond any lawful motor product
  if (npv(high) > 0) return null;    // outside the bracket; refuse rather than guess
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (npv(mid) > 0) low = mid; else high = mid;
  }
  return roundApr(((low + high) / 2) * 100);
}

/** The cashflows a quote implies, in the order the customer actually pays them. */
export function quoteCashflows(q: FinanceQuote): Cashflow[] {
  const flows: Cashflow[] = [];
  for (let m = 1; m <= q.termMonths; m++) flows.push({ atMonth: m, amountPence: q.monthlyPaymentPence });
  for (const fee of q.fees) flows.push({ atMonth: fee.dueAtMonth, amountPence: fee.amountPence });
  if (q.finalPaymentPence !== null && q.finalPaymentPence > 0n) {
    flows.push({ atMonth: q.termMonths, amountPence: q.finalPaymentPence });
  }
  return flows.sort((a, b) => a.atMonth - b.atMonth);
}

// ---------------------------------------------------------------- verification

export interface QuoteProblem {
  field: string;
  message: string;
  /** `blocking` problems stop the quote being displayed at all. */
  severity: 'blocking' | 'warning';
}

/** APR tolerance. One decimal place is the reported precision, so 0.1 is the floor. */
export const APR_TOLERANCE_PP = 0.1;

const money = (p: bigint): string => `£${(Number(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;

/**
 * Re-derive every figure and refuse anything that does not reconcile.
 *
 * A lender's arithmetic error becomes our financial promotion the instant we
 * render it, so "the provider sent it" is not a defence. Every problem names
 * the field, the figure we were given and the figure the cashflows imply, so a
 * dealer can put it to the lender rather than guess.
 */
export function verifyQuote(q: FinanceQuote): QuoteProblem[] {
  const problems: QuoteProblem[] = [];
  const blocking = (field: string, message: string): void => { problems.push({ field, message, severity: 'blocking' }); };

  if (q.termMonths < 1) blocking('termMonths', 'A term of less than one month is not a credit agreement.');
  if (q.monthlyPaymentPence <= 0n) blocking('monthlyPaymentPence', 'The monthly payment must be positive.');
  if (q.cashPricePence <= 0n) blocking('cashPricePence', 'The cash price must be positive.');
  if (q.depositPence < 0n || q.partExchangePence < 0n) {
    blocking('depositPence', 'A deposit or part-exchange contribution cannot be negative.');
  }

  // Amount of credit = cash price − deposit − part-exchange.
  const impliedCredit = q.cashPricePence - q.depositPence - q.partExchangePence;
  if (impliedCredit !== q.amountOfCreditPence) {
    blocking('amountOfCreditPence',
      `Amount of credit is ${money(q.amountOfCreditPence)} but cash price less deposit and part-exchange is ${money(impliedCredit)}.`);
  }
  if (q.amountOfCreditPence <= 0n) {
    blocking('amountOfCreditPence', 'There is no credit to advance — this is a cash sale, not a finance quote.');
  }

  const feeTotal = q.fees.reduce((s, f) => s + f.amountPence, 0n);
  const payments = q.monthlyPaymentPence * BigInt(q.termMonths);
  const final = q.finalPaymentPence ?? 0n;

  // "Total amount payable" is a STATUTORY term, not a plain-English one:
  // s.189 CCA 1974 and the Consumer Credit (Disclosure of Information)
  // Regulations 2010 define it as the total amount of credit PLUS the total
  // charge for credit — which is the sum of the repayments, and EXCLUDES the
  // deposit and any part-exchange. Those are the advance payment, disclosed
  // separately in the representative example.
  //
  // We originally had this as total cash outlay (deposit + repayments), which
  // reads more naturally in English and is wrong. Caught on 2 August 2026 by
  // running a live competitor's published representative example through this
  // very function: their figures reconciled perfectly on the statutory
  // definition and failed on ours, which is how we found out ours was the one
  // that was wrong.
  const impliedTotalPayable = payments + final + feeTotal;
  if (impliedTotalPayable !== q.totalAmountPayablePence) {
    blocking('totalAmountPayablePence',
      `Total amount payable is ${money(q.totalAmountPayablePence)} but the repayments add up to ${money(impliedTotalPayable)}. ` +
      `Total amount payable is the amount of credit plus the total charge for credit; it excludes the deposit.`);
  }

  const impliedCharge = payments + final + feeTotal - q.amountOfCreditPence;
  if (impliedCharge !== q.totalChargeForCreditPence) {
    blocking('totalChargeForCreditPence',
      `Total charge for credit is ${money(q.totalChargeForCreditPence)} but the cashflows imply ${money(impliedCharge)}.`);
  }

  // The APR itself.
  const implied = impliedApr(q.amountOfCreditPence, quoteCashflows(q));
  if (implied === null) {
    if (q.aprPercent > 0) {
      blocking('aprPercent', `An APR of ${q.aprPercent}% was quoted, but the cashflows carry no charge for credit.`);
    }
  } else if (Math.abs(implied - q.aprPercent) > APR_TOLERANCE_PP) {
    blocking('aprPercent',
      `APR is quoted as ${q.aprPercent.toFixed(1)}% but the cashflows imply ${implied.toFixed(1)}%. ` +
      `Ask the lender to reissue — we cannot advertise a rate we cannot reproduce.`);
  }

  if (q.expiresAt <= q.quotedAt) {
    problems.push({ field: 'expiresAt', message: 'The quote expires before it was issued.', severity: 'blocking' });
  }
  if (q.productType === 'pcp' && (q.finalPaymentPence === null || q.finalPaymentPence <= 0n)) {
    problems.push({
      field: 'finalPaymentPence',
      message: 'A PCP with no optional final payment is a hire purchase. Check the product type.',
      severity: 'warning',
    });
  }
  if (q.productType === 'pcp' && q.annualMileage === null) {
    problems.push({
      field: 'annualMileage',
      message: 'A PCP without an annual mileage allowance hides the excess-mileage charge the customer will actually face.',
      severity: 'warning',
    });
  }
  return problems;
}

export const isDisplayable = (q: FinanceQuote, now: Date): boolean =>
  q.expiresAt > now && !verifyQuote(q).some((p) => p.severity === 'blocking');

// ---------------------------------------------------------------- the rule, as data

export type ExampleField =
  | 'interestRate' | 'otherCharges' | 'amountOfCredit' | 'representativeApr'
  | 'cashPriceAndAdvance' | 'duration' | 'totalAmountPayable' | 'repaymentAmount';

/**
 * A versioned record of what the regulator currently requires.
 *
 * This is the artefact the compliance consultant signs off. Changing the field
 * list is a data change with a source URL and an effective date, not a code
 * change — which is the only way to keep up with a rulebook that is being
 * consulted on right now.
 */
export interface FinancePromotionRule {
  key: 'conc.representative_example';
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** In the order they must appear. */
  requiredFields: readonly ExampleField[];
  /** The field that must be given greater prominence than every other. */
  prominentField: ExampleField;
  /** Heading the example must carry. */
  heading: string;
  /** Share of business expected to be concluded at or below the advertised APR. */
  representativeThreshold: number;
  /** How long an example may stand before it must be re-approved. */
  maxAgeDays: number;
  sourceUrl: string;
  signedOffBy: string | null;
  signedOffAt: Date | null;
}

/**
 * CONC 3.5 as it stands on 2 August 2026.
 *
 * Seeded as version 1 with `signedOffBy: null` — the platform will not render a
 * promotion against an unsigned rule, so this cannot reach a customer site
 * until the retained consultant has approved it. That is the gate, and it is
 * deliberately impossible to forget.
 */
export const CONC_REPRESENTATIVE_EXAMPLE_V1: FinancePromotionRule = {
  key: 'conc.representative_example',
  version: 1,
  effectiveFrom: new Date('2014-04-01T00:00:00Z'),
  effectiveTo: null,
  requiredFields: [
    'interestRate',           // and whether fixed or variable
    'otherCharges',           // nature and amount of any other charge in the TCC
    'amountOfCredit',
    'representativeApr',
    'cashPriceAndAdvance',    // deferred payment for specific goods
    'duration',
    'totalAmountPayable',
    'repaymentAmount',
  ],
  prominentField: 'representativeApr',
  heading: 'Representative Example',
  representativeThreshold: 0.51,
  maxAgeDays: 90,
  sourceUrl: 'https://www.handbook.fca.org.uk/handbook/CONC/3/5.html',
  signedOffBy: null,
  signedOffAt: null,
};

/**
 * The rule governing a given date.
 *
 * Highest version wins among those whose window covers the date. Rules are
 * append-only — a superseded version is never edited or closed, because it is
 * the record of what we believed the law required at the time, and a promotion
 * rendered in March has to remain explicable in November. So overlapping open
 * windows are normal, and version order is what resolves them.
 */
export const ruleEffectiveOn = (
  rules: readonly FinancePromotionRule[],
  on: Date,
): FinancePromotionRule | null =>
  [...rules]
    .filter((r) => r.effectiveFrom <= on && (r.effectiveTo === null || r.effectiveTo > on))
    .sort((a, b) => b.version - a.version)[0] ?? null;

// ---------------------------------------------------------------- the example

export interface RepresentativeExample {
  id: string;
  tenantId: string;
  version: number;
  productType: FinanceProductType;

  cashPricePence: bigint;
  advancePaymentPence: bigint;
  amountOfCreditPence: bigint;
  termMonths: number;
  monthlyPaymentPence: bigint;
  finalPaymentPence: bigint | null;
  otherCharges: readonly FinanceFee[];

  interestRatePercent: number;
  interestRateFixed: boolean;
  representativeAprPercent: number;
  totalAmountPayablePence: bigint;

  approvedBy: string | null;
  approvedAt: Date | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface ExampleProblem { field: string; message: string }

/**
 * Whether an example may be shown right now.
 *
 * Four independent things have to be true, and the renderer refuses on any one:
 * the rule it is measured against is signed off, the example itself is
 * approved, it is in date, and its own arithmetic reconciles.
 */
export function validateRepresentativeExample(
  example: RepresentativeExample,
  rule: FinancePromotionRule,
  now: Date,
): ExampleProblem[] {
  const problems: ExampleProblem[] = [];

  if (rule.signedOffBy === null || rule.signedOffAt === null) {
    problems.push({
      field: 'rule',
      message: `Rule ${rule.key} v${rule.version} has not been signed off by the FCA compliance consultant. ` +
        `No finance promotion may render against an unsigned rule.`,
    });
  }
  if (example.approvedBy === null || example.approvedAt === null) {
    problems.push({ field: 'approvedBy', message: 'This representative example has not been approved.' });
  }
  if (example.effectiveFrom > now) {
    problems.push({ field: 'effectiveFrom', message: 'This example is not yet effective.' });
  }
  if (example.effectiveTo !== null && example.effectiveTo <= now) {
    problems.push({ field: 'effectiveTo', message: 'This example has expired and must be re-approved.' });
  }
  if (example.approvedAt) {
    const ageDays = (now.getTime() - example.approvedAt.getTime()) / 86_400_000;
    if (ageDays > rule.maxAgeDays) {
      problems.push({
        field: 'approvedAt',
        message: `Approved ${Math.floor(ageDays)} days ago; an example must be re-approved every ${rule.maxAgeDays} days. ` +
          `A stale example is a promotion nobody has checked against current lending.`,
      });
    }
  }

  // The example is itself a quote, and must reconcile like one.
  const asQuote: FinanceQuote = {
    quoteId: `example:${example.id}`, provider: 'representative-example', lenderName: '—',
    productType: example.productType,
    cashPricePence: example.cashPricePence,
    depositPence: example.advancePaymentPence,
    partExchangePence: 0n,
    amountOfCreditPence: example.amountOfCreditPence,
    termMonths: example.termMonths,
    monthlyPaymentPence: example.monthlyPaymentPence,
    finalPaymentPence: example.finalPaymentPence,
    fees: example.otherCharges,
    aprPercent: example.representativeAprPercent,
    flatRatePercent: null,
    fixedRate: example.interestRateFixed,
    totalChargeForCreditPence:
      example.monthlyPaymentPence * BigInt(example.termMonths)
      + (example.finalPaymentPence ?? 0n)
      + example.otherCharges.reduce((s, f) => s + f.amountPence, 0n)
      - example.amountOfCreditPence,
    totalAmountPayablePence: example.totalAmountPayablePence,
    annualMileage: null, excessPencePerMile: null,
    quotedAt: example.effectiveFrom,
    expiresAt: example.effectiveTo ?? new Date('2999-01-01T00:00:00Z'),
  };
  for (const p of verifyQuote(asQuote)) {
    if (p.severity === 'blocking') problems.push({ field: p.field, message: p.message });
  }
  return problems;
}

// ---------------------------------------------------------------- the gate

declare const approvedBrand: unique symbol;

/**
 * Proof that a valid, in-date, signed-off representative example exists.
 *
 * This type cannot be constructed anywhere except `approvePromotion`, which
 * refuses unless every check passes. Anything that wants to put a cost-of-credit
 * figure in front of a customer — the vehicle page, the search grid, an email,
 * a PDF — has to be handed one of these. That makes "there is no other code
 * path" a fact the compiler enforces rather than a convention someone has to
 * remember during a refactor.
 */
export interface ApprovedPromotion {
  readonly [approvedBrand]: 'ApprovedPromotion';
  readonly example: RepresentativeExample;
  readonly rule: FinancePromotionRule;
  readonly approvedFor: Date;
}

export class FinancePromotionError extends Error {
  constructor(readonly problems: readonly ExampleProblem[]) {
    super(
      `Refusing to render a finance promotion. A cost-of-credit figure cannot be shown without a valid ` +
      `representative example (CONC 3.5.3R):\n` +
      problems.map((p) => `  · ${p.field}: ${p.message}`).join('\n'),
    );
    this.name = 'FinancePromotionError';
  }
}

/** Throws unless the example may lawfully be shown. There is no soft failure. */
export function approvePromotion(
  example: RepresentativeExample,
  rule: FinancePromotionRule,
  now: Date,
): ApprovedPromotion {
  const problems = validateRepresentativeExample(example, rule, now);
  if (problems.length > 0) throw new FinancePromotionError(problems);
  return { example, rule, approvedFor: now } as ApprovedPromotion;
}

export interface PromotionAttempt {
  ok: boolean;
  promotion: ApprovedPromotion | null;
  problems: readonly ExampleProblem[];
}

/** The non-throwing form, for a page that must degrade rather than fail. */
export function tryApprovePromotion(
  example: RepresentativeExample | null,
  rule: FinancePromotionRule | null,
  now: Date,
): PromotionAttempt {
  if (example === null || rule === null) {
    return {
      ok: false, promotion: null,
      problems: [{ field: 'example', message: 'No representative example is configured for this dealer.' }],
    };
  }
  const problems = validateRepresentativeExample(example, rule, now);
  if (problems.length > 0) return { ok: false, promotion: null, problems };
  return { ok: true, promotion: { example, rule, approvedFor: now } as ApprovedPromotion, problems: [] };
}

// ---------------------------------------------------------------- the 51% test

export interface ConcludedAgreement {
  agreementId: string;
  aprPercent: number;
  concludedAt: Date;
  /** Which advertised promotion the customer responded to, where known. */
  promotionId: string | null;
}

export interface RepresentativeAprReport {
  advertisedAprPercent: number;
  threshold: number;
  agreementCount: number;
  atOrBelowCount: number;
  share: number;
  compliant: boolean;
  /** The APR we should be advertising, given what actually completed. */
  suggestedAprPercent: number | null;
  finding: string;
}

/**
 * The lowest APR at which at least `threshold` of business completed.
 *
 * "Representative" means the firm reasonably expects at least 51% of business
 * resulting from the promotion to be concluded at that rate or better. That is
 * a forward-looking expectation, and the only honest evidence for it is what
 * actually happened — so this is computed from concluded agreements, not from
 * what anyone hoped.
 */
export function representativeAprFrom(
  agreements: readonly ConcludedAgreement[],
  threshold = 0.51,
): number | null {
  if (agreements.length === 0) return null;
  const sorted = [...agreements].map((a) => a.aprPercent).sort((a, b) => a - b);
  // The APR at the threshold percentile: at or below it lies >= threshold of business.
  const index = Math.ceil(sorted.length * threshold) - 1;
  return roundApr(sorted[Math.max(0, Math.min(index, sorted.length - 1))]!);
}

/**
 * Governance: does the APR we advertise still hold?
 *
 * Run monthly. A representative APR that drifts is a live financial-promotion
 * breach on every page of the dealer's website simultaneously, and nobody
 * notices until someone complains — which is exactly the shape of the motor
 * finance problem the industry is currently paying for.
 */
export function representativeAprReport(
  advertisedAprPercent: number,
  agreements: readonly ConcludedAgreement[],
  threshold = 0.51,
  minimumSample = 20,
): RepresentativeAprReport {
  const atOrBelow = agreements.filter((a) => a.aprPercent <= advertisedAprPercent + 1e-9).length;
  const share = agreements.length === 0 ? 0 : atOrBelow / agreements.length;
  const suggested = representativeAprFrom(agreements, threshold);

  if (agreements.length < minimumSample) {
    return {
      advertisedAprPercent, threshold, agreementCount: agreements.length,
      atOrBelowCount: atOrBelow, share, compliant: true, suggestedAprPercent: suggested,
      finding: `Only ${agreements.length} concluded agreements — too few to test the ${Math.round(threshold * 100)}% ` +
        `requirement. Not a pass; there is simply not enough evidence yet.`,
    };
  }

  const compliant = share >= threshold;
  return {
    advertisedAprPercent, threshold, agreementCount: agreements.length,
    atOrBelowCount: atOrBelow, share, compliant, suggestedAprPercent: suggested,
    finding: compliant
      ? `${atOrBelow} of ${agreements.length} agreements (${(share * 100).toFixed(0)}%) completed at or below ` +
        `${advertisedAprPercent.toFixed(1)}% APR. The advertised representative APR holds.`
      : `Only ${atOrBelow} of ${agreements.length} agreements (${(share * 100).toFixed(0)}%) completed at or below ` +
        `${advertisedAprPercent.toFixed(1)}% APR, against a ${Math.round(threshold * 100)}% requirement. ` +
        `Every finance promotion on the site is currently non-compliant. ` +
        `${suggested === null ? '' : `Advertise ${suggested.toFixed(1)}% APR instead, or stop showing payments until it is corrected.`}`,
  };
}

// ---------------------------------------------------------------- commission

export type CommissionType = 'flat' | 'percentage_of_credit' | 'volume_bonus' | 'difference_in_charges' | 'none';

/**
 * Commission disclosure.
 *
 * After *Hopcraft* and s.140A CCA 1974, undisclosed or inadequately disclosed
 * commission is the single largest liability in this industry. The disclosure
 * is required before the customer is bound, in a form they are likely to
 * notice, and it is evidence — so it is recorded, not merely displayed.
 *
 * Discretionary commission arrangements have been banned since January 2021.
 * We refuse to record one at all rather than model it.
 */
export interface CommissionDisclosure {
  type: CommissionType;
  amountPence: bigint | null;
  percentOfCredit: number | null;
  lenderName: string;
  disclosedAt: Date | null;
  disclosureWordingVersion: string | null;
  customerAcknowledgedAt: Date | null;
}

export function commissionDisclosureProblems(d: CommissionDisclosure, now: Date): ExampleProblem[] {
  const problems: ExampleProblem[] = [];
  if (d.type === 'difference_in_charges') {
    problems.push({
      field: 'type',
      message: 'Discretionary commission arrangements have been banned since January 2021 and cannot be recorded here.',
    });
  }
  if (d.type !== 'none') {
    if (d.disclosedAt === null) {
      problems.push({ field: 'disclosedAt', message: 'Commission must be disclosed before the customer is bound.' });
    }
    if (d.disclosureWordingVersion === null) {
      problems.push({
        field: 'disclosureWordingVersion',
        message: 'The exact wording shown must be recorded with its version — a disclosure nobody can reproduce is not evidence.',
      });
    }
    if (d.amountPence === null && d.percentOfCredit === null) {
      problems.push({ field: 'amountPence', message: 'Disclose the amount, or the basis on which it is calculated.' });
    }
    if (d.disclosedAt && d.disclosedAt > now) {
      problems.push({ field: 'disclosedAt', message: 'Disclosure is dated in the future.' });
    }
  }
  return problems;
}
