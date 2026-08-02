/**
 * M6b — the vehicle detail page.
 *
 * The single most important page in the business. Above the fold on mobile,
 * in this order (`04-design-system.md` §6.2):
 *
 *   gallery → make/model/derivative → price and finance-from → key specs
 *   → CTA row (Call · WhatsApp · Enquire · Reserve)
 *
 * Everything below: full gallery, description, full specification, MOT history
 * with mileage, provenance badge, declared condition, finance calculator,
 * part-exchange, warranty and delivery, dealer trust block, similar vehicles.
 *
 * Renders completely without JavaScript. That is not a preference — audit
 * check `structured-data` and the < 120KB JS budget both depend on it, and a
 * buyer on a bad connection should still be able to see the car and find the
 * phone number.
 */

import { html, raw, when, esc } from './html.js';
import { criticalCss, DEFAULT_THEME, type BrandTheme } from './theme.js';
import {
  vehicleTitle, vehicleDescription, canonicalUrl, vehicleUrlPath,
} from '../../../../packages/domain/src/seo.js';
import {
  vehicleJsonLd, dealerJsonLd, breadcrumbJsonLd, vehicleBreadcrumbs,
  renderJsonLd, assertNoFinanceFigures,
  type StructuredDealer, type StructuredVehicle,
} from '../../../../packages/domain/src/structured-data.js';

export interface MotTestView {
  testDate: string;
  result: string;
  odometerMiles: number | null;
  advisories: readonly string[];
}

export interface MediaView {
  /** Ordered smallest-first, for the srcset. */
  variants: readonly { width: number; format: 'avif' | 'webp' | 'jpeg'; url: string }[];
  alt: string;
  isDamage: boolean;
  /**
   * Short, specific name for a declared mark — "Kerbed alloy", "Rear bumper
   * scuff". `alt` describes the photograph for a screen reader; this names the
   * fault in the summary. "3 declared marks — kerbed alloy, rear bumper scuff,
   * bonnet stone chip" is a trust signal. "3 photos" is not.
   */
  damageLabel?: string;
}

/**
 * The provenance result, stated rather than implied.
 *
 * A bare "Provenance checked" badge asks the buyer to guess what was checked.
 * Naming the three outcomes is the whole value of the check the dealer has
 * already paid for. Each flag is tri-state: `null` means the provider did not
 * return that field, and an unknown is never rendered as a clear.
 *
 * The paid provenance adapter (HPI Check) is contract-blocked, so in practice
 * this is null until M4's paid half lands. The renderer falls back to the
 * dated badge and never invents a claim.
 */
export interface ProvenanceView {
  checkedAt: string;
  provider: string | null;
  outstandingFinance: boolean | null;
  stolen: boolean | null;
  writtenOff: boolean | null;
}

/** EV battery state of health, with the context that makes the number mean something. */
export interface BatteryHealthView {
  percentOfNew: number;
  testedOn: string;
  typicalLowPercent: number | null;
  typicalHighPercent: number | null;
  ageYears: number | null;
}

/**
 * A price reduction taken from OUR OWN price history.
 *
 * Deliberately NOT a market-guide comparison ("priced £651 under guide"): that
 * needs cap hpi valuations, which are contract-blocked. Publishing a guide
 * comparison we cannot source would be a claim we cannot stand behind.
 */
export interface PriceContextView {
  previousPence: bigint;
  changedOn: string;
}

export interface VdpInput {
  vehicle: StructuredVehicle & {
    stockNumber: string;
    keyCount: number | null;
    serviceHistory: string | null;
    motExpiresOn: string | null;
    warranty: string | null;
  };
  dealer: StructuredDealer & { whatsapp: string | null };
  media: readonly MediaView[];
  mot: readonly MotTestView[];
  provenanceCheckedAt: string | null;
  /** Detailed provenance outcome. Falls back to `provenanceCheckedAt` when absent. */
  provenance?: ProvenanceView | null;
  batteryHealth?: BatteryHealthView | null;
  priceContext?: PriceContextView | null;
  /**
   * Rendered finance block. Built ONLY by <FinancePromotion> in M8, which
   * cannot produce output without a valid representative example. Until then
   * this is null and no payment figure appears anywhere on the page.
   */
  financeHtml: string | null;
  theme?: BrandTheme;
}

const fmtPrice = (pence: bigint | null): string =>
  pence === null ? 'POA' : `£${(Number(pence) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const fmtMiles = (m: number | null): string => (m === null ? '—' : `${m.toLocaleString('en-GB')} miles`);

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const fmtShortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

/**
 * `WN22HNL` → `WN22 HNL`. Current-style plates only; anything else (dateless,
 * personalised, Northern Irish) is shown exactly as the dealer entered it
 * rather than spaced by a rule that does not apply to it.
 */
export function formatRegistration(reg: string): string {
  const compact = reg.toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]{2}\d{2})([A-Z]{3})$/.exec(compact);
  return m ? `${m[1]} ${m[2]}` : reg.toUpperCase();
}

/**
 * A real GB plate: yellow field, blue UK band, mono face.
 *
 * Small thing, and car people notice it immediately. The band is decorative,
 * so it is `aria-hidden` and the whole plate carries one label — otherwise a
 * screen reader announces "UK WN22 HNL" as if the band were part of the mark.
 */
function regPlate(reg: string): string {
  const shown = formatRegistration(reg);
  // Deliberately one line: `.reg` is an inline-flex container, so whitespace
  // between the band and the number would be dropped by flex layout anyway,
  // and keeping it flat makes the markup assertable.
  return html`<span class="reg" role="img" aria-label="Registration ${shown}"><span class="reg-band" aria-hidden="true">UK</span><span class="reg-no" aria-hidden="true">${shown}</span></span>`;
}

const srcset = (m: MediaView, format: MediaView['variants'][number]['format']): string =>
  m.variants.filter((v) => v.format === format).map((v) => `${v.url} ${v.width}w`).join(', ');

/** `<picture>` with AVIF → WebP → JPEG, sized so nothing shifts on load. */
function picture(m: MediaView, opts: { hero?: boolean } = {}): string {
  const fallback = m.variants.filter((v) => v.format === 'jpeg').at(-1) ?? m.variants.at(-1);
  return html`<picture>
  ${raw(srcset(m, 'avif') ? `<source type="image/avif" srcset="${esc(srcset(m, 'avif'))}" sizes="(min-width:768px) 60vw, 100vw">` : '')}
  ${raw(srcset(m, 'webp') ? `<source type="image/webp" srcset="${esc(srcset(m, 'webp'))}" sizes="(min-width:768px) 60vw, 100vw">` : '')}
  <img class="${opts.hero ? 'vdp-hero' : ''}" src="${fallback?.url ?? ''}" alt="${m.alt}"
       ${raw(opts.hero ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"')} width="1200" height="900">
</picture>`;
}

// ---------------------------------------------------------------- sections

/**
 * Price, plus the context that answers "is this a fair number?".
 *
 * "Cash price" is the correct label the moment a finance figure can appear
 * beside it (CONC), and it costs nothing to be right about it now.
 */
function priceBlock(pricePence: bigint | null, ctx: PriceContextView | null | undefined): string {
  const dropped = ctx && pricePence !== null && ctx.previousPence > pricePence;
  const drop = dropped ? fmtPrice(ctx.previousPence - pricePence) : null;
  return html`<p class="vdp-price">${fmtPrice(pricePence)}</p>
    <div class="price-row">
      <span class="price-label">${pricePence === null ? 'Price on application' : 'Cash price'}</span>
      ${when(drop, `<span class="price-drop">▾ ${esc(drop ?? '')} since ${esc(fmtShortDate(ctx?.changedOn ?? null))}</span>`)}
    </div>`;
}

/**
 * The three facts a buyer actually wants before they get in the car and drive
 * to you: is its history clean, what is wrong with it, and — on an EV — how is
 * the battery.
 *
 * Every one of these pairs an icon with a text label, because a colour never
 * carries meaning on its own (`forecourt-ui` rule 2). The warning mark uses
 * `--warning-ink`, not `--warning`: the amber is sub-3:1 on white by design and
 * is not a text colour.
 */
function factsSection(input: VdpInput): string {
  const facts: string[] = [];
  const fact = (mark: 'good' | 'warn', glyph: string, head: string, note: string): string =>
    html`<div class="fact">
      <p class="fact-head"><span class="fact-mark mark-${mark}" aria-hidden="true">${glyph}</span>${head}</p>
      <p class="fact-note">${note}</p>
    </div>`;

  // ---- provenance
  const prov = input.provenance;
  if (prov) {
    const adverse = [
      prov.outstandingFinance === true ? 'outstanding finance recorded' : null,
      prov.stolen === true ? 'recorded as stolen' : null,
      prov.writtenOff === true ? 'previously written off' : null,
    ].filter(Boolean) as string[];
    const clear = [
      prov.outstandingFinance === false ? 'no outstanding finance' : null,
      prov.stolen === false ? 'not recorded stolen' : null,
      prov.writtenOff === false ? 'not written off' : null,
    ].filter(Boolean) as string[];
    const checked = `Checked ${fmtDate(prov.checkedAt)}${prov.provider ? ` with ${prov.provider}` : ''}.`;
    // An adverse result is disclosed, never suppressed. A dealer who hides it
    // is the dealer we are selling against.
    facts.push(adverse.length
      ? fact('warn', '!', 'Provenance — declared', `This vehicle has ${adverse.join(', ')}. Ask us about it before you travel. ${checked}`)
      : clear.length === 3
        ? fact('good', '✓', 'Provenance clear', `No outstanding finance, not stolen, not written off. ${checked}`)
        : fact('good', '✓', 'Provenance checked', `${clear.length ? `${clear.join(', ')}. ` : ''}${checked}`));
  } else if (input.provenanceCheckedAt) {
    facts.push(fact('good', '✓', 'Provenance checked', `Independently history checked on ${fmtDate(input.provenanceCheckedAt)}.`));
  }

  // ---- declared condition
  const marks = input.media.filter((m) => m.isDamage);
  if (marks.length > 0) {
    const labels = marks.map((m) => m.damageLabel).filter(Boolean) as string[];
    facts.push(fact('warn', '!', `${marks.length} declared mark${marks.length === 1 ? '' : 's'}`,
      labels.length > 0
        ? `${labels.join(', ')}. Every one photographed below.`
        : 'Each one photographed below, so nothing is a surprise on the forecourt.'));
  }

  // ---- EV battery health
  const bh = input.batteryHealth;
  if (bh && /electric/i.test(input.vehicle.fuelType ?? '')) {
    const low = bh.typicalLowPercent;
    const high = bh.typicalHighPercent;
    const below = low !== null && bh.percentOfNew < low;
    const typical = low !== null && high !== null
      ? ` Typical is ${low}–${high}%${bh.ageYears !== null ? ` at ${bh.ageYears} years` : ''}.`
      : '';
    facts.push(fact(below ? 'warn' : 'good', below ? '!' : '✓',
      `Battery health ${bh.percentOfNew}%`,
      `Tested ${fmtDate(bh.testedOn)}.${typical}`));
  }

  return facts.length === 0 ? '' : html`<div class="facts">${raw(facts.join(''))}</div>`;
}

/**
 * Mileage over time, as an inline SVG.
 *
 * The table below it is the full record; the chart is what makes a clocked or
 * a barely-used car obvious in one glance. Chart rules from `forecourt-ui`:
 * 2px series, ≥8px markers, hairline recessive grid, no number on every point,
 * labels in ink tokens rather than the series colour — and a table view, which
 * is the table this sits above.
 *
 * The y-axis starts at zero. A mileage chart with a truncated axis exaggerates
 * every step, and this one is a trust signal or it is nothing.
 */
export function mileageChart(mot: readonly MotTestView[]): string {
  const pts = mot
    .filter((t) => t.odometerMiles !== null)
    .map((t) => ({ t: Date.parse(t.testDate), m: t.odometerMiles!, date: t.testDate }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return '';

  const W = 640, H = 220, L = 60, R = 12, T = 12, B = 32;
  const t0 = pts[0]!.t, t1 = pts[pts.length - 1]!.t;
  const peak = Math.max(...pts.map((p) => p.m));
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(peak || 1)) - 1)) * 5;
  const yMax = Math.max(step, Math.ceil(peak / step) * step);

  const x = (t: number): number => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (m: number): number => T + (1 - m / yMax) * (H - T - B);
  const n = (v: number): string => v.toFixed(1);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const grid = ticks.map((v) =>
    `<line class="grid" x1="${L}" x2="${W - R}" y1="${n(y(v))}" y2="${n(y(v))}"></line>` +
    `<text class="axis" x="${L - 8}" y="${n(y(v) + 4)}" text-anchor="end">${v.toLocaleString('en-GB')}</text>`).join('');

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(x(p.t))} ${n(y(p.m))}`).join(' ');
  const dots = pts.map((p) => `<circle class="pt" cx="${n(x(p.t))}" cy="${n(y(p.m))}" r="5"></circle>`).join('');
  const year = (iso: string): string => new Date(iso).getFullYear().toString();
  const endLabels =
    `<text class="axis" x="${L}" y="${H - 8}" text-anchor="start">${year(pts[0]!.date)}</text>` +
    `<text class="axis" x="${W - R}" y="${H - 8}" text-anchor="end">${year(pts[pts.length - 1]!.date)}</text>`;

  const first = pts[0]!, last = pts[pts.length - 1]!;
  const label = `Recorded mileage at MOT, from ${first.m.toLocaleString('en-GB')} miles in ${fmtDate(first.date)} to ${last.m.toLocaleString('en-GB')} miles in ${fmtDate(last.date)}. Full figures in the table below.`;

  return `<svg class="mileage-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">`
    + `${grid}<path class="series" d="${path}"></path>${dots}${endLabels}</svg>`;
}

function motSection(mot: readonly MotTestView[]): string {
  if (mot.length === 0) {
    return html`<section class="card" id="mot">
      <h2>MOT history</h2>
      <p>No MOT tests recorded yet for this vehicle.</p>
    </section>`;
  }
  const latest = mot[0]!;
  return html`<section class="card" id="mot">
    <h2>MOT history</h2>
    <p>Every test, every mileage reading, straight from the DVSA. Latest test ${fmtDate(latest.testDate)}.</p>
    ${raw(mileageChart(mot))}
    <table class="mot-table">
      <caption class="visually-hidden">MOT test history with recorded mileage</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Result</th><th scope="col">Mileage</th><th scope="col">Advisories</th></tr></thead>
      <tbody>
        ${raw(mot.map((t) => html`<tr>
          <td>${fmtDate(t.testDate)}</td>
          <td>${t.result === 'PASSED' ? 'Pass' : t.result === 'FAILED' ? 'Fail' : '—'}</td>
          <td>${t.odometerMiles === null ? '—' : t.odometerMiles.toLocaleString('en-GB')}</td>
          <td>${t.advisories.length === 0 ? 'None' : t.advisories.join('; ')}</td>
        </tr>`).join(''))}
      </tbody>
    </table>
  </section>`;
}

function specSection(v: VdpInput['vehicle']): string {
  const rows: [string, string | null][] = [
    ['Registration', v.registration],
    ['Mileage', fmtMiles(v.mileage)],
    ['Fuel', v.fuelType],
    ['Transmission', v.transmission],
    ['Body style', v.bodyStyle],
    ['Doors', v.doors === null ? null : String(v.doors)],
    ['Seats', v.seats === null ? null : String(v.seats)],
    ['Colour', v.colour],
    ['Previous owners', v.formerKeepers === null ? null : String(v.formerKeepers)],
    ['Keys', v.keyCount === null ? null : String(v.keyCount)],
    ['Service history', v.serviceHistory],
    ['MOT expires', v.motExpiresOn ? fmtDate(v.motExpiresOn) : null],
    ['Stock number', v.stockNumber],
  ];
  return html`<section class="card" id="specification">
    <h2>Specification</h2>
    <dl class="spec-grid">
      ${raw(rows.filter(([, value]) => value).map(([label, value]) =>
        html`<div><dt>${label}</dt><dd>${value}</dd></div>`).join(''))}
    </dl>
  </section>`;
}

function trustSection(input: VdpInput): string {
  // The provenance badge used to live here as well. It now appears once, in
  // the fact block above the fold, where a buyer sees it before they decide to
  // keep reading. Saying it twice made neither instance feel like a fact.
  const { dealer, vehicle } = input;
  return html`<section class="card" id="trust">
    <h2>Why buy from ${dealer.name}</h2>
    ${when(vehicle.warranty, `<p><span class="badge">${esc(vehicle.warranty ?? '')}</span></p>`)}
    ${when(dealer.ratingValue !== null && (dealer.reviewCount ?? 0) > 0,
      `<p>Rated ${dealer.ratingValue} out of 5 from ${dealer.reviewCount} reviews.</p>`)}
    <p>
      ${dealer.street}, ${dealer.locality}, ${dealer.postcode}.
      ${when(dealer.telephone, `<a href="tel:${esc(dealer.telephone ?? '')}">${esc(dealer.telephone ?? '')}</a>`)}
    </p>
  </section>`;
}

// ---------------------------------------------------------------- page

export function renderVehiclePage(input: VdpInput): string {
  const { vehicle: v, dealer, media, theme = DEFAULT_THEME } = input;
  const hero = media.find((m) => !m.isDamage) ?? media[0];
  const damage = media.filter((m) => m.isDamage);
  const path = vehicleUrlPath(v);
  const url = canonicalUrl(dealer.url, path);

  const metaInput = { ...v, dealerName: dealer.name };
  const title = vehicleTitle(metaInput);
  const description = vehicleDescription(metaInput);

  const jsonLd = [
    vehicleJsonLd({ ...v, url }, dealer),
    dealerJsonLd(dealer),
    breadcrumbJsonLd(vehicleBreadcrumbs(dealer.url, v, url)),
  ];
  // A payment figure has nowhere in JSON-LD to carry its representative
  // example, so it must not appear there. Enforced, not merely intended.
  assertNoFinanceFigures(jsonLd);

  const name = [v.year, v.make, v.model, v.derivative].filter(Boolean).join(' ');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${hero ? `<meta property="og:image" content="${esc(hero.variants.at(-1)?.url ?? '')}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>${criticalCss(theme)}</style>
<script type="application/ld+json">${renderJsonLd(jsonLd)}</script>
</head>
<body>
<a class="visually-hidden" href="#main">Skip to content</a>
<header class="wrap">
  <nav aria-label="Breadcrumb">
    <a href="/">Home</a> › <a href="/used-cars">Used cars</a>${v.make ? ` › <a href="/used-cars/${esc(v.make.toLowerCase().replace(/\s+/g, '-'))}">${esc(v.make)}</a>` : ''}
  </nav>
</header>

<main id="main">
  <!-- 1. Gallery -->
  <div class="vdp-gallery">${hero ? picture(hero, { hero: true }) : ''}</div>

  <div class="wrap">
    <!-- 2. Make / model / derivative -->
    <div class="vdp-head">
      <h1 class="vdp-title">${esc(name)}</h1>
      ${regPlate(v.registration)}

      <!-- 3. Price, and finance only if it is compliant -->
      ${priceBlock(v.pricePence, input.priceContext)}
      ${input.financeHtml ?? ''}

      <!-- 4. Key specs -->
      <ul class="vdp-specs">
        ${v.year ? `<li><b>${esc(v.year)}</b></li>` : ''}
        <li><b>${esc(fmtMiles(v.mileage))}</b></li>
        ${v.fuelType ? `<li><b>${esc(v.fuelType)}</b></li>` : ''}
        ${v.transmission ? `<li><b>${esc(v.transmission)}</b></li>` : ''}
      </ul>
    </div>

    <!-- 5. CTA row -->
    <div class="cta-row">
      ${dealer.telephone ? `<a class="btn btn-primary" href="tel:${esc(dealer.telephone)}">Call us</a>` : ''}
      ${dealer.whatsapp ? `<a class="btn" href="https://wa.me/${esc(dealer.whatsapp)}?text=${encodeURIComponent(`Hi, I'm interested in the ${name} (${v.registration})`)}">WhatsApp</a>` : ''}
      <a class="btn" href="#enquire">Enquire</a>
      <a class="btn" href="#reserve">Reserve</a>
    </div>

    <!-- 6. The facts that decide whether they get in the car and drive over -->
    ${factsSection(input)}

    ${v.description ? `<section class="card"><h2>About this ${esc(v.make ?? 'car')}</h2><p>${esc(v.description)}</p></section>` : ''}

    ${specSection(v)}
    ${motSection(input.mot)}

    ${damage.length > 0 ? `<section class="card" id="condition">
      <h2>Declared condition</h2>
      <p>We photograph anything worth knowing about before you travel.</p>
      ${damage.map((m) => m.damageLabel
        ? `<figure class="declared"><figcaption>${esc(m.damageLabel)}</figcaption>${picture(m)}</figure>`
        : picture(m)).join('')}
    </section>` : ''}

    ${trustSection(input)}

    <section class="card" id="enquire">
      <h2>Enquire about this ${esc(v.make ?? 'vehicle')}</h2>
      <form method="post" action="/enquiries">
        <input type="hidden" name="vehicle" value="${esc(v.registration)}">
        <p><label for="name">Your name</label><br><input id="name" name="name" required autocomplete="name"></p>
        <p><label for="email">Email</label><br><input id="email" name="email" type="email" required autocomplete="email"></p>
        <p><label for="phone">Phone</label><br><input id="phone" name="phone" type="tel" autocomplete="tel"></p>
        <p><label for="message">Message</label><br><textarea id="message" name="message" rows="4"></textarea></p>
        <p><button class="btn btn-primary" type="submit">Send enquiry</button></p>
      </form>
    </section>
  </div>
</main>

<!-- Sticky on mobile so a buyer never scrolls back up to find the phone number -->
<div class="sticky-cta">
  ${dealer.telephone ? `<a class="btn btn-primary" href="tel:${esc(dealer.telephone)}">Call</a>` : ''}
  <a class="btn" href="#enquire">Enquire</a>
</div>

<footer class="wrap">
  <p>${esc(dealer.name)} · ${esc(dealer.street)}, ${esc(dealer.locality)}, ${esc(dealer.postcode)}</p>
  <p><a href="/initial-disclosure">Initial disclosure</a> · <a href="/complaints-procedure">Complaints procedure</a> · <a href="/privacy-policy">Privacy policy</a> · <a href="/terms">Terms</a></p>
</footer>
<style>.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
</body>
</html>`;
}
