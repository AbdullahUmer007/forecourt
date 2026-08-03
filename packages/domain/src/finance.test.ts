/**
 * M8 — finance verification, the representative example and the 51% test.
 *
 * ⚠️ These tests assert what the code does. They are not a compliance opinion.
 * The retained FCA compliance consultant signs off the RULE RECORD; these
 * tests only prove the code obeys whatever record it is given.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  impliedApr, roundApr, quoteCashflows, verifyQuote, isDisplayable, APR_TOLERANCE_PP,
  validateRepresentativeExample, approvePromotion, tryApprovePromotion, FinancePromotionError,
  representativeAprFrom, representativeAprReport, commissionDisclosureProblems,
  ruleEffectiveOn, CONC_REPRESENTATIVE_EXAMPLE_V1,
  type FinanceQuote, type RepresentativeExample, type FinancePromotionRule, type ConcludedAgreement,
} from './finance.js';

const NOW = new Date('2026-08-02T09:00:00Z');

/** A clean, internally consistent HP quote to mutate in each test. */
function hpQuote(over: Partial<FinanceQuote> = {}): FinanceQuote {
  const cash = 1_200_000n, deposit = 200_000n, credit = 1_000_000n;
  const term = 48, monthly = 25_000n;
  const payments = monthly * BigInt(term);
  return {
    quoteId: 'q1', provider: 'ivendi', lenderName: 'Blue Motor Finance', productType: 'hp',
    cashPricePence: cash, depositPence: deposit, partExchangePence: 0n, amountOfCreditPence: credit,
    termMonths: term, monthlyPaymentPence: monthly, finalPaymentPence: null, fees: [],
    aprPercent: impliedApr(credit, Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })))!,
    flatRatePercent: null, fixedRate: true,
    totalChargeForCreditPence: payments - credit,
    // Statutory definition: amount of credit + total charge for credit.
    // The deposit is the advance payment and is NOT part of it.
    totalAmountPayablePence: payments,
    annualMileage: null, excessPencePerMile: null,
    quotedAt: new Date('2026-08-01T00:00:00Z'), expiresAt: new Date('2026-08-31T00:00:00Z'),
    ...over,
  };
}

// ---------------------------------------------------------------- APR
describe('the APR implied by a set of cashflows', () => {
  it('is zero-charge when the repayments equal the advance', () => {
    // 0% finance: nothing to imply, and quoting a positive APR against it is a lie.
    expect(impliedApr(1_200_000n, Array.from({ length: 12 }, (_, i) => ({ atMonth: i + 1, amountPence: 100_000n }))))
      .toBeNull();
  });

  it('reproduces a textbook amortisation', () => {
    // £10,000 over 48 months at £250/month is £12,000 repaid on £10,000
    // advanced. The APR must sit in the region a 9-10% flat deal implies.
    const apr = impliedApr(1_000_000n, Array.from({ length: 48 }, (_, i) => ({ atMonth: i + 1, amountPence: 25_000n })))!;
    expect(apr).toBeGreaterThan(9);
    expect(apr).toBeLessThan(10);
  });

  it('is reported to one decimal place, as the rule requires', () => {
    const apr = impliedApr(1_000_000n, Array.from({ length: 48 }, (_, i) => ({ atMonth: i + 1, amountPence: 25_000n })))!;
    expect(apr).toBe(roundApr(apr));
    expect(String(apr).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('rises when the same total is repaid later — money has a time value', () => {
    const early = impliedApr(1_000_000n, [{ atMonth: 1, amountPence: 1_200_000n }])!;
    const late = impliedApr(1_000_000n, [{ atMonth: 48, amountPence: 1_200_000n }])!;
    expect(early).toBeGreaterThan(late);
  });

  it('refuses rather than guessing when the cashflows are outside any lawful bracket', () => {
    // Repaying 500x the advance in a month is not a credit agreement.
    expect(impliedApr(1_000n, [{ atMonth: 1, amountPence: 500_000n }])).toBeNull();
  });

  it('is monotonic in the payment: a bigger payment is never a cheaper APR', () => {
    fc.assert(fc.property(
      fc.integer({ min: 20_000, max: 60_000 }),
      fc.integer({ min: 12, max: 60 }),
      (monthly, term) => {
        const flows = (m: number): { atMonth: number; amountPence: bigint }[] =>
          Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: BigInt(m) }));
        const low = impliedApr(1_000_000n, flows(monthly));
        const high = impliedApr(1_000_000n, flows(monthly + 1_000));
        if (low === null || high === null) return;
        expect(high).toBeGreaterThanOrEqual(low);
      },
    ));
  });
});

// ---------------------------------------------------------------- verification
describe('verifying a quote the lender sent us', () => {
  it('passes a consistent quote', () => {
    expect(verifyQuote(hpQuote())).toEqual([]);
    expect(isDisplayable(hpQuote(), NOW)).toBe(true);
  });

  it('refuses an APR that does not match its own cashflows', () => {
    // The moment we render it, the lender's error is OUR financial promotion.
    const wrong = hpQuote({ aprPercent: 4.9 });
    const problem = verifyQuote(wrong).find((p) => p.field === 'aprPercent')!;
    expect(problem.severity).toBe('blocking');
    expect(problem.message).toMatch(/cashflows imply/);
    expect(problem.message).toMatch(/reissue/);
    expect(isDisplayable(wrong, NOW)).toBe(false);
  });

  it('accepts an APR inside the one-decimal-place tolerance', () => {
    const q = hpQuote();
    const nudged = hpQuote({ aprPercent: q.aprPercent + APR_TOLERANCE_PP });
    expect(verifyQuote(nudged).some((p) => p.field === 'aprPercent')).toBe(false);
  });

  it('refuses an amount of credit that is not cash price less deposit', () => {
    const wrong = hpQuote({ amountOfCreditPence: 999_999n });
    expect(verifyQuote(wrong).some((p) => p.field === 'amountOfCreditPence' && p.severity === 'blocking')).toBe(true);
  });

  it('uses the STATUTORY total amount payable, which excludes the deposit', () => {
    // s.189 CCA 1974: total amount payable = total amount of credit + total
    // charge for credit. Not total cash outlay. We had this wrong until a live
    // competitor's published example reconciled on the statutory definition
    // and failed on ours.
    const q = hpQuote();
    expect(q.totalAmountPayablePence).toBe(q.amountOfCreditPence + q.totalChargeForCreditPence);
    const withDeposit = hpQuote({ totalAmountPayablePence: q.totalAmountPayablePence + q.depositPence });
    const problem = verifyQuote(withDeposit).find((p) => p.field === 'totalAmountPayablePence')!;
    expect(problem.severity).toBe('blocking');
    expect(problem.message).toMatch(/excludes the deposit/);
  });

  it('reproduces a real published representative example exactly', () => {
    // Kennington Car Sales, read from their live stock page on 2 August 2026:
    // £45,999 cash price, £5,999 deposit, £40,000 credit, 48 x £993.50 plus a
    // final £496.75, total charge for credit £8,184.75, total amount payable
    // £48,184.75, advertised as "representative 8.90% APR".
    //
    // Every figure reconciles EXCEPT the APR: the cashflows imply 9.8%, and
    // £993.50 is exactly the payment for 8.90% as a NOMINAL annual rate
    // compounded monthly — i.e. the interest rate, not the APR, which CONC
    // App 1.2 requires to be an effective annual rate.
    const credit = 4_000_000n, term = 48, monthly = 99_350n, final = 49_675n;
    const theirs = hpQuote({
      cashPricePence: 4_599_900n, depositPence: 599_900n, amountOfCreditPence: credit,
      termMonths: term, monthlyPaymentPence: monthly,
      fees: [{ label: 'Final payment', amountPence: final, dueAtMonth: term }],
      totalChargeForCreditPence: monthly * BigInt(term) + final - credit,
      totalAmountPayablePence: monthly * BigInt(term) + final,
      aprPercent: 8.9,
    });
    expect(theirs.totalChargeForCreditPence).toBe(818_475n);
    expect(theirs.totalAmountPayablePence).toBe(4_818_475n);

    const problems = verifyQuote(theirs);
    // Everything reconciles except the advertised rate.
    expect(problems.map((p) => p.field)).toEqual(['aprPercent']);
    expect(problems[0]!.message).toMatch(/9\.8%/);
    expect(isDisplayable(theirs, NOW)).toBe(false);
  });

  it('counts fees into the charge for credit and the total payable', () => {
    const base = hpQuote();
    const withFees = hpQuote({
      fees: [
        { label: 'Documentation fee', amountPence: 19_900n, dueAtMonth: 1 },
        { label: 'Option to purchase fee', amountPence: 10_000n, dueAtMonth: 48 },
      ],
      totalChargeForCreditPence: base.totalChargeForCreditPence + 29_900n,
      totalAmountPayablePence: base.totalAmountPayablePence + 29_900n,
    });
    // The APR must rise once fees are inside the total charge for credit.
    const impliedWithFees = impliedApr(withFees.amountOfCreditPence, quoteCashflows(withFees))!;
    expect(impliedWithFees).toBeGreaterThan(base.aprPercent);
    const corrected = hpQuote({ ...withFees, aprPercent: impliedWithFees });
    expect(verifyQuote(corrected)).toEqual([]);
  });

  it('handles a PCP balloon as a payment at the end of the term', () => {
    const term = 36, monthly = 18_000n, balloon = 500_000n, credit = 1_000_000n;
    const flows = [
      ...Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })),
      { atMonth: term, amountPence: balloon },
    ];
    const apr = impliedApr(credit, flows)!;
    const pcp = hpQuote({
      productType: 'pcp', termMonths: term, monthlyPaymentPence: monthly,
      finalPaymentPence: balloon, annualMileage: 10_000, aprPercent: apr,
      totalChargeForCreditPence: monthly * BigInt(term) + balloon - credit,
      totalAmountPayablePence: monthly * BigInt(term) + balloon,
    });
    expect(verifyQuote(pcp).filter((p) => p.severity === 'blocking')).toEqual([]);
  });

  it('warns about a PCP with no mileage allowance', () => {
    const term = 36, monthly = 18_000n, balloon = 500_000n, credit = 1_000_000n;
    const apr = impliedApr(credit, [
      ...Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })),
      { atMonth: term, amountPence: balloon },
    ])!;
    const pcp = hpQuote({
      productType: 'pcp', termMonths: term, monthlyPaymentPence: monthly, finalPaymentPence: balloon,
      annualMileage: null, aprPercent: apr,
      totalChargeForCreditPence: monthly * BigInt(term) + balloon - credit,
      totalAmountPayablePence: monthly * BigInt(term) + balloon,
    });
    const warning = verifyQuote(pcp).find((p) => p.field === 'annualMileage')!;
    expect(warning.severity).toBe('warning');
    expect(warning.message).toMatch(/excess-mileage/);
  });

  it('will not display an expired quote', () => {
    expect(isDisplayable(hpQuote(), new Date('2026-09-15T00:00:00Z'))).toBe(false);
  });
});

// ---------------------------------------------------------------- the gate
describe('the representative example gate', () => {
  const signedRule: FinancePromotionRule = {
    ...CONC_REPRESENTATIVE_EXAMPLE_V1,
    signedOffBy: 'A. Consultant, Motor Compliance Ltd',
    signedOffAt: new Date('2026-07-01T00:00:00Z'),
  };

  function example(over: Partial<RepresentativeExample> = {}): RepresentativeExample {
    const cash = 1_200_000n, advance = 200_000n, credit = 1_000_000n, term = 48, monthly = 25_000n;
    return {
      id: 'e1', tenantId: 't1', version: 1, productType: 'hp',
      cashPricePence: cash, advancePaymentPence: advance, amountOfCreditPence: credit,
      termMonths: term, monthlyPaymentPence: monthly, finalPaymentPence: null, otherCharges: [],
      interestRatePercent: 9.9, interestRateFixed: true,
      representativeAprPercent: impliedApr(credit, Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })))!,
      totalAmountPayablePence: monthly * BigInt(term),
      approvedBy: 'Dealer Principal', approvedAt: new Date('2026-07-15T00:00:00Z'),
      effectiveFrom: new Date('2026-07-15T00:00:00Z'), effectiveTo: null,
      ...over,
    };
  }

  it('approves a valid, in-date example against a signed-off rule', () => {
    expect(validateRepresentativeExample(example(), signedRule, NOW)).toEqual([]);
    expect(() => approvePromotion(example(), signedRule, NOW)).not.toThrow();
  });

  it('REFUSES when the rule itself has not been signed off', () => {
    // This is the launch gate. The seeded rule ships unsigned, so nothing can
    // render until the retained consultant approves it.
    const problems = validateRepresentativeExample(example(), CONC_REPRESENTATIVE_EXAMPLE_V1, NOW);
    expect(problems.some((p) => p.field === 'rule')).toBe(true);
    expect(() => approvePromotion(example(), CONC_REPRESENTATIVE_EXAMPLE_V1, NOW))
      .toThrow(FinancePromotionError);
  });

  it('refuses an unapproved example', () => {
    expect(() => approvePromotion(example({ approvedBy: null, approvedAt: null }), signedRule, NOW))
      .toThrow(/has not been approved/);
  });

  it('refuses an example that has gone stale', () => {
    // A promotion nobody has checked in three months is a rate nobody is
    // lending at any more.
    const stale = example({ approvedAt: new Date('2026-01-01T00:00:00Z') });
    expect(() => approvePromotion(stale, signedRule, NOW)).toThrow(/re-approved every 90 days/);
  });

  it('refuses an example that does not add up', () => {
    const wrong = example({ totalAmountPayablePence: 1n });
    expect(() => approvePromotion(wrong, signedRule, NOW)).toThrow(/Total amount payable/);
  });

  it('refuses an example whose APR does not match its own figures', () => {
    expect(() => approvePromotion(example({ representativeAprPercent: 2.9 }), signedRule, NOW))
      .toThrow(/cashflows imply/);
  });

  it('degrades rather than throwing when a page must still render', () => {
    const attempt = tryApprovePromotion(null, signedRule, NOW);
    expect(attempt.ok).toBe(false);
    expect(attempt.promotion).toBeNull();
    expect(attempt.problems[0]!.message).toMatch(/No representative example is configured/);
  });

  it('names every problem, so a dealer knows what to fix', () => {
    try {
      approvePromotion(example({ approvedBy: null, approvedAt: null }), CONC_REPRESENTATIVE_EXAMPLE_V1, NOW);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as FinancePromotionError).problems.length).toBeGreaterThanOrEqual(2);
      expect((err as Error).message).toMatch(/CONC 3\.5\.3R/);
    }
  });
});

// ---------------------------------------------------------------- rule versions
describe('which rule governs a date', () => {
  const v1: FinancePromotionRule = { ...CONC_REPRESENTATIVE_EXAMPLE_V1, version: 1 };
  const v2: FinancePromotionRule = {
    ...CONC_REPRESENTATIVE_EXAMPLE_V1, version: 2, effectiveFrom: new Date('2026-08-02T00:00:00Z'),
  };

  it('prefers the highest version whose window covers the date', () => {
    expect(ruleEffectiveOn([v1, v2], NOW)?.version).toBe(2);
    expect(ruleEffectiveOn([v2, v1], NOW)?.version).toBe(2);
  });

  it('still explains a decision made before the new version existed', () => {
    // A promotion rendered in March has to remain explicable in November.
    expect(ruleEffectiveOn([v1, v2], new Date('2026-03-01T00:00:00Z'))?.version).toBe(1);
  });

  it('returns nothing rather than a guess when no rule covers the date', () => {
    expect(ruleEffectiveOn([v2], new Date('2020-01-01T00:00:00Z'))).toBeNull();
  });
});

// ---------------------------------------------------------------- the 51% test
describe('the representative APR governance test', () => {
  const agreements = (aprs: readonly number[]): ConcludedAgreement[] =>
    aprs.map((aprPercent, i) => ({
      agreementId: `a${i}`, aprPercent, concludedAt: NOW, promotionId: 'p1',
    }));

  it('finds the APR at which at least 51% of business completed', () => {
    const apr = representativeAprFrom(agreements([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))!;
    // 6 of 10 at or below 10.0 — the first APR that clears 51%.
    expect(apr).toBe(10);
  });

  it('passes when the advertised rate holds', () => {
    const report = representativeAprReport(12.9, agreements(Array.from({ length: 30 }, (_, i) => (i < 20 ? 9.9 : 15.9))));
    expect(report.compliant).toBe(true);
    expect(report.finding).toMatch(/holds/);
  });

  it('fails loudly when it does not, and says what to advertise instead', () => {
    // A drifted representative APR is a live breach on every page of the
    // dealer's website at once, and nobody notices until a complaint arrives.
    const report = representativeAprReport(9.9, agreements(Array.from({ length: 30 }, (_, i) => (i < 5 ? 9.9 : 18.9))));
    expect(report.compliant).toBe(false);
    expect(report.finding).toMatch(/non-compliant/);
    expect(report.finding).toMatch(/Advertise 18\.9% APR instead/);
  });

  it('does not call a small sample a pass', () => {
    // "17% of 6 deals" is not evidence of anything, and reporting it as a pass
    // would be the most comfortable possible lie.
    const report = representativeAprReport(9.9, agreements([9.9, 18.9, 18.9, 18.9, 18.9, 18.9]));
    expect(report.compliant).toBe(true);
    expect(report.finding).toMatch(/Not a pass/);
    expect(report.finding).toMatch(/too few/);
  });

  it('reports zero agreements without dividing by zero', () => {
    const report = representativeAprReport(9.9, []);
    expect(report.share).toBe(0);
    expect(report.suggestedAprPercent).toBeNull();
  });
});

// ---------------------------------------------------------------- commission
describe('commission disclosure', () => {
  const base = {
    type: 'flat' as const, amountPence: 40_000n, percentOfCredit: null,
    lenderName: 'Blue Motor Finance',
    disclosedAt: new Date('2026-08-01T00:00:00Z'),
    disclosureWordingVersion: 'commission-v3',
    customerAcknowledgedAt: new Date('2026-08-01T00:00:00Z'),
  };

  it('accepts a complete disclosure', () => {
    expect(commissionDisclosureProblems(base, NOW)).toEqual([]);
  });

  it('refuses to record a discretionary commission arrangement at all', () => {
    // Banned since January 2021. Modelling it would imply it were an option.
    const problems = commissionDisclosureProblems({ ...base, type: 'difference_in_charges' }, NOW);
    expect(problems[0]!.message).toMatch(/banned since January 2021/);
  });

  it('requires the exact wording version, not just the fact of disclosure', () => {
    const problems = commissionDisclosureProblems({ ...base, disclosureWordingVersion: null }, NOW);
    expect(problems[0]!.message).toMatch(/not evidence/);
  });

  it('requires an amount or a basis', () => {
    const problems = commissionDisclosureProblems({ ...base, amountPence: null, percentOfCredit: null }, NOW);
    expect(problems.some((p) => p.field === 'amountPence')).toBe(true);
  });

  it('expects nothing when there is no commission', () => {
    expect(commissionDisclosureProblems({
      ...base, type: 'none', amountPence: null, disclosedAt: null, disclosureWordingVersion: null,
    }, NOW)).toEqual([]);
  });
});
