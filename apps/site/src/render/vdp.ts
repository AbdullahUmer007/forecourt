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
import { masthead, siteFooter, type OpeningHoursView } from './chrome.js';
import { renderFinancePromotion, renderFinanceUnavailable, type FinancePromotionInput } from './finance.js';
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

/**
 * Everything the finance section needs. `promotion` is the proof; `quote` is
 * the figure it legitimises. A quote without a promotion is unrenderable by
 * construction — `FinancePromotionInput` requires both.
 */
export type FinanceBlock = FinancePromotionInput;

export interface VdpInput {
  vehicle: StructuredVehicle & {
    stockNumber: string;
    keyCount: number | null;
    serviceHistory: string | null;
    motExpiresOn: string | null;
    warranty: string | null;
  };
  dealer: StructuredDealer & {
    whatsapp: string | null;
    openingHours?: readonly OpeningHoursView[];
    fcaReference?: string | null;
    companyNumber?: string | null;
    legalName?: string | null;
    tradeBodies?: readonly string[];
    yearsTrading?: number | null;
  };
  media: readonly MediaView[];
  mot: readonly MotTestView[];
  provenanceCheckedAt: string | null;
  /** Detailed provenance outcome. Falls back to `provenanceCheckedAt` when absent. */
  provenance?: ProvenanceView | null;
  batteryHealth?: BatteryHealthView | null;
  priceContext?: PriceContextView | null;
  /**
   * The finance block.
   *
   * M8: this is no longer a string. It is an `ApprovedPromotion` — a type that
   * can only be constructed by `approvePromotion()`, which refuses unless the
   * rule is signed off, the example is approved, in date, and reconciles. Pass
   * null and no cost-of-credit figure appears anywhere on the page.
   *
   * Making it a token rather than pre-rendered HTML is the point: it is not
   * possible to hand this page a payment figure that did not come with its
   * representative example, and the compiler says so.
   */
  finance: FinanceBlock | null;
  theme?: BrandTheme;
  /**
   * Injected so the opening status ("Open until 6pm") is deterministic in
   * tests and in the golden files. Defaults to now in production.
   */
  now?: Date;
  /** Similar live stock, for the rail at the foot of the page. */
  similar?: readonly SimilarVehicleView[];
}

export interface SimilarVehicleView {
  name: string;
  href: string;
  pricePence: bigint | null;
  meta: string;
  thumbUrl: string | null;
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
    html`<div class="card fact">
      <h2 class="fact-head"><span class="fact-mark mark-${mark}" aria-hidden="true">${glyph}</span>${head}</h2>
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
    // The big figure with its meter and its typical range. A battery
    // percentage means nothing to a buyer without the context of what is
    // normal at that age — 93.2% reads as a fail to anyone who expects 100.
    facts.push(html`<div class="well">
      <h2>Battery health ${bh.percentOfNew}%</h2>
      <p class="big-figure" aria-hidden="true">${bh.percentOfNew}%</p>
      <p class="fact-head"><span class="fact-mark mark-${below ? 'warn' : 'good'}" aria-hidden="true">${below ? '!' : '✓'}</span>${below ? 'Below typical for its age' : 'Healthy for its age'}</p>
      <p class="meter" aria-hidden="true"><b style="width:${Math.max(0, Math.min(100, bh.percentOfNew))}%"></b></p>
      <p class="fact-note">Tested ${fmtDate(bh.testedOn)}.${typical}</p>
    </div>`);
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
    return html`<section class="band" id="mot">
      <div class="wrap">
        <h2>MOT history</h2>
        <p class="mot-none">No MOT tests recorded yet — a car under three years old has not needed one. We publish every DVSA test here the day it happens.</p>
      </div>
    </section>`;
  }
  const latest = mot[0]!;
  const chart = mileageChart(mot);
  return html`<section class="band" id="mot">
    <div class="wrap">
      <div class="section-head">
        <h2>MOT history and mileage</h2>
        <span class="section-note">Straight from the DVSA · latest test ${fmtDate(latest.testDate)}</span>
      </div>
      <div class="mot-split">
        ${raw(chart ? `<figure class="chart-card">
          <figcaption>Recorded mileage over time</figcaption>
          <p class="section-note">Miles at each MOT test. Every reading higher than the last means no anomaly.</p>
          ${chart}
        </figure>` : '')}
        <div class="mot-list">
          ${raw(mot.map((t) => {
            const pass = t.result === 'PASSED';
            const adv = t.advisories.length;
            return `<div class="mot-item">
              <div class="mot-top">
                <span class="badge ${pass ? 'badge-good' : 'badge-bad'}"><span aria-hidden="true">${pass ? '✓' : '✕'}</span>${pass ? 'Pass' : t.result === 'FAILED' ? 'Fail' : '—'}</span>
                <span class="mot-date">${esc(fmtDate(t.testDate))}</span>
                <span class="mot-miles">${t.odometerMiles === null ? '—' : esc(t.odometerMiles.toLocaleString('en-GB'))} miles</span>
              </div>
              <p class="mot-adv">
                <span aria-hidden="true" class="${adv ? 'adv-mark' : 'adv-none'}">${adv ? '!' : '✓'}</span>
                <span><b>${adv ? `${adv} advisor${adv === 1 ? 'y' : 'ies'}:</b> ` : 'No advisories</b>'}${adv ? esc(t.advisories.join('; ')) : ''}</span>
              </p>
            </div>`;
          }).join(''))}
        </div>
      </div>
    </div>
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
  return html`<section class="section" id="specification">
    <h2>Full specification</h2>
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
  const rated = dealer.ratingValue !== null && (dealer.reviewCount ?? 0) > 0;
  // Shown, not written in a sentence. "Rated 4.8 from 252 reviews" buried in a
  // paragraph is the finding the design review opened with.
  const cards: string[] = [];
  if (vehicle.warranty) {
    cards.push(`<div class="trust-card">
      <p class="trust-figure">✓</p>
      <p class="trust-title">${esc(vehicle.warranty)}</p>
      <p class="trust-detail">Included with this car, not an upsell at the desk.</p>
    </div>`);
  }
  if (dealer.yearsTrading) {
    cards.push(`<div class="trust-card">
      <p class="trust-figure">${dealer.yearsTrading}</p>
      <p class="trust-title">Years on this forecourt</p>
      <p class="trust-detail">Same family, same site, same people.</p>
    </div>`);
  }
  cards.push(`<div class="trust-card">
    <p class="trust-figure">✓</p>
    <p class="trust-title">Every car history checked</p>
    <p class="trust-detail">Finance, theft and write-off markers checked before it goes on sale.</p>
  </div>`);

  const addr = [dealer.street, dealer.locality, dealer.postcode].filter(Boolean).join(', ');
  return html`<section class="band-3" id="trust">
    <div class="wrap">
      <h2>Buying from ${dealer.name}</h2>
      <div class="trust-grid">
        ${raw(rated ? `<div class="trust-card">
          <p class="trust-figure trust-figure-lg">${esc(String(dealer.ratingValue))}</p>
          <p class="stars" aria-hidden="true">★★★★★</p>
          <p class="trust-detail">${esc(String(dealer.ratingValue))} out of 5 from ${esc(String(dealer.reviewCount))} reviews</p>
        </div>` : '')}
        ${raw(cards.join(''))}
      </div>
      <div class="trust-foot">
        ${raw(dealer.tradeBodies && dealer.tradeBodies.length > 0 ? `<div class="trust-card">
          <p class="trust-label">Approved and accountable</p>
          <div class="bodies">${dealer.tradeBodies.map((b) => `<span>${esc(b)}</span>`).join('')}</div>
        </div>` : '')}
        <div class="trust-card">
          <p class="trust-label">Where to find us</p>
          <p class="trust-addr">${esc(addr)}</p>
          ${when(dealer.telephone, `<p><a href="tel:${esc(dealer.telephone ?? '')}">${esc(dealer.telephone ?? '')}</a></p>`)}
        </div>
      </div>
    </div>
  </section>`;
}

/**
 * The hero gallery: a scroll-snap rail, swipeable with no JavaScript.
 *
 * Only the first photograph is eager and `fetchpriority="high"` — it is the
 * LCP element and the budget is 2.0s at p75 on mobile. The rest are lazy, so a
 * fourteen-photograph gallery does not cost fourteen requests above the fold.
 */
function galleryFrame(
  media: readonly MediaView[],
  hero: MediaView | undefined,
  ctx: PriceContextView | null | undefined,
  pricePence: bigint | null,
): string {
  if (!hero) {
    return html`<div class="gallery-empty">
      <p class="gallery-empty-head">Photographs are being taken today.</p>
      <p class="gallery-empty-note">Ring us and we will send you photos and a walkaround video within the hour, before this car goes on the website.</p>
    </div>`;
  }
  // Show the presentable shots in the rail. Declared marks have their own
  // section — leading a listing with a scuffed bumper loses the click the
  // disclosure was meant to protect.
  const shots = media.filter((m) => !m.isDamage);
  const rail = (shots.length > 0 ? shots : [hero]).slice(0, 6);
  const dropped = ctx && pricePence !== null && ctx.previousPence > pricePence;
  const drop = dropped ? fmtPrice(ctx.previousPence - pricePence) : null;
  return html`<div>
    <div class="gallery-frame">
      <div class="gallery-rail">
        ${raw(rail.map((m, i) => `<figure>${picture(m, { hero: i === 0 })}</figure>`).join(''))}
      </div>
      ${raw(drop
        ? `<p class="gallery-badges"><span class="badge badge-accent"><span aria-hidden="true">↓</span>Reduced by ${esc(drop)}</span></p>`
        : '')}
      ${raw(media.length > 1 ? `<a class="gallery-all" href="#gallery">View all ${media.length} photos</a>` : '')}
    </div>
    ${raw(rail.length > 1
      ? `<div class="gallery-dots" aria-hidden="true">${rail.map(() => '<span></span>').join('')}</div>`
      : '')}
  </div>`;
}

/** The six facts a buyer scans before anything else. */
function keySpecs(v: VdpInput['vehicle']): [string, string][] {
  const out: [string, string][] = [];
  if (v.mileage !== null) out.push(['Mileage', v.mileage.toLocaleString('en-GB')]);
  if (v.fuelType) out.push(['Fuel', v.fuelType]);
  if (v.transmission) out.push(['Gearbox', v.transmission]);
  if (v.bodyStyle) out.push(['Body', v.bodyStyle]);
  if (v.seats !== null) out.push(['Seats', String(v.seats)]);
  if (v.formerKeepers !== null) out.push(['Owners', String(v.formerKeepers)]);
  return out;
}

/** Short reassurances in the buy column — shown, not written in a sentence. */
function reassuranceList(input: VdpInput): string {
  const items: string[] = [];
  if (input.vehicle.warranty) items.push(input.vehicle.warranty);
  // The stored value may already read "Full Tesla service history" — appending
  // the words again gives "…service history service history".
  if (input.vehicle.serviceHistory) {
    const sh = input.vehicle.serviceHistory;
    items.push(/service history/i.test(sh) ? sh : `${sh} service history`);
  }
  if (input.vehicle.motExpiresOn) items.push(`MOT to ${fmtDate(input.vehicle.motExpiresOn)}`);
  if (input.vehicle.keyCount !== null && input.vehicle.keyCount > 1) items.push(`${input.vehicle.keyCount} keys`);
  if (items.length === 0) return '';
  return html`<ul class="reassure">
    ${raw(items.map((i) => `<li><span class="tick" aria-hidden="true">✓</span>${esc(i)}</li>`).join(''))}
  </ul>`;
}

/**
 * Declared condition, on the dark plane.
 *
 * No competitor shows damage voluntarily, so this is the page's strongest
 * trust signal and it is designed to read as confidence: a count, each mark
 * named, each photographed. Naming matters — "3 photos" is not a trust signal,
 * "kerbed nearside front alloy" is.
 */
function declaredConditionSection(damage: readonly MediaView[]): string {
  if (damage.length === 0) return '';
  const n = damage.length;
  return html`<section class="plane" id="condition">
    <div class="wrap">
      <div class="declared-head">
        <div class="declared-intro">
          <p class="plane-eyebrow">Declared condition</p>
          <h2 class="h2-lg">Every mark on this car, photographed and named.</h2>
          <p class="declared-lead">A used car has history. We photograph and caption all of it before you drive here, so nothing on the forecourt is a surprise.</p>
        </div>
        <p class="declared-count">
          <b>${n}</b><span>mark${n === 1 ? '' : 's'} declared</span>
        </p>
      </div>
      <ul class="marks">
        ${raw(damage.map((m) => `<li class="mark">
          ${picture(m)}
          <div class="mark-body">
            <h3>${esc(m.damageLabel ?? 'Declared mark')}</h3>
            <p>${esc(m.alt)}</p>
          </div>
        </li>`).join(''))}
      </ul>
    </div>
  </section>`;
}

/**
 * Provenance and battery health, side by side.
 *
 * Both are stated outcomes rather than badges. Provenance is tri-state: only an
 * explicit `false` produces "no outstanding finance"; an unknown produces
 * silence, because rendering a missing field as good news is how a provenance
 * badge becomes a misrepresentation.
 */
function provenanceSection(input: VdpInput): string {
  const facts = factsSection(input);
  if (!facts) return '';
  return html`<div class="split">${raw(facts)}</div>`;
}

/** The full gallery grid, below the fold. */
function gallerySection(media: readonly MediaView[]): string {
  const shots = media.filter((m) => !m.isDamage);
  if (shots.length < 2) return '';
  return html`<section class="section" id="gallery">
    <div class="section-head">
      <h2>Photographs <span class="section-count">${shots.length}</span></h2>
      <span class="section-note">Swipe or scroll to see more</span>
    </div>
    <div class="photo-grid">
      ${raw(shots.map((m) => picture(m)).join(''))}
    </div>
  </section>`;
}

/** Similar live stock — the rail at the foot of the page. */
function similarSection(similar: readonly SimilarVehicleView[] | undefined): string {
  if (!similar || similar.length === 0) return '';
  return html`<section class="section" id="similar">
    <h2>Similar in stock</h2>
    <ul class="rail">
      ${raw(similar.map((s) => `<li class="v-card"><a class="v-card-link" href="${esc(s.href)}">
        ${s.thumbUrl
          ? `<img class="v-thumb" src="${esc(s.thumbUrl)}" alt="${esc(s.name)}" loading="lazy" decoding="async" width="800" height="600">`
          : '<span class="v-thumb-empty" aria-hidden="true"></span>'}
        <div class="v-card-body">
          <p class="v-name">${esc(s.name)}</p>
          <p class="v-deriv">${esc(s.meta)}</p>
          <p class="v-price">${esc(fmtPrice(s.pricePence))}</p>
        </div>
      </a></li>`).join(''))}
    </ul>
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
${masthead(dealer, input.now ? { now: input.now } : {})}

<main id="main">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a><span aria-hidden="true">/</span><a href="/used-cars">Used cars</a>${v.make ? `<span aria-hidden="true">/</span><a href="/used-cars/${esc(v.make.toLowerCase().replace(/\s+/g, '-'))}">${esc(v.make)}</a>` : ''}
    </nav>
  </div>

  <!-- HERO. The above-fold order is fixed by the design brief:
       gallery → name → price → key specs → CTA row. -->
  <section class="hero">
    <div class="hero-media">${galleryFrame(media, hero, input.priceContext, v.pricePence)}</div>

    <div class="hero-buy">
      <div>
        <h1 class="vdp-title">${v.year ? `<span class="yr">${esc(String(v.year))}</span> ` : ''}${esc([v.make, v.model].filter(Boolean).join(' '))}</h1>
        ${v.derivative ? `<p class="vdp-deriv">${esc(v.derivative)}</p>` : ''}
        <div class="vdp-ids">
          ${regPlate(v.registration)}
          <span class="stock-no">Stock ${esc(v.stockNumber)}</span>
        </div>
      </div>

      <!-- Price. The finance figure lives with its representative example,
           further down — a payment figure above the fold with the example
           below it is not "clear, concise and prominent" (CONC 3.5.4R). -->
      <div>${priceBlock(v.pricePence, input.priceContext)}</div>

      <ul class="key-specs">
        ${keySpecs(v).map((s) =>
          `<li><span class="k">${esc(s[0])}</span><span class="v">${esc(s[1])}</span></li>`).join('')}
      </ul>

      <div class="cta-row">
        ${dealer.telephone ? `<a class="btn btn-primary" href="tel:${esc(dealer.telephone)}">Call the forecourt</a>` : ''}
        <a class="btn btn-accent" href="#reserve">Reserve</a>
        <a class="btn" href="#enquire">Enquire</a>
        ${dealer.whatsapp ? `<a class="btn" href="https://wa.me/${esc(dealer.whatsapp)}?text=${encodeURIComponent(`Hi, I'm interested in the ${name} (${v.registration})`)}">WhatsApp</a>` : ''}
      </div>

      ${reassuranceList(input)}
    </div>
  </section>

  <!-- DECLARED CONDITION — full-bleed dark plane.
       Our biggest differentiator, so it is not a grey box halfway down. -->
  ${declaredConditionSection(damage)}

  <!-- The facts that decide whether they get in the car and drive over -->
  ${provenanceSection(input)}

  ${gallerySection(media)}

  ${motSection(input.mot)}

  ${specSection(v)}

  ${v.description ? `<section class="section"><h2>About this ${esc(v.make ?? 'car')}</h2><p class="prose">${esc(v.description)}</p></section>` : ''}

  <section class="band-3" id="finance">
    <div class="wrap">
      ${input.finance
        ? renderFinancePromotion(input.finance)
        : renderFinanceUnavailable({ name: dealer.name, fcaReference: dealer.fcaReference ?? null })}
    </div>
  </section>

  ${trustSection(input)}

  <section class="plane" id="enquire">
    <div class="enq">
      <div>
        <h2 class="h2-lg">Ask us anything about this ${esc(v.make ?? 'car')}</h2>
        <p>A real person at the forecourt answers these — usually within the hour, always the same day. Ask for a video walkaround if you are coming a distance.</p>
        ${dealer.telephone ? `<p>Or ring <a href="tel:${esc(dealer.telephone)}">${esc(dealer.telephone)}</a></p>` : ''}
      </div>
      <form class="enq-form" method="post" action="/enquiries">
        <input type="hidden" name="vehicle" value="${esc(v.registration)}">
        <label><span>Your name</span><input name="name" required autocomplete="name" autocapitalize="words"></label>
        <label><span>Email</span><input name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label><span>Phone</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel"></label>
        <label class="full"><span>Your question</span><textarea name="message" rows="3" placeholder="Is it available to view on Saturday morning?"></textarea></label>
        <button class="full" type="submit">Send my enquiry</button>
        <p class="enq-note">We will only use this to answer you about this car. No marketing unless you tick to ask for it.</p>
      </form>
    </div>
  </section>

  ${similarSection(input.similar)}
</main>

<!-- Sticky on mobile so a buyer never scrolls back up to find the phone number -->
<div class="sticky-cta">
  ${dealer.telephone ? `<a class="btn btn-primary" href="tel:${esc(dealer.telephone)}">Call</a>` : ''}
  <a class="btn" href="#enquire">Enquire</a>
</div>

${siteFooter(dealer)}
<style>.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
</body>
</html>`;
}
