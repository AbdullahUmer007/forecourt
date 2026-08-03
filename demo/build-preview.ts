/**
 * Build a browsable static preview of the public site.
 *
 * Runs the REAL renderers over the demo dataset and writes plain HTML files
 * you can open straight from disk — no server, no database, no build step.
 * Every page here is byte-for-byte what `apps/site` serves; the Next.js routes
 * are thin wrappers that call these same functions and return the string.
 *
 *   pnpm preview     → writes demo/preview/*.html
 *
 * The links between pages are rewritten to relative filenames so the whole
 * thing works from a `file://` URL. That is the only difference from
 * production output.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderVehiclePage, type VdpInput, type MediaView } from '../apps/site/src/render/vdp.js';
import { renderResultsPage, type ResultsInput, type ResultVehicle } from '../apps/site/src/render/results.js';
import { renderHomePage } from '../apps/site/src/render/home.js';
import { canonicalUrl, vehicleUrlPath, slugify } from '../packages/domain/src/seo.js';
import {
  approvePromotion, impliedApr, CONC_REPRESENTATIVE_EXAMPLE_V1,
  type FinancePromotionRule, type RepresentativeExample, type FinanceQuote,
} from '../packages/domain/src/finance.js';
import { EMPTY_QUERY, baseColour, type SearchQuery, type FacetCount, type MultiDimension } from '../packages/domain/src/search.js';
import { KENNINGTON, DEMO_STOCK, DEMO_NOTICE, placeholderImage, type DemoVehicle } from './kennington.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'preview');
const ORIGIN = `https://www.kenningtoncarsales.co.uk`;
const NOW = new Date('2026-08-02T09:00:00Z');

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- shared shapes

const dealer = {
  name: KENNINGTON.name, url: ORIGIN, logoUrl: null,
  telephone: KENNINGTON.telephone, email: null, whatsapp: KENNINGTON.whatsapp,
  street: KENNINGTON.street, locality: KENNINGTON.locality, region: KENNINGTON.region,
  postcode: KENNINGTON.postcode, country: KENNINGTON.country,
  latitude: KENNINGTON.latitude, longitude: KENNINGTON.longitude,
  openingHours: KENNINGTON.openingHours.map((h) => ({ ...h, days: [...h.days] })),
  ratingValue: KENNINGTON.ratingValue, reviewCount: KENNINGTON.reviewCount, priceRange: '££',
};

const urlParts = (v: DemoVehicle) => ({
  make: v.make, model: v.model, derivative: v.derivative, year: v.year,
  registration: v.registration.replace(/\s+/g, ''),
});

/** A local filename for a vehicle, so the preview works from `file://`. */
const fileFor = (v: DemoVehicle): string => `vehicle-${slugify(v.registration)}.html`;

/**
 * Placeholder photographs are SVG data URIs. Only the JPEG slot is populated
 * because that is what `<img src>` falls back to — declaring a data URI as
 * AVIF or WebP would be a lie in the markup, and the preview is meant to be
 * honest about what it is.
 */
function media(v: DemoVehicle): MediaView[] {
  const hero: MediaView = {
    alt: `${v.year} ${v.make} ${v.model} ${v.derivative}, front three-quarter`,
    isDamage: false,
    variants: [{ width: 1200, format: 'jpeg', url: placeholderImage(v, 'hero') }],
  };
  const marks: MediaView[] = v.declaredMarks.map((label) => ({
    alt: `${v.year} ${v.make} ${v.model}, ${label.toLowerCase()}`,
    isDamage: true,
    damageLabel: label,
    variants: [{ width: 1200, format: 'jpeg', url: placeholderImage(v, 'damage', label) }],
  }));
  return [hero, ...marks];
}

// ---------------------------------------------------------------- finance
//
// A DEMO sign-off. The migration seeds the real rule UNSIGNED and nothing
// renders against it — that is the launch gate. This fixture stands in for the
// compliance consultant so the preview can show what the block looks like.

const DEMO_RULE: FinancePromotionRule = {
  ...CONC_REPRESENTATIVE_EXAMPLE_V1,
  version: 2,
  signedOffBy: 'DEMO SIGN-OFF — not a real approval',
  signedOffAt: new Date('2026-07-01T00:00:00Z'),
};

const EX_TERM = 48, EX_MONTHLY = 25_000n, EX_CREDIT = 1_000_000n;
const DEMO_EXAMPLE: RepresentativeExample = {
  id: 'demo-example', tenantId: 't-kennington', version: 1, productType: 'hp',
  cashPricePence: 1_200_000n, advancePaymentPence: 200_000n, amountOfCreditPence: EX_CREDIT,
  termMonths: EX_TERM, monthlyPaymentPence: EX_MONTHLY, finalPaymentPence: null, otherCharges: [],
  interestRatePercent: 9.9, interestRateFixed: true,
  representativeAprPercent: impliedApr(EX_CREDIT,
    Array.from({ length: EX_TERM }, (_, i) => ({ atMonth: i + 1, amountPence: EX_MONTHLY })))!,
  totalAmountPayablePence: EX_MONTHLY * BigInt(EX_TERM),
  approvedBy: 'Dealer Principal (demo)', approvedAt: new Date('2026-07-15T00:00:00Z'),
  effectiveFrom: new Date('2026-07-15T00:00:00Z'), effectiveTo: null,
};
const PROMOTION = approvePromotion(DEMO_EXAMPLE, DEMO_RULE, NOW);

/**
 * An indicative quote, derived so that it reconciles — `verifyQuote` refuses
 * anything that does not, and the renderer will not show an unverified quote.
 */
function quoteFor(v: DemoVehicle): FinanceQuote {
  const deposit = (v.pricePence / 1000n) * 100n;          // ~10%, to the pound
  const credit = v.pricePence - deposit;
  const term = 48;
  const monthly = (credit * 128n) / (100n * BigInt(term));
  const apr = impliedApr(credit,
    Array.from({ length: term }, (_, i) => ({ atMonth: i + 1, amountPence: monthly })))!;
  return {
    quoteId: `demo-${v.stockNumber}`, provider: 'demo', lenderName: 'Blue Motor Finance',
    productType: 'hp', cashPricePence: v.pricePence, depositPence: deposit, partExchangePence: 0n,
    amountOfCreditPence: credit, termMonths: term, monthlyPaymentPence: monthly,
    finalPaymentPence: null, fees: [], aprPercent: apr, flatRatePercent: null, fixedRate: true,
    totalChargeForCreditPence: monthly * BigInt(term) - credit,
    totalAmountPayablePence: monthly * BigInt(term),
    annualMileage: null, excessPencePerMile: null,
    quotedAt: NOW, expiresAt: new Date('2026-09-01T00:00:00Z'),
  };
}

const financeDealer = {
  name: KENNINGTON.name, fcaFrn: KENNINGTON.fcaFrn,
  principalName: null, principalFrn: null, isCreditBroker: true,
};

// ---------------------------------------------------------------- pages

function vdpFor(v: DemoVehicle): string {
  const parts = urlParts(v);
  const input: VdpInput = {
    vehicle: {
      ...parts, vin: null, mileage: v.mileage, mileageUnit: 'SMI',
      pricePence: v.pricePence, currency: 'GBP', colour: v.colour, fuelType: v.fuelType,
      transmission: v.transmission, bodyStyle: v.bodyStyle, doors: v.doors, seats: v.seats,
      engineCc: v.engineCc, powerBhp: v.powerBhp, co2Gkm: v.co2Gkm,
      formerKeepers: v.formerKeepers, state: v.state,
      imageUrls: [], description: v.description,
      url: canonicalUrl(ORIGIN, vehicleUrlPath(parts)),
      stockNumber: v.stockNumber, keyCount: v.keyCount, serviceHistory: v.serviceHistory,
      motExpiresOn: v.motExpiresOn, warranty: v.warranty,
    },
    dealer,
    media: media(v),
    mot: v.mot.map((t) => ({ ...t, odometerMiles: t.odometerMiles, advisories: [...t.advisories] })),
    provenanceCheckedAt: v.provenanceCheckedAt,
    provenance: {
      checkedAt: v.provenanceCheckedAt, provider: 'HPI Check',
      outstandingFinance: false, stolen: false, writtenOff: false,
    },
    batteryHealth: v.batteryHealth,
    priceContext: v.previousPricePence && v.priceChangedOn
      ? { previousPence: v.previousPricePence, changedOn: v.priceChangedOn }
      : null,
    finance: { promotion: PROMOTION, quote: quoteFor(v), dealer: financeDealer },
  };
  return renderVehiclePage(input);
}

const resultVehicle = (v: DemoVehicle): ResultVehicle => ({
  id: v.stockNumber, ...urlParts(v),
  mileage: v.mileage, pricePence: v.pricePence, fuelType: v.fuelType,
  transmission: v.transmission, state: v.state,
  liveSince: new Date(v.liveSince),
  priceReducedAt: v.priceChangedOn ? new Date(v.priceChangedOn) : null,
  thumbnail: {
    url: placeholderImage(v, 'hero'), srcset: '',
    alt: `${v.year} ${v.make} ${v.model} ${v.derivative}`,
  },
});

const countBy = (vehicles: readonly DemoVehicle[], pick: (v: DemoVehicle) => string): FacetCount[] => {
  const counts = new Map<string, { label: string; count: number }>();
  for (const v of vehicles) {
    const label = pick(v);
    const value = slugify(label);
    const existing = counts.get(value);
    if (existing) existing.count++; else counts.set(value, { label, count: 1 });
  }
  return [...counts.entries()]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

function resultsFor(query: SearchQuery, vehicles: readonly DemoVehicle[], all: readonly DemoVehicle[]): string {
  const facetCounts: Partial<Record<MultiDimension, readonly FacetCount[]>> = {
    make: countBy(all, (v) => v.make),
    fuel: countBy(all, (v) => v.fuelType),
    transmission: countBy(all, (v) => v.transmission),
    body: countBy(all, (v) => v.bodyStyle),
    // Base colour, not the paint name: a facet with 'Cosmos Black' and
    // 'Frozen White' one car apiece is a list, not a filter.
    colour: countBy(all, (v) => baseColour(v.colour) ?? 'Other'),
  };
  const input: ResultsInput = {
    query, dealer,
    vehicles: vehicles.map(resultVehicle),
    totalCount: vehicles.length,
    facetCounts,
    countFor: () => all.length,
    fallbackVehicles: vehicles.length === 0 ? all.slice(0, 3).map(resultVehicle) : [],
    now: NOW,
  };
  return renderResultsPage(input);
}

// ---------------------------------------------------------------- write

/** Rewrite absolute site paths to the local filenames the preview uses. */
function localise(html: string): string {
  let out = html;
  for (const v of DEMO_STOCK) {
    out = out.split(vehicleUrlPath(urlParts(v))).join(fileFor(v));
  }
  out = out
    .split('href="/used-cars"').join('href="results.html"')
    .split('href="/"').join('href="index.html"')
    .replace(/href="\/used-cars\?[^"]*"/g, 'href="results.html"')
    .replace(/href="\/used-cars\/[^"]*"/g, 'href="results.html"');
  return out;
}

const written: { file: string; title: string; note: string }[] = [];

const write = (file: string, html: string, title: string, note: string): void => {
  writeFileSync(join(OUT, file), localise(html), 'utf8');
  written.push({ file, title, note });
};

// The dealer's home page — M6's last renderer.
write('home.html', renderHomePage({
  dealer,
  stockCount: DEMO_STOCK.length,
  fromPricePence: DEMO_STOCK.reduce<bigint | null>(
    (lo, v) => (lo === null || v.pricePence < lo ? v.pricePence : lo), null),
  justArrived: DEMO_STOCK.slice(0, 6).map((v) => ({
    name: `${v.year} ${v.make} ${v.model}`,
    href: vehicleUrlPath(urlParts(v)),
    pricePence: v.pricePence,
    meta: [`${v.mileage.toLocaleString('en-GB')} miles`, v.fuelType, v.transmission].join(' · '),
    thumbUrl: placeholderImage(v, 'hero'),
    thumbAlt: `${v.year} ${v.make} ${v.model}`,
  })),
  browseByBody: countBy(DEMO_STOCK, (v) => v.bodyStyle).slice(0, 8)
    .map((f) => ({ label: f.label, href: `/used-cars?body=${f.value}`, count: f.count })),
  browseByMake: countBy(DEMO_STOCK, (v) => v.make).slice(0, 8)
    .map((f) => ({ label: f.label, href: `/used-cars/${f.value}`, count: f.count })),
  now: NOW,
}), 'Home page', 'Search-first hero, real stock counts, why-buy-here above the grid, and the FCA disclosure in the footer.');

// The results page, all stock.
write('results.html', resultsFor({ ...EMPTY_QUERY }, DEMO_STOCK, DEMO_STOCK),
  'Search results — all stock',
  'Faceted search. Every filter, the sort order and the pagination are plain links: this page works with JavaScript switched off.');

// A filtered results page, to show the facets and the crawl rules working.
const electric = DEMO_STOCK.filter((v) => v.fuelType === 'Electric');
write('results-electric.html',
  resultsFor({ ...EMPTY_QUERY, filters: { ...EMPTY_QUERY.filters, fuel: ['electric'] } }, electric, DEMO_STOCK),
  'Search results — filtered to electric',
  'Note the H1 changes with the filter, the applied-filter chip, and the counts on every facet option.');

// A zero-result page, which is where most dealer sites lose the buyer.
write('results-zero.html',
  resultsFor({ ...EMPTY_QUERY, filters: { ...EMPTY_QUERY.filters, make: ['porsche'] } }, [], DEMO_STOCK),
  'Search results — nothing matched',
  'Never a dead end: it says what we widened, shows the closest real cars, and offers to tell them when one arrives.');

// Every vehicle page.
for (const v of DEMO_STOCK) {
  write(fileFor(v), vdpFor(v), `${v.year} ${v.make} ${v.model} ${v.derivative}`,
    `${v.declaredMarks.length} declared mark${v.declaredMarks.length === 1 ? '' : 's'} · ` +
    `${v.mot.length} MOT test${v.mot.length === 1 ? '' : 's'}${v.batteryHealth ? ' · EV battery health' : ''}` +
    `${v.previousPricePence ? ' · price reduced' : ''}`);
}

// ---------------------------------------------------------------- index

const index = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forecourt — preview</title>
<style>
:root{--ink:#0F172A;--muted:#475569;--subtle:#64748B;--border:#E2E8F0;--surface:#FFFFFF;--page:#F8FAFC;--brand:#0E5A6B;--warn:#B45309;--warnbg:#FEF3C7}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:16px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;line-height:34px;margin:0 0 8px}
h2{font-size:20px;line-height:28px;margin:32px 0 12px}
p{color:var(--muted);max-width:70ch}
.banner{background:var(--warnbg);border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;margin:16px 0 24px;color:var(--warn);font-size:14px;max-width:none}
.banner strong{display:block;margin-bottom:4px}
a.card{display:block;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 16px;margin:0 0 8px;text-decoration:none;color:inherit}
a.card:hover{border-color:var(--brand)}
a.card b{display:block;font-size:16px}
a.card span{display:block;font-size:13px;color:var(--subtle);margin-top:2px}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);font-size:13px;color:var(--subtle)}
</style></head><body><div class="wrap">
<h1>Forecourt — public site preview</h1>
<p>Generated by the real renderers, over ${DEMO_STOCK.length} demo cars. Every page below is
byte-for-byte what <code>apps/site</code> serves; the Next.js routes are thin wrappers that call
these same functions. Zero JavaScript on any page.</p>

<div class="banner">
<strong>${DEMO_NOTICE}</strong>
The business details are Kennington's real public facts. The cars, prices and photographs are not
theirs and are not real. The finance block renders against a <em>demo</em> compliance sign-off —
in the shipped migration that rule is unsigned, and nothing renders until a named person signs it.
</div>

<h2>Home</h2>
${written.filter((w) => w.file === 'home.html').map((w) =>
  `<a class="card" href="${w.file}"><b>${w.title}</b><span>${w.note}</span></a>`).join('\n')}

<h2>Search</h2>
${written.filter((w) => w.file.startsWith('results')).map((w) =>
  `<a class="card" href="${w.file}"><b>${w.title}</b><span>${w.note}</span></a>`).join('\n')}

<h2>Vehicle pages</h2>
${written.filter((w) => w.file.startsWith('vehicle')).map((w) =>
  `<a class="card" href="${w.file}"><b>${w.title}</b><span>${w.note}</span></a>`).join('\n')}

<footer>Start with the Tesla — it has declared marks, a mileage chart, EV battery health and a
price reduction, so it exercises most of what has been built.</footer>
</div></body></html>`;

writeFileSync(join(OUT, 'index.html'), index, 'utf8');

console.log(`Wrote ${written.length + 1} pages to demo/preview/`);
for (const w of written) console.log(`  ${w.file.padEnd(34)} ${w.title}`);
