/**
 * M7 — search, facets and crawl control.
 *
 * The tests that matter most here are the crawl-control ones. A faceted search
 * is the easiest way in this business to build ten million near-duplicate URLs
 * without noticing, and the damage is invisible for months.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseSearchQuery, assertNoPaymentFilter, EMPTY_QUERY, searchUrlPath, canonicalSearchPath,
  searchIndexability, robotsContent, facetLinkRel, buildFacets, toggleFilter, appliedFilters,
  paginate, relaxationLadder, firstNonEmpty, demandSignal, resultBadges, filterCount,
  MULTI_DIMENSIONS, PRICE_BANDS, PER_PAGE,
  type SearchQuery, type MultiDimension,
} from './search.js';

/**
 * `filters` is a full Record on SearchQuery, so a naive `Partial<SearchQuery>`
 * makes every partial `{ make: [...] }` in these tests a type error. Overriding
 * the filters type is what lets the helper be used the way it reads.
 */
type QueryOverride = Omit<Partial<SearchQuery>, 'filters'> & {
  filters?: Partial<Record<MultiDimension, string[]>>;
};

const q = (over: QueryOverride = {}): SearchQuery => ({
  ...EMPTY_QUERY,
  ...over,
  filters: { ...EMPTY_QUERY.filters, ...(over.filters ?? {}) },
});

// ---------------------------------------------------------------- parsing
describe('parsing a search URL', () => {
  it('normalises and de-duplicates so one search is one URL', () => {
    const a = parseSearchQuery({ make: ['BMW', 'audi'], fuel: 'Diesel' }).query;
    const b = parseSearchQuery({ make: 'audi,bmw', fuel: ['diesel'] }).query;
    expect(a.filters.make).toEqual(['audi', 'bmw']);
    expect(searchUrlPath(a)).toBe(searchUrlPath(b));
  });

  it('drops unknown parameters instead of passing them through', () => {
    // A marketplace or an ad platform appends its own parameters. Passing them
    // through would fork the cache and mint a new indexable URL per click.
    const { query, ignored } = parseSearchQuery({ make: 'bmw', utm_source: 'autotrader', fbclid: 'x' });
    expect(ignored).toEqual(['fbclid', 'utm_source']);
    expect(searchUrlPath(query)).toBe('/used-cars/bmw');
  });

  it('swaps a reversed price range rather than returning nothing', () => {
    const { query } = parseSearchQuery({ price_min: '20000', price_max: '5000' });
    expect(query.minPricePence).toBe(500_000n);
    expect(query.maxPricePence).toBe(2_000_000n);
  });

  it('caps the number of values in a dimension', () => {
    const { query } = parseSearchQuery({ make: 'a,b,c,d,e,f,g,h,i,j' });
    expect(query.filters.make).toHaveLength(6);
  });

  it('clamps the page number', () => {
    expect(parseSearchQuery({ page: '0' }).query.page).toBe(1);
    expect(parseSearchQuery({ page: '-4' }).query.page).toBe(1);
    expect(parseSearchQuery({ page: '99999' }).query.page).toBe(50);
    expect(parseSearchQuery({ page: 'nonsense' }).query.page).toBe(1);
  });

  it('lets path segments win over query parameters', () => {
    // Otherwise /used-cars/tesla?make=bmw is a second URL for one page.
    const { query } = parseSearchQuery({ make: 'bmw' }, ['tesla', 'model-x']);
    expect(query.filters.make).toEqual(['tesla']);
    expect(query.filters.model).toEqual(['model-x']);
  });

  it('falls back to the default sort rather than trusting the URL', () => {
    expect(parseSearchQuery({ sort: 'price-asc' }).query.sort).toBe('price-asc');
    expect(parseSearchQuery({ sort: 'DROP TABLE' }).query.sort).toBe('relevance');
  });

  // ---- the compliance gate
  it.each(['monthly', 'ppm', 'payment', 'per_month', 'apr'])(
    'refuses a %s filter without an approved representative example', (key) => {
      // M8 supplies the unlock: an ApprovedPromotion, which can only be built
      // from a signed-off, in-date, arithmetically sound example. No promotion
      // is the safe default, so a caller that has not thought about it is
      // blocked. The unlocked path is asserted in rendered-finance.test.ts.
      expect(() => assertNoPaymentFilter({ [key]: '250' })).toThrow(/CONC 3\.5\.3R/);
      expect(() => parseSearchQuery({ [key]: '250' })).toThrow(/representative example/);
    });
});

// ---------------------------------------------------------------- URLs
describe('search URLs', () => {
  it('promotes a single make and model into the path', () => {
    expect(searchUrlPath(q({ filters: { make: ['tesla'] } }))).toBe('/used-cars/tesla');
    expect(searchUrlPath(q({ filters: { make: ['tesla'], model: ['model-x'] } }))).toBe('/used-cars/tesla/model-x');
  });

  it('keeps multiple makes in the query string — a path can only mean one thing', () => {
    expect(searchUrlPath(q({ filters: { make: ['audi', 'bmw'] } }))).toBe('/used-cars?make=audi%2Cbmw');
  });

  it('is stable: the same filters always produce the same URL', () => {
    // Two URLs for one page is two cache entries, two canonical tags and two
    // competing pages in the index.
    fc.assert(fc.property(
      fc.uniqueArray(fc.constantFrom('audi', 'bmw', 'ford', 'kia'), { minLength: 1, maxLength: 3 }),
      fc.uniqueArray(fc.constantFrom('petrol', 'diesel', 'electric'), { maxLength: 2 }),
      (makes, fuels) => {
        const forwards = q({ filters: { make: [...makes].sort(), fuel: [...fuels].sort() } });
        const backwards = q({ filters: { make: [...makes].reverse().sort(), fuel: [...fuels].reverse().sort() } });
        expect(searchUrlPath(forwards)).toBe(searchUrlPath(backwards));
      },
    ));
  });

  it('round-trips: parsing a URL we generated reproduces the query', () => {
    fc.assert(fc.property(
      fc.record({
        make: fc.uniqueArray(fc.constantFrom('audi', 'bmw', 'ford'), { maxLength: 2 }),
        fuel: fc.uniqueArray(fc.constantFrom('petrol', 'diesel'), { maxLength: 2 }),
        maxPrice: fc.option(fc.constantFrom(...PRICE_BANDS), { nil: undefined }),
        page: fc.integer({ min: 1, max: 5 }),
      }),
      (spec) => {
        const original = q({
          filters: { make: [...spec.make].sort(), fuel: [...spec.fuel].sort() },
          maxPricePence: spec.maxPrice === undefined ? null : BigInt(spec.maxPrice) * 100n,
          page: spec.page,
        });
        const url = searchUrlPath(original);
        const [path, search = ''] = url.split('?');
        const segments = path!.replace('/used-cars', '').split('/').filter(Boolean);
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(search)) params[k] = v;
        const reparsed = parseSearchQuery(params, segments).query;
        expect(searchUrlPath(reparsed)).toBe(url);
      },
    ));
  });

  it('drops the sort from the canonical but keeps the page', () => {
    const sorted = q({ filters: { make: ['bmw'] }, sort: 'price-asc', page: 3 });
    // Sorting reorders a set; it does not change it.
    expect(canonicalSearchPath(sorted)).toBe('/used-cars/bmw?page=3');
    // Canonicalising page 3 to page 1 tells Google page 3 does not exist.
    expect(canonicalSearchPath(sorted)).toContain('page=3');
  });
});

// ---------------------------------------------------------------- crawl control
describe('crawl control', () => {
  const many = 40;

  it('indexes the handful of shapes worth ranking', () => {
    expect(searchIndexability(q(), many).index).toBe(true);
    expect(searchIndexability(q({ filters: { make: ['tesla'] } }), many).index).toBe(true);
    expect(searchIndexability(q({ filters: { make: ['tesla'], model: ['model-x'] } }), many).index).toBe(true);
    expect(searchIndexability(q({ filters: { make: ['tesla'], fuel: ['electric'] } }), many).index).toBe(true);
  });

  it('refuses to index a combinatorial crawl space', () => {
    const twoRefinements = q({ filters: { make: ['tesla'], fuel: ['electric'], body: ['suv'] } });
    expect(searchIndexability(twoRefinements, many).index).toBe(false);

    const multiSelect = q({ filters: { make: ['audi', 'bmw'] } });
    expect(searchIndexability(multiSelect, many).index).toBe(false);

    const sorted = q({ filters: { make: ['tesla'] }, sort: 'price-desc' });
    expect(searchIndexability(sorted, many).index).toBe(false);

    const deep = q({ filters: { make: ['tesla'] }, page: 4 });
    expect(searchIndexability(deep, many).index).toBe(false);
  });

  it('keeps following almost everything it will not index', () => {
    // A noindex page still passes crawlers through to the vehicle pages, which
    // are what actually earn rankings.
    const sorted = q({ filters: { make: ['tesla'] }, sort: 'price-desc' });
    expect(robotsContent(searchIndexability(sorted, many))).toBe('noindex, follow');
  });

  it('makes a keyword search a dead end for a crawler', () => {
    // Unbounded: every typo is a new URL.
    const kw = q({ keyword: 'red car cheap' });
    expect(robotsContent(searchIndexability(kw, many))).toBe('noindex, nofollow');
  });

  it('only indexes band-aligned price and mileage', () => {
    const onBand = q({ filters: { make: ['bmw'] }, maxPricePence: 10_000_00n });
    const offBand = q({ filters: { make: ['bmw'] }, maxPricePence: 9_999_00n });
    expect(searchIndexability(onBand, many).index).toBe(true);
    expect(searchIndexability(offBand, many).index).toBe(false);
    expect(searchIndexability(offBand, many).follow).toBe(false);
  });

  it('will not index a thin page', () => {
    expect(searchIndexability(q({ filters: { make: ['tesla'] } }), 2).index).toBe(false);
    expect(searchIndexability(q({ filters: { make: ['tesla'] } }), 3).index).toBe(true);
  });

  it('will not index a low-intent facet, even as the only refinement', () => {
    // "Used electric BMW" is a search. "Used white BMW" is not.
    expect(searchIndexability(q({ filters: { make: ['bmw'], fuel: ['electric'] } }), many).index).toBe(true);
    expect(searchIndexability(q({ filters: { make: ['bmw'], colour: ['white'] } }), many).index).toBe(false);
    expect(searchIndexability(q({ filters: { make: ['bmw'], doors: ['5'] } }), many).index).toBe(false);
  });

  it('nofollows the links into everything it will not index', () => {
    expect(facetLinkRel(q({ filters: { make: ['tesla'] } }), many)).toBeNull();
    expect(facetLinkRel(q({ filters: { make: ['tesla'], colour: ['white'] } }), many)).toBe('nofollow');
  });

  it('never indexes more than a bounded number of URL shapes', () => {
    // The real assertion: enumerate a realistic slice of the space and prove
    // the indexable count stays tiny. This is the test that would have caught
    // the competitor's estate before it was built.
    const makes = ['audi', 'bmw', 'ford', 'kia', 'tesla'];
    const fuels = ['petrol', 'diesel', 'electric', 'hybrid'];
    const colours = ['black', 'white', 'grey', 'blue', 'red'];
    let total = 0;
    let indexable = 0;
    for (const make of [null, ...makes]) {
      for (const fuel of [null, ...fuels]) {
        for (const colour of [null, ...colours]) {
          for (const sort of ['relevance', 'price-asc'] as const) {
            for (const page of [1, 2]) {
              total++;
              const query = q({
                filters: {
                  make: make ? [make] : [],
                  fuel: fuel ? [fuel] : [],
                  colour: colour ? [colour] : [],
                },
                sort, page,
              });
              if (searchIndexability(query, many).index) indexable++;
            }
          }
        }
      }
    }
    expect(total).toBe(720);
    // 1 (all stock) + 5 makes + 5 makes × 4 fuels = 26.
    // Colour is not an indexable refinement — "used white BMW" is not how
    // anyone arrives from a search engine, and it would add 25 thin pages.
    expect(indexable).toBe(26);
    expect(indexable / total).toBeLessThan(0.04);
  });
});

// ---------------------------------------------------------------- facets
describe('facets', () => {
  const counts = {
    make: [
      { value: 'tesla', label: 'Tesla', count: 4 },
      { value: 'bmw', label: 'BMW', count: 0 },
    ],
    fuel: [{ value: 'electric', label: 'Electric', count: 4 }],
  };

  it('shows a zero-count option, disabled, rather than hiding it', () => {
    const [makeGroup] = buildFacets(q(), counts);
    const bmw = makeGroup!.options.find((o) => o.value === 'bmw')!;
    expect(bmw.count).toBe(0);
    expect(bmw.disabled).toBe(true);
  });

  it('keeps a selected option clickable even at zero, so it can be undone', () => {
    const selected = q({ filters: { make: ['bmw'] } });
    const [makeGroup] = buildFacets(selected, counts);
    const bmw = makeGroup!.options.find((o) => o.value === 'bmw')!;
    expect(bmw.selected).toBe(true);
    expect(bmw.disabled).toBe(false);
  });

  it('hides the model facet until exactly one make is chosen', () => {
    const withModels = { ...counts, model: [{ value: 'model-x', label: 'Model X', count: 4 }] };
    expect(buildFacets(q(), withModels).some((g) => g.dimension === 'model')).toBe(false);
    expect(buildFacets(q({ filters: { make: ['tesla'] } }), withModels).some((g) => g.dimension === 'model')).toBe(true);
  });

  it('resets to page 1 when a filter changes', () => {
    // Landing on "page 4 of 2" is the classic faceted-search bug.
    const deep = q({ filters: { make: ['tesla'] }, page: 4 });
    expect(toggleFilter(deep, 'fuel', 'electric').page).toBe(1);
  });

  it('clears the model when the make changes', () => {
    const withModel = q({ filters: { make: ['tesla'], model: ['model-x'] } });
    expect(toggleFilter(withModel, 'make', 'bmw').filters.model).toEqual([]);
  });

  it('toggles off as well as on', () => {
    const on = toggleFilter(q(), 'fuel', 'electric');
    expect(on.filters.fuel).toEqual(['electric']);
    expect(toggleFilter(on, 'fuel', 'electric').filters.fuel).toEqual([]);
  });

  it('gives every applied filter a link that removes exactly that one', () => {
    const applied = q({
      filters: { make: ['tesla'], fuel: ['electric'] },
      maxPricePence: 2_000_000n, maxMileage: 40_000,
    });
    const chips = appliedFilters(applied);
    expect(chips.map((c) => c.label)).toEqual(['tesla', 'electric', 'Under £20,000', 'Under 40,000 miles']);
    // Removing the price leaves the other three constraints intact.
    const priceChip = chips.find((c) => c.label === 'Under £20,000')!;
    expect(priceChip.removeHref).toContain('fuel=electric');
    expect(priceChip.removeHref).not.toContain('price_max');
    expect(priceChip.removeHref).toContain('mileage_max=40000');
  });
});

// ---------------------------------------------------------------- pagination
describe('pagination', () => {
  it('describes the window honestly', () => {
    const p = paginate(q({ page: 2 }), 60);
    expect(p.pageCount).toBe(Math.ceil(60 / PER_PAGE));
    expect(p.from).toBe(PER_PAGE + 1);
    expect(p.to).toBe(Math.min(2 * PER_PAGE, 60));
  });

  it('never strands a buyer past the last page', () => {
    const p = paginate(q({ page: 40 }), 10);
    expect(p.page).toBe(1);
    expect(p.nextHref).toBeNull();
  });

  it('reads as 0 of 0 when there is nothing, not 1 of 0', () => {
    const p = paginate(q(), 0);
    expect(p.from).toBe(0);
    expect(p.to).toBe(0);
    expect(p.pageCount).toBe(1);
  });
});

// ---------------------------------------------------------------- zero results
describe('the zero-result ladder', () => {
  const tight = q({
    filters: { make: ['vw'], model: ['golf'], fuel: ['diesel'], transmission: ['automatic'], colour: ['red'] },
    maxPricePence: 800_000n,
    maxMileage: 60_000,
  });

  it('drops the least important constraint first and the make last', () => {
    const ladder = relaxationLadder(tight);
    expect(ladder[0]!.explanation).toBe('in any colour');
    expect(ladder.at(-1)!.explanation).toBe('from any manufacturer');
  });

  it('never widens into a search with more constraints than it started with', () => {
    const ladder = relaxationLadder(tight);
    let previous = filterCount(tight);
    for (const step of ladder) {
      const now = filterCount(step.query);
      expect(now).toBeLessThanOrEqual(previous);
      previous = now;
    }
  });

  it('widens the budget by about 10%, because a dealer has that much room', () => {
    const budget = q({ maxPricePence: 1_000_000n });
    const step = relaxationLadder(budget).find((s) => s.explanation.includes('10%'))!;
    expect(step.query.maxPricePence).toBe(1_100_000n);
  });

  it('stops at the first step with stock', () => {
    const found = firstNonEmpty(relaxationLadder(tight), (query) =>
      query.filters.colour.length === 0 && query.filters.doors.length === 0 ? 3 : 0);
    expect(found?.count).toBe(3);
    expect(found?.explanation).toBe('in any colour');
  });

  it('returns null rather than pretending, when we truly have nothing', () => {
    expect(firstNonEmpty(relaxationLadder(tight), () => 0)).toBeNull();
  });
});

// ---------------------------------------------------------------- demand
describe('the demand signal', () => {
  const at = new Date('2026-08-02T10:00:00Z');

  it('records a search that found nothing', () => {
    const signal = demandSignal(q({ filters: { make: ['nissan'], model: ['qashqai'] }, maxPricePence: 1_200_000n }), 0, at);
    expect(signal).not.toBeNull();
    expect(signal!.make).toBe('nissan');
    expect(signal!.canonicalPath).toBe('/used-cars/nissan/qashqai?price_max=12000');
  });

  it('ignores a healthy result — logging everything buries the signal', () => {
    expect(demandSignal(q({ filters: { make: ['nissan'] } }), 12, at)).toBeNull();
  });

  it('ignores unfiltered browsing', () => {
    expect(demandSignal(q(), 0, at)).toBeNull();
  });

  it('records the normalised query, so two spellings aggregate as one', () => {
    const a = demandSignal(parseSearchQuery({ make: 'Nissan', sort: 'price-asc', page: '3' }).query, 0, at);
    const b = demandSignal(parseSearchQuery({ make: 'nissan' }).query, 0, at);
    expect(a!.canonicalPath).toBe(b!.canonicalPath);
  });
});

// ---------------------------------------------------------------- badges
describe('result badges', () => {
  const now = new Date('2026-08-02T00:00:00Z');
  const days = (n: number): Date => new Date(now.getTime() - n * 86_400_000);

  it('marks a genuinely new arrival', () => {
    expect(resultBadges({ state: 'live', liveSince: days(3), priceReducedAt: null, mileage: null, year: null }, now))
      .toContain('just-arrived');
    expect(resultBadges({ state: 'live', liveSince: days(30), priceReducedAt: null, mileage: null, year: null }, now))
      .not.toContain('just-arrived');
  });

  it('marks a recent reduction', () => {
    expect(resultBadges({ state: 'live', liveSince: null, priceReducedAt: days(5), mileage: null, year: null }, now))
      .toContain('reduced');
    expect(resultBadges({ state: 'live', liveSince: null, priceReducedAt: days(90), mileage: null, year: null }, now))
      .not.toContain('reduced');
  });

  it('calls a car low-mileage only when it really is', () => {
    // UK average is about 7,400 miles a year; the badge fires below half that.
    const low = resultBadges({ state: 'live', liveSince: null, priceReducedAt: null, mileage: 12_000, year: 2022 }, now);
    const normal = resultBadges({ state: 'live', liveSince: null, priceReducedAt: null, mileage: 40_000, year: 2022 }, now);
    expect(low).toContain('low-mileage');
    expect(normal).not.toContain('low-mileage');
  });

  it('never shows more than two, or they stop meaning anything', () => {
    const all = resultBadges(
      { state: 'reserved', liveSince: days(1), priceReducedAt: days(1), mileage: 1_000, year: 2022 }, now);
    expect(all).toHaveLength(2);
    expect(all[0]).toBe('reserved');
  });
});

// ---------------------------------------------------------------- invariants
describe('invariants that must hold for every query', () => {
  const arbQuery = fc.record({
    make: fc.uniqueArray(fc.constantFrom('audi', 'bmw', 'tesla'), { maxLength: 2 }),
    fuel: fc.uniqueArray(fc.constantFrom('petrol', 'electric'), { maxLength: 2 }),
    colour: fc.uniqueArray(fc.constantFrom('white', 'black'), { maxLength: 1 }),
    maxPrice: fc.option(fc.integer({ min: 500, max: 99_000 }), { nil: null }),
    keyword: fc.option(fc.constantFrom('golf', 'red'), { nil: null }),
    page: fc.integer({ min: 1, max: 8 }),
  }).map((s): SearchQuery => q({
    filters: { make: [...s.make].sort(), fuel: [...s.fuel].sort(), colour: [...s.colour].sort() },
    maxPricePence: s.maxPrice === null ? null : BigInt(s.maxPrice) * 100n,
    keyword: s.keyword,
    page: s.page,
  }));

  it('a URL never contains a raw space or an unescaped quote', () => {
    fc.assert(fc.property(arbQuery, (query) => {
      const url = searchUrlPath(query);
      expect(url).not.toMatch(/[ "'<>]/);
    }));
  });

  it('the canonical of a canonical is itself', () => {
    fc.assert(fc.property(arbQuery, (query) => {
      const once = canonicalSearchPath(query);
      const [path, search = ''] = once.split('?');
      const segments = path!.replace('/used-cars', '').split('/').filter(Boolean);
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(search)) params[k] = v;
      expect(canonicalSearchPath(parseSearchQuery(params, segments).query)).toBe(once);
    }));
  });

  it('an indexable page always has at most one refinement beyond make and model', () => {
    fc.assert(fc.property(arbQuery, fc.integer({ min: 0, max: 200 }), (query, count) => {
      if (!searchIndexability(query, count).index) return;
      const refinements = MULTI_DIMENSIONS
        .filter((d) => d !== 'make' && d !== 'model')
        .filter((d) => query.filters[d].length > 0).length
        + (query.maxPricePence !== null ? 1 : 0);
      expect(refinements).toBeLessThanOrEqual(1);
      expect(query.keyword).toBeNull();
      expect(query.page).toBe(1);
    }));
  });
});
