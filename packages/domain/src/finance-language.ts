/**
 * M8 — cost-of-credit language detection.
 *
 * The `<FinancePromotion>` component is the only path to a payment figure —
 * but only for figures the code puts there. The realistic breach is a dealer
 * typing "Only £199 a month!" into a vehicle description, a homepage banner, a
 * photo caption or a page title, where no component is involved at all.
 *
 * CONC 3.5.3R is triggered by a financial promotion that indicates a rate of
 * interest or an amount relating to the cost of credit. A sentence in a
 * description does that just as effectively as a styled component, and the
 * dealer will not know they have done it.
 *
 * So: every piece of free text that will be published is scanned, and a
 * trigger blocks publishing until either the text is changed or a valid
 * representative example is attached to that page. The dealer sees what was
 * found, where, and what to do — not "validation failed".
 *
 * FALSE POSITIVES ARE THE DESIGN. "£12,995" in a description is a cash price
 * and fine; "£199 per month" is not. The patterns below are deliberately
 * anchored on the credit signal (a period, a rate, an APR, a credit word)
 * rather than on the presence of a number, because a scanner that flags every
 * price gets switched off within a week and then protects nothing.
 */

export type TriggerKind = 'periodic_payment' | 'interest_rate' | 'apr' | 'credit_offer' | 'deposit_incentive';

export interface LanguageFinding {
  kind: TriggerKind;
  /** The exact text that triggered it, so the dealer can find it. */
  match: string;
  index: number;
  field: string;
  explanation: string;
  suggestion: string;
}

interface Pattern {
  kind: TriggerKind;
  re: RegExp;
  explanation: string;
  suggestion: string;
}

/** Money, with or without a symbol: £199, £199.50, 199.99. */
const AMOUNT = String.raw`£\s?\d[\d,]*(?:\.\d{2})?`;
const PERIOD = String.raw`(?:per|a|/|every\s+)?\s*(?:month|mth|mo\b|week|wk\b|fortnight|pcm|pm\b|p\/m)`;

const PATTERNS: readonly Pattern[] = [
  {
    kind: 'periodic_payment',
    re: new RegExp(String.raw`(?:from\s+)?${AMOUNT}\s*(?:${PERIOD})`, 'gi'),
    explanation:
      'A payment expressed per period is an amount relating to the cost of credit (CONC 3.5.3R). ' +
      'It cannot appear without a representative example alongside it.',
    suggestion:
      'Remove the figure, or add the finance block to this page so the payment renders through the ' +
      'representative example instead of as free text.',
  },
  {
    kind: 'periodic_payment',
    re: /\b(?:monthly|weekly)\s+(?:payments?|repayments?|instal?lments?)\s+(?:of|from)\s+£?\s?\d/gi,
    explanation: 'A stated monthly or weekly payment triggers the representative example requirement (CONC 3.5.3R).',
    suggestion: 'Use the finance block, which renders the payment inside a compliant representative example.',
  },
  {
    kind: 'apr',
    re: /\b\d{1,2}(?:\.\d)?\s*%\s*APR\b/gi,
    explanation: 'An APR is a cost-of-credit figure and must be accompanied by a representative example.',
    suggestion: 'Remove it here. The representative APR belongs in the finance block, where it is given the required prominence.',
  },
  {
    kind: 'interest_rate',
    re: /\b\d{1,2}(?:\.\d+)?\s*%\s*(?:interest|flat\s*rate|per\s*annum|p\.?a\.?)\b/gi,
    explanation: 'A rate of interest triggers CONC 3.5.3R even when no payment is shown.',
    suggestion: 'Remove the rate, or move the whole statement into the finance block.',
  },
  {
    kind: 'credit_offer',
    re: /\b(?:0%\s*(?:finance|apr)|interest[-\s]?free\s*(?:credit|finance)|buy\s*now\s*pay\s*later)\b/gi,
    explanation:
      'A stated credit offer is a financial promotion. 0% is still a rate, and it still requires the example.',
    suggestion: 'Move it into the finance block, with the lender named and the example attached.',
  },
  {
    kind: 'credit_offer',
    re: /\b(?:finance\s+available|credit\s+available|we\s+finance|bad\s+credit|poor\s+credit|no\s+credit\s+check|everyone\s+accepted|guaranteed\s+(?:finance|approval|acceptance))\b/gi,
    explanation:
      'This suggests credit is available regardless of the customer\'s financial circumstances, which requires a ' +
      'representative APR with equal prominence (CONC 3.5.7R) — and "guaranteed acceptance" is very likely misleading ' +
      'under CONC 3.3 regardless of what accompanies it.',
    suggestion: 'Rewrite without the promise. "Finance available, subject to status" still needs the representative APR.',
  },
  {
    kind: 'deposit_incentive',
    re: /\b(?:no\s*deposit|zero\s*deposit|£0\s*deposit|nothing\s*to\s*pay\s*(?:for|until))\b/gi,
    explanation: 'A deposit or payment-holiday incentive to apply for credit triggers the representative APR requirement (CONC 3.5.7R).',
    suggestion: 'Move it into the finance block so the representative APR appears with equal prominence.',
  },
];

/**
 * Scan one field. Overlapping matches from different patterns are kept — two
 * different reasons the same sentence is a problem are two different things
 * the dealer may need to fix.
 */
export function scanForCostOfCredit(field: string, text: string | null | undefined): LanguageFinding[] {
  if (!text) return [];
  const findings: LanguageFinding[] = [];
  for (const pattern of PATTERNS) {
    // Fresh lastIndex per call: a shared global regex is stateful, and reusing
    // one across fields silently skips matches in every field after the first.
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    for (const m of text.matchAll(re)) {
      findings.push({
        kind: pattern.kind,
        match: m[0].trim(),
        index: m.index,
        field,
        explanation: pattern.explanation,
        suggestion: pattern.suggestion,
      });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

export interface PublishSubject {
  /** Every publishable free-text field on the page, keyed by where the dealer will find it. */
  fields: Readonly<Record<string, string | null | undefined>>;
  /** True when this page renders a valid, in-date representative example. */
  hasRepresentativeExample: boolean;
}

export interface PublishDecision {
  canPublish: boolean;
  findings: readonly LanguageFinding[];
  message: string | null;
}

/**
 * The publish gate.
 *
 * With a valid representative example on the page the findings are still
 * reported — a dealer should know a payment figure is sitting in their prose
 * where it cannot be kept in step with the lender's actual rates — but they do
 * not block. Without one, they block.
 */
export function publishDecision(subject: PublishSubject): PublishDecision {
  const findings = Object.entries(subject.fields).flatMap(([field, text]) => scanForCostOfCredit(field, text));
  if (findings.length === 0) return { canPublish: true, findings, message: null };

  if (subject.hasRepresentativeExample) {
    return {
      canPublish: true,
      findings,
      message:
        `${findings.length} cost-of-credit ${findings.length === 1 ? 'figure is' : 'figures are'} written into the ` +
        `page text. The representative example covers ${findings.length === 1 ? 'it' : 'them'}, but text figures do ` +
        `not update when the lender's rates change. Move ${findings.length === 1 ? 'it' : 'them'} into the finance block.`,
    };
  }

  const first = findings[0]!;
  return {
    canPublish: false,
    findings,
    // What happened, why, and what to do (design-system copy rule).
    message:
      `Can't publish — "${first.match}" in ${first.field} is a cost-of-credit figure, and a page showing one must ` +
      `also show a representative example (CONC 3.5.3R). ${first.suggestion}` +
      (findings.length > 1 ? ` ${findings.length - 1} other ${findings.length === 2 ? 'figure needs' : 'figures need'} the same treatment.` : ''),
  };
}
