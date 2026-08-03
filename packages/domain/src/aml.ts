/**
 * M11 — the AML High Value Dealer cash threshold.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED COMPLIANCE CONSULTANT'S SIGN-OFF.
 *
 * A dealer accepting cash of £10,000 or more must be registered with HMRC as a
 * High Value Dealer BEFORE taking the payment — registration cannot be
 * backdated. Taking it unregistered is an offence, so the product hard-blocks
 * it rather than warning.
 *
 * Two things make this harder than a single comparison:
 *
 *   1. LINKED PAYMENTS count together. Splitting £12,000 into two £6,000 cash
 *      payments a week apart is the classic evasion, and the regulation
 *      follows the transaction rather than the receipt. So the running total
 *      is per customer AND per linked set, and the linking is explicit.
 *
 *   2. The threshold MOVED. It was €10,000 until the 2026 AML reform converted
 *      the MLR 2017 thresholds to a fixed £10,000 on 30 June 2026. A payment
 *      received before that date must still be evaluated against the rule that
 *      was in force then — which is why the threshold is resolved from
 *      `compliance_rules` keyed on the RECEIPT date and never from a constant.
 */

import { type Money, money, add, zero, format } from './money.js';

/** Resolved from `compliance_rules['aml.hvd_threshold']` for the receipt date. */
export interface AmlThresholdRule {
  readonly key: 'aml.hvd_threshold';
  readonly version: number;
  readonly effectiveFrom: string;
  readonly amountPence: bigint;
  readonly currency: 'GBP' | 'EUR';
  readonly sourceUrl: string;
}

export interface CashPayment {
  amount: Money;
  receivedAt: Date;
  contactId: string | null;
  /** Set when several payments form one transaction. */
  linkedGroupId?: string | null;
}

/** Warn at 80% so a dealer can have the registration conversation before the sale. */
export const ALERT_FRACTION = 0.8;

export type AmlOutcome = 'ok' | 'approaching' | 'blocked';

export interface AmlAssessment {
  outcome: AmlOutcome;
  /** Cash already taken against this customer or linked set, before this payment. */
  runningTotal: Money;
  /** The running total INCLUDING the payment being assessed. */
  projectedTotal: Money;
  threshold: Money;
  /** Whether this payment may be accepted without an override. */
  accept: boolean;
  /** Whether an override could lawfully permit it — false when already registered. */
  overridable: boolean;
  reason: string;
}

/**
 * Assess a cash payment against the threshold.
 *
 * `isRegisteredHvd` is the pivot. A registered dealer may take the cash and
 * simply has to complete customer due diligence; an unregistered one must not
 * take it at all. Reporting the same "blocked" to both would be wrong in
 * opposite directions — one gets stopped from lawful business, the other gets
 * told a criminal offence is a warning.
 */
export function assessCashPayment(
  payment: CashPayment,
  priorPayments: readonly CashPayment[],
  rule: AmlThresholdRule,
  opts: { isRegisteredHvd: boolean },
): AmlAssessment {
  const currency = payment.amount.currency;
  const threshold = money(rule.amountPence, rule.currency === 'EUR' ? 'EUR' : 'GBP');

  // Count what is genuinely part of the same transaction: same linked set, or
  // failing that the same customer. A linked group is explicit and wins,
  // because two customers can share a group (a company and its director) and
  // one customer can have unrelated purchases years apart.
  const related = priorPayments.filter((p) =>
    payment.linkedGroupId
      ? p.linkedGroupId === payment.linkedGroupId
      : p.contactId !== null && p.contactId === payment.contactId);

  const runningTotal = related.reduce((acc, p) => add(acc, p.amount), zero(currency));
  const projectedTotal = add(runningTotal, payment.amount);

  const alertAt = (threshold.amount * BigInt(Math.round(ALERT_FRACTION * 100))) / 100n;

  if (projectedTotal.amount >= threshold.amount) {
    if (opts.isRegisteredHvd) {
      return {
        outcome: 'ok', runningTotal, projectedTotal, threshold,
        accept: true, overridable: false,
        reason:
          `This takes cash from this customer to ${format(projectedTotal)}, at or above the ` +
          `${format(threshold)} High Value Dealer threshold. You are registered, so complete ` +
          `full customer due diligence and keep the evidence with the deal.`,
      };
    }
    return {
      outcome: 'blocked', runningTotal, projectedTotal, threshold,
      accept: false, overridable: true,
      reason:
        `Taking this would bring cash from this customer to ${format(projectedTotal)}, at or above ` +
        `the ${format(threshold)} threshold, and this dealership is not registered with HMRC as a ` +
        `High Value Dealer. Registration cannot be backdated. Take the balance by card or bank ` +
        `transfer, or register first.`,
    };
  }

  if (projectedTotal.amount >= alertAt) {
    return {
      outcome: 'approaching', runningTotal, projectedTotal, threshold,
      accept: true, overridable: false,
      reason:
        `Cash from this customer would reach ${format(projectedTotal)}, within ` +
        `${format(money(threshold.amount - projectedTotal.amount, currency))} of the ` +
        `${format(threshold)} threshold. Any further cash on this deal needs HVD registration.`,
    };
  }

  return {
    outcome: 'ok', runningTotal, projectedTotal, threshold,
    accept: true, overridable: false,
    reason: `Cash from this customer would be ${format(projectedTotal)}, below the ${format(threshold)} threshold.`,
  };
}

export interface AmlOverride {
  reason: string;
  authorisedBy: string;
  runningTotal: Money;
  threshold: Money;
  createdAt: Date;
}

/**
 * Validate an override of a blocked payment.
 *
 * The override exists because a block that cannot be overridden gets worked
 * around outside the system, where nothing is recorded at all. But it demands
 * a named authoriser and a real reason, and it writes append-only evidence —
 * so the dealer who uses it has made a documented decision rather than a
 * quiet one.
 */
export function validateOverride(
  assessment: AmlAssessment,
  override: { reason: string; authorisedBy: string | null },
): { ok: boolean; error: string | null } {
  if (assessment.accept) {
    return { ok: false, error: 'This payment is not blocked, so it does not need an override.' };
  }
  if (!override.authorisedBy) {
    return { ok: false, error: 'An override must name the person authorising it.' };
  }
  if (override.reason.trim().length < 10) {
    return {
      ok: false,
      error: 'Give a real reason for overriding the cash threshold — this is written to the compliance record.',
    };
  }
  return { ok: true, error: null };
}

/**
 * The running cash position for a customer, for the deal screen.
 *
 * Shown before anyone reaches the payment step: a salesperson who learns about
 * the threshold at the point of taking the money has already told the customer
 * they can pay cash.
 */
export function cashPosition(
  payments: readonly CashPayment[],
  rule: AmlThresholdRule,
): { total: Money; threshold: Money; headroom: Money; fractionUsed: number } {
  const total = payments.reduce((acc, p) => add(acc, p.amount), zero('GBP'));
  const threshold = money(rule.amountPence, 'GBP');
  const headroom = money(
    threshold.amount > total.amount ? threshold.amount - total.amount : 0n, 'GBP');
  return {
    total,
    threshold,
    headroom,
    fractionUsed: threshold.amount === 0n ? 0 : Number(total.amount) / Number(threshold.amount),
  };
}
