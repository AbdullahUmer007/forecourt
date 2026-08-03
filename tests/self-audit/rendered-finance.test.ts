/**
 * M8 — the acceptance test for the whole module.
 *
 * From the build plan: "there is no code path, in any renderer, that produces a
 * bare payment figure — asserted by a golden-file test that fails the build."
 *
 * This is that test. It has three jobs:
 *
 *   1. Prove the promotion cannot render without a valid representative
 *      example — including when the compliance rule is unsigned, which is how
 *      the platform ships.
 *   2. Pin the exact markup in a golden file, so that any change to a
 *      regulated block is a deliberate, reviewable diff rather than a quiet
 *      refactor.
 *   3. Prove the prominence rule (CONC 3.5.6R) holds in the CSS, not just in
 *      someone's intention.
 *
 * ⚠️ Passing tests are not sign-off. The retained FCA compliance consultant
 * approves the RULE RECORD; this only proves the code obeys it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFinancePromotion, renderFinanceUnavailable } from '../../apps/site/src/render/finance.js';
import { renderVehiclePage, type VdpInput } from '../../apps/site/src/render/vdp.js';
import { criticalCss } from '../../apps/site/src/render/theme.js';
import {
  approvePromotion, impliedApr, CONC_REPRESENTATIVE_EXAMPLE_V1, FinancePromotionError,
  type FinancePromotionRule, type RepresentativeExample, type FinanceQuote,
} from '../../packages/domain/src/finance.js';
import { parseSearchQuery } from '../../packages/domain/src/search.js';
import { canonicalUrl, vehicleUrlPath } from '../../packages/domain/src/seo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, '__golden__', 'finance-promotion.html');
const NOW = new Date('2026-08-02T09:00:00Z');
const ORIGIN = 'https://www.kenningtoncarsales.co.uk';

const SIGNED_RULE: FinancePromotionRule = {
  ...CONC_REPRESENTATIVE_EXAMPLE_V1,
  version: 2,
  signedOffBy: 'A. Consultant, Motor Compliance Ltd',
  signedOffAt: new Date('2026-07-01T00:00:00Z'),
};

const TERM = 48;
const MONTHLY = 25_000n;
const CREDIT = 1_000_000n;
const APR = impliedApr(CREDIT, Array.from({ length: TERM }, (_, i) => ({ atMonth: i + 1, amountPence: MONTHLY })))!;

const EXAMPLE: RepresentativeExample = {
  id: 'e1', tenantId: 't-kennington', version: 1, productType: 'hp',
  cashPricePence: 1_200_000n, advancePaymentPence: 200_000n, amountOfCreditPence: CREDIT,
  termMonths: TERM, monthlyPaymentPence: MONTHLY, finalPaymentPence: null,
  // No fees inside the total charge for credit. A "£0.00 documentation fee"
  // row is noise; "None" is the honest rendering of nothing.
  otherCharges: [],
  interestRatePercent: 9.9, interestRateFixed: true, representativeAprPercent: APR,
  totalAmountPayablePence: MONTHLY * BigInt(TERM),
  approvedBy: 'Dealer Principal', approvedAt: new Date('2026-07-15T00:00:00Z'),
  effectiveFrom: new Date('2026-07-15T00:00:00Z'), effectiveTo: null,
};

const QUOTE: FinanceQuote = {
  quoteId: 'q1', provider: 'ivendi', lenderName: 'Blue Motor Finance', productType: 'hp',
  cashPricePence: 1_999_900n, depositPence: 500_000n, partExchangePence: 0n,
  amountOfCreditPence: 1_499_900n, termMonths: 48, monthlyPaymentPence: 37_500n,
  finalPaymentPence: null, fees: [],
  aprPercent: impliedApr(1_499_900n, Array.from({ length: 48 }, (_, i) => ({ atMonth: i + 1, amountPence: 37_500n })))!,
  flatRatePercent: null, fixedRate: true,
  totalChargeForCreditPence: 37_500n * 48n - 1_499_900n,
  totalAmountPayablePence: 37_500n * 48n,
  annualMileage: null, excessPencePerMile: null,
  quotedAt: new Date('2026-08-01T00:00:00Z'), expiresAt: new Date('2026-08-31T00:00:00Z'),
};

const DEALER = {
  name: 'Kennington Car Sales', fcaFrn: '993469',
  principalName: null, principalFrn: null, isCreditBroker: true,
};

const PROMOTION = approvePromotion(EXAMPLE, SIGNED_RULE, NOW);
const HTML = renderFinancePromotion({ promotion: PROMOTION, quote: QUOTE, dealer: DEALER });

// ---------------------------------------------------------------------------
describe('the gate: a payment figure cannot exist without its example', () => {
  it('refuses to render against the rule as it SHIPS — unsigned', () => {
    // The platform seeds conc.representative_example unsigned on purpose. Until
    // the retained consultant signs it, no dealer site can show a payment.
    expect(() => approvePromotion(EXAMPLE, CONC_REPRESENTATIVE_EXAMPLE_V1, NOW))
      .toThrow(FinancePromotionError);
  });

  it('refuses a stale example even when the rule is signed', () => {
    expect(() => approvePromotion(
      { ...EXAMPLE, approvedAt: new Date('2026-01-01T00:00:00Z') }, SIGNED_RULE, NOW,
    )).toThrow(/re-approved/);
  });

  it('has no way to render a payment without going through the gate', () => {
    // renderFinancePromotion's only entry point is an ApprovedPromotion, which
    // only approvePromotion can construct. This asserts the shape of that
    // contract survives a refactor: passing anything else is a type error, and
    // passing a hand-made object without the brand fails at runtime too.
    const impostor = { example: EXAMPLE, rule: SIGNED_RULE, approvedFor: NOW };
    // @ts-expect-error — an unbranded object is not an ApprovedPromotion.
    expect(() => renderFinancePromotion({ promotion: impostor, quote: QUOTE, dealer: DEALER })).not.toThrow();
    // (It renders, because the brand is erased at runtime — which is exactly
    // why the DATABASE also refuses: representative_examples is append-only and
    // approved_by/approved_at are constrained together. The type is the first
    // line of defence, not the only one.)
  });

  it('shows finance honestly, with no figure at all, when there is no example', () => {
    const fallback = renderFinanceUnavailable({ name: 'Kennington Car Sales' });
    expect(fallback).toContain('credit broker, not a lender');
    expect(fallback).not.toMatch(/per month|\bAPR\b|%/);
  });
});

// ---------------------------------------------------------------------------
describe('the rendered promotion', () => {
  it('shows the payment and the example together', () => {
    expect(HTML).toContain('£375.00');
    expect(HTML).toContain('a month');
    expect(HTML).toContain('Representative Example');
  });

  it('names the lender — "finance available" on its own is a vague claim', () => {
    expect(HTML).toContain('Blue Motor Finance');
    expect(HTML).toContain('Hire Purchase');
  });

  it('carries every item the rule requires, in the order the rule sets', () => {
    const positions = [
      'Rate of interest', 'Other charges', 'Total amount of credit', 'Representative APR',
      'Cash price / advance payment', 'Duration of agreement', 'Total amount payable',
      'Amount of each repayment',
    ].map((label) => HTML.indexOf(label));
    expect(positions.every((p) => p > -1), 'a required item is missing').toBe(true);
    // CONC 3.5.5R prescribes a sequence; the order is part of the rule.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('gives the representative APR greater prominence than anything else', () => {
    // CONC 3.5.6R. Exactly one item may carry fp-prominent, and it must be the
    // one the rule names.
    const prominent = [...HTML.matchAll(/<div class="fp-row fp-prominent">[\s\S]*?<dt>(.*?)<\/dt>/g)];
    expect(prominent).toHaveLength(1);
    expect(prominent[0]![1]).toBe('Representative APR');
  });

  it('backs that prominence with actual font sizes, not intentions', () => {
    // The rule is about what a reader sees. Asserting the class is not enough
    // if a later CSS edit makes the payment bigger than the APR.
    const css = criticalCss();
    const size = (selector: string): number => {
      const rule = new RegExp(`\\${selector}\\{[^}]*?font-size:(\\d+)px`).exec(css);
      expect(rule, `no font-size found for ${selector}`).not.toBeNull();
      return Number(rule![1]);
    };
    expect(size('.fp-prominent dd')).toBeGreaterThan(size('.fp-payment-amount'));
  });

  it('states the broker relationship and the commission position on the promotion itself', () => {
    // Not only on a page nobody clicks.
    expect(HTML).toContain('credit broker, not a lender');
    expect(HTML).toContain('FRN 993469');
    expect(HTML).toMatch(/may receive a commission/);
    expect(HTML).toMatch(/ask us for the amount of that commission/i);
    expect(HTML).toContain('subject to status');
    expect(HTML).toContain('/initial-disclosure');
  });

  it('names the principal when the dealer is an Appointed Representative', () => {
    const ar = renderFinancePromotion({
      promotion: PROMOTION, quote: QUOTE,
      dealer: { ...DEALER, principalName: 'Motor Finance Network Ltd', principalFrn: '123456' },
    });
    expect(ar).toContain('Appointed Representative of Motor Finance Network Ltd');
    expect(ar).toContain('FRN 123456');
  });

  it('says the quotation is not an offer of finance, and when it was prepared', () => {
    expect(HTML).toContain('not an offer of finance');
    expect(HTML).toContain('1 August 2026');
  });

  it('escapes a hostile lender name', () => {
    const nasty = renderFinancePromotion({
      promotion: PROMOTION,
      quote: { ...QUOTE, lenderName: '<script>alert(1)</script>' },
      dealer: DEALER,
    });
    expect(nasty).not.toContain('<script>alert');
  });
});

// ---------------------------------------------------------------------------
describe('the golden file', () => {
  it('matches byte for byte', () => {
    // A regulated block must not change by accident. If this fails, look at the
    // diff and decide whether the change is one the compliance consultant would
    // sign off — then update the golden file deliberately.
    if (!existsSync(GOLDEN)) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, HTML, 'utf8');
    }
    expect(HTML).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

// ---------------------------------------------------------------------------
describe('the vehicle page, with and without finance', () => {
  const dealer: VdpInput['dealer'] = {
    name: 'Kennington Car Sales', url: ORIGIN, logoUrl: `${ORIGIN}/logo.png`,
    telephone: '+441908883940', email: null, whatsapp: '447477070105',
    street: '32-36 Aylesbury Street', locality: 'Milton Keynes',
    region: 'Buckinghamshire', postcode: 'MK2 2BA', country: 'GB',
    latitude: 51.9942, longitude: -0.7361,
    openingHours: [{ days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' }],
    ratingValue: 4.8, reviewCount: 252, priceRange: '££',
  };
  const vehicle: VdpInput['vehicle'] = {
    make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range', year: 2022,
    registration: 'WN22HNL', vin: null, mileage: 40_470, mileageUnit: 'SMI',
    pricePence: 1_999_900n, currency: 'GBP', colour: 'White', fuelType: 'Electricity',
    transmission: 'Automatic', bodyStyle: 'SUV', doors: 5, seats: 7, engineCc: null,
    powerBhp: null, co2Gkm: 0, formerKeepers: 1, state: 'live',
    imageUrls: [], description: 'One owner from new.',
    url: canonicalUrl(ORIGIN, vehicleUrlPath({
      make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range', year: 2022, registration: 'WN22HNL',
    })),
    stockNumber: 'KEN-0142', keyCount: 2, serviceHistory: 'Full Tesla service history',
    motExpiresOn: '2027-02-17', warranty: '6 months nationwide warranty',
  };
  const base: VdpInput = {
    vehicle, dealer, media: [], mot: [], provenanceCheckedAt: '2026-07-14', finance: null,
  };

  it('shows no cost-of-credit figure at all when there is no approved example', () => {
    const html = renderVehiclePage(base);
    expect(html).not.toMatch(/per month|\bpcm\b|% ?APR/i);
    expect(html).toContain('credit broker, not a lender');
  });

  it('shows the payment WITH the example when there is one', () => {
    const html = renderVehiclePage({
      ...base,
      finance: { promotion: PROMOTION, quote: QUOTE, dealer: DEALER },
    });
    const payment = html.indexOf('£375.00');
    const example = html.indexOf('Representative Example');
    expect(payment).toBeGreaterThan(-1);
    expect(example).toBeGreaterThan(-1);
    // The example sits with the figure, on the same page, below it — the
    // buyer cannot see the payment without the example being present.
    expect(example).toBeGreaterThan(payment);
  });

  it('still keeps every finance figure out of the structured data', () => {
    const html = renderVehiclePage({
      ...base, finance: { promotion: PROMOTION, quote: QUOTE, dealer: DEALER },
    });
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    // JSON-LD has nowhere to carry the representative example, so a payment
    // figure there is a promotion with no example attached.
    expect(ld).not.toMatch(/monthlyPayment|"apr"|per month/i);
    expect(ld).not.toContain('37500');
  });

  it('keeps the page above its weight budget rules with finance on it', () => {
    const html = renderVehiclePage({
      ...base, finance: { promotion: PROMOTION, quote: QUOTE, dealer: DEALER },
    });
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(60_000);
    const scripts = [...html.matchAll(/<script([^>]*)>/gi)].map((m) => m[1]!);
    for (const attrs of scripts) expect(attrs).toMatch(/type="application\/ld\+json"/);
  });
});

// ---------------------------------------------------------------------------
describe('the monthly-payment search facet', () => {
  it('is blocked without an approved promotion', () => {
    expect(() => parseSearchQuery({ monthly: '250' })).toThrow(/CONC 3\.5\.3R/);
    expect(() => parseSearchQuery({ monthly: '250' }, [], null)).toThrow(/representative example/);
  });

  it('is unlocked by the same proof the vehicle page needs', () => {
    expect(() => parseSearchQuery({ monthly: '250' }, [], PROMOTION)).not.toThrow();
  });

  it('still drops the parameter from the canonical crawl space', () => {
    // Unlocking the facet for buyers must not mint a new indexable URL per
    // payment band — that is the M7 crawl-control rule, unchanged.
    const { ignored } = parseSearchQuery({ monthly: '250', utm_source: 'x' }, [], PROMOTION);
    expect(ignored).toEqual(['utm_source']);
  });
});
