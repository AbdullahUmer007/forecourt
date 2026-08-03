/**
 * M6 — the dealer home page.
 *
 * This was the outstanding half of M6b: the root URL redirected to the stock
 * list because no home page existed. A redirect is a reasonable placeholder and
 * a poor home page — a dealer's domain is the thing they put on a forecourt
 * banner and a business card, and it landed on a filtered list.
 *
 * The page has two jobs, for two different buyers arriving at the same URL:
 *
 *   1. Someone who knows what they want must reach the stock list in ONE
 *      action. That is why the hero is search-first rather than a stock
 *      photograph with a slider on it.
 *   2. Someone deciding whether to trust this dealer at all must get an
 *      answer without scrolling past marketing. That is what the "why buy
 *      here" band and the review figure are for, and why they sit above the
 *      featured stock rather than below it.
 *
 * This is a TEMPLATE, not a one-off: every dealer gets it with their own name,
 * brand colour, stock and copy. It has to hold up with 12 cars or 300, so
 * every count is rendered from real data and nothing is padded.
 *
 * Zero JavaScript, like the rest of the render layer. The hero search is a GET
 * form that lands on `/used-cars` with query parameters the results page
 * already understands.
 */

import { html, raw, when, esc } from './html.js';
import { criticalCss, DEFAULT_THEME, type BrandTheme } from './theme.js';
import { masthead, siteFooter, type OpeningHoursView } from './chrome.js';
import { canonicalUrl } from '../../../../packages/domain/src/seo.js';
import {
  dealerJsonLd, renderJsonLd, assertNoFinanceFigures, type StructuredDealer,
} from '../../../../packages/domain/src/structured-data.js';

export interface HomeVehicleCard {
  name: string;
  href: string;
  pricePence: bigint | null;
  meta: string;
  thumbUrl: string | null;
  thumbAlt: string;
}

export interface BrowseEntry {
  label: string;
  href: string;
  count: number;
}

export interface HomeInput {
  dealer: StructuredDealer & {
    whatsapp: string | null;
    openingHours?: readonly OpeningHoursView[];
    fcaReference?: string | null;
    companyNumber?: string | null;
    legalName?: string | null;
    tradeBodies?: readonly string[];
    yearsTrading?: number | null;
  };
  /** Total live stock. Rendered as a credibility signal, so it is never faked. */
  stockCount: number;
  /** Lowest live price, for "from £x" in the hero. */
  fromPricePence: bigint | null;
  justArrived: readonly HomeVehicleCard[];
  browseByBody: readonly BrowseEntry[];
  browseByMake: readonly BrowseEntry[];
  theme?: BrandTheme;
  now?: Date;
}

const fmtPrice = (pence: bigint | null): string =>
  pence === null ? 'POA' : `£${(Number(pence) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

/**
 * The price bands offered in the hero.
 *
 * These are the SAME declared bands the crawl-control allow-list uses, so a
 * buyer arriving through this form lands on an indexable URL rather than
 * minting a free-form `?price_max=` that we deliberately do not index.
 */
const PRICE_BANDS: readonly { label: string; value: string }[] = [
  { label: 'Any price', value: '' },
  { label: 'Under £5,000', value: 'under-5000' },
  { label: '£5,000 to £10,000', value: '5000-10000' },
  { label: '£10,000 to £15,000', value: '10000-15000' },
  { label: '£15,000 to £20,000', value: '15000-20000' },
  { label: '£20,000 to £30,000', value: '20000-30000' },
  { label: 'Over £30,000', value: 'over-30000' },
];

function vehicleCard(v: HomeVehicleCard): string {
  return html`<li class="v-card">
    <a class="v-card-link" href="${v.href}">
      ${raw(v.thumbUrl
        ? `<img class="v-thumb" src="${esc(v.thumbUrl)}" alt="${esc(v.thumbAlt)}" loading="lazy" decoding="async" width="800" height="600">`
        : '<span class="v-thumb-empty" role="img" aria-label="No photograph yet"></span>')}
      <div class="v-card-body">
        <p class="v-name">${v.name}</p>
        <p class="v-deriv">${v.meta}</p>
        <p class="v-price">${fmtPrice(v.pricePence)}</p>
      </div>
    </a>
  </li>`;
}

function browseBlock(title: string, entries: readonly BrowseEntry[]): string {
  if (entries.length === 0) return '';
  return html`<div class="browse-group">
    <h3 class="trust-label">${title}</h3>
    <div class="browse">
      ${raw(entries.map((e) => `<a href="${esc(e.href)}">${esc(e.label)}<span class="n">${e.count} in stock</span></a>`).join(''))}
    </div>
  </div>`;
}

export function renderHomePage(input: HomeInput): string {
  const {
    dealer, stockCount, fromPricePence, justArrived,
    browseByBody, browseByMake, theme = DEFAULT_THEME,
  } = input;

  const url = canonicalUrl(dealer.url, '/');
  const place = dealer.locality ?? '';
  const title = `Used cars ${place ? `in ${place}` : ''} — ${dealer.name}`.replace(/\s+/g, ' ').trim();
  const description = stockCount > 0
    ? `${stockCount} used cars in stock at ${dealer.name}${place ? `, ${place}` : ''}. Every car history checked, full MOT history published and any declared marks photographed before you travel.`
    : `${dealer.name}${place ? `, ${place}` : ''}. Every car history checked, full MOT history published and any declared marks photographed before you travel.`;

  const jsonLd = [dealerJsonLd(dealer)];
  // Same rule as every other page: no cost-of-credit figure in structured
  // data, because JSON-LD cannot carry a representative example.
  assertNoFinanceFigures(jsonLd);

  const rated = dealer.ratingValue !== null && (dealer.reviewCount ?? 0) > 0;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<style>${criticalCss(theme)}</style>
<script type="application/ld+json">${renderJsonLd(jsonLd)}</script>
</head>
<body>
<a class="visually-hidden" href="#main">Skip to content</a>
${masthead(dealer, input.now ? { now: input.now } : {})}

<main id="main">
  <!-- Search-first hero. These buyers arrive with a budget and a body style in
       mind; a stock photograph of a car they cannot buy wastes the fold. -->
  <section class="home-hero">
    <div class="wrap">
      <h1>Used cars${place ? ` in ${esc(place)}` : ''}, sold straight.</h1>
      <p>Every car history checked before it goes on sale, the full MOT record published, and any mark on the paintwork photographed and named — so nothing is a surprise when you get here.</p>

      <form class="home-search" method="get" action="/used-cars" role="search">
        <label class="visually-hidden" for="hq">Make, model or registration</label>
        <input id="hq" name="q" type="search" placeholder="Make, model or reg">
        <label class="visually-hidden" for="hp">Budget</label>
        <select id="hp" name="price">
          ${PRICE_BANDS.map((b) => `<option value="${esc(b.value)}">${esc(b.label)}</option>`).join('')}
        </select>
        <button type="submit">Search ${stockCount > 0 ? `${stockCount} cars` : 'stock'}</button>
      </form>

      <div class="home-stats">
        ${stockCount > 0 ? `<p class="home-stat"><b>${stockCount}</b><span>cars in stock today</span></p>` : ''}
        ${fromPricePence !== null ? `<p class="home-stat"><b>${esc(fmtPrice(fromPricePence))}</b><span>lowest price today</span></p>` : ''}
        ${rated ? `<p class="home-stat"><b>${esc(String(dealer.ratingValue))}</b><span>from ${esc(String(dealer.reviewCount))} reviews</span></p>` : ''}
        ${dealer.yearsTrading ? `<p class="home-stat"><b>${dealer.yearsTrading}</b><span>years on this forecourt</span></p>` : ''}
      </div>
    </div>
  </section>

  <!-- Why buy here, BEFORE the stock. A buyer deciding whether to trust this
       dealer should not have to scroll past a grid to find out. -->
  <section class="band">
    <div class="wrap">
      <h2>Why buy from ${esc(dealer.name)}</h2>
      <div class="why">
        <div class="why-item">
          <h3>Every car history checked</h3>
          <p>Outstanding finance, theft and write-off markers checked before a car goes on sale — and the result is published on the car's own page, whatever it says.</p>
        </div>
        <div class="why-item">
          <h3>The full MOT history, published</h3>
          <p>Every test, every mileage reading and every advisory, straight from the DVSA, with the mileage drawn as a chart so you can see it has not been clocked.</p>
        </div>
        <div class="why-item">
          <h3>Declared marks, photographed</h3>
          <p>If there is a kerbed alloy or a stone chip we photograph it and name it. You should know what you are driving to see before you set off.</p>
        </div>
        <div class="why-item">
          <h3>The price on the screen</h3>
          <p>No admin fee bolted on at the desk. What you see is what you pay, and any reduction we have made is shown with the date we made it.</p>
        </div>
      </div>
    </div>
  </section>

  ${justArrived.length > 0 ? `<section class="section">
    <div class="section-head">
      <h2>Just arrived</h2>
      <a class="section-note" href="/used-cars?sort=just-arrived">See everything in stock</a>
    </div>
    <ul class="rail">${justArrived.map(vehicleCard).join('')}</ul>
  </section>` : ''}

  ${browseByBody.length > 0 || browseByMake.length > 0 ? `<section class="band-3">
    <div class="wrap">
      <h2>Browse the forecourt</h2>
      <div class="browse-groups">
        ${browseBlock('By body style', browseByBody)}
        ${browseBlock('By make', browseByMake)}
      </div>
    </div>
  </section>` : ''}

  <section class="plane">
    <div class="enq">
      <div>
        <h2 class="h2-lg">Thinking of part-exchanging?</h2>
        <p>Tell us what you are driving and we will give you a figure against anything on the forecourt. Bring it down and we will confirm it in person — the number we give you is the number we honour.</p>
        <p><a href="/part-exchange">Value my part-exchange</a></p>
      </div>
      <div>
        <h2 class="h2-lg">Where to find us</h2>
        <p>${esc([dealer.street, dealer.locality, dealer.postcode].filter(Boolean).join(', '))}</p>
        ${dealer.telephone ? `<p>Ring us on <a href="tel:${esc(dealer.telephone)}">${esc(dealer.telephone)}</a></p>` : ''}
      </div>
    </div>
  </section>
</main>

${siteFooter(dealer)}
<style>.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
</body>
</html>`;
}
