import { describe, it, expect } from 'vitest';
import {
  assessCashPayment, validateOverride, cashPosition, ALERT_FRACTION,
  type AmlThresholdRule, type CashPayment,
} from './aml.js';
import { money } from './money.js';

/** £10,000 sterling, in force from 30 June 2026. */
const GBP_RULE: AmlThresholdRule = {
  key: 'aml.hvd_threshold', version: 2, effectiveFrom: '2026-06-30',
  amountPence: 1_000_000n, currency: 'GBP',
  sourceUrl: 'https://www.gov.uk/hmrc-internal-manuals/economic-crime-supervision-handbook/ecsh51525',
};

/** The pre-reform euro threshold, retained for historic receipts. */
const EUR_RULE: AmlThresholdRule = {
  ...GBP_RULE, version: 1, effectiveFrom: '2017-06-26', currency: 'EUR',
};

const AUG = (d: number): Date => new Date(Date.UTC(2026, 7, d, 12));

const cash = (pounds: number, over: Partial<CashPayment> = {}): CashPayment => ({
  amount: money(BigInt(pounds) * 100n),
  receivedAt: AUG(3),
  contactId: 'p1',
  ...over,
});

describe('the cash threshold', () => {
  it('accepts a small cash payment without comment', () => {
    const a = assessCashPayment(cash(2_000), [], GBP_RULE, { isRegisteredHvd: false });
    expect(a.outcome).toBe('ok');
    expect(a.accept).toBe(true);
  });

  it('warns as the threshold approaches, before anyone reaches the till', () => {
    // 80% of £10,000. A salesperson who learns about this at the payment step
    // has already told the customer they can pay cash.
    const a = assessCashPayment(cash(8_500), [], GBP_RULE, { isRegisteredHvd: false });
    expect(a.outcome).toBe('approaching');
    expect(a.accept).toBe(true);
    expect(a.reason).toMatch(/within/);
    expect(ALERT_FRACTION).toBe(0.8);
  });

  it('HARD BLOCKS an unregistered dealer at the threshold', () => {
    // Taking it is an offence, and registration cannot be backdated.
    const a = assessCashPayment(cash(10_000), [], GBP_RULE, { isRegisteredHvd: false });
    expect(a.outcome).toBe('blocked');
    expect(a.accept).toBe(false);
    expect(a.reason).toMatch(/cannot be backdated/);
    // Says what to do instead, never just "blocked".
    expect(a.reason).toMatch(/card or bank transfer/);
  });

  it('permits a REGISTERED dealer, with the due diligence instruction', () => {
    // Reporting the same "blocked" to both would stop lawful business for one
    // and describe a criminal offence as a warning to the other.
    const a = assessCashPayment(cash(10_000), [], GBP_RULE, { isRegisteredHvd: true });
    expect(a.outcome).toBe('ok');
    expect(a.accept).toBe(true);
    expect(a.reason).toMatch(/customer due diligence/);
  });

  it('blocks at exactly the threshold, not a penny above', () => {
    const at = assessCashPayment(cash(10_000), [], GBP_RULE, { isRegisteredHvd: false });
    const below = assessCashPayment(cash(9_999), [], GBP_RULE, { isRegisteredHvd: false });
    expect(at.accept).toBe(false);
    expect(below.accept).toBe(true);
  });
});

describe('linked and split payments', () => {
  it('counts earlier cash from the same customer', () => {
    // £6,000 then £6,000 is the classic split.
    const prior = [cash(6_000, { receivedAt: AUG(1) })];
    const a = assessCashPayment(cash(6_000), prior, GBP_RULE, { isRegisteredHvd: false });
    expect(a.outcome).toBe('blocked');
    expect(a.runningTotal.amount).toBe(600_000n);
    expect(a.projectedTotal.amount).toBe(1_200_000n);
  });

  it('follows an explicit linked group across different customers', () => {
    // A company and its director are two contacts and one transaction.
    const prior = [cash(6_000, { contactId: 'company', linkedGroupId: 'deal-1' })];
    const a = assessCashPayment(
      cash(6_000, { contactId: 'director', linkedGroupId: 'deal-1' }),
      prior, GBP_RULE, { isRegisteredHvd: false },
    );
    expect(a.outcome).toBe('blocked');
  });

  it('does not merge unrelated purchases by the same customer', () => {
    // A linked group is explicit and wins over the customer match, so a
    // customer's second car years later is its own transaction.
    const prior = [cash(6_000, { contactId: 'p1', linkedGroupId: 'deal-1' })];
    const a = assessCashPayment(
      cash(6_000, { contactId: 'p1', linkedGroupId: 'deal-2' }),
      prior, GBP_RULE, { isRegisteredHvd: false },
    );
    expect(a.outcome).toBe('ok');
  });

  it('ignores prior payments from a different customer entirely', () => {
    const prior = [cash(9_000, { contactId: 'someone-else' })];
    expect(assessCashPayment(cash(5_000), prior, GBP_RULE, { isRegisteredHvd: false }).outcome)
      .toBe('ok');
  });
});

describe('the threshold is versioned data, not a constant', () => {
  it('evaluates a historic receipt against the rule in force then', () => {
    // The MLR 2017 euro thresholds became a fixed £10,000 on 30 June 2026.
    // A payment before that date must still evaluate against version 1.
    const a = assessCashPayment(cash(10_000), [], EUR_RULE, { isRegisteredHvd: false });
    expect(a.threshold.currency).toBe('EUR');
    expect(a.outcome).toBe('blocked');
  });
});

describe('overrides', () => {
  const blocked = assessCashPayment(cash(10_000), [], GBP_RULE, { isRegisteredHvd: false });

  it('needs a named authoriser', () => {
    const r = validateOverride(blocked, { reason: 'Customer insisted on paying cash', authorisedBy: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name the person/);
  });

  it('needs a real reason, not a keystroke', () => {
    const r = validateOverride(blocked, { reason: 'ok', authorisedBy: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/real reason/);
  });

  it('accepts a properly authorised override', () => {
    const r = validateOverride(blocked, {
      reason: 'Registered with HMRC this morning, certificate on file',
      authorisedBy: 'u1',
    });
    expect(r.ok).toBe(true);
  });

  it('refuses to override something that was never blocked', () => {
    const fine = assessCashPayment(cash(100), [], GBP_RULE, { isRegisteredHvd: false });
    expect(validateOverride(fine, { reason: 'x'.repeat(20), authorisedBy: 'u1' }).ok).toBe(false);
  });
});

describe('the running cash position', () => {
  it('reports headroom before anyone reaches the payment step', () => {
    const p = cashPosition([cash(7_000)], GBP_RULE);
    expect(p.total.amount).toBe(700_000n);
    expect(p.headroom.amount).toBe(300_000n);
    expect(p.fractionUsed).toBeCloseTo(0.7);
  });

  it('reports zero headroom rather than a negative one', () => {
    const p = cashPosition([cash(12_000)], GBP_RULE);
    expect(p.headroom.amount).toBe(0n);
  });
});
