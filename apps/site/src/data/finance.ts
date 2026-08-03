/**
 * Loading the finance block — the gate, in its production form.
 *
 * This function returns null far more often than it returns a block, and every
 * one of those nulls is deliberate:
 *
 *   · the compliance rule has not been signed off        → null
 *   · the dealer has no approved representative example  → null
 *   · the example is out of date or does not reconcile   → null
 *   · there is no verified quote for this car            → null
 *
 * A null renders `renderFinanceUnavailable`, which contains no figure at all
 * and therefore needs no representative example. There is no path through this
 * module that produces a payment without one — `approvePromotion` is the only
 * constructor of the token the renderer requires, and it throws rather than
 * degrading.
 *
 * ⚠️ On a freshly migrated database this ALWAYS returns null, because
 * `conc.representative_example` ships unsigned. That is the launch gate
 * working, not a bug.
 */

import { withTenant, toPence, toInt, toDate, type Tx } from './db.js';
import {
  tryApprovePromotion, verifyQuote,
  type FinancePromotionRule, type RepresentativeExample, type FinanceQuote,
  type ExampleField, type FinanceProductType, type FinanceFee,
} from '../../../../packages/domain/src/finance.js';
import type { FinanceBlock } from '../render/vdp.js';

interface Row { [key: string]: unknown }

/** The rule governing today, read from `compliance_rules`. Never a constant. */
async function loadRule(tx: Tx, on: Date): Promise<FinancePromotionRule | null> {
  const rows = await tx`
    SELECT version, effective_from, effective_to, parameters, source_url, signed_off_by, signed_off_at
      FROM compliance_rules
     WHERE key = 'conc.representative_example'
       AND effective_from <= ${on}
       AND (effective_to IS NULL OR effective_to > ${on})
     ORDER BY version DESC
     LIMIT 1`;
  const r = rows[0] as Row | undefined;
  if (!r) return null;

  const p = (r['parameters'] as Record<string, unknown>) ?? {};
  return {
    key: 'conc.representative_example',
    version: toInt(r['version']) ?? 0,
    effectiveFrom: toDate(r['effective_from']) ?? new Date(0),
    effectiveTo: toDate(r['effective_to']),
    requiredFields: (p['requiredFields'] as ExampleField[]) ?? [],
    prominentField: (p['prominentField'] as ExampleField) ?? 'representativeApr',
    heading: String(p['heading'] ?? 'Representative Example'),
    representativeThreshold: Number(p['representativeThreshold'] ?? 0.51),
    maxAgeDays: Number(p['maxAgeDays'] ?? 90),
    sourceUrl: String(r['source_url'] ?? ''),
    signedOffBy: (r['signed_off_by'] as string) ?? null,
    signedOffAt: toDate(r['signed_off_at']),
  };
}

async function loadExample(tx: Tx, tenantId: string, on: Date): Promise<RepresentativeExample | null> {
  const rows = await tx`
    SELECT id, version, product_type, cash_price_pence, advance_payment_pence,
           amount_of_credit_pence, term_months, monthly_payment_pence, final_payment_pence,
           other_charges, interest_rate_percent, interest_rate_fixed,
           representative_apr_percent, total_amount_payable_pence,
           approved_by, approved_at, effective_from, effective_to
      FROM representative_examples
     WHERE approved_at IS NOT NULL
       AND effective_from <= ${on}
       AND (effective_to IS NULL OR effective_to > ${on})
     ORDER BY version DESC
     LIMIT 1`;
  const r = rows[0] as Row | undefined;
  if (!r) return null;

  return {
    id: String(r['id']), tenantId, version: toInt(r['version']) ?? 1,
    productType: String(r['product_type']) as FinanceProductType,
    cashPricePence: toPence(r['cash_price_pence']) ?? 0n,
    advancePaymentPence: toPence(r['advance_payment_pence']) ?? 0n,
    amountOfCreditPence: toPence(r['amount_of_credit_pence']) ?? 0n,
    termMonths: toInt(r['term_months']) ?? 0,
    monthlyPaymentPence: toPence(r['monthly_payment_pence']) ?? 0n,
    finalPaymentPence: toPence(r['final_payment_pence']),
    otherCharges: (r['other_charges'] as FinanceFee[]) ?? [],
    interestRatePercent: Number(r['interest_rate_percent']),
    interestRateFixed: Boolean(r['interest_rate_fixed']),
    representativeAprPercent: Number(r['representative_apr_percent']),
    totalAmountPayablePence: toPence(r['total_amount_payable_pence']) ?? 0n,
    approvedBy: (r['approved_by'] as string) ?? null,
    approvedAt: toDate(r['approved_at']),
    effectiveFrom: toDate(r['effective_from']) ?? new Date(0),
    effectiveTo: toDate(r['effective_to']),
  };
}

async function loadQuote(tx: Tx, vehicleId: string, on: Date): Promise<FinanceQuote | null> {
  const rows = await tx`
    SELECT id, provider, provider_quote_ref, lender_name, product_type,
           cash_price_pence, deposit_pence, part_exchange_pence, amount_of_credit_pence,
           term_months, monthly_payment_pence, final_payment_pence, fees,
           apr_percent, flat_rate_percent, fixed_rate,
           total_charge_for_credit_pence, total_amount_payable_pence,
           annual_mileage, excess_pence_per_mile, quoted_at, expires_at
      FROM vehicle_finance_quotes
     WHERE vehicle_id = ${vehicleId}::uuid
       AND verified_at IS NOT NULL          -- unverified never reaches a buyer
       AND expires_at > ${on}
     ORDER BY monthly_payment_pence ASC
     LIMIT 1`;
  const r = rows[0] as Row | undefined;
  if (!r) return null;

  return {
    quoteId: String(r['id']), provider: String(r['provider']),
    lenderName: String(r['lender_name']),
    productType: String(r['product_type']) as FinanceProductType,
    cashPricePence: toPence(r['cash_price_pence']) ?? 0n,
    depositPence: toPence(r['deposit_pence']) ?? 0n,
    partExchangePence: toPence(r['part_exchange_pence']) ?? 0n,
    amountOfCreditPence: toPence(r['amount_of_credit_pence']) ?? 0n,
    termMonths: toInt(r['term_months']) ?? 0,
    monthlyPaymentPence: toPence(r['monthly_payment_pence']) ?? 0n,
    finalPaymentPence: toPence(r['final_payment_pence']),
    fees: (r['fees'] as FinanceFee[]) ?? [],
    aprPercent: Number(r['apr_percent']),
    flatRatePercent: r['flat_rate_percent'] === null ? null : Number(r['flat_rate_percent']),
    fixedRate: Boolean(r['fixed_rate']),
    totalChargeForCreditPence: toPence(r['total_charge_for_credit_pence']) ?? 0n,
    totalAmountPayablePence: toPence(r['total_amount_payable_pence']) ?? 0n,
    annualMileage: toInt(r['annual_mileage']),
    excessPencePerMile: toInt(r['excess_pence_per_mile']),
    quotedAt: toDate(r['quoted_at']) ?? new Date(0),
    expiresAt: toDate(r['expires_at']) ?? new Date(0),
  };
}

export async function loadFinanceBlock(
  tenantId: string,
  vehicle: { id: string },
  now: Date,
): Promise<FinanceBlock | null> {
  return withTenant(tenantId, async (tx) => {
    const [rule, example] = await Promise.all([loadRule(tx, now), loadExample(tx, tenantId, now)]);

    const attempt = tryApprovePromotion(example, rule, now);
    if (!attempt.ok || attempt.promotion === null) {
      // Left as a warning rather than swallowed: a dealer whose example has
      // gone stale needs to know their site has stopped showing payments, and
      // the reason is the first thing anyone will ask.
      console.warn(
        `[forecourt] no finance promotion for tenant ${tenantId}: ` +
        attempt.problems.map((p) => `${p.field}: ${p.message}`).join(' | '),
      );
      return null;
    }

    const quote = await loadQuote(tx, vehicle.id, now);
    // A quote whose own arithmetic does not reconcile is not shown at all. It
    // should never be here — `verified_at` is only set after the same check —
    // but the display path re-checks rather than trusting a stored flag.
    const usable = quote !== null && !verifyQuote(quote).some((p) => p.severity === 'blocking') ? quote : null;

    const dealerRows = await tx`SELECT name, fca_frn, settings FROM tenants WHERE id = ${tenantId}::uuid`;
    const d = (dealerRows[0] ?? {}) as Row;
    const settings = (d['settings'] as Record<string, string> | null) ?? {};

    return {
      promotion: attempt.promotion,
      quote: usable,
      dealer: {
        name: String(d['name'] ?? ''),
        fcaFrn: (d['fca_frn'] as string) ?? null,
        principalName: settings['principal_name'] ?? null,
        principalFrn: settings['principal_frn'] ?? null,
        isCreditBroker: true,
      },
    };
  });
}
