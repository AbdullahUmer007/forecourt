/**
 * M7 — the search results page, audited against its own real output.
 *
 * Same discipline as the VDP suite: run the ACTUAL renderer and assert on the
 * ACTUAL HTML a buyer and a crawler would receive. A fixture would drift.
 *
 * The crawl-control assertions are the ones worth the most here. Everything
 * else on this page can be fixed in an afternoon; an indexed crawl space takes
 * months to unwind.
 */

import { describe, it, expect } from 'vitest';
import { renderResultsPage, resultsHeading, type ResultsInput, type ResultVehicle } from '../../apps/site/src/render/results.js';
import { EMPTY_QUERY, searchUrlPath, type SearchQuery, type MultiDimension } from '../../packages/domain/src/search.js';

const ORIGIN = 'https://www.kenningtoncarsales.co.uk';
const NOW = new Date('2026-08-02T09:00:00Z');

const dealer: ResultsInput['dealer'] = {
  name: 'Kennington Car Sales', url: ORIGIN, logoUrl: `${ORIGIN}/logo.png`,
  telephone: '+441908883940', email: null,
  street: '32-36 Aylesbury Street', locality: 'Milton Keynes',
  region: 'Buckinghamshire', postcode: 'MK2 2BA', country: 'GB',
  latitude: 51.9942, longitude: -0.7361,
  openingHours: [{ days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' }],
  ratingValue: 4.8, reviewCount: 252, priceRange: '££',
};

const vehicle = (over: Partial<ResultVehicle> = {}): ResultVehicle => ({
  id: 'v-1', make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range',
  year: 2022, registration: 'WN22HNL', mileage: 40_470, pricePence: 1_999_900n,
  fuelType: 'Electricity', transmission: 'Automatic', state: 'live',
  liveSince: new Date('2026-07-30'), priceReducedAt: new Date('2026-07-12'),
  thumbnail: {
    url: `${ORIGIN}/i/wn22hnl-640.jpeg`,
    srcset: `${ORIGIN}/i/wn22hnl-320.jpeg 320w, ${ORIGIN}/i/wn22hnl-640.jpeg 640w`,
    alt: '2022 Tesla Model X Dual Motor Long Range, front three-quarter',
  },
  ...over,
});

type QueryOverride = Omit<Partial<SearchQuery>, 'filters'> & {
  filters?: Partial<Record<MultiDimension, string[]>>;
};

const q = (over: QueryOverride = {}): SearchQuery => ({
  ...EMPTY_QUERY, ...over,
  filters: { ...EMPTY_QUERY.filters, ...(over.filters ?? {}) },
});

const facetCounts = {
  make: [
    { value: 'tesla', label: 'Tesla', count: 4 },
    { value: 'bmw', label: 'BMW', count: 6 },
    { value: 'ferrari', label: 'Ferrari', count: 0 },
  ],
  fuel: [
    { value: 'electric', label: 'Electric', count: 4 },
    { value: 'diesel', label: 'Diesel', count: 9 },
  ],
  colour: [{ value: 'white', label: 'White', count: 3 }],
};

const render = (over: Partial<ResultsInput> = {}): string =>
  renderResultsPage({
    query: q({ filters: { make: ['tesla'] } }),
    dealer,
    vehicles: [vehicle(), vehicle({ id: 'v-2', registration: 'WN22HNM', pricePence: 2_149_900n, priceReducedAt: null })],
    totalCount: 30,
    facetCounts,
    now: NOW,
    ...over,
  });

const HTML = render();

// ---------------------------------------------------------------------------
describe('the rendered results page', () => {
  it('renders valid, complete HTML', () => {
    expect(HTML.startsWith('<!doctype html>')).toBe(true);
    expect(HTML.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('ships ZERO JavaScript — every filter is a real link', () => {
    const scripts = [...HTML.matchAll(/<script([^>]*)>/gi)].map((m) => m[1]!);
    for (const attrs of scripts) {
      expect(attrs, `unexpected executable script: ${attrs}`).toMatch(/type="application\/ld\+json"/);
    }
    expect(HTML).not.toContain('<script src');
    expect(HTML).not.toMatch(/\son(click|change|submit)=/i);
  });

  it('stays well inside the page-weight budget', () => {
    expect(Buffer.byteLength(HTML, 'utf8')).toBeLessThan(60_000);
  });

  it('names the filters in the H1 instead of always saying "Used cars"', () => {
    // A results page whose heading never changes is the same failure as a
    // vehicle page carrying the homepage title.
    expect(HTML).toContain('<h1 class="results-title">Used Tesla for sale in Milton Keynes</h1>');
    expect(resultsHeading(q(), dealer)).toBe('Used cars for sale in Milton Keynes');
    // Two-letter slugs uppercase: "VW Golf", never "Vw Golf". A dealer notices.
    expect(resultsHeading(q({ filters: { make: ['vw'], model: ['golf'] }, maxPricePence: 1_500_000n }), dealer))
      .toBe('Used VW Golf under £15,000 for sale in Milton Keynes');
  });

  it('shows every facet option with its count', () => {
    expect(HTML).toMatch(/BMW <span class="facet-count">6<\/span>/);
    expect(HTML).toMatch(/Diesel <span class="facet-count">9<\/span>/);
  });

  it('disables a zero-count option rather than hiding it', () => {
    // Hiding it makes the sidebar flicker and leaves a buyer unable to tell
    // "there are none" from "I mis-filtered".
    expect(HTML).toMatch(/is-disabled[\s\S]{0,120}Ferrari/);
    expect(HTML).toMatch(/<span aria-disabled="true">Ferrari/);
    // And it is NOT a link.
    expect(HTML).not.toMatch(/<a[^>]*>\s*Ferrari/);
  });

  it('marks the current filter for a screen reader, not just visually', () => {
    expect(HTML).toMatch(/aria-current="true"/);
  });

  it('gives each applied filter a chip that removes exactly that one', () => {
    expect(HTML).toContain('class="chip"');
    expect(HTML).toContain('remove this filter');
    expect(HTML).toContain('Clear all');
  });

  it('lets a buyer save a car with JavaScript switched off', () => {
    expect(HTML).toContain('<form class="v-save" method="post" action="/saved-cars">');
    expect(HTML).toContain('name="action" value="save"');
  });

  it('reserves image space so the grid does not shift on load', () => {
    expect(HTML).toMatch(/<img[^>]+width="600"[^>]+height="450"/);
    expect(HTML).toContain('loading="lazy"');
    expect(HTML).toMatch(/<img[^>]+srcset=/);
  });

  it('gives every card image real alt text', () => {
    const alts = [...HTML.matchAll(/<img[^>]+alt="([^"]*)"/g)].map((m) => m[1]!);
    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) expect(alt.length).toBeGreaterThan(10);
  });

  it('badges a reduction and a new arrival, but never more than two', () => {
    expect(HTML).toContain('Price reduced');
    expect(HTML).toContain('Just arrived');
    const perCard = [...HTML.matchAll(/<p class="v-badges">([\s\S]*?)<\/p>/g)];
    for (const m of perCard) {
      expect([...m[1]!.matchAll(/<span class="badge/g)].length).toBeLessThanOrEqual(2);
    }
  });

  it('states honestly how many cars are being shown', () => {
    expect(HTML).toContain('Showing 1–24 of 30 cars');
  });

  it('emits an ItemList of the vehicles actually on the page', () => {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)![1]!;
    const parsed = JSON.parse(ld.replace(/\\u003c/g, '<')) as Record<string, unknown>[];
    const itemList = parsed.find((x) => x['@type'] === 'ItemList')!;
    expect(itemList['numberOfItems']).toBe(2);
    expect(JSON.stringify(itemList)).toContain('/used-cars/tesla/model-x/');
  });

  it('escapes hostile content in a vehicle name', () => {
    const nasty = render({ vehicles: [vehicle({ model: '<img src=x onerror=alert(1)>' })] });
    expect(nasty).not.toContain('<img src=x onerror');
    expect(nasty).toContain('&lt;img src=x onerror');
  });

  it('uses CSS custom properties, not raw hex, in the markup', () => {
    const body = HTML.slice(HTML.indexOf('<body'));
    expect(body).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('shows NO payment figure while the finance module is unbuilt', () => {
    expect(HTML).not.toMatch(/per month|\bpcm\b|% ?APR/i);
  });
});

// ---------------------------------------------------------------------------
describe('crawl control, in the real markup', () => {
  it('indexes a make landing page and self-canonicalises it', () => {
    expect(HTML).toContain('<meta name="robots" content="index, follow">');
    expect(HTML).toContain(`<link rel="canonical" href="${ORIGIN}/used-cars/tesla">`);
  });

  it('drops the sort from the canonical but keeps the page', () => {
    const sorted = render({ query: q({ filters: { make: ['tesla'] }, sort: 'price-desc', page: 2 }) });
    expect(sorted).toContain(`<link rel="canonical" href="${ORIGIN}/used-cars/tesla?page=2">`);
    expect(sorted).toContain('<meta name="robots" content="noindex, follow">');
  });

  it('makes a keyword search a dead end for a crawler', () => {
    const kw = render({ query: q({ keyword: 'cheap red car' }), totalCount: 1, vehicles: [vehicle()] });
    expect(kw).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('nofollows the links into pages it will not index', () => {
    // Colour on top of a make is a second refinement — combinatorial.
    const colourLink = /<a href="[^"]*colour=white[^"]*"([^>]*)>/.exec(HTML)?.[1] ?? '';
    expect(colourLink).toContain('rel="nofollow"');
  });

  it('does not nofollow the links it does want followed', () => {
    // Fuel on top of a make is the one refinement that stays indexable.
    const fuelLink = /<a href="[^"]*fuel=electric[^"]*"([^>]*)>/.exec(HTML)?.[1] ?? '';
    expect(fuelLink).not.toContain('nofollow');
  });

  it('nofollows every sort link except the default', () => {
    const sorts = [...HTML.matchAll(/<a class="sort[^"]*" href="([^"]*)"([^>]*)>/g)];
    expect(sorts.length).toBeGreaterThan(3);
    for (const [, href, attrs] of sorts) {
      if (href!.includes('sort=')) {
        expect(attrs, `sorted view ${href} must not be followed`).toContain('nofollow');
      }
    }
  });

  it('declares prev and next so deep pages are reachable but not indexed', () => {
    const page2 = render({ query: q({ filters: { make: ['tesla'] }, page: 2 }), totalCount: 90 });
    expect(page2).toContain(`<link rel="prev" href="${ORIGIN}/used-cars/tesla">`);
    expect(page2).toContain(`<link rel="next" href="${ORIGIN}/used-cars/tesla?page=3">`);
    expect(page2).toContain('<meta name="robots" content="noindex, follow">');
    expect(page2).toContain('Page 2 of 4');
  });

  it('omits the next link on the last page rather than pointing at nothing', () => {
    const last = render({ query: q({ filters: { make: ['tesla'] }, page: 2 }), totalCount: 30 });
    expect(last).toContain('Page 2 of 2');
    expect(last).not.toContain('rel="next"');
  });

  it('will not index a thin page', () => {
    const thin = render({ totalCount: 2, vehicles: [vehicle()] });
    expect(thin).toContain('<meta name="robots" content="noindex, follow">');
  });

  it('records the indexability reason in the markup, so a human can debug it', () => {
    expect(HTML).toMatch(/<!-- make landing page -->/);
  });
});

// ---------------------------------------------------------------------------
describe('when nothing matches', () => {
  const EMPTY = render({
    query: q({ filters: { make: ['vw'], model: ['golf'], colour: ['red'] } }),
    vehicles: [],
    totalCount: 0,
    countFor: (query) => (query.filters.colour.length === 0 ? 4 : 0),
    fallbackVehicles: [vehicle()],
  });

  it('is never a dead end', () => {
    expect(EMPTY).toContain("We haven't got a match for that today");
    expect(EMPTY).toContain('No cars match');
  });

  it('shows the closest real cars and says what it widened', () => {
    expect(EMPTY).toContain('are 4 cars we have in any colour');
    expect(EMPTY).toContain('class="grid"');   // the fallback cars are actually rendered
  });

  it('offers to tell them when one arrives, with consent as a record', () => {
    // Consent is channel + basis + source + timestamp + WORDING VERSION, and
    // the version has to travel with the form or it cannot be recorded.
    expect(EMPTY).toContain('action="/saved-searches"');
    expect(EMPTY).toContain('name="consent_version" value="notify-me-v1"');
    expect(EMPTY).toMatch(/<input type="checkbox" name="consent"[^>]*required/);
    expect(EMPTY).toContain('one-click unsubscribe');
  });

  it('carries the normalised search, not the raw URL, into the notify form', () => {
    expect(EMPTY).toContain('name="search" value="/used-cars/vw/golf?colour=red"');
  });

  it('never indexes an empty result', () => {
    expect(EMPTY).toContain('content="noindex, follow"');
  });
});

// ---------------------------------------------------------------------------
describe('the facet links themselves', () => {
  it('always point somewhere our own parser accepts', () => {
    const hrefs = [...HTML.matchAll(/<a href="(\/used-cars[^"]*)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      expect(href, `${href} is not a URL we would generate`).toMatch(/^\/used-cars(\/[a-z0-9-]+){0,2}(\?[^"]*)?$/);
    }
  });

  it('toggle off as well as on', () => {
    // The selected make must link to the search WITHOUT it, or a buyer can
    // filter in and never get out without editing the URL.
    const off = searchUrlPath(q());
    expect(HTML).toContain(`href="${off}"`);
  });
});
