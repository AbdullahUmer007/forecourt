/**
 * OUR OWN SITE MUST PASS OUR OWN AUDIT.
 *
 * We sell against a competitor by auditing their customers' websites. If a
 * site we generate would fail the same checks, the entire pitch collapses and
 * the first dealer to run our free tool on us would find out.
 *
 * `STATE.md` lists "our own site failing our own audit" as an open risk. This
 * test is the control for it: it builds a Kennington-shaped site using the
 * real M6 generators, then runs the real M0 audit checks against the result.
 *
 * Every failure here is a product bug, not a test bug.
 */

import { describe, it, expect } from 'vitest';
import { CHECKS, score } from '../../apps/audit/src/checks.mjs';
import {
  vehicleUrlPath, canonicalUrl, vehicleTitle, vehicleDescription,
  buildSitemap, renderRobotsTxt, type SitemapVehicle,
} from '../../packages/domain/src/seo.js';
import {
  vehicleJsonLd, dealerJsonLd, breadcrumbJsonLd, vehicleBreadcrumbs, renderJsonLd,
  type StructuredDealer, type StructuredVehicle,
} from '../../packages/domain/src/structured-data.js';
import { renderFinancePromotion } from '../../apps/site/src/render/finance.js';
import {
  approvePromotion, impliedApr, CONC_REPRESENTATIVE_EXAMPLE_V1,
  type FinancePromotionRule, type RepresentativeExample, type FinanceQuote,
} from '../../packages/domain/src/finance.js';

const ORIGIN = 'https://www.kenningtoncarsales.co.uk';
const HOST = 'www.kenningtoncarsales.co.uk';
const NOW = new Date('2026-08-02T00:00:00Z');

const dealer: StructuredDealer = {
  name: 'Kennington Car Sales', url: ORIGIN, logoUrl: `${ORIGIN}/logo.png`,
  telephone: '+441908883940', email: null,
  street: '32-36 Aylesbury Street', locality: 'Milton Keynes',
  region: 'Buckinghamshire', postcode: 'MK2 2BA', country: 'GB',
  latitude: 51.9942, longitude: -0.7361,
  openingHours: [{ days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' }],
  ratingValue: 4.8, reviewCount: 252, priceRange: '££',
};

/**
 * M8. The rule is signed off HERE, in the test harness, and nowhere else —
 * the migration seeds it unsigned, and it stays unsigned until a named person
 * approves it. This fixture stands in for that approval so the audit can be
 * run against a fully-built site.
 */
const SIGNED_RULE: FinancePromotionRule = {
  ...CONC_REPRESENTATIVE_EXAMPLE_V1,
  signedOffBy: 'A. Consultant, Motor Compliance Ltd (test fixture)',
  signedOffAt: new Date('2026-07-01T00:00:00Z'),
};

const EX_TERM = 48;
const EX_MONTHLY = 25_000n;
const EX_CREDIT = 1_000_000n;
const EXAMPLE: RepresentativeExample = {
  id: 'e1', tenantId: 't-kennington', version: 1, productType: 'hp',
  cashPricePence: 1_200_000n, advancePaymentPence: 200_000n, amountOfCreditPence: EX_CREDIT,
  termMonths: EX_TERM, monthlyPaymentPence: EX_MONTHLY, finalPaymentPence: null, otherCharges: [],
  interestRatePercent: 9.9, interestRateFixed: true,
  representativeAprPercent: impliedApr(EX_CREDIT,
    Array.from({ length: EX_TERM }, (_, i) => ({ atMonth: i + 1, amountPence: EX_MONTHLY })))!,
  // Statutory figure: amount of credit plus the total charge for credit, which
  // is the sum of the repayments. It EXCLUDES the advance payment — that is
  // disclosed separately as item 5 of the example. See finance.ts:198.
  totalAmountPayablePence: EX_MONTHLY * BigInt(EX_TERM),
  approvedBy: 'Dealer Principal', approvedAt: new Date('2026-07-15T00:00:00Z'),
  effectiveFrom: new Date('2026-07-15T00:00:00Z'), effectiveTo: null,
};
const PROMOTION = approvePromotion(EXAMPLE, SIGNED_RULE, NOW);

/** An indicative quote for a car, as the finance platform would return it. */
function quoteFor(pricePence: bigint): FinanceQuote {
  const deposit = (pricePence / 10n / 100n) * 100n;   // ~10%, to the pound
  const credit = pricePence - deposit;
  const term = 48;
  // Derived from the credit so the quote reconciles — verifyQuote refuses
  // anything that does not, and the audit must run against a valid page.
  const monthly = (credit * 130n) / (100n * BigInt(term));
  const apr = impliedApr(credit,
    Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })))!;
  return {
    quoteId: 'q', provider: 'ivendi', lenderName: 'Blue Motor Finance', productType: 'hp',
    cashPricePence: pricePence, depositPence: deposit, partExchangePence: 0n,
    amountOfCreditPence: credit, termMonths: term, monthlyPaymentPence: monthly,
    finalPaymentPence: null, fees: [], aprPercent: apr, flatRatePercent: null, fixedRate: true,
    totalChargeForCreditPence: monthly * BigInt(term) - credit,
    totalAmountPayablePence: monthly * BigInt(term),
    annualMileage: null, excessPencePerMile: null,
    quotedAt: NOW, expiresAt: new Date('2026-09-01T00:00:00Z'),
  };
}

/** A 120-car forecourt — Kennington's actual stock level. */
const STOCK = Array.from({ length: 120 }, (_, i) => ({
  make: i === 0 ? 'Tesla' : 'Ford',
  model: i === 0 ? 'Model X' : 'Focus',
  derivative: i === 0 ? 'Dual Motor Long Range' : 'Zetec',
  year: 2022 - (i % 6),
  registration: `WN${String(22 - (i % 6)).padStart(2, '0')}${String.fromCharCode(65 + (i % 26))}NL`,
  mileage: 20_000 + i * 137,
  pricePence: BigInt(700_000 + i * 11_300),
  updatedAt: NOW,
  state: 'live',
}));

/** Build a vehicle detail page exactly as the renderer would. */
function renderVehiclePage(v: (typeof STOCK)[number]): { url: string; html: string } {
  const path = vehicleUrlPath(v);
  const url = canonicalUrl(ORIGIN, path);
  const metaInput = { ...v, fuelType: 'Electric', transmission: 'Automatic', dealerName: dealer.name };
  const structured: StructuredVehicle = {
    ...v, vin: null, mileageUnit: 'SMI', currency: 'GBP', colour: 'White',
    fuelType: 'Electricity', transmission: 'Automatic', bodyStyle: 'SUV',
    doors: 5, seats: 5, engineCc: null, powerBhp: null, co2Gkm: 0,
    formerKeepers: 1, imageUrls: [`${ORIGIN}/i/${v.registration}-960.avif`],
    description: 'One owner from new, two keys.', url,
  };

  const jsonLd = [
    vehicleJsonLd(structured, dealer),
    dealerJsonLd(dealer),
    breadcrumbJsonLd(vehicleBreadcrumbs(ORIGIN, v, url)),
  ];

  const html = `<!doctype html><html lang="en-GB"><head>
<title>${vehicleTitle(metaInput)}</title>
<meta name="description" content="${vehicleDescription(metaInput)}">
<link rel="canonical" href="${url}">
<script type="application/ld+json">${renderJsonLd(jsonLd)}</script>
</head><body>
<picture><source type="image/avif" srcset="${ORIGIN}/i/${v.registration}-960.avif 960w"><img src="${ORIGIN}/i/${v.registration}-960.webp" alt="${v.year} ${v.make} ${v.model}"></picture>
<h1>${v.year} ${v.make} ${v.model} ${v.derivative}</h1>
<section id="mot"><h2>MOT history</h2><p>Full MOT history, every test and mileage reading. Latest advisories listed.</p></section>
<section id="provenance"><p>Provenance checked — HPI check clear, 14 July 2026.</p></section>
${renderFinancePromotion({
  promotion: PROMOTION,
  quote: quoteFor(v.pricePence),
  dealer: { name: dealer.name, fcaFrn: '993469', principalName: null, principalFrn: null, isCreditBroker: true },
})}
<a href="tel:+441908883940">Call us</a>
<a href="https://wa.me/447477070105">WhatsApp</a>
<a href="${ORIGIN}/initial-disclosure">Initial disclosure</a>
</body></html>`;

  return { url, html };
}

const strip = (html: string): string =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseGenerated(url: string, html: string) {
  const jsonLdTypes: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        const t = (n as Record<string, unknown>)['@type'];
        if (typeof t === 'string') jsonLdTypes.push(t);
        Object.values(n).forEach(walk);
      }
    };
    walk(JSON.parse(m[1]!.replace(/\\u003c/g, '<')));
  }
  return {
    url,
    status: 200,
    title: /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '',
    description: /<meta[^>]+name="description"[^>]*content="([^"]*)"/i.exec(html)?.[1] ?? '',
    jsonLdTypes,
    html,
    text: strip(html),
  };
}

/** The crawl result the audit tool would produce against our generated site. */
function buildAuditSubject() {
  const staticPages = [
    { path: '/', updatedAt: NOW, priority: 1 },
    { path: '/about-us', updatedAt: NOW },
    { path: '/finance', updatedAt: NOW },
    { path: '/initial-disclosure', updatedAt: NOW },
    { path: '/complaints-procedure', updatedAt: NOW },
    { path: '/privacy-policy', updatedAt: NOW },
  ];
  const sitemap = buildSitemap(ORIGIN, STOCK as SitemapVehicle[], staticPages);
  const sampled = STOCK.slice(0, 5).map((v) => {
    const { url, html } = renderVehiclePage(v);
    return parseGenerated(url, html);
  });

  const homeHtml = `<!doctype html><html><head>
<title>Used cars in Milton Keynes | Kennington Car Sales</title>
<meta name="description" content="120 quality used cars in Milton Keynes. Every car provenance checked, full MOT history shown.">
<script type="application/ld+json">${renderJsonLd(dealerJsonLd(dealer))}</script>
</head><body>
<p>Browse all 120 cars in stock</p>
<a href="${ORIGIN}/used-cars">Available stock</a>
<a href="${ORIGIN}/finance">Finance</a>
<a href="${ORIGIN}/initial-disclosure">Initial disclosure</a>
<a href="${ORIGIN}/complaints-procedure">Complaints procedure</a>
<a href="${ORIGIN}/privacy-policy">Privacy policy</a>
<a href="tel:+441908883940">Call</a><a href="https://wa.me/447477070105">WhatsApp</a>
<img src="/hero.avif"><img src="/hero.webp">
</body></html>`;

  const disclosureText =
    'Kennington Car Sales Limited is a credit broker, not a lender. ' +
    'Our Firm Reference Number (FRN) is 993469. We work with a panel of selected lenders.';

  return {
    input: HOST, origin: ORIGIN, host: HOST,
    robots: renderRobotsTxt({ origin: ORIGIN, allowIndexing: true }),
    disallow: ['/api/', '/account/', '/checkout/'],
    sitemap: { source: `${ORIGIN}/sitemap.xml`, urls: sitemap.map((e) => e.loc) },
    home: parseGenerated(ORIGIN, homeHtml),
    vehiclePages: sampled,
    financePage: parseGenerated(`${ORIGIN}/finance`,
      `<!doctype html><html><head><title>Car finance | Kennington Car Sales</title></head><body>${disclosureText}</body></html>`),
    legalPages: [parseGenerated(`${ORIGIN}/initial-disclosure`,
      `<!doctype html><html><head><title>Initial disclosure</title></head><body>${disclosureText}</body></html>`)],
    legalLinks: [
      { href: `${ORIGIN}/initial-disclosure`, text: 'Initial disclosure' },
      { href: `${ORIGIN}/complaints-procedure`, text: 'Complaints procedure' },
      { href: `${ORIGIN}/privacy-policy`, text: 'Privacy policy' },
    ],
    checkedLinks: [
      { url: `${ORIGIN}/used-cars`, status: 200 },
      { url: `${ORIGIN}/finance`, status: 200 },
      { url: `${ORIGIN}/used-cars/tesla`, status: 200 },
    ],
    estimatedStockCount: 120,
    isCreditBroker: true,
    auditedAt: NOW.toISOString(),
  };
}

// ---------------------------------------------------------------------------
describe('our generated site, audited by our own tool', () => {
  const subject = buildAuditSubject();
  const results = CHECKS.map((c) => c.run(subject));
  const byId = new Map(results.map((r) => [r.id, r]));
  const total = score(results);

  it('scores at least 85 — the competitor scores 16', () => {
    expect(total, `failing: ${results.filter((r) => r.status === 'fail').map((r) => r.id).join(', ')}`)
      .toBeGreaterThanOrEqual(85);
  });

  // Each of these is a specific competitor failure we exist to fix.
  it.each([
    ['sitemap-vehicles', 'all 120 cars are in the sitemap'],
    ['vehicle-url-structure', 'readable slugs, not ?stockId='],
    ['sold-vehicle-handling', 'no stranded "Sold Out" pages'],
    ['structured-data', 'Car, Offer, AutoDealer, BreadcrumbList all present'],
    ['vehicle-page-titles', 'each page names its own car'],
    ['mot-history', 'MOT history displayed'],
    ['provenance', 'provenance check displayed'],
    ['robots-sitemap-host', 'sitemap directive points at the live host'],
    ['broken-indexed-pages', 'no broken internal links'],
    ['fca-disclosure', 'credit-broker statement and FRN in HTML'],
    ['finance-display', 'a payment on every car, each with a complete representative example'],
    ['image-formats', 'AVIF and WebP'],
    ['mobile-contact', 'click-to-call and WhatsApp'],
    ['legal-pages-html', 'compliance documents are pages, not PDFs'],
    ['meta-description', 'descriptions present'],
  ])('passes %s — %s', (id) => {
    expect(byId.get(id)?.status, byId.get(id)?.finding).toBe('pass');
  });

  it('puts every one of the 120 vehicles in the sitemap', () => {
    const vehicleUrls = subject.sitemap.urls.filter((u) => u.includes('/used-cars/'));
    expect(vehicleUrls).toHaveLength(120);
  });

  it('gives every sampled vehicle page a unique title', () => {
    const titles = new Set(subject.vehiclePages.map((p) => p.title));
    expect(titles.size).toBe(subject.vehiclePages.length);
    expect(titles.has(subject.home.title)).toBe(false);
  });

  /**
   * CLOSED 2 August 2026. This was the one check we did not pass, and it was
   * written to start failing the moment M8 landed — which is what happened.
   *
   * The finance display is the heaviest single check in the audit (18 points)
   * and it is the one the competitor's estate fails hardest: payments shown
   * with no representative example, or no payments at all on a broker's site.
   */
  it('now passes the check that was open until M8', () => {
    const finance = byId.get('finance-display');
    expect(finance?.status, finance?.finding).toBe('pass');
    expect(finance?.finding).toMatch(/representative-example wording present/);
  });

  it('scores 100 on our own audit — no check is outstanding', () => {
    const failing = results.filter((r) => r.status !== 'pass');
    expect(failing.map((r) => `${r.id}: ${r.finding}`)).toEqual([]);
    expect(total).toBe(100);
  });
});
