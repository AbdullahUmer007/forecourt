/**
 * M7 — the search results page.
 *
 * Renders completely without JavaScript, like the VDP. That constraint is not
 * decoration here: it forces every filter to be a real URL, which is what makes
 * the page shareable, cacheable at the edge, crawlable on our terms, and
 * usable on a phone with one bar of signal on a forecourt.
 *
 * Facets are `<a href>`. Sorting is `<a href>`. The keyword box is a plain GET
 * form. Saving a car is a POST form. Nothing on this page needs a script, so
 * nothing on this page can be broken by one failing to load.
 */

import { html, raw, when, esc } from './html.js';
import { criticalCss, DEFAULT_THEME, type BrandTheme } from './theme.js';
import { canonicalUrl, vehicleUrlPath } from '../../../../packages/domain/src/seo.js';
import {
  searchResultsJsonLd, dealerJsonLd, breadcrumbJsonLd, renderJsonLd,
  assertNoFinanceFigures, type StructuredDealer,
} from '../../../../packages/domain/src/structured-data.js';
import {
  canonicalSearchPath, searchUrlPath, searchIndexability, robotsContent,
  buildFacets, appliedFilters, paginate, relaxationLadder, firstNonEmpty,
  resultBadges, BADGE_LABELS, SORTS, DEFAULT_SORT, FACET_LABELS,
  type SearchQuery, type FacetCount, type MultiDimension, type Relaxation,
} from '../../../../packages/domain/src/search.js';

export interface ResultVehicle {
  id: string;
  make: string | null;
  model: string | null;
  derivative: string | null;
  year: number | null;
  registration: string;
  mileage: number | null;
  pricePence: bigint | null;
  fuelType: string | null;
  transmission: string | null;
  state: string;
  liveSince: Date | null;
  priceReducedAt: Date | null;
  thumbnail: { url: string; srcset: string; alt: string } | null;
}

export interface ResultsInput {
  query: SearchQuery;
  dealer: StructuredDealer;
  vehicles: readonly ResultVehicle[];
  totalCount: number;
  facetCounts: Partial<Record<MultiDimension, readonly FacetCount[]>>;
  /** Human labels for slugs, so "model-x" renders as "Model X". */
  labelFor?: (dimension: MultiDimension, value: string) => string;
  /** Used to walk the relaxation ladder when nothing matched. */
  countFor?: (q: SearchQuery) => number;
  /** Vehicles to show instead when the search found nothing. */
  fallbackVehicles?: readonly ResultVehicle[];
  now: Date;
  theme?: BrandTheme;
}

const fmtPrice = (pence: bigint | null): string =>
  pence === null ? 'POA' : `£${(Number(pence) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const titleCase = (slug: string): string =>
  slug.split('-').map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const vehicleName = (v: ResultVehicle): string =>
  [v.year, v.make, v.model, v.derivative].filter(Boolean).join(' ') || 'Used car';

/**
 * The H1 and the page title, built from the filters.
 *
 * A results page whose heading is always "Used cars" is the same mistake as a
 * vehicle page carrying the homepage title — the reason we score the
 * competitor 16 out of 100. If a URL is worth indexing it is worth naming.
 */
export function resultsHeading(
  q: SearchQuery,
  dealer: { locality: string | null },
  labelFor: (d: MultiDimension, v: string) => string = (_, v) => titleCase(v),
): string {
  const make = q.filters.make.length === 1 ? labelFor('make', q.filters.make[0]!) : null;
  const model = q.filters.model.length === 1 ? labelFor('model', q.filters.model[0]!) : null;
  const fuel = q.filters.fuel.length === 1 ? labelFor('fuel', q.filters.fuel[0]!) : null;
  const gearbox = q.filters.transmission.length === 1 ? labelFor('transmission', q.filters.transmission[0]!) : null;

  const subject = [gearbox, fuel, make, model].filter(Boolean).join(' ');
  const head = subject ? `Used ${subject}` : 'Used cars';
  const where = dealer.locality ? ` for sale in ${dealer.locality}` : ' for sale';
  const budget = q.maxPricePence !== null
    ? ` under £${(Number(q.maxPricePence) / 100).toLocaleString('en-GB')}`
    : '';
  return `${head}${budget}${where}`;
}

// ---------------------------------------------------------------- pieces

function card(v: ResultVehicle, now: Date, returnPath: string): string {
  const badges = resultBadges(v, now);
  const path = vehicleUrlPath(v);
  return html`<article class="v-card">
    <a class="v-card-link" href="${path}">
      ${raw(v.thumbnail
        ? `<img class="v-thumb" src="${esc(v.thumbnail.url)}" srcset="${esc(v.thumbnail.srcset)}"
             sizes="(min-width:1024px) 300px, (min-width:640px) 45vw, 92vw"
             alt="${esc(v.thumbnail.alt)}" width="600" height="450" loading="lazy" decoding="async">`
        : `<div class="v-thumb v-thumb-empty" role="img" aria-label="No photograph yet"></div>`)}
      <h3 class="v-name">${vehicleName(v)}</h3>
    </a>
    ${when(badges.length > 0, `<p class="v-badges">${badges.map((b) =>
      `<span class="badge badge-${esc(b)}">${esc(BADGE_LABELS[b])}</span>`).join('')}</p>`)}
    <p class="v-price">${fmtPrice(v.pricePence)}</p>
    <ul class="v-specs">
      ${raw([
        v.year ? String(v.year) : null,
        v.mileage === null ? null : `${v.mileage.toLocaleString('en-GB')} miles`,
        v.fuelType, v.transmission,
      ].filter(Boolean).map((s) => `<li>${esc(s!)}</li>`).join(''))}
    </ul>
    <!-- Saving works without JavaScript: a POST, a redirect, a re-render. -->
    <form class="v-save" method="post" action="/saved-cars">
      <input type="hidden" name="vehicle" value="${v.id}">
      <input type="hidden" name="return" value="${returnPath}">
      <button class="btn btn-save" type="submit" name="action" value="save">
        <span aria-hidden="true">♡</span> Save this car
      </button>
    </form>
  </article>`;
}

function facetSidebar(input: ResultsInput): string {
  const { query: q } = input;
  const groups = buildFacets(q, input.facetCounts);
  if (groups.length === 0) return '';

  const label = input.labelFor ?? ((_: MultiDimension, v: string) => titleCase(v));
  const chips = appliedFilters(q, label);

  return html`<aside class="filters" aria-label="Filter results">
    ${when(chips.length > 0, `<div class="chips"><h2 class="chips-head">Filtered by</h2>${
      chips.map((c) =>
        `<a class="chip" rel="nofollow" href="${esc(c.removeHref)}">${esc(c.label)}<span aria-hidden="true"> ×</span><span class="visually-hidden"> — remove this filter</span></a>`,
      ).join('')
    }<a class="chip chip-clear" rel="nofollow" href="/used-cars">Clear all</a></div>`)}

    ${raw(groups.map((g) => `<section class="facet">
      <h2 class="facet-head">${esc(g.label)}</h2>
      <ul class="facet-list">
        ${g.options.map((o) => o.disabled
          // Shown, counted, and not clickable. Hiding it would make the
          // sidebar flicker as options appear and vanish, and a buyer cannot
          // tell "there are none" from "I mis-filtered".
          ? `<li class="facet-opt is-disabled"><span aria-disabled="true">${esc(o.label)} <span class="facet-count">0</span></span></li>`
          : `<li class="facet-opt${o.selected ? ' is-selected' : ''}">
              <a href="${esc(o.href)}"${o.rel ? ` rel="${esc(o.rel)}"` : ''}${o.selected ? ' aria-current="true"' : ''}>
                ${esc(o.label)} <span class="facet-count">${o.count}</span>
              </a></li>`,
        ).join('')}
      </ul>
    </section>`).join(''))}
  </aside>`;
}

function sortBar(q: SearchQuery, total: number, from: number, to: number): string {
  return html`<div class="sortbar">
    <p class="count" role="status">${total === 0 ? 'No cars match' : `Showing ${from}–${to} of ${total} cars`}</p>
    <nav class="sorts" aria-label="Sort results">
      ${raw(SORTS.map((s) => {
        const href = searchUrlPath({ ...q, sort: s.key, page: 1 });
        const current = q.sort === s.key;
        // Sorted views are duplicates of the same set — never followed.
        return `<a class="sort${current ? ' is-current' : ''}" href="${esc(href)}"${
          s.key === DEFAULT_SORT ? '' : ' rel="nofollow"'}${current ? ' aria-current="true"' : ''}>${esc(s.label)}</a>`;
      }).join(''))}
    </nav>
  </div>`;
}

/**
 * The zero-result page. Never a dead end.
 *
 * It says what we did not have, what we widened, and shows the closest real
 * cars — then offers to tell them when the right one arrives, which is the
 * one moment we know exactly what a buyer wants.
 */
function zeroResults(input: ResultsInput, relaxed: (Relaxation & { count: number }) | null): string {
  const heading = resultsHeading(input.query, input.dealer, input.labelFor ?? ((_, v) => titleCase(v)));
  return html`<section class="zero">
    <h2>We haven't got a match for that today</h2>
    <p>Nothing in stock matches <strong>${heading.toLowerCase()}</strong> right now.</p>
    ${relaxed === null ? '' : raw(`<p class="zero-relaxed">Here ${
      relaxed.count === 1 ? 'is the one car' : `are ${relaxed.count} cars`} we have ${esc(relaxed.explanation)}.
      <a href="${esc(searchUrlPath(relaxed.query))}">See ${relaxed.count === 1 ? 'it' : 'them all'}</a>.</p>`)}
    <form class="notify" method="post" action="/saved-searches">
      <input type="hidden" name="search" value="${canonicalSearchPath({ ...input.query, page: 1 })}">
      <h3>Tell me when one arrives</h3>
      <p>We buy to order. Leave your email and we'll let you know the day we get one in.</p>
      <p><label for="notify-email">Email</label><br>
         <input id="notify-email" name="email" type="email" required autocomplete="email"></p>
      <!-- Consent is a RECORD, not a tick: channel, basis, source, timestamp
           and the exact wording version, captured in M9 and re-checked at
           send time. The wording version travels with the form. -->
      <p class="consent"><label><input type="checkbox" name="consent" value="yes" required>
        Email me when a matching car arrives. We won't use your address for anything else,
        and every email has a one-click unsubscribe.</label></p>
      <input type="hidden" name="consent_version" value="notify-me-v1">
      <p><button class="btn btn-primary" type="submit">Notify me</button></p>
    </form>
  </section>`;
}

// ---------------------------------------------------------------- page

export function renderResultsPage(input: ResultsInput): string {
  const { query: q, dealer, vehicles, totalCount, now, theme = DEFAULT_THEME } = input;
  const label = input.labelFor ?? ((_: MultiDimension, v: string) => titleCase(v));

  const indexability = searchIndexability(q, totalCount);
  const canonical = canonicalUrl(dealer.url, canonicalSearchPath(q));
  const page = paginate(q, totalCount);

  const heading = resultsHeading(q, dealer, label);
  const title = `${heading} | ${dealer.name}`;
  const description =
    totalCount > 0
      ? `${totalCount} ${heading.toLowerCase()} at ${dealer.name}. Every car with full MOT history, a provenance check and photographs of anything worth knowing about.`
          .slice(0, 155)
      : `${heading} at ${dealer.name}. Tell us what you're after and we'll let you know when one arrives.`.slice(0, 155);

  const shown = vehicles.length > 0 ? vehicles : (input.fallbackVehicles ?? []);
  const relaxed = vehicles.length === 0 && input.countFor
    ? firstNonEmpty(relaxationLadder(q), input.countFor)
    : null;

  const jsonLd = [
    searchResultsJsonLd(vehicles.map((v) => ({
      url: canonicalUrl(dealer.url, vehicleUrlPath(v)),
      name: vehicleName(v),
    }))),
    dealerJsonLd(dealer),
    breadcrumbJsonLd([
      { name: 'Home', url: dealer.url },
      { name: 'Used cars', url: canonicalUrl(dealer.url, '/used-cars') },
      ...(q.filters.make.length === 1
        ? [{ name: label('make', q.filters.make[0]!), url: canonicalUrl(dealer.url, `/used-cars/${q.filters.make[0]!}`) }]
        : []),
    ]),
  ];
  // Same rule as the VDP: no cost-of-credit figure can reach structured data,
  // because JSON-LD has nowhere to carry the representative example.
  assertNoFinanceFigures(jsonLd);

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<!-- ${esc(indexability.reason)} -->
<meta name="robots" content="${esc(robotsContent(indexability))}">
${page.prevHref ? `<link rel="prev" href="${esc(canonicalUrl(dealer.url, page.prevHref))}">` : ''}
${page.nextHref ? `<link rel="next" href="${esc(canonicalUrl(dealer.url, page.nextHref))}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:url" content="${esc(canonical)}">
<style>${criticalCss(theme)}</style>
<script type="application/ld+json">${renderJsonLd(jsonLd)}</script>
</head>
<body>
<a class="visually-hidden" href="#results">Skip to results</a>
<header class="wrap">
  <nav aria-label="Breadcrumb">
    <a href="/">Home</a> › <a href="/used-cars">Used cars</a>${
      q.filters.make.length === 1
        ? ` › <a href="/used-cars/${esc(q.filters.make[0]!)}">${esc(label('make', q.filters.make[0]!))}</a>`
        : ''}
  </nav>
  <h1 class="results-title">${esc(heading)}</h1>
  <form class="keyword" method="get" action="/used-cars" role="search">
    <label class="visually-hidden" for="q">Search our stock</label>
    <input id="q" name="q" type="search" placeholder="Reg, make or model" value="${esc(q.keyword ?? '')}">
    <button class="btn btn-primary" type="submit">Search</button>
  </form>
</header>

<main class="wrap results-layout">
  ${facetSidebar(input)}

  <div id="results" class="results">
    ${sortBar(q, totalCount, page.from, page.to)}

    ${vehicles.length === 0 ? zeroResults(input, relaxed) : ''}
    ${shown.length > 0 ? `<div class="grid">${shown.map((v) => card(v, now, searchUrlPath(q))).join('')}</div>` : ''}

    ${page.pageCount > 1 ? `<nav class="pager" aria-label="Pagination">
      ${page.prevHref ? `<a class="btn" rel="prev" href="${esc(page.prevHref)}">Previous</a>` : ''}
      <span class="pager-pos">Page ${page.page} of ${page.pageCount}</span>
      ${page.nextHref ? `<a class="btn" rel="next" href="${esc(page.nextHref)}">Next</a>` : ''}
    </nav>` : ''}
  </div>
</main>

<footer class="wrap">
  <p>${esc(dealer.name)} · ${esc(dealer.street)}, ${esc(dealer.locality)}, ${esc(dealer.postcode)}</p>
  <p><a href="/saved-cars">Saved cars</a> · <a href="/initial-disclosure">Initial disclosure</a> · <a href="/complaints-procedure">Complaints procedure</a> · <a href="/privacy-policy">Privacy policy</a> · <a href="/terms">Terms</a></p>
</footer>
<style>.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
</body>
</html>`;
}

export { FACET_LABELS };
