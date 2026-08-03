import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  slugify, vehicleUrlPath, canonicalUrl,
  vehicleTitle, vehicleDescription,
  buildSitemap, renderSitemapXml, renderRobotsTxt,
  resolveSoldVehicle, landingPageDecision, robotsMetaFor,
  type SitemapVehicle, type VehicleMetaInput, type SimilarVehicle,
} from './seo.js';
import {
  vehicleJsonLd, dealerJsonLd, breadcrumbJsonLd, vehicleBreadcrumbs,
  renderJsonLd, assertNoFinanceFigures,
  type StructuredVehicle, type StructuredDealer,
} from './structured-data.js';

/** The real Kennington Tesla — the car every M6 fix is measured against. */
const tesla = {
  make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range',
  year: 2022, registration: 'WN22HNL',
};

const meta: VehicleMetaInput = {
  ...tesla, mileage: 40_470, pricePence: 1_999_900n,
  fuelType: 'Electric', transmission: 'Automatic', dealerName: 'Kennington Car Sales',
};

const kennington: StructuredDealer = {
  name: 'Kennington Car Sales',
  url: 'https://www.kenningtoncarsales.co.uk',
  logoUrl: 'https://www.kenningtoncarsales.co.uk/logo.png',
  telephone: '+441908883940',
  email: null,
  street: '32-36 Aylesbury Street',
  locality: 'Milton Keynes',
  region: 'Buckinghamshire',
  postcode: 'MK2 2BA',
  country: 'GB',
  latitude: 51.9942,
  longitude: -0.7361,
  openingHours: [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '10:00', closes: '18:00' }],
  ratingValue: 4.8,
  reviewCount: 252,
  priceRange: '££',
};

const structured: StructuredVehicle = {
  ...tesla, vin: null, mileage: 40_470, mileageUnit: 'SMI',
  pricePence: 1_999_900n, currency: 'GBP', colour: 'White', fuelType: 'Electricity',
  transmission: 'Automatic', bodyStyle: 'SUV', doors: 5, seats: 7,
  engineCc: null, powerBhp: null, co2Gkm: 0, formerKeepers: 1, state: 'live',
  imageUrls: ['https://cdn.example/a.avif'],
  description: 'One owner from new, two keys, battery health 93.2%.',
  url: 'https://www.kenningtoncarsales.co.uk/used-cars/tesla/model-x/dual-motor-long-range-2022-wn22hnl',
};

// ---------------------------------------------------------------------------
describe('slugs and URLs', () => {
  it('produces a readable, shareable vehicle URL', () => {
    // The competitor used /get-car-details?stockId=50111
    expect(vehicleUrlPath(tesla)).toBe('/used-cars/tesla/model-x/dual-motor-long-range-2022-wn22hnl');
  });

  it('strips diacritics rather than dropping the word', () => {
    expect(slugify('Citroën')).toBe('citroen');
    expect(slugify('Škoda')).toBe('skoda');
  });

  it('handles apostrophes without splitting the word', () => {
    expect(slugify("O'Neill")).toBe('oneill');
  });

  it('never leaves stray or doubled hyphens', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        const slug = slugify(s);
        expect(slug).not.toMatch(/^-|-$|--/);
        expect(slug).toMatch(/^[a-z0-9-]*$/);
      }),
      { numRuns: 300 },
    );
  });

  it('always includes the registration, so similar cars never collide', () => {
    const a = vehicleUrlPath({ ...tesla, registration: 'AA11AAA' });
    const b = vehicleUrlPath({ ...tesla, registration: 'BB22BBB' });
    expect(a).not.toBe(b);
  });

  it('degrades gracefully when the spec is missing', () => {
    const path = vehicleUrlPath({ make: null, model: null, derivative: null, year: null, registration: 'AB12CDE' });
    expect(path).toBe('/used-cars/used/car/ab12cde');
    expect(path).not.toContain('null');
    expect(path).not.toContain('//');
  });

  it('builds canonical URLs without doubled slashes', () => {
    expect(canonicalUrl('https://example.com/', '/used-cars')).toBe('https://example.com/used-cars');
    expect(canonicalUrl('https://example.com', 'used-cars')).toBe('https://example.com/used-cars');
  });
});

describe('page metadata', () => {
  it('names the actual car, not the dealership', () => {
    // Every competitor vehicle page carried the homepage's title.
    const title = vehicleTitle(meta);
    expect(title).toContain('Tesla');
    expect(title).toContain('Model X');
    expect(title).toContain('£19,999');
    expect(title).toContain('Kennington Car Sales');
  });

  it('drops the mileage before the price when the title is too long', () => {
    const long = vehicleTitle({ ...meta, derivative: 'Dual Motor Long Range Performance Plus Ludicrous' });
    expect(long).toContain('£19,999');
    expect(long).not.toContain('40,470 miles');
  });

  it('writes a description within the truncation limit', () => {
    const d = vehicleDescription(meta);
    expect(d.length).toBeLessThanOrEqual(155);
    expect(d).toContain('Tesla');
  });

  it('never emits the string null', () => {
    const bare = vehicleDescription({
      ...meta, make: null, model: null, derivative: null, year: null,
      mileage: null, pricePence: null, fuelType: null, transmission: null,
    });
    expect(bare).not.toContain('null');
    expect(bare.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE HEADLINE FIX: 27 URLs and not one of them a car.
// ---------------------------------------------------------------------------
describe('sitemap', () => {
  const now = new Date('2026-08-02T00:00:00Z');
  const stock: SitemapVehicle[] = [
    { ...tesla, updatedAt: now, state: 'live' },
    { make: 'Ford', model: 'Fiesta', derivative: 'ST-Line', year: 2019, registration: 'AB19XYZ', updatedAt: now, state: 'live' },
    { make: 'Audi', model: 'A3', derivative: 'Sport', year: 2020, registration: 'CD20ABC', updatedAt: now, state: 'reserved' },
    { make: 'BMW', model: '320d', derivative: 'M Sport', year: 2018, registration: 'EF18GHI', updatedAt: now, state: 'sold' },
    { make: 'Kia', model: 'Ceed', derivative: '2', year: 2021, registration: 'GH21JKL', updatedAt: now, state: 'in_prep' },
  ];

  it('includes every advertisable vehicle', () => {
    const entries = buildSitemap('https://example.com', stock, [{ path: '/', updatedAt: now, priority: 1 }]);
    const vehicleEntries = entries.filter((e) => e.loc.includes('/used-cars/'));
    // live + reserved, not sold, not in_prep
    expect(vehicleEntries).toHaveLength(3);
    expect(entries.some((e) => e.loc.endsWith('wn22hnl'))).toBe(true);
  });

  it('excludes sold vehicles — a sold car is a redirect, not an entry', () => {
    const entries = buildSitemap('https://example.com', stock);
    expect(entries.some((e) => e.loc.includes('ef18ghi'))).toBe(false);
  });

  it('excludes vehicles not yet advertisable', () => {
    const entries = buildSitemap('https://example.com', stock);
    expect(entries.some((e) => e.loc.includes('gh21jkl'))).toBe(false);
  });

  it('gives vehicles a higher priority than static pages', () => {
    const entries = buildSitemap('https://example.com', stock, [{ path: '/about', updatedAt: now }]);
    const vehicle = entries.find((e) => e.loc.includes('/used-cars/'))!;
    const about = entries.find((e) => e.loc.endsWith('/about'))!;
    expect(vehicle.priority!).toBeGreaterThan(about.priority!);
  });

  it('renders valid XML with escaped entities', () => {
    const xml = renderSitemapXml(buildSitemap('https://example.com', stock));
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('</urlset>');
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });

  it('a 120-car forecourt produces 120 vehicle URLs', () => {
    // Kennington's actual position: ~120 cars, zero in the sitemap.
    const many = Array.from({ length: 120 }, (_, i) => ({
      make: 'Ford', model: 'Focus', derivative: 'Zetec', year: 2020,
      registration: `AB${String(i).padStart(2, '0')}XYZ`, updatedAt: now, state: 'live',
    }));
    expect(buildSitemap('https://example.com', many).filter((e) => e.loc.includes('/used-cars/'))).toHaveLength(120);
  });
});

describe('robots.txt', () => {
  it('points the Sitemap directive at the LIVE host', () => {
    // The competitor's production robots.txt pointed at dev.<domain>.
    const txt = renderRobotsTxt({ origin: 'https://www.kenningtoncarsales.co.uk', allowIndexing: true });
    expect(txt).toContain('Sitemap: https://www.kenningtoncarsales.co.uk/sitemap.xml');
    expect(txt).not.toContain('dev.');
    expect(txt).not.toContain('staging');
  });

  it('blocks everything on an unverified or staging domain', () => {
    const txt = renderRobotsTxt({ origin: 'https://preview.example.com', allowIndexing: false });
    expect(txt).toContain('Disallow: /');
    expect(txt).not.toContain('Sitemap:');
  });

  it('can block AI training crawlers when the dealer wants that', () => {
    const txt = renderRobotsTxt({ origin: 'https://example.com', allowIndexing: true, blockAiTraining: true });
    expect(txt).toContain('User-agent: GPTBot');
    expect(txt).toContain('User-agent: ClaudeBot');
  });
});

// ---------------------------------------------------------------------------
describe('sold-vehicle redirects', () => {
  const sold = { path: '/used-cars/tesla/model-x/x-2022-wn22hnl', make: 'Tesla', model: 'Model X', pricePence: 1_999_900n };
  const candidates: SimilarVehicle[] = [
    { make: 'Tesla', model: 'Model X', derivative: 'Long Range', year: 2021, registration: 'AA21AAA', pricePence: 2_450_000n },
    { make: 'Tesla', model: 'Model X', derivative: 'Standard', year: 2022, registration: 'BB22BBB', pricePence: 2_050_000n },
    { make: 'Ford', model: 'Focus', derivative: 'Zetec', year: 2020, registration: 'CC20CCC', pricePence: 990_000n },
  ];

  it('301s to the closest-priced car of the same model', () => {
    // Never a 200 "Sold Out" page — that is a dead end for a real buyer who
    // clicked through from search, and it accumulates as duplicate thin content.
    const r = resolveSoldVehicle(sold, candidates);
    expect(r.status).toBe(301);
    expect(r.location).toContain('bb22bbb');   // £20,500 is closer than £24,500
  });

  it('falls back to the make landing page when nothing matches the model', () => {
    const r = resolveSoldVehicle(sold, [candidates[2]!]);
    expect(r.status).toBe(301);
    expect(r.location).toBe('/used-cars/tesla');
  });

  it('falls back to all stock when there is nothing at all', () => {
    const r = resolveSoldVehicle({ ...sold, make: null }, []);
    expect(r.status).toBe(301);
    expect(r.location).toBe('/used-cars');
  });

  it('always redirects — never returns a 200 or a bare 404', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...candidates), { maxLength: 5 }), (subset) => {
        const r = resolveSoldVehicle(sold, subset);
        expect(r.status).toBe(301);
        expect(r.location).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });
});

describe('landing pages', () => {
  it('renders but does not index a page with no stock', () => {
    // The competitor had make/location pages INDEXED BY GOOGLE that 404'd.
    const d = landingPageDecision(0);
    expect(d.render).toBe(true);    // never 404 a URL we published
    expect(d.index).toBe(false);    // but do not offer thin content for indexing
    expect(robotsMetaFor(d)).toBe('noindex, follow');
  });

  it('does not index below the threshold', () => {
    expect(landingPageDecision(2).index).toBe(false);
  });

  it('indexes once there is enough stock to justify it', () => {
    const d = landingPageDecision(8);
    expect(d.index).toBe(true);
    expect(robotsMetaFor(d)).toBe('index, follow');
  });

  it('always renders, for any stock count', () => {
    fc.assert(
      // Block body, not a concise one: fast-check reads the arrow's RETURN
      // value as the property result, and expect() does not return true.
      fc.property(fc.nat({ max: 500 }), (n) => {
        expect(landingPageDecision(n).render).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
describe('structured data', () => {
  it('emits a Car with a nested Offer', () => {
    const ld = vehicleJsonLd(structured, kennington);
    expect(ld['@type']).toBe('Car');
    expect(ld['name']).toBe('2022 Tesla Model X Dual Motor Long Range');
    const offer = ld['offers'] as Record<string, unknown>;
    expect(offer['@type']).toBe('Offer');
    expect(offer['price']).toBe('19999.00');
    expect(offer['priceCurrency']).toBe('GBP');
    expect(offer['availability']).toBe('https://schema.org/InStock');
  });

  it('marks a reserved car as limited availability, and a sold one as sold out', () => {
    expect((vehicleJsonLd({ ...structured, state: 'reserved' }, kennington)['offers'] as Record<string, unknown>)['availability'])
      .toBe('https://schema.org/LimitedAvailability');
    expect((vehicleJsonLd({ ...structured, state: 'sold' }, kennington)['offers'] as Record<string, unknown>)['availability'])
      .toBe('https://schema.org/SoldOut');
  });

  it('normalises DVLA fuel wording to schema.org vocabulary', () => {
    // DVLA says ELECTRICITY; schema.org consumers expect Electric.
    expect(vehicleJsonLd(structured, kennington)['fuelType']).toBe('Electric');
  });

  it('records mileage as a QuantitativeValue with a unit', () => {
    const m = vehicleJsonLd(structured, kennington)['mileageFromOdometer'] as Record<string, unknown>;
    expect(m['value']).toBe(40_470);
    expect(m['unitCode']).toBe('SMI');
  });

  it('omits absent fields rather than emitting nulls', () => {
    const ld = vehicleJsonLd({ ...structured, colour: null, vin: null, doors: null }, kennington);
    expect(ld).not.toHaveProperty('color');
    expect(ld).not.toHaveProperty('vehicleIdentificationNumber');
    expect(JSON.stringify(ld)).not.toContain('null');
  });

  it('emits AutoDealer with address, geo, hours and a real rating', () => {
    const ld = dealerJsonLd(kennington);
    expect(ld['@type']).toBe('AutoDealer');   // a LocalBusiness subtype
    expect((ld['address'] as Record<string, unknown>)['postalCode']).toBe('MK2 2BA');
    expect(ld['geo']).toBeDefined();
    expect((ld['aggregateRating'] as Record<string, unknown>)['reviewCount']).toBe(252);
  });

  it('omits aggregateRating when there are no reviews', () => {
    // An invented or zero-count rating is a structured-data violation.
    expect(dealerJsonLd({ ...kennington, ratingValue: null, reviewCount: null })).not.toHaveProperty('aggregateRating');
    expect(dealerJsonLd({ ...kennington, reviewCount: 0 })).not.toHaveProperty('aggregateRating');
  });

  it('builds ordered breadcrumbs', () => {
    const ld = breadcrumbJsonLd(vehicleBreadcrumbs('https://example.com', tesla, structured.url));
    const items = ld['itemListElement'] as Array<Record<string, unknown>>;
    expect(items[0]!['position']).toBe(1);
    expect(items.at(-1)!['name']).toBe('2022 Tesla Model X Dual Motor Long Range');
    expect(items.map((i) => i['position'])).toEqual([1, 2, 3, 4]);
  });

  it('escapes < so a description cannot close the script tag', () => {
    // That is an XSS vector, not a formatting nicety.
    const rendered = renderJsonLd(vehicleJsonLd({ ...structured, description: '</script><script>alert(1)</script>' }, kennington));
    expect(rendered).not.toContain('</script>');
    expect(rendered).toContain('\\u003c');
  });

  it('refuses to emit finance figures in structured data', () => {
    // JSON-LD cannot carry the representative example CONC 3.5.3R requires
    // alongside a monthly payment, so the payment must not appear at all.
    expect(() => assertNoFinanceFigures(vehicleJsonLd(structured, kennington))).not.toThrow();
    expect(() => assertNoFinanceFigures({ '@type': 'Car', monthlyPayment: '289' })).toThrow(/CONC 3\.5\.3R/);
    expect(() => assertNoFinanceFigures({ '@type': 'Offer', description: 'From £289 per month' })).toThrow();
  });
});
