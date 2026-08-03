/**
 * THE SELF-AUDIT, UPGRADED: real rendered HTML, not a fixture.
 *
 * M6a's self-audit built an approximation of a page and audited that. This one
 * runs the ACTUAL renderer and audits its ACTUAL output — so the gate now
 * covers the markup a buyer would really receive, and a regression in the
 * renderer breaks the build rather than the fixture quietly diverging from it.
 *
 * Also enforces the performance budget by construction: zero JavaScript, and
 * an above-fold weight well inside 500KB.
 */

import { describe, it, expect } from 'vitest';
import { CHECKS, score } from '../../apps/audit/src/checks.mjs';
import { renderVehiclePage, type VdpInput } from '../../apps/site/src/render/vdp.js';
import { resolveTenant, cacheKey, type DomainRecord } from '../../apps/site/src/tenant.js';
import { vehicleUrlPath, canonicalUrl } from '../../packages/domain/src/seo.js';

const ORIGIN = 'https://www.kenningtoncarsales.co.uk';

const dealer: VdpInput['dealer'] = {
  name: 'Kennington Car Sales', url: ORIGIN, logoUrl: `${ORIGIN}/logo.png`,
  telephone: '+441908883940', email: null, whatsapp: '447477070105',
  street: '32-36 Aylesbury Street', locality: 'Milton Keynes',
  region: 'Buckinghamshire', postcode: 'MK2 2BA', country: 'GB',
  latitude: 51.9942, longitude: -0.7361,
  openingHours: [{ days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' }],
  ratingValue: 4.8, reviewCount: 252, priceRange: '££',
};

/** The real Kennington Tesla. */
const vehicle: VdpInput['vehicle'] = {
  make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range',
  year: 2022, registration: 'WN22HNL', vin: null,
  mileage: 40_470, mileageUnit: 'SMI', pricePence: 1_999_900n, currency: 'GBP',
  colour: 'White', fuelType: 'Electricity', transmission: 'Automatic',
  bodyStyle: 'SUV', doors: 5, seats: 7, engineCc: null, powerBhp: null,
  co2Gkm: 0, formerKeepers: 1, state: 'live',
  imageUrls: [`${ORIGIN}/i/wn22hnl-1440.avif`],
  description: 'One owner from new, two keys, battery health 93.2%.',
  url: canonicalUrl(ORIGIN, vehicleUrlPath({ make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range', year: 2022, registration: 'WN22HNL' })),
  stockNumber: 'KEN-0142', keyCount: 2,
  serviceHistory: 'Full Tesla service history',
  motExpiresOn: '2027-02-17',
  warranty: '6 months nationwide warranty',
};

const media: VdpInput['media'] = [
  {
    alt: '2022 Tesla Model X Dual Motor Long Range, front three-quarter',
    isDamage: false,
    variants: [320, 640, 960, 1440].flatMap((w) =>
      (['avif', 'webp', 'jpeg'] as const).map((format) => ({ width: w, format, url: `${ORIGIN}/i/wn22hnl-${w}.${format}` })),
    ),
  },
  {
    alt: '2022 Tesla Model X Dual Motor Long Range, kerbed nearside front alloy',
    isDamage: true,
    damageLabel: 'Kerbed nearside front alloy',
    variants: [640].flatMap((w) =>
      (['avif', 'webp', 'jpeg'] as const).map((format) => ({ width: w, format, url: `${ORIGIN}/i/wn22hnl-damage-${w}.${format}` })),
    ),
  },
  {
    alt: '2022 Tesla Model X Dual Motor Long Range, stone chip on the bonnet',
    isDamage: true,
    damageLabel: 'Bonnet stone chip',
    variants: [640].flatMap((w) =>
      (['avif', 'webp', 'jpeg'] as const).map((format) => ({ width: w, format, url: `${ORIGIN}/i/wn22hnl-damage2-${w}.${format}` })),
    ),
  },
];

const mot: VdpInput['mot'] = [
  { testDate: '2026-02-14', result: 'PASSED', odometerMiles: 38_940, advisories: ['Nearside front tyre worn close to the legal limit'] },
  { testDate: '2025-02-12', result: 'PASSED', odometerMiles: 25_110, advisories: [] },
];

const input: VdpInput = {
  vehicle, dealer, media, mot,
  provenanceCheckedAt: '2026-07-14',
  provenance: {
    checkedAt: '2026-07-14', provider: 'HPI Check',
    outstandingFinance: false, stolen: false, writtenOff: false,
  },
  batteryHealth: {
    percentOfNew: 93.2, testedOn: '2026-07-24',
    typicalLowPercent: 90, typicalHighPercent: 94, ageYears: 4,
  },
  priceContext: { previousPence: 2_119_900n, changedOn: '2026-07-12' },
  // M8: no longer a string. `finance` takes an ApprovedPromotion, which only
  // `approvePromotion()` can build. Null here, so this suite continues to prove
  // that a page with no approved example shows no cost-of-credit figure at all.
  // The with-finance case lives in rendered-finance.test.ts.
  finance: null,
};
const HTML = renderVehiclePage(input);

// ---------------------------------------------------------------------------
describe('the rendered vehicle detail page', () => {
  it('renders valid, complete HTML', () => {
    expect(HTML.startsWith('<!doctype html>')).toBe(true);
    expect(HTML).toContain('<html lang="en-GB">');
    expect(HTML.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('titles the page with the car, not the dealership', () => {
    const title = /<title>([\s\S]*?)<\/title>/.exec(HTML)![1]!;
    expect(title).toContain('Tesla Model X');
    expect(title).toContain('£19,999');
  });

  it('ships ZERO JavaScript', () => {
    // The budget is <120KB. Zero is the only number that cannot regress by
    // accident, and the page must work without JS regardless.
    const scripts = [...HTML.matchAll(/<script([^>]*)>/gi)].map((m) => m[1]!);
    for (const attrs of scripts) {
      expect(attrs, `unexpected executable script: ${attrs}`).toMatch(/type="application\/ld\+json"/);
    }
    expect(HTML).not.toContain('<script src');
  });

  it('stays well inside the above-fold weight budget', () => {
    // 500KB budget; the HTML itself should be a rounding error against images.
    expect(Buffer.byteLength(HTML, 'utf8')).toBeLessThan(60_000);
  });

  it('puts the gallery, name, price, specs and CTAs above the fold in that order', () => {
    // Class names track the redesign; the ORDER is what this test guards, and
    // that order is fixed by the design brief.
    const order = ['gallery-frame', 'vdp-title', 'vdp-price', 'key-specs', 'cta-row'];
    const positions = order.map((cls) => HTML.indexOf(cls));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('serves AVIF and WebP with a JPEG fallback', () => {
    expect(HTML).toContain('type="image/avif"');
    expect(HTML).toContain('type="image/webp"');
    expect(HTML).toMatch(/<img[^>]+src="[^"]+\.jpeg"/);
  });

  it('reserves image space so nothing shifts on load', () => {
    // CLS budget is 0.1; an unsized hero image is the usual cause of blowing it.
    expect(HTML).toMatch(/<img[^>]+width="1200"[^>]+height="900"/);
    expect(HTML).toContain('aspect-ratio:4/3');
  });

  it('marks the hero as high priority and lazy-loads the rest', () => {
    expect(HTML).toContain('fetchpriority="high"');
    expect(HTML).toContain('loading="lazy"');
  });

  it('gives every image real alt text describing the car', () => {
    const alts = [...HTML.matchAll(/<img[^>]+alt="([^"]*)"/g)].map((m) => m[1]!);
    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) {
      expect(alt.length).toBeGreaterThan(10);
      expect(alt).toContain('Tesla');
    }
  });

  it('shows MOT history with mileage — free public data the competitor hides', () => {
    expect(HTML).toContain('MOT history');
    expect(HTML).toContain('38,940');
    expect(HTML).toContain('Nearside front tyre');
  });

  it('draws the mileage history as a chart as well as a table', () => {
    // The table is the record; the chart is what makes a clocked car obvious
    // in one glance. `forecourt-ui`: every chart has a table view — this one
    // sits directly above its own.
    expect(HTML).toContain('class="mileage-chart"');
    expect(HTML).toMatch(/<svg[^>]+role="img"[^>]+aria-label="[^"]*25,110 miles/);
    expect(HTML).toContain('class="series"');
    // Two MOT readings → two markers.
    expect([...HTML.matchAll(/class="pt"/g)]).toHaveLength(2);
  });

  it('starts the mileage axis at zero', () => {
    // A truncated axis exaggerates every step. On a chart whose entire job is
    // to be trusted, that is not a styling choice.
    const svg = /<svg class="mileage-chart"[\s\S]*?<\/svg>/.exec(HTML)![0];
    expect(svg).toMatch(/<text class="axis"[^>]*>0<\/text>/);
  });

  it('puts no chart at all when there is only one reading', () => {
    // A two-point line needs two points. A single-point "trend" is a lie.
    const single = renderVehiclePage({ ...input, mot: [mot[0]!] });
    expect(single).not.toContain('<svg class="mileage-chart"');
    expect(single).toContain('MOT history');
  });

  it('states what the provenance check actually found', () => {
    // "Provenance checked" asks the buyer to guess what was checked. Naming
    // the three outcomes is the entire value of the check the dealer paid for.
    expect(HTML).toMatch(/Provenance clear/);
    expect(HTML).toContain('No outstanding finance, not stolen, not written off');
    expect(HTML).toContain('HPI Check');
  });

  it('discloses an adverse provenance result instead of hiding it', () => {
    const adverse = renderVehiclePage({
      ...input,
      provenance: { checkedAt: '2026-07-14', provider: 'HPI Check', outstandingFinance: true, stolen: false, writtenOff: false },
    });
    expect(adverse).toContain('Provenance — declared');
    expect(adverse).toContain('outstanding finance recorded');
    expect(adverse).not.toContain('Provenance clear');
  });

  it('never renders an unknown provenance field as a clear', () => {
    const partial = renderVehiclePage({
      ...input,
      provenance: { checkedAt: '2026-07-14', provider: null, outstandingFinance: false, stolen: null, writtenOff: null },
    });
    expect(partial).toContain('Provenance checked');
    expect(partial).toContain('no outstanding finance');
    expect(partial).not.toContain('not recorded stolen');
    expect(partial).not.toContain('not written off');
  });

  it('counts and names the declared marks, and photographs each one', () => {
    expect(HTML).toContain('2 declared marks');
    expect(HTML).toContain('Kerbed nearside front alloy, Bonnet stone chip');
    expect(HTML).toContain('Declared condition');
    expect(HTML).toContain('wn22hnl-damage');
    expect(HTML).toContain('wn22hnl-damage2');
  });

  it('gives the battery percentage the context that makes it mean something', () => {
    // "93.2%" alone tells a buyer nothing. "Typical is 90–94% at four years"
    // is the difference between a number and an answer.
    expect(HTML).toContain('Battery health 93.2%');
    expect(HTML).toContain('Typical is 90–94% at 4 years');
  });

  it('shows no battery block on a car that has no battery', () => {
    const petrol = renderVehiclePage({ ...input, vehicle: { ...vehicle, fuelType: 'Petrol' } });
    expect(petrol).not.toContain('Battery health');
  });

  it('never lets a status colour carry meaning on its own', () => {
    // Every fact mark ships a glyph and a text label beside it.
    const marks = [...HTML.matchAll(/<span class="fact-mark mark-(good|warn)" aria-hidden="true">(.)<\/span>([^<]+)/g)];
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) {
      expect(['✓', '!']).toContain(m[2]);
      expect(m[3]!.trim().length).toBeGreaterThan(3);
    }
  });

  it('renders a proper GB plate, announced once to a screen reader', () => {
    expect(HTML).toContain('aria-label="Registration WN22 HNL"');
    expect(HTML).toContain('<span class="reg-band" aria-hidden="true">UK</span>');
    expect(HTML).toMatch(/class="reg-no" aria-hidden="true">WN22 HNL/);
  });

  it('labels the price and shows a reduction from our own price history', () => {
    expect(HTML).toContain('Cash price');
    expect(HTML).toContain('▾ £1,200 since 12 Jul');
  });

  it('claims nothing about a market guide price we cannot source', () => {
    // cap hpi valuations are contract-blocked. A "priced under guide" claim we
    // cannot evidence is exactly the kind of thing we audit competitors for.
    expect(HTML).not.toMatch(/guide price|under guide|market value/i);
  });

  it('has a click-to-call, a WhatsApp deep link naming the car, and a sticky mobile bar', () => {
    expect(HTML).toContain('href="tel:+441908883940"');
    expect(HTML).toContain('wa.me/447477070105');
    expect(HTML).toMatch(/wa\.me[^"]*text=[^"]*Tesla/);
    expect(HTML).toContain('sticky-cta');
  });

  it('has a skip link and a visible focus style', () => {
    expect(HTML).toContain('Skip to content');
    expect(HTML).toContain(':focus-visible');
  });

  it('honours prefers-reduced-motion', () => {
    expect(HTML).toContain('prefers-reduced-motion');
  });

  it('uses CSS custom properties, not raw hex, in the markup', () => {
    const body = HTML.slice(HTML.indexOf('<body'));
    expect(body).not.toMatch(/#[0-9a-f]{6}/i);
  });

  // ---- compliance -------------------------------------------------------
  it('shows NO payment figure while the finance module is unbuilt', () => {
    // The finance block is supplied via an ApprovedPromotion, which cannot be
    // constructed without a valid representative example. With none: nothing.
    expect(HTML).not.toMatch(/per month|\bpcm\b|% ?APR/i);
  });

  it('never puts a finance figure in the structured data', () => {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)![1]!;
    expect(ld).not.toMatch(/monthlyPayment|"apr"|per month/i);
  });

  it('emits Car, Offer, AutoDealer and BreadcrumbList', () => {
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)![1]!;
    const parsed = JSON.parse(ld.replace(/\\u003c/g, '<'));
    const types = JSON.stringify(parsed);
    for (const t of ['"Car"', '"Offer"', '"AutoDealer"', '"BreadcrumbList"']) {
      expect(types).toContain(t);
    }
  });

  it('links the compliance documents as pages', () => {
    expect(HTML).toContain('/initial-disclosure');
    expect(HTML).toContain('/complaints-procedure');
    expect(HTML).not.toMatch(/href="[^"]*\.pdf"/);
  });

  it('escapes user content so a description cannot inject markup', () => {
    const nasty = renderVehiclePage({
      ...input,
      vehicle: { ...vehicle, description: '<img src=x onerror=alert(1)>' },
    });
    expect(nasty).not.toContain('<img src=x onerror');
    expect(nasty).toContain('&lt;img src=x onerror');
  });
});

// ---------------------------------------------------------------------------
describe('the rendered page, audited by our own tool', () => {
  const strip = (h: string): string =>
    h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const jsonLdTypes = (h: string): string[] => {
    const out: string[] = [];
    for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          const t = (n as Record<string, unknown>)['@type'];
          if (typeof t === 'string') out.push(t);
          Object.values(n).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]!.replace(/\\u003c/g, '<')));
    }
    return out;
  };

  const page = {
    url: vehicle.url, status: 200,
    title: /<title>([\s\S]*?)<\/title>/.exec(HTML)![1]!,
    description: /<meta name="description" content="([^"]*)"/.exec(HTML)?.[1] ?? '',
    jsonLdTypes: jsonLdTypes(HTML), html: HTML, text: strip(HTML),
  };

  // A DISTINCT home page. Passing the VDP as the home page made the
  // `vehicle-page-titles` check fail — correctly, because that check exists to
  // catch exactly the competitor failure where every vehicle page carries the
  // homepage's title. The check was right; the harness was wrong.
  const homePage = {
    url: ORIGIN, status: 200,
    title: 'Used cars in Milton Keynes | Kennington Car Sales',
    description: '120 quality used cars in Milton Keynes, every one provenance checked.',
    jsonLdTypes: ['AutoDealer'],
    html: '<html><head><title>Used cars in Milton Keynes | Kennington Car Sales</title></head><body><a href="tel:+441908883940">Call</a><a href="https://wa.me/447477070105">WhatsApp</a><img src="/h.avif"><img src="/h.webp"></body></html>',
    text: 'Used cars in Milton Keynes. 120 cars in stock.',
  };

  const subject = {
    origin: ORIGIN, host: 'www.kenningtoncarsales.co.uk',
    robots: `User-agent: *\nDisallow: /api/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
    disallow: ['/api/'],
    sitemap: { source: `${ORIGIN}/sitemap.xml`, urls: [vehicle.url] },
    home: homePage, vehiclePages: [page], financePage: null,
    legalPages: [], legalLinks: [{ href: `${ORIGIN}/initial-disclosure`, text: 'Initial disclosure' }],
    checkedLinks: [{ url: vehicle.url, status: 200 }],
    estimatedStockCount: null, isCreditBroker: true,
    auditedAt: new Date('2026-08-02').toISOString(),
  };

  const results = CHECKS.map((c) => c.run(subject));
  const byId = new Map(results.map((r) => [r.id, r]));

  it.each([
    'vehicle-url-structure', 'sold-vehicle-handling', 'structured-data',
    'vehicle-page-titles', 'mot-history', 'provenance',
    'robots-sitemap-host', 'image-formats', 'mobile-contact', 'meta-description',
  ])('the real markup passes %s', (id) => {
    expect(byId.get(id)?.status, byId.get(id)?.finding).toBe('pass');
  });

  it('scores highly on real output', () => {
    expect(score(results)).toBeGreaterThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
describe('host-to-tenant resolution', () => {
  const record: DomainRecord = {
    hostname: 'www.kenningtoncarsales.co.uk', tenantId: 't-kennington', brandId: 'b-1',
    siteId: 's-1', dealerName: 'Kennington Car Sales', verifiedAt: new Date('2026-07-01'), isPrimary: true,
  };
  const lookup = (h: string): DomainRecord | null => (h === record.hostname ? record : null);

  it('resolves a verified host', () => {
    const r = resolveTenant('www.kenningtoncarsales.co.uk', lookup);
    expect(r.ok).toBe(true);
    expect(r.ok && r.tenant.tenantId).toBe('t-kennington');
  });

  it('is case- and port-insensitive', () => {
    expect(resolveTenant('WWW.KenningtonCarSales.co.uk:443', lookup).ok).toBe(true);
  });

  it('404s an unknown host — NEVER falls through to a default tenant', () => {
    // Falling through would serve one dealer's stock on another's domain.
    const r = resolveTenant('someone-elses-domain.co.uk', lookup);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(404);
  });

  it('404s a host that exists but is not verified', () => {
    // Anyone can point a CNAME at us; serving before the TXT challenge passes
    // would let them impersonate a dealer on a domain they do not control.
    const unverified = (h: string): DomainRecord | null =>
      h === 'squatter.example' ? { ...record, hostname: h, verifiedAt: null } : null;
    const r = resolveTenant('squatter.example', unverified);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(404);
  });

  it('refuses a missing Host header', () => {
    expect(resolveTenant(null, lookup).ok).toBe(false);
    expect(resolveTenant('', lookup).ok).toBe(false);
  });

  it('marks non-production hosts as not indexable', () => {
    const dev = (h: string): DomainRecord | null => ({ ...record, hostname: h });
    expect(resolveTenant('dev.kenningtoncarsales.co.uk', dev).ok && true).toBe(true);
    const r = resolveTenant('dev.kenningtoncarsales.co.uk', dev);
    expect(r.ok && r.tenant.allowIndexing).toBe(false);
    const live = resolveTenant('www.kenningtoncarsales.co.uk', lookup);
    expect(live.ok && live.tenant.allowIndexing).toBe(true);
  });

  it('always includes the tenant in a cache key', () => {
    const r = resolveTenant('www.kenningtoncarsales.co.uk', lookup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const key = cacheKey(r.tenant, 'vehicle', 'v-1');
    // A cache key without a tenant serves the previous tenant's HTML to the
    // next request — a leak no RLS policy can catch.
    expect(key).toContain('t-kennington');
    expect(key.startsWith('t:')).toBe(true);
  });
});

describe('the render layer does not silently drop content', () => {
  it('never leaks a Raw marker into the vehicle page', () => {
    // `raw()` and `when()` return objects that only the `html` tagged template
    // unwraps. Interpolated into a plain template literal they stringify to
    // "[object Object]" and silently drop whatever they wrapped — this is how
    // the derivative and the enquiry phone number both disappeared during the
    // redesign. Neither broke a test, because every test asserted on what
    // SHOULD be present rather than on this marker.
    expect(HTML).not.toContain('[object Object]');
  });
});
