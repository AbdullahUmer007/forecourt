/**
 * The home page — M6's last outstanding renderer.
 *
 * Audited the same way as every other page: real renderer output, zero
 * JavaScript, and the same crawl-control rules the results page obeys. The
 * home page is where a dealer's direct traffic lands, so a regression here is
 * a regression in every visit that did not come from Google.
 */

import { describe, it, expect } from 'vitest';
import { renderHomePage, type HomeInput } from '../../apps/site/src/render/home.js';
import { openingStatus, clockLabel } from '../../apps/site/src/render/chrome.js';

const ORIGIN = 'https://www.kenningtoncarsales.co.uk';

const dealer: HomeInput['dealer'] = {
  name: 'Kennington Car Sales', url: ORIGIN, logoUrl: `${ORIGIN}/logo.png`,
  telephone: '+441908883940', email: null, whatsapp: '447477070105',
  street: '32-36 Aylesbury Street', locality: 'Milton Keynes',
  region: 'Buckinghamshire', postcode: 'MK2 2BA', country: 'GB',
  latitude: 51.9942, longitude: -0.7361,
  openingHours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '10:00', closes: '18:00' },
    { days: ['Sunday'], opens: '11:00', closes: '16:00' },
  ],
  ratingValue: 4.8, reviewCount: 252, priceRange: '££',
  fcaReference: '993469', yearsTrading: 18,
};

const input: HomeInput = {
  dealer,
  stockCount: 123,
  fromPricePence: 649_500n,
  justArrived: [
    {
      name: '2022 Tesla Model X', href: '/used-cars/tesla/model-x/2022-wn22hnl',
      pricePence: 1_999_900n, meta: '40,470 miles · Electricity · Automatic',
      thumbUrl: `${ORIGIN}/i/wn22hnl-640.jpeg`, thumbAlt: '2022 Tesla Model X',
    },
  ],
  browseByBody: [{ label: 'SUV', href: '/used-cars?body=suv', count: 34 }],
  browseByMake: [{ label: 'Tesla', href: '/used-cars/tesla', count: 6 }],
  // A Wednesday at 11:00, inside opening hours.
  now: new Date('2026-08-05T11:00:00'),
};

const HTML = renderHomePage(input);

describe('the rendered home page', () => {
  it('renders with no executable JavaScript at all', () => {
    const scripts = [...HTML.matchAll(/<script([^>]*)>/g)].map((m) => m[1] ?? '');
    for (const attrs of scripts) {
      expect(attrs, `unexpected executable script: ${attrs}`).toMatch(/type="application\/ld\+json"/);
    }
    expect(HTML).not.toContain('<script src');
  });

  it('gets a buyer into the stock list in one action', () => {
    // The hero is a GET form onto the results page — no JS, one submit.
    expect(HTML).toMatch(/<form[^>]+action="\/used-cars"/);
    expect(HTML).toContain('role="search"');
  });

  it('states the real stock count rather than a marketing number', () => {
    expect(HTML).toContain('123');
    expect(HTML).toContain('cars in stock today');
  });

  it('shows the lowest price from actual stock', () => {
    expect(HTML).toContain('£6,495');
  });

  it('answers "can I trust them" before it shows the grid', () => {
    // A buyer deciding whether to trust this dealer should not have to scroll
    // past a stock grid to find out.
    const why = HTML.indexOf('Why buy from');
    const arrived = HTML.indexOf('Just arrived');
    expect(why).toBeGreaterThan(-1);
    expect(arrived).toBeGreaterThan(-1);
    expect(why).toBeLessThan(arrived);
  });

  it('shows the review score as a figure, not a sentence', () => {
    expect(HTML).toContain('4.8');
    expect(HTML).toContain('252 reviews');
  });

  it('only links to crawlable URL shapes', () => {
    // Browse-by entries must land on the indexable allow-list — a make, or a
    // band-aligned refinement — never a free-form parameter.
    const hrefs = [...HTML.matchAll(/href="(\/used-cars[^"]*)"/g)].map((m) => m[1]!);
    // Vehicle pages are make/model/slug and are always crawlable; the listing
    // shapes are the constrained ones. Only fuel, transmission and body may
    // refine an indexable URL — colour and the free-form ranges may not.
    const vehiclePage = /^\/used-cars\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;
    const listing = /^\/used-cars(\/[a-z0-9-]+){0,2}(\?(body|fuel|transmission|sort)=[a-z0-9-]+)?$/;
    for (const href of hrefs) {
      expect(vehiclePage.test(href) || listing.test(href), `uncrawlable shape: ${href}`).toBe(true);
    }
  });

  it('never leaks a Raw marker into the markup', () => {
    // `raw()` and `when()` return objects that only the `html` tagged template
    // unwraps. Interpolated into a plain template literal they stringify to
    // "[object Object]" and SILENTLY DROP the content — which is how the
    // dealer's phone number vanished from the enquiry section. Cheap to
    // assert, and it fails loudly instead of quietly losing a CTA.
    expect(HTML).not.toContain('[object Object]');
  });

  it('carries the FCA disclosure in the footer', () => {
    expect(HTML).toContain('993469');
    expect(HTML).toContain('credit broker, not a lender');
  });

  it('never puts a finance figure in structured data', () => {
    // assertNoFinanceFigures throws inside the renderer; this proves the page
    // renders at all, which means it passed.
    expect(HTML).toContain('application/ld+json');
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)![1]!;
    expect(ld).not.toMatch(/apr|monthly|finance/i);
  });

  it('holds up for a dealer with almost no stock', () => {
    // The template must not look broken at 12 cars, and must not invent a
    // count or a price it does not have.
    const small = renderHomePage({
      ...input, stockCount: 0, fromPricePence: null,
      justArrived: [], browseByBody: [], browseByMake: [],
    });
    expect(small).not.toContain('cars in stock today');
    // The rail section is gone; the footer's "just arrived" link legitimately
    // remains, so assert on the section heading rather than the phrase.
    expect(small).not.toContain('<h2>Just arrived</h2>');
    expect(small).toContain('Search stock');
    expect(small).toContain('Why buy from');
  });
});

describe('the masthead opening status', () => {
  it('says when the dealer shuts, while they are open', () => {
    const s = openingStatus(dealer.openingHours, new Date('2026-08-05T11:00:00'));
    expect(s).toEqual({ open: true, label: 'Open until 6pm' });
  });

  it('says when they next open, before opening time', () => {
    const s = openingStatus(dealer.openingHours, new Date('2026-08-05T08:30:00'));
    expect(s).toEqual({ open: false, label: 'Opens 10am' });
  });

  it('rolls to the next day once they have shut', () => {
    const s = openingStatus(dealer.openingHours, new Date('2026-08-05T19:00:00'));
    expect(s).toEqual({ open: false, label: 'Opens 10am tomorrow' });
  });

  it('never claims to be open when there are no hours at all', () => {
    expect(openingStatus([], new Date())).toBeNull();
    expect(openingStatus(undefined, new Date())).toBeNull();
  });

  it('reads times the way a person says them', () => {
    expect(clockLabel('18:00')).toBe('6pm');
    expect(clockLabel('16:30')).toBe('4:30pm');
    expect(clockLabel('10:00')).toBe('10am');
    expect(clockLabel('00:00')).toBe('12am');
  });

  it('pairs the status dot with words, never colour alone', () => {
    // Design system rule 2: a colour never carries meaning on its own.
    expect(HTML).toContain('Open until 6pm');
  });
});
