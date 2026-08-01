/**
 * Forecourt Dealer Site Audit — check definitions.
 *
 * Each check receives the crawled `site` object and returns:
 *   { id, title, status: 'pass'|'warn'|'fail'|'skip', weight, finding, impact, fix }
 *
 * Zero runtime dependencies. Node 20+.
 */

const ok = (id, title, weight, finding) => ({ id, title, weight, status: 'pass', finding });
const warn = (id, title, weight, finding, impact, fix) => ({ id, title, weight, status: 'warn', finding, impact, fix });
const fail = (id, title, weight, finding, impact, fix) => ({ id, title, weight, status: 'fail', finding, impact, fix });
const skip = (id, title, weight, finding) => ({ id, title, weight, status: 'skip', finding });

// ---------------------------------------------------------------- discovery

/** Does a URL look like an individual vehicle page? */
export function looksLikeVehicleUrl(url) {
  const u = url.toLowerCase();
  return (
    /[?&]stockid=/.test(u) ||
    /[?&]vehicleid=/.test(u) ||
    /[?&]carid=/.test(u) ||
    /\/(vehicle|vehicles|car|cars|stock|used-cars?|usedcars|our-cars)\/[^/?#]+\/[^/?#]+/.test(u) ||
    /\/(vehicle|car|stock)-details?/.test(u) ||
    /\/used\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+/.test(u)
  );
}

/** A vehicle URL that is a readable slug rather than an opaque id. */
export function isSlugUrl(url) {
  if (/[?&](stockid|vehicleid|carid|id)=/i.test(url)) return false;
  const path = url.split('?')[0];
  const last = path.replace(/\/$/, '').split('/').pop() || '';
  // a slug has letters and hyphens; an id is mostly digits
  return /[a-z]/i.test(last) && last.replace(/[^0-9]/g, '').length < last.length / 2;
}

// ---------------------------------------------------------------- checks

export const CHECKS = [
  // ---- Findability -------------------------------------------------------
  {
    id: 'sitemap-exists',
    run(site) {
      const w = 4;
      if (!site.sitemap) {
        return fail('sitemap-exists', 'Sitemap exists', w,
          'No sitemap.xml could be found.',
          'Search engines have to guess what pages exist on your site.',
          'Publish an XML sitemap that regenerates automatically whenever stock changes.');
      }
      return ok('sitemap-exists', 'Sitemap exists', w,
        `Sitemap found with ${site.sitemap.urls.length} URLs.`);
    },
  },

  {
    id: 'sitemap-vehicles',
    run(site) {
      const w = 20; // the single most important check
      if (!site.sitemap) return skip('sitemap-vehicles', 'Vehicles listed in the sitemap', w, 'No sitemap to check.');
      const vehicleUrls = site.sitemap.urls.filter(looksLikeVehicleUrl);
      const stock = site.estimatedStockCount;
      if (vehicleUrls.length === 0) {
        return fail('sitemap-vehicles', 'Vehicles listed in the sitemap', w,
          `The sitemap contains ${site.sitemap.urls.length} URLs and none of them are vehicles${stock ? ` — but the site advertises around ${stock} cars in stock` : ''}.`,
          'For a used-car dealer the individual vehicle pages ARE the website. If none are in the sitemap, none of your stock is being offered to Google.',
          'Generate the sitemap from live stock so every vehicle appears within minutes of going live, and drops out when it sells.');
      }
      if (stock && vehicleUrls.length < stock * 0.7) {
        return warn('sitemap-vehicles', 'Vehicles listed in the sitemap', w,
          `Only ${vehicleUrls.length} vehicle URLs in the sitemap against roughly ${stock} cars in stock.`,
          'A large part of your stock is not being offered to search engines.',
          'Regenerate the sitemap from live stock on every change.');
      }
      return ok('sitemap-vehicles', 'Vehicles listed in the sitemap', w,
        `${vehicleUrls.length} vehicle URLs present in the sitemap.`);
    },
  },

  {
    id: 'vehicle-url-structure',
    run(site) {
      const w = 8;
      if (!site.vehiclePages.length) return skip('vehicle-url-structure', 'Readable vehicle web addresses', w, 'No vehicle pages found to check.');
      const slugged = site.vehiclePages.filter((p) => isSlugUrl(p.url));
      if (slugged.length === 0) {
        const sample = site.vehiclePages[0].url;
        return fail('vehicle-url-structure', 'Readable vehicle web addresses', w,
          `Vehicle pages use opaque identifiers, e.g. ${sample}`,
          'Non-descriptive URLs rank worse, look untrustworthy when shared, and tell nobody what car they point at.',
          'Use readable addresses like /used-cars/tesla/model-x/long-range-2022-wn22hnl.');
      }
      if (slugged.length < site.vehiclePages.length) {
        return warn('vehicle-url-structure', 'Readable vehicle web addresses', w,
          `${site.vehiclePages.length - slugged.length} of ${site.vehiclePages.length} sampled vehicle pages use opaque identifiers.`,
          'Mixed URL structures dilute ranking and confuse crawlers.',
          'Standardise on descriptive slugs with permanent redirects from the old addresses.');
      }
      return ok('vehicle-url-structure', 'Readable vehicle web addresses', w, 'Vehicle pages use descriptive slugs.');
    },
  },

  {
    id: 'sold-vehicle-handling',
    run(site) {
      const w = 12;
      if (!site.vehiclePages.length) return skip('sold-vehicle-handling', 'Sold vehicles handled properly', w, 'No vehicle pages found to check.');
      const soldish = site.vehiclePages.filter(
        (p) => p.status === 200 && /sold\s*out|this vehicle is sold|no longer available|vehicle sold/i.test(p.text)
      );
      if (soldish.length === site.vehiclePages.length && soldish.length > 0) {
        return fail('sold-vehicle-handling', 'Sold vehicles handled properly', w,
          `Every one of the ${soldish.length} vehicle pages sampled returns a "sold" message with a 200 response and no redirect.`,
          'Sold pages accumulate as near-identical dead ends. They waste crawl budget, compete with each other, and send buyers who click through from search to a dead end.',
          'Redirect a sold vehicle to similar live stock in the same price band, and keep a permanent redirect so the ranking is inherited rather than lost.');
      }
      if (soldish.length > 0) {
        return warn('sold-vehicle-handling', 'Sold vehicles handled properly', w,
          `${soldish.length} of ${site.vehiclePages.length} sampled vehicle pages return a "sold" message rather than redirecting.`,
          'Dead pages accumulate over time and dilute the site.',
          'Redirect sold vehicles to similar live stock.');
      }
      return ok('sold-vehicle-handling', 'Sold vehicles handled properly', w, 'No stranded sold-vehicle pages found in the sample.');
    },
  },

  {
    id: 'structured-data',
    run(site) {
      const w = 14;
      const wanted = ['Vehicle', 'Car', 'Product', 'Offer', 'AutoDealer', 'LocalBusiness'];
      const found = new Set();
      for (const page of [site.home, ...site.vehiclePages].filter(Boolean)) {
        for (const t of page.jsonLdTypes || []) found.add(t);
      }
      const relevant = wanted.filter((t) => found.has(t));
      if (found.size === 0) {
        return fail('structured-data', 'Structured data (how Google reads a listing)', w,
          'No JSON-LD structured data was found on the homepage or any vehicle page.',
          'Without it, search engines cannot read price, mileage or availability, you are ineligible for vehicle listing formats, and your results appear as plain blue text next to competitors showing a photo and a price.',
          'Add Vehicle/Car + Product + Offer markup to every vehicle page, and AutoDealer + LocalBusiness to the site.');
      }
      if (relevant.length < 3) {
        return warn('structured-data', 'Structured data (how Google reads a listing)', w,
          `Structured data present but thin — found: ${[...found].join(', ') || 'none relevant'}.`,
          'Partial markup means partial eligibility for rich results.',
          'Add the full Vehicle + Offer + AutoDealer + LocalBusiness + BreadcrumbList set.');
      }
      return ok('structured-data', 'Structured data (how Google reads a listing)', w,
        `Found: ${[...found].join(', ')}.`);
    },
  },

  {
    id: 'vehicle-page-titles',
    run(site) {
      const w = 8;
      if (!site.home || !site.vehiclePages.length) return skip('vehicle-page-titles', 'Unique vehicle page titles', w, 'Not enough pages to compare.');
      const homeTitle = (site.home.title || '').trim();
      const dupes = site.vehiclePages.filter((p) => (p.title || '').trim() === homeTitle && homeTitle);
      if (dupes.length === site.vehiclePages.length && dupes.length > 0) {
        return fail('vehicle-page-titles', 'Unique vehicle page titles', w,
          `Every sampled vehicle page carries the homepage's title: "${homeTitle}".`,
          'If a vehicle page ranks, the search result will not tell anyone which car it is. Duplicate titles also suppress ranking.',
          'Title each vehicle with the car: "2022 Tesla Model X Long Range | 40,470 miles | £19,999 | <Dealer>".');
      }
      if (dupes.length) {
        return warn('vehicle-page-titles', 'Unique vehicle page titles', w,
          `${dupes.length} of ${site.vehiclePages.length} sampled vehicle pages reuse the homepage title.`,
          'Duplicate titles compete with each other in search.',
          'Generate a unique title per vehicle from its own data.');
      }
      return ok('vehicle-page-titles', 'Unique vehicle page titles', w, 'Vehicle pages have their own titles.');
    },
  },

  // ---- Finance -----------------------------------------------------------
  {
    id: 'finance-display',
    run(site) {
      const w = 18;
      const pages = [site.home, site.financePage, ...site.vehiclePages].filter(Boolean);
      const paymentRe = /£\s?\d[\d,]*(\.\d{2})?\s*(per month|pm|p\/m|a month|\/month|month)/i;
      const aprRe = /\b\d{1,2}(\.\d+)?\s*%\s*apr\b/i;
      const withPayment = pages.filter((p) => paymentRe.test(p.text) || aprRe.test(p.text));

      if (withPayment.length === 0) {
        return fail('finance-display', 'Finance shown to buyers', w,
          'No monthly payment figure, APR or finance calculator was found anywhere on the site.',
          site.isCreditBroker
            ? 'This site belongs to an FCA-authorised credit broker with a lender panel, yet a customer cannot see what any car costs per month. Most used-car buyers shop by monthly budget. Every finance enquiry this would generate is currently being lost.'
            : 'Most used-car buyers shop by monthly budget rather than cash price. With no payment figures, those buyers have nothing to respond to.',
          'Show a payment on every vehicle, generated from a live lender quote, with a compliant representative example rendered automatically alongside it.');
      }

      // Payments are shown — now the compliance question.
      const exampleTerms = [
        /representative example/i,
        /representative\s+apr/i,
        /total amount payable/i,
        /amount of credit/i,
      ];
      const compliant = withPayment.filter((p) => exampleTerms.filter((re) => re.test(p.text)).length >= 3);
      if (compliant.length < withPayment.length) {
        return fail('finance-display', 'Finance shown to buyers', w,
          `${withPayment.length - compliant.length} of ${withPayment.length} pages showing a payment or APR do not appear to carry a complete representative example.`,
          'Displaying any cost-of-credit figure triggers FCA CONC 3.5.3R, which requires a representative example containing representative APR, the interest rate and whether it is fixed or variable, total amount of credit, other charges, cash price, deposit, duration, total amount payable and the amount of each repayment. This is a regulatory exposure, not a cosmetic one.',
          'Render every payment figure through a single component that cannot display without a valid, in-date representative example.');
      }
      return ok('finance-display', 'Finance shown to buyers', w,
        `Payment figures shown on ${withPayment.length} pages, each with representative-example wording present.`);
    },
  },

  {
    id: 'fca-disclosure',
    run(site) {
      const w = 6;
      const pages = [site.home, site.financePage, ...site.legalPages].filter(Boolean);
      const html = pages.map((p) => p.text).join(' ');
      const brokerStatement = /credit broker(,| and)? not a lender|we are a credit broker|acts? as a credit broker/i.test(html);
      const frn = /\b(FRN|firm reference number)\b[^0-9]{0,20}(\d{6})/i.exec(html);
      if (!brokerStatement && !frn) {
        return warn('fca-disclosure', 'FCA credit-broker disclosure as a web page', w,
          'No "credit broker, not a lender" statement or Firm Reference Number was found in the site\'s HTML.',
          'If the dealer introduces finance, the initial disclosure needs to be findable. If it exists only inside a PDF, it is invisible to search and to screen readers.',
          'Publish the initial disclosure and FRN as a proper page, versioned, so you can evidence which version a customer saw and when.');
      }
      if (!brokerStatement || !frn) {
        return warn('fca-disclosure', 'FCA credit-broker disclosure as a web page', w,
          brokerStatement ? 'Credit-broker statement found but no Firm Reference Number in the HTML.' : 'FRN found but no explicit "credit broker, not a lender" statement in the HTML.',
          'Partial disclosure is harder to evidence than complete disclosure.',
          'Publish the full initial disclosure — firm identity, FRN, broker-not-lender, panel scope, and how you are remunerated.');
      }
      return ok('fca-disclosure', 'FCA credit-broker disclosure as a web page', w,
        `Credit-broker statement present, FRN ${frn[2]}.`);
    },
  },

  // ---- Trust content -----------------------------------------------------
  {
    id: 'mot-history',
    run(site) {
      const w = 6;
      if (!site.vehiclePages.length) return skip('mot-history', 'MOT history shown to buyers', w, 'No vehicle pages found to check.');
      const withMot = site.vehiclePages.filter((p) => /mot history|mot record|previous mot|advisor(y|ies)/i.test(p.text));
      if (!withMot.length) {
        return fail('mot-history', 'MOT history shown to buyers', w,
          'No MOT history is displayed on any vehicle page.',
          'A vehicle\'s full MOT record — every test, mileage reading and advisory — is free public data from the DVSA. Showing it, with mileage plotted, is one of the most reassuring things you can put in front of a used-car buyer.',
          'Pull the MOT history by registration and display it as a timeline with a mileage chart on every vehicle page.');
      }
      return ok('mot-history', 'MOT history shown to buyers', w, 'MOT history displayed on vehicle pages.');
    },
  },

  {
    id: 'provenance',
    run(site) {
      const w = 5;
      if (!site.vehiclePages.length) return skip('provenance', 'Provenance / HPI check shown to buyers', w, 'No vehicle pages found to check.');
      const withProv = site.vehiclePages.filter((p) => /hpi check|provenance|history check(ed)?|finance check(ed)?|clear on hpi/i.test(p.text));
      if (!withProv.length) {
        return fail('provenance', 'Provenance / HPI check shown to buyers', w,
          'No provenance or HPI check is mentioned on any vehicle page.',
          'Most dealers pay for these checks and then get no marketing value from them. It is one of the strongest trust signals available and it costs nothing extra to display.',
          'Show a dated "Provenance checked" badge on every vehicle page.');
      }
      return ok('provenance', 'Provenance / HPI check shown to buyers', w, 'Provenance checking is surfaced on vehicle pages.');
    },
  },

  // ---- Technical hygiene -------------------------------------------------
  {
    id: 'robots-sitemap-host',
    run(site) {
      const w = 5;
      if (!site.robots) return skip('robots-sitemap-host', 'robots.txt configuration', w, 'No robots.txt found.');
      const declared = [...site.robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      const offHost = declared.filter((u) => {
        try { return new URL(u).host.replace(/^www\./, '') !== site.host.replace(/^www\./, ''); }
        catch { return false; }
      });
      if (offHost.length) {
        return fail('robots-sitemap-host', 'robots.txt configuration', w,
          `robots.txt points search engines at a sitemap on a different host: ${offHost.join(', ')}`,
          'A production site pointing crawlers at a development or staging host is a misconfiguration that should never reach a live customer site. It can also expose a non-production environment publicly.',
          'Point the Sitemap directive at the live domain and take the development host out of the index.');
      }
      return ok('robots-sitemap-host', 'robots.txt configuration', w, 'robots.txt sitemap directive points at the live host.');
    },
  },

  {
    id: 'image-formats',
    run(site) {
      const w = 4;
      const pages = [site.home, ...site.vehiclePages].filter(Boolean);
      const html = pages.map((p) => p.html).join(' ');
      const hasModern = /\.(avif|webp)\b/i.test(html) || /image\/(avif|webp)/i.test(html);
      if (!hasModern) {
        return warn('image-formats', 'Modern image formats', w,
          'No AVIF or WebP images detected.',
          'Vehicle photography is the heaviest thing on a dealer site. Modern formats typically cut it by half or more, which directly improves how fast the page feels on a phone.',
          'Serve AVIF with a WebP fallback at responsive sizes.');
      }
      return ok('image-formats', 'Modern image formats', w, 'Modern image formats in use.');
    },
  },

  {
    id: 'mobile-contact',
    run(site) {
      const w = 5;
      const pages = [site.home, ...site.vehiclePages].filter(Boolean);
      const html = pages.map((p) => p.html).join(' ');
      const tel = /href=["']tel:/i.test(html);
      const wa = /wa\.me\/|api\.whatsapp\.com/i.test(html);
      if (!tel) {
        return fail('mobile-contact', 'Mobile contact options', w,
          'No click-to-call link found.',
          'Most dealer web traffic is mobile and most enquiries are phone calls. A phone number that is not a link costs calls.',
          'Make every phone number a tel: link, add WhatsApp, and put a sticky contact bar on mobile vehicle pages.');
      }
      if (!wa) {
        return warn('mobile-contact', 'Mobile contact options', w,
          'Click-to-call present, but no WhatsApp link found.',
          'WhatsApp is now a default channel for UK car buyers, and it is the easiest way to send a video walkaround.',
          'Add a WhatsApp deep link with a pre-filled message naming the vehicle.');
      }
      return ok('mobile-contact', 'Mobile contact options', w, 'Click-to-call and WhatsApp both present.');
    },
  },

  {
    id: 'legal-pages-html',
    run(site) {
      const w = 4;
      if (!site.legalLinks.length) return skip('legal-pages-html', 'Legal documents as web pages', w, 'No legal links found.');
      const pdfs = site.legalLinks.filter((l) => /\.pdf(\?|$)/i.test(l.href));
      if (pdfs.length >= Math.max(2, site.legalLinks.length * 0.5)) {
        return warn('legal-pages-html', 'Legal documents as web pages', w,
          `${pdfs.length} of ${site.legalLinks.length} legal/compliance links are PDF downloads rather than web pages.`,
          'PDFs are poor for accessibility, invisible to search, and hard to version. If you ever need to prove which version of your terms a customer saw on a given date, a PDF on a web server will not do it.',
          'Publish compliance documents as versioned pages with effective dates, and record which version each customer was shown.');
      }
      return ok('legal-pages-html', 'Legal documents as web pages', w, 'Legal documents are published as web pages.');
    },
  },

  {
    id: 'broken-indexed-pages',
    run(site) {
      const w = 6;
      if (!site.checkedLinks.length) return skip('broken-indexed-pages', 'Internal links resolve', w, 'No internal links sampled.');
      const broken = site.checkedLinks.filter((l) => l.status >= 400);
      if (broken.length) {
        return fail('broken-indexed-pages', 'Internal links resolve', w,
          `${broken.length} of ${site.checkedLinks.length} sampled internal links return an error: ${broken.slice(0, 4).map((b) => `${b.url} (${b.status})`).join(', ')}${broken.length > 4 ? '…' : ''}`,
          'Broken pages that are still linked or still indexed send real customers to error screens and waste crawl budget.',
          'Fix or permanently redirect them, and add a link check to your release process.');
      }
      return ok('broken-indexed-pages', 'Internal links resolve', w, `All ${site.checkedLinks.length} sampled internal links resolve.`);
    },
  },

  {
    id: 'meta-description',
    run(site) {
      const w = 3;
      if (!site.home) return skip('meta-description', 'Page descriptions', w, 'Homepage not fetched.');
      if (!site.home.description) {
        return warn('meta-description', 'Page descriptions', w,
          'No meta description on the homepage.',
          'Search engines will invent one, usually badly.',
          'Write descriptions per page, and generate them per vehicle from the vehicle data.');
      }
      return ok('meta-description', 'Page descriptions', w, 'Homepage has a meta description.');
    },
  },
];

export function score(results) {
  const scored = results.filter((r) => r.status !== 'skip');
  const total = scored.reduce((s, r) => s + r.weight, 0) || 1;
  const earned = scored.reduce((s, r) => s + r.weight * (r.status === 'pass' ? 1 : r.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((earned / total) * 100);
}
