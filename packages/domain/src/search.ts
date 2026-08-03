/**
 * M7 — the public inventory search: query model, URLs, facets and crawl control.
 *
 * Two problems are being solved at once, and they pull against each other.
 *
 * 1. A BUYER wants to filter freely and instantly. Every facet is a real link
 *    so filtering works with JavaScript switched off, and every option carries
 *    its count so nobody clicks into an empty result.
 *
 * 2. A SEARCH ENGINE must not be handed an infinite crawl space. Ten facets
 *    with five values each is 9.7 million URLs of near-identical content, all
 *    competing with each other and with the vehicle pages that actually sell
 *    cars. This is the single most common way a dealer site quietly destroys
 *    its own organic traffic, and it is invisible until it has happened.
 *
 * The resolution is a small allow-list of URL shapes that may be indexed, and
 * `rel="nofollow"` on the links to everything else. Buyers get every filter;
 * crawlers get a few dozen good pages. Both are asserted by test.
 *
 * NOTE ON MONTHLY-PAYMENT SEARCH: it is a large conversion win and it is
 * deliberately absent. A payment figure is a financial promotion under
 * CONC 3.5.3R and cannot render without a representative example, which the
 * search grid has nowhere to put. `assertNoPaymentFilter` makes the omission
 * loud rather than accidental; M8 unlocks it properly.
 */

import { slugify } from './seo.js';
import type { ApprovedPromotion } from './finance.js';

// ---------------------------------------------------------------- the query

export type SortKey = 'relevance' | 'newest' | 'price-asc' | 'price-desc' | 'mileage-asc' | 'year-desc';

export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'relevance', label: 'Most relevant' },
  { key: 'newest', label: 'Just arrived' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'mileage-asc', label: 'Lowest mileage' },
  { key: 'year-desc', label: 'Newest year' },
];

export const DEFAULT_SORT: SortKey = 'relevance';
export const PER_PAGE = 24;

/**
 * The multi-select dimensions, in the order they appear in the sidebar and in
 * a canonical URL. Order is fixed so that two requests for the same filters
 * always produce the same URL, the same canonical tag and the same cache key.
 */
export const MULTI_DIMENSIONS = [
  'make', 'model', 'fuel', 'transmission', 'body', 'colour', 'doors', 'seats',
] as const;
export type MultiDimension = (typeof MULTI_DIMENSIONS)[number];

export interface SearchQuery {
  filters: Readonly<Record<MultiDimension, readonly string[]>>;
  minPricePence: bigint | null;
  maxPricePence: bigint | null;
  minYear: number | null;
  maxMileage: number | null;
  keyword: string | null;
  siteSlug: string | null;
  sort: SortKey;
  page: number;
}

export const EMPTY_QUERY: SearchQuery = {
  filters: { make: [], model: [], fuel: [], transmission: [], body: [], colour: [], doors: [], seats: [] },
  minPricePence: null, maxPricePence: null, minYear: null, maxMileage: null,
  keyword: null, siteSlug: null, sort: DEFAULT_SORT, page: 1,
};

/**
 * Price bands a crawler is allowed to see, in pounds.
 *
 * Free-form price is unbounded crawl space — `?price_max=9999` and
 * `?price_max=10000` are two URLs showing almost the same cars. A buyer may
 * still type any number; only these bands are ever indexed or followed.
 */
export const PRICE_BANDS = [2_000, 4_000, 6_000, 8_000, 10_000, 15_000, 20_000, 30_000, 50_000] as const;

/** Mileage caps a crawler is allowed to see. Same reasoning as `PRICE_BANDS`. */
export const MILEAGE_BANDS = [10_000, 20_000, 40_000, 60_000, 80_000, 100_000] as const;

const MAX_VALUES_PER_DIMENSION = 6;   // beyond this it is a scrape, not a search
const MAX_KEYWORD_LENGTH = 60;
const MAX_PAGE = 50;

type RawParams = Record<string, string | readonly string[] | undefined>;

const asArray = (v: string | readonly string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? [...v] : [v as string];

/** Split on commas so `?fuel=petrol,diesel` and `?fuel=petrol&fuel=diesel` agree. */
const values = (raw: RawParams, key: string): string[] =>
  asArray(raw[key]).flatMap((v) => v.split(',')).map((v) => slugify(v)).filter(Boolean);

const int = (raw: RawParams, key: string): number | null => {
  const first = asArray(raw[key])[0];
  if (first === undefined) return null;
  const n = Number.parseInt(first, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export const PAYMENT_PARAMS = ['monthly', 'ppm', 'payment', 'per_month', 'apr'] as const;

/**
 * A monthly-payment filter may exist ONLY when a representative example does.
 *
 * Searching by monthly payment is one of the largest conversion wins available
 * and the most dangerous facet on the site: the results grid then shows a
 * payment against every car, and CONC 3.5.3R requires a representative example
 * alongside it. M8 supplies the proof — an `ApprovedPromotion`, which can only
 * be constructed from a signed-off, in-date, arithmetically sound example.
 *
 * Passing no promotion is the safe default, so every caller that has not
 * thought about it gets the blocked behaviour.
 */
export function assertNoPaymentFilter(raw: RawParams, promotion?: ApprovedPromotion | null): void {
  if (promotion) return;
  for (const key of PAYMENT_PARAMS) {
    if (raw[key] !== undefined) {
      throw new Error(
        `Monthly-payment search requires an approved representative example: a payment figure is a ` +
        `financial promotion (CONC 3.5.3R) and cannot render without one. Offending parameter: ${key}`,
      );
    }
  }
}

export interface ParsedSearch {
  query: SearchQuery;
  /** Parameters we ignored, so a test can prove nothing silently widened the crawl space. */
  ignored: readonly string[];
}

/**
 * Parse and NORMALISE. Everything downstream — the SQL, the canonical tag, the
 * cache key — uses the output of this function and never the raw URL.
 *
 * Unknown parameters are dropped rather than passed through. A tracking
 * parameter appended by a marketplace must not fork the cache or mint a new
 * indexable URL.
 */
export function parseSearchQuery(
  raw: RawParams,
  pathSegments: readonly string[] = [],
  promotion?: ApprovedPromotion | null,
): ParsedSearch {
  assertNoPaymentFilter(raw, promotion);

  const known = new Set<string>([
    ...MULTI_DIMENSIONS, 'price_min', 'price_max', 'year_min', 'mileage_max', 'q', 'site', 'sort', 'page',
    // Only reachable with an approved promotion; otherwise the assert above threw.
    ...(promotion ? PAYMENT_PARAMS : []),
  ]);
  const ignored = Object.keys(raw).filter((k) => !known.has(k) && raw[k] !== undefined).sort();

  const filters: Record<MultiDimension, string[]> = {
    make: [], model: [], fuel: [], transmission: [], body: [], colour: [], doors: [], seats: [],
  };
  for (const d of MULTI_DIMENSIONS) {
    // Sorted and de-duplicated: `?make=bmw&make=audi` and `?make=audi&make=bmw`
    // are the same search and must not be two cache entries or two URLs.
    filters[d] = [...new Set(values(raw, d))].sort().slice(0, MAX_VALUES_PER_DIMENSION);
  }

  // Path segments win over query parameters: `/used-cars/tesla/model-x` is the
  // canonical shape, and `?make=` on top of it would be a second URL for one page.
  const [pathMake, pathModel] = pathSegments;
  if (pathMake) filters.make = [slugify(pathMake)];
  if (pathMake && pathModel) filters.model = [slugify(pathModel)];

  const pounds = (key: string): bigint | null => {
    const n = int(raw, key);
    return n === null ? null : BigInt(n) * 100n;
  };
  let minPricePence = pounds('price_min');
  let maxPricePence = pounds('price_max');
  // A reversed range returns nothing and reads as a bug to the buyer. Swap it.
  if (minPricePence !== null && maxPricePence !== null && minPricePence > maxPricePence) {
    [minPricePence, maxPricePence] = [maxPricePence, minPricePence];
  }

  const keywordRaw = asArray(raw['q'])[0]?.trim() ?? '';
  const sortRaw = asArray(raw['sort'])[0];
  const site = asArray(raw['site'])[0];

  return {
    ignored,
    query: {
      filters,
      minPricePence,
      maxPricePence,
      minYear: int(raw, 'year_min'),
      maxMileage: int(raw, 'mileage_max'),
      keyword: keywordRaw ? keywordRaw.slice(0, MAX_KEYWORD_LENGTH).replace(/\s+/g, ' ') : null,
      siteSlug: site ? slugify(site) : null,
      sort: SORTS.some((s) => s.key === sortRaw) ? (sortRaw as SortKey) : DEFAULT_SORT,
      page: Math.min(Math.max(int(raw, 'page') ?? 1, 1), MAX_PAGE),
    },
  };
}

// ---------------------------------------------------------------- URLs

const activeDimensions = (q: SearchQuery): MultiDimension[] =>
  MULTI_DIMENSIONS.filter((d) => q.filters[d].length > 0);

/** How many independent constraints the buyer has applied. */
export function filterCount(q: SearchQuery): number {
  return activeDimensions(q).length
    + (q.minPricePence !== null || q.maxPricePence !== null ? 1 : 0)
    + (q.minYear !== null ? 1 : 0)
    + (q.maxMileage !== null ? 1 : 0)
    + (q.keyword ? 1 : 0)
    + (q.siteSlug ? 1 : 0);
}

/**
 * The URL for a query.
 *
 * A single make, or a single make and model, is promoted into the path so that
 * `/used-cars/tesla/model-x` is the ONLY address for that page — there is no
 * `?make=tesla&model=model-x` twin for it to compete with. Those are also the
 * two shapes worth ranking: "used tesla" and "used tesla model x" are how
 * people search. Everything else stays in the query string.
 */
export function searchUrlPath(q: SearchQuery, opts: { omitPage?: boolean; omitSort?: boolean } = {}): string {
  const makes = q.filters.make;
  const models = q.filters.model;
  const promoteMake = makes.length === 1 && models.length <= 1;
  const promoteModel = promoteMake && models.length === 1;

  let path = '/used-cars';
  if (promoteMake) path += `/${makes[0]!}`;
  if (promoteModel) path += `/${models[0]!}`;

  const params: [string, string][] = [];
  for (const d of MULTI_DIMENSIONS) {
    if (d === 'make' && promoteMake) continue;
    if (d === 'model' && promoteModel) continue;
    if (q.filters[d].length > 0) params.push([d, q.filters[d].join(',')]);
  }
  if (q.minPricePence !== null) params.push(['price_min', String(Number(q.minPricePence) / 100)]);
  if (q.maxPricePence !== null) params.push(['price_max', String(Number(q.maxPricePence) / 100)]);
  if (q.minYear !== null) params.push(['year_min', String(q.minYear)]);
  if (q.maxMileage !== null) params.push(['mileage_max', String(q.maxMileage)]);
  if (q.keyword) params.push(['q', q.keyword]);
  if (q.siteSlug) params.push(['site', q.siteSlug]);
  if (!opts.omitSort && q.sort !== DEFAULT_SORT) params.push(['sort', q.sort]);
  if (!opts.omitPage && q.page > 1) params.push(['page', String(q.page)]);

  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${path}?${qs}` : path;
}

/**
 * The canonical URL: the same page with the sort order removed.
 *
 * Sorting reorders a set, it does not change it, so every sort of one filter
 * combination is duplicate content. The page number is KEPT: canonicalising
 * page 2 to page 1 tells Google page 2 does not exist, which is a well-known
 * way to lose deep listings.
 */
export const canonicalSearchPath = (q: SearchQuery): string => searchUrlPath(q, { omitSort: true });

// ---------------------------------------------------------------- crawl control

export interface Indexability {
  index: boolean;
  follow: boolean;
  reason: string;
}

export const robotsContent = (i: Indexability): string =>
  `${i.index ? 'index' : 'noindex'}, ${i.follow ? 'follow' : 'nofollow'}`;

/**
 * The only facets that may appear on an indexable URL alongside a make.
 *
 * Chosen on search intent, not on what is technically possible. Colour, doors
 * and seats are how buyers narrow a list once they are already on the site —
 * they are not how anybody arrives from Google.
 */
export const INDEXABLE_REFINEMENTS = new Set<MultiDimension>(['fuel', 'transmission', 'body']);

const inBand = (pence: bigint | null, bands: readonly number[]): boolean =>
  pence === null || bands.includes(Number(pence) / 100);

/**
 * Whether this results URL may be indexed.
 *
 * The allow-list, deliberately small:
 *   - all stock
 *   - one make
 *   - one make + one model
 *   - one make (or make+model) plus ONE band-aligned refinement
 * and in every case only with enough stock to be worth a page.
 *
 * `follow` stays true almost everywhere. A noindex page still passes crawlers
 * through to the vehicle pages, which are the pages that actually earn rankings.
 * The one exception is a keyword search, which is unbounded and must be a
 * dead end for a crawler.
 */
export function searchIndexability(q: SearchQuery, resultCount: number, minimumForIndex = 3): Indexability {
  if (q.keyword) {
    return { index: false, follow: false, reason: 'keyword search — unbounded URL space, must not be crawled' };
  }
  if (q.page > 1) {
    // Every vehicle has its own URL in the sitemap, so nothing is orphaned by
    // this. Without it, page 7 of a four-facet filter becomes an indexable page.
    return { index: false, follow: true, reason: 'paginated page — vehicles are indexed individually' };
  }
  if (q.sort !== DEFAULT_SORT) {
    return { index: false, follow: true, reason: 'sorted view — same set, different order; canonical drops the sort' };
  }
  if (q.siteSlug) {
    return { index: false, follow: true, reason: 'site filter — an internal convenience, not a landing page' };
  }
  if (!inBand(q.minPricePence, PRICE_BANDS) || !inBand(q.maxPricePence, PRICE_BANDS)) {
    return { index: false, follow: false, reason: 'off-band price — free-form ranges are unbounded URL space' };
  }
  if (q.maxMileage !== null && !MILEAGE_BANDS.includes(q.maxMileage as (typeof MILEAGE_BANDS)[number])) {
    return { index: false, follow: false, reason: 'off-band mileage — free-form ranges are unbounded URL space' };
  }

  const dims = activeDimensions(q);
  const makes = q.filters.make.length;
  const models = q.filters.model.length;
  if (dims.some((d) => q.filters[d].length > 1)) {
    return { index: false, follow: true, reason: 'multi-select within a dimension — combinatorial, not a landing page' };
  }
  if (models > 0 && makes !== 1) {
    return { index: false, follow: true, reason: 'model without exactly one make — ambiguous page' };
  }

  // Only these dimensions are worth a page of their own on top of a make.
  // "Used electric BMW" and "used automatic BMW" are real searches with real
  // intent. "Used white BMW" and "used 5-door BMW" are not — they are how a
  // dealer site ends up with 400 thin pages competing with each other.
  const refinementDims = dims.filter((d) => d !== 'make' && d !== 'model');
  if (refinementDims.some((d) => !INDEXABLE_REFINEMENTS.has(d))) {
    return { index: false, follow: true, reason: 'refined on a low-intent facet — not worth a page of its own' };
  }

  const refinements = refinementDims.length
    + (q.minPricePence !== null || q.maxPricePence !== null ? 1 : 0)
    + (q.minYear !== null ? 1 : 0)
    + (q.maxMileage !== null ? 1 : 0);

  if (refinements > 1) {
    return { index: false, follow: true, reason: 'two or more refinements — combinatorial crawl space' };
  }
  if (refinements === 1 && makes === 0) {
    return { index: false, follow: true, reason: 'refinement without a make — too generic to rank' };
  }
  if (resultCount < minimumForIndex) {
    return { index: false, follow: true, reason: `only ${resultCount} matching — below the thin-content threshold` };
  }
  return {
    index: true,
    follow: true,
    reason: models ? 'make and model landing page' : makes ? 'make landing page' : 'all stock',
  };
}

/**
 * `rel` for a facet link.
 *
 * A page we would not index is a page we do not want crawled *into*. The
 * buyer's link is identical either way — this only speaks to robots.
 */
export const facetLinkRel = (target: SearchQuery, expectedCount: number): string | null =>
  searchIndexability(target, expectedCount).index ? null : 'nofollow';

// ---------------------------------------------------------------- facets

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
  /** Zero results and not currently selected — shown with its count, not hidden. */
  disabled: boolean;
  href: string;
  rel: string | null;
}

export interface FacetGroup {
  dimension: MultiDimension;
  label: string;
  options: readonly FacetOption[];
}

export const FACET_LABELS: Readonly<Record<MultiDimension, string>> = {
  make: 'Make', model: 'Model', fuel: 'Fuel', transmission: 'Gearbox',
  body: 'Body style', colour: 'Colour', doors: 'Doors', seats: 'Seats',
};

/** Toggle one value of one dimension, returning a NEW query reset to page 1. */
export function toggleFilter(q: SearchQuery, dimension: MultiDimension, value: string): SearchQuery {
  const current = q.filters[dimension];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value].sort();
  const filters = { ...q.filters, [dimension]: next };
  // Changing the make invalidates any model chosen under the old one.
  if (dimension === 'make') filters.model = [];
  // Page 1: a filter change makes the old page number meaningless, and landing
  // a buyer on "page 4 of 2" is the most common filtering bug there is.
  return { ...q, filters, page: 1 };
}

export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

/**
 * Build the sidebar.
 *
 * Counts come from the same query that produced the results, so they are never
 * stale relative to the grid. An option with no matches is DISABLED AND STILL
 * SHOWN — hiding it makes the sidebar flicker as options appear and vanish, and
 * a buyer cannot tell whether "Estate" is missing because there are none or
 * because they mis-filtered.
 */
export function buildFacets(
  q: SearchQuery,
  counts: Partial<Record<MultiDimension, readonly FacetCount[]>>,
): FacetGroup[] {
  const groups: FacetGroup[] = [];
  for (const dimension of MULTI_DIMENSIONS) {
    const available = counts[dimension];
    if (!available || available.length === 0) continue;
    // Model is meaningless until a make is chosen — 400 models is not a filter.
    if (dimension === 'model' && q.filters.make.length !== 1) continue;

    const options = available.map((c): FacetOption => {
      const selected = q.filters[dimension].includes(c.value);
      const target = toggleFilter(q, dimension, c.value);
      return {
        value: c.value,
        label: c.label,
        count: c.count,
        selected,
        disabled: c.count === 0 && !selected,
        href: searchUrlPath(target),
        rel: facetLinkRel(target, c.count),
      };
    });
    groups.push({ dimension, label: FACET_LABELS[dimension], options });
  }
  return groups;
}

/**
 * Manufacturer paint names collapsed to the colour a buyer actually filters by.
 *
 * "Cosmos Black", "Frozen White", "Infra Red", "Moonstone Grey" — every marque
 * invents its own names, so an un-normalised colour facet is a list of thirty
 * options with one car behind each, which is not a filter. The full paint name
 * still appears on the vehicle page, where it is what the buyer wants to read.
 *
 * Order matters: "Metallic Black" must not match "Metal", and "Grey" is checked
 * before "Green" so "Greystone" cannot land in the wrong bucket.
 */
const BASE_COLOURS: readonly [string, readonly string[]][] = [
  ['Black', ['black', 'ebony', 'onyx', 'obsidian', 'panther', 'carbon']],
  ['White', ['white', 'alpine', 'polar', 'glacier', 'ice', 'pearl']],
  ['Silver', ['silver', 'aluminium', 'platinum', 'chrome']],
  ['Grey', ['grey', 'gray', 'graphite', 'granite', 'slate', 'gunmetal', 'anthracite', 'quartz', 'moonstone']],
  ['Blue', ['blue', 'navy', 'cobalt', 'azure', 'indigo', 'sapphire', 'reef']],
  ['Red', ['red', 'crimson', 'scarlet', 'burgundy', 'maroon', 'ruby', 'flame']],
  ['Green', ['green', 'emerald', 'olive', 'jade', 'british racing']],
  ['Silver', ['metallic']],
  ['Brown', ['brown', 'bronze', 'chestnut', 'mocha', 'coffee', 'walnut']],
  ['Beige', ['beige', 'sand', 'champagne', 'cream', 'ivory', 'gold']],
  ['Orange', ['orange', 'copper', 'amber', 'sunset']],
  ['Yellow', ['yellow', 'lime']],
  ['Purple', ['purple', 'violet', 'plum', 'aubergine']],
];

export function baseColour(paintName: string | null | undefined): string | null {
  if (!paintName) return null;
  const name = paintName.toLowerCase();
  for (const [base, words] of BASE_COLOURS) {
    if (words.some((w) => name.includes(w))) return base;
  }
  return 'Other';
}

/** The "you have filtered by" chips, each removing exactly one constraint. */
export interface AppliedFilter { label: string; removeHref: string }

export function appliedFilters(q: SearchQuery, labelFor: (d: MultiDimension, v: string) => string = (_, v) => v): AppliedFilter[] {
  const out: AppliedFilter[] = [];
  for (const d of MULTI_DIMENSIONS) {
    for (const v of q.filters[d]) {
      out.push({ label: labelFor(d, v), removeHref: searchUrlPath(toggleFilter(q, d, v)) });
    }
  }
  const money = (p: bigint): string => `£${(Number(p) / 100).toLocaleString('en-GB')}`;
  if (q.minPricePence !== null || q.maxPricePence !== null) {
    const label = q.minPricePence !== null && q.maxPricePence !== null
      ? `${money(q.minPricePence)}–${money(q.maxPricePence)}`
      : q.maxPricePence !== null ? `Under ${money(q.maxPricePence)}` : `Over ${money(q.minPricePence!)}`;
    out.push({ label, removeHref: searchUrlPath({ ...q, minPricePence: null, maxPricePence: null, page: 1 }) });
  }
  if (q.minYear !== null) out.push({ label: `${q.minYear} or newer`, removeHref: searchUrlPath({ ...q, minYear: null, page: 1 }) });
  if (q.maxMileage !== null) {
    out.push({
      label: `Under ${q.maxMileage.toLocaleString('en-GB')} miles`,
      removeHref: searchUrlPath({ ...q, maxMileage: null, page: 1 }),
    });
  }
  if (q.keyword) out.push({ label: `“${q.keyword}”`, removeHref: searchUrlPath({ ...q, keyword: null, page: 1 }) });
  return out;
}

// ---------------------------------------------------------------- pagination

export interface Pagination {
  page: number;
  perPage: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  prevHref: string | null;
  nextHref: string | null;
}

export function paginate(q: SearchQuery, total: number, perPage = PER_PAGE): Pagination {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(q.page, pageCount);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  return {
    page, perPage, pageCount, total, from,
    to: Math.min(page * perPage, total),
    prevHref: page > 1 ? searchUrlPath({ ...q, page: page - 1 }) : null,
    nextHref: page < pageCount ? searchUrlPath({ ...q, page: page + 1 }) : null,
  };
}

// ---------------------------------------------------------------- zero results

export interface Relaxation {
  query: SearchQuery;
  /** Shown to the buyer, in their words, explaining what we widened and why. */
  explanation: string;
}

/**
 * What to show instead of nothing.
 *
 * A zero-result page is where a dealer loses a buyer who was ready to spend.
 * The ladder drops the least important constraint first and stops at the first
 * step that has stock, so the buyer sees the closest real cars rather than an
 * apology. Never a dead end (`02-functional-spec.md` §12.1).
 */
export function relaxationLadder(q: SearchQuery): Relaxation[] {
  const steps: Relaxation[] = [];
  let cur = { ...q, page: 1 };

  if (cur.filters.colour.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, colour: [] } };
    steps.push({ query: cur, explanation: 'in any colour' });
  }
  if (cur.filters.doors.length > 0 || cur.filters.seats.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, doors: [], seats: [] } };
    steps.push({ query: cur, explanation: 'with any number of doors or seats' });
  }
  if (cur.maxMileage !== null) {
    const widened = Math.round((cur.maxMileage * 1.25) / 1000) * 1000;
    cur = { ...cur, maxMileage: widened };
    steps.push({ query: cur, explanation: `up to ${widened.toLocaleString('en-GB')} miles` });
  }
  if (cur.maxPricePence !== null || cur.minPricePence !== null) {
    // 10% is roughly a dealer's negotiating room — a car just over budget is
    // still a car worth showing.
    const widened: SearchQuery = {
      ...cur,
      maxPricePence: cur.maxPricePence === null ? null : (cur.maxPricePence * 110n) / 100n,
      minPricePence: cur.minPricePence === null ? null : (cur.minPricePence * 90n) / 100n,
    };
    cur = widened;
    steps.push({ query: cur, explanation: 'within about 10% of your budget' });
  }
  if (cur.filters.transmission.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, transmission: [] } };
    steps.push({ query: cur, explanation: 'with either gearbox' });
  }
  if (cur.filters.fuel.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, fuel: [] } };
    steps.push({ query: cur, explanation: 'with any fuel type' });
  }
  if (cur.filters.model.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, model: [] } };
    steps.push({ query: cur, explanation: 'across the whole range' });
  }
  if (cur.keyword) {
    cur = { ...cur, keyword: null };
    steps.push({ query: cur, explanation: 'without your search words' });
  }
  if (cur.filters.make.length > 0) {
    cur = { ...cur, filters: { ...cur.filters, make: [] } };
    steps.push({ query: cur, explanation: 'from any manufacturer' });
  }
  return steps;
}

/** Walk the ladder and return the first step that has stock. */
export function firstNonEmpty(
  ladder: readonly Relaxation[],
  countFor: (q: SearchQuery) => number,
): (Relaxation & { count: number }) | null {
  for (const step of ladder) {
    const count = countFor(step.query);
    if (count > 0) return { ...step, count };
  }
  return null;
}

// ---------------------------------------------------------------- demand signal

export interface DemandSignal {
  /** The normalised query, so two spellings of one search aggregate together. */
  canonicalPath: string;
  make: string | null;
  model: string | null;
  maxPricePence: bigint | null;
  keyword: string | null;
  resultCount: number;
  occurredAt: Date;
}

/**
 * What a failed search is worth.
 *
 * "Eleven people looked for an automatic Qashqai under £12,000 last month and
 * we had none" is a buying instruction. It is the reason this table exists and
 * the reason the zero-result page is not just an apology. Recorded only for
 * thin or empty results — logging every search would bury the signal.
 */
export function demandSignal(q: SearchQuery, resultCount: number, occurredAt: Date, threshold = 3): DemandSignal | null {
  if (resultCount >= threshold) return null;
  if (filterCount(q) === 0) return null;   // browsing all stock is not a demand signal
  return {
    canonicalPath: canonicalSearchPath({ ...q, page: 1 }),
    make: q.filters.make[0] ?? null,
    model: q.filters.model[0] ?? null,
    maxPricePence: q.maxPricePence,
    keyword: q.keyword,
    resultCount,
    occurredAt,
  };
}

// ---------------------------------------------------------------- result cards

export type ResultBadge = 'just-arrived' | 'reduced' | 'reserved' | 'low-mileage';

export interface BadgeInput {
  state: string;
  liveSince: Date | null;
  priceReducedAt: Date | null;
  mileage: number | null;
  year: number | null;
}

const DAY = 86_400_000;

/**
 * Badges, capped at two.
 *
 * Three or more on one card and they stop meaning anything — the eye reads a
 * decorated card, not an urgent one.
 */
export function resultBadges(v: BadgeInput, now: Date): ResultBadge[] {
  const out: ResultBadge[] = [];
  if (v.state === 'reserved') out.push('reserved');
  if (v.priceReducedAt && now.getTime() - v.priceReducedAt.getTime() <= 30 * DAY) out.push('reduced');
  if (v.liveSince && now.getTime() - v.liveSince.getTime() <= 7 * DAY) out.push('just-arrived');
  if (v.mileage !== null && v.year !== null) {
    const age = Math.max(1, now.getFullYear() - v.year);
    // The UK average is about 7,400 miles a year (DfT NTS, 2024). Half that is
    // genuinely notable; anything looser is just noise on every card.
    if (v.mileage / age < 3_700) out.push('low-mileage');
  }
  return out.slice(0, 2);
}

export const BADGE_LABELS: Readonly<Record<ResultBadge, string>> = {
  'just-arrived': 'Just arrived',
  reduced: 'Price reduced',
  reserved: 'Reserved',
  'low-mileage': 'Low mileage',
};
