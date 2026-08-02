/**
 * M6a — URLs, sitemaps, redirects and metadata.
 *
 * This module exists because of a specific, measured failure. Our named
 * competitor's platform, audited on a live customer site in August 2026:
 *
 *   - sitemap contained 27 URLs and NONE of them were vehicles, against ~120
 *     cars in stock
 *   - vehicle URLs were `?stockId=50111` query strings
 *   - every indexed vehicle page returned "This Vehicle is Sold Out" with a
 *     200 status, the homepage's title, and a self-canonical
 *   - make/location landing pages were indexed by Google and returned 404
 *   - robots.txt pointed the Sitemap directive at a dev subdomain
 *
 * Every function here is the direct fix for one of those, and the M0 audit
 * tool checks each one. Our own generated output must score near-perfect on
 * our own audit — see `seo.test.ts`.
 */

// ---------------------------------------------------------------- slugs

/** URL-safe slug: lowercase, ASCII, hyphenated, no leading or trailing dashes. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')       // strip diacritics: Citroën → Citroen
    .toLowerCase()
    .replace(/['’]/g, '')                   // O'Neill → oneill, not o-neill
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export interface VehicleUrlParts {
  make: string | null;
  model: string | null;
  derivative: string | null;
  year: number | null;
  registration: string;
}

/**
 * A readable, shareable vehicle URL.
 *
 *   /used-cars/tesla/model-x/dual-motor-long-range-2022-wn22hnl
 *
 * The registration is the uniqueness guarantee, so two similar cars never
 * collide. Everything before it is for humans and for search.
 */
export function vehicleUrlPath(v: VehicleUrlParts): string {
  const make = slugify(v.make ?? 'used');
  const model = slugify(v.model ?? 'car');
  const tail = [slugify(v.derivative ?? ''), v.year ? String(v.year) : '', slugify(v.registration)]
    .filter(Boolean)
    .join('-');
  return `/used-cars/${make || 'used'}/${model || 'car'}/${tail}`;
}

export const canonicalUrl = (origin: string, path: string): string =>
  `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

/** `/used-cars/tesla` and `/used-cars/tesla/milton-keynes` */
export const makeLandingPath = (make: string, location?: string): string =>
  location ? `/used-cars/${slugify(make)}/in/${slugify(location)}` : `/used-cars/${slugify(make)}`;

export const searchPath = (): string => '/used-cars';

// ---------------------------------------------------------------- metadata

export interface VehicleMetaInput extends VehicleUrlParts {
  mileage: number | null;
  pricePence: bigint | null;
  fuelType: string | null;
  transmission: string | null;
  dealerName: string;
}

const formatPrice = (pence: bigint | null): string =>
  pence === null ? '' : `£${(Number(pence) / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const vehicleName = (v: VehicleUrlParts): string =>
  [v.year, v.make, v.model, v.derivative].filter(Boolean).join(' ') || 'Used car';

/**
 * A title that says which car it is.
 *
 * The competitor's vehicle pages all carried the homepage title — so even when
 * one ranked, the search result told nobody what car it was.
 */
export function vehicleTitle(v: VehicleMetaInput): string {
  const parts = [vehicleName(v)];
  if (v.mileage !== null) parts.push(`${v.mileage.toLocaleString('en-GB')} miles`);
  const price = formatPrice(v.pricePence);
  if (price) parts.push(price);
  parts.push(v.dealerName);
  // Google truncates around 60 characters; drop the mileage before the price.
  let title = parts.join(' | ');
  if (title.length > 65 && v.mileage !== null) {
    title = [vehicleName(v), price, v.dealerName].filter(Boolean).join(' | ');
  }
  return title;
}

export function vehicleDescription(v: VehicleMetaInput): string {
  const bits = [
    vehicleName(v),
    v.mileage !== null ? `${v.mileage.toLocaleString('en-GB')} miles` : null,
    v.fuelType,
    v.transmission,
  ].filter(Boolean).join(', ');
  const price = formatPrice(v.pricePence);
  return `${bits}${price ? ` — ${price}` : ''}. Available now at ${v.dealerName}. Full MOT history and provenance check shown.`
    .slice(0, 155);
}

// ---------------------------------------------------------------- sitemap

export interface SitemapEntry {
  loc: string;
  lastmod: string;          // ISO date
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export interface SitemapVehicle extends VehicleUrlParts {
  updatedAt: Date;
  state: string;
}

export interface SitemapStaticPage {
  path: string;
  updatedAt: Date;
  priority?: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The sitemap, built from LIVE STOCK.
 *
 * The whole point. A used-car dealer's vehicle pages are the website; a
 * sitemap without them offers search engines nothing.
 */
export function buildSitemap(
  origin: string,
  vehicles: readonly SitemapVehicle[],
  staticPages: readonly SitemapStaticPage[] = [],
  landingPages: readonly SitemapStaticPage[] = [],
): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  for (const p of staticPages) {
    entries.push({
      loc: canonicalUrl(origin, p.path),
      lastmod: iso(p.updatedAt),
      changefreq: 'monthly',
      priority: p.priority ?? 0.5,
    });
  }

  // Only advertisable states belong in a sitemap. A sold car is a redirect,
  // not an entry — including it invites Google to index a dead end.
  for (const v of vehicles.filter((x) => x.state === 'live' || x.state === 'reserved')) {
    entries.push({
      loc: canonicalUrl(origin, vehicleUrlPath(v)),
      lastmod: iso(v.updatedAt),
      changefreq: 'daily',
      priority: 0.8,
    });
  }

  for (const p of landingPages) {
    entries.push({
      loc: canonicalUrl(origin, p.path),
      lastmod: iso(p.updatedAt),
      changefreq: 'weekly',
      priority: p.priority ?? 0.6,
    });
  }

  return entries;
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((e) =>
    `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>` +
    (e.changefreq ? `\n    <changefreq>${e.changefreq}</changefreq>` : '') +
    (e.priority !== undefined ? `\n    <priority>${e.priority.toFixed(1)}</priority>` : '') +
    `\n  </url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ---------------------------------------------------------------- robots.txt

/**
 * robots.txt.
 *
 * The Sitemap directive MUST point at the live host. The competitor's live
 * customer site pointed it at `dev.<domain>`, publicly exposing a staging
 * environment and sending crawlers to the wrong sitemap.
 */
export function renderRobotsTxt(opts: {
  origin: string;
  allowIndexing: boolean;
  disallowPaths?: readonly string[];
  blockAiTraining?: boolean;
}): string {
  const lines: string[] = [];

  if (!opts.allowIndexing) {
    // A staging or unverified domain must never be indexed.
    lines.push('User-agent: *', 'Disallow: /', '');
    return lines.join('\n');
  }

  lines.push('User-agent: *');
  for (const path of opts.disallowPaths ?? ['/api/', '/account/', '/checkout/']) {
    lines.push(`Disallow: ${path}`);
  }
  lines.push('');

  if (opts.blockAiTraining) {
    for (const bot of ['GPTBot', 'Google-Extended', 'CCBot', 'anthropic-ai', 'ClaudeBot', 'Bytespider']) {
      lines.push(`User-agent: ${bot}`, 'Disallow: /', '');
    }
  }

  // Always the live origin this file is served from — never a dev host.
  lines.push(`Sitemap: ${canonicalUrl(opts.origin, '/sitemap.xml')}`, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- redirects

export interface SoldVehicleContext {
  path: string;
  make: string | null;
  model: string | null;
  pricePence: bigint | null;
}

export interface RedirectTarget {
  status: 301 | 302 | 410;
  location: string | null;
  reason: string;
}

export interface SimilarVehicle extends VehicleUrlParts {
  pricePence: bigint | null;
}

/**
 * Where a sold vehicle's URL should send someone.
 *
 * Never a 200 "Sold Out" page. Those accumulate as near-identical dead ends,
 * waste crawl budget, compete with each other, and drop a real buyer who
 * clicked from search onto nothing. Send them to the closest thing we have.
 */
export function resolveSoldVehicle(
  sold: SoldVehicleContext,
  candidates: readonly SimilarVehicle[],
): RedirectTarget {
  const sameModel = candidates.filter(
    (c) => c.make?.toLowerCase() === sold.make?.toLowerCase() &&
           c.model?.toLowerCase() === sold.model?.toLowerCase(),
  );

  // Closest price within the same model is the best substitute.
  if (sameModel.length > 0 && sold.pricePence !== null) {
    const closest = [...sameModel]
      .filter((c) => c.pricePence !== null)
      .sort((a, b) =>
        Math.abs(Number(a.pricePence! - sold.pricePence!)) -
        Math.abs(Number(b.pricePence! - sold.pricePence!)))[0];
    if (closest) {
      return { status: 301, location: vehicleUrlPath(closest), reason: 'similar vehicle, same model, closest price' };
    }
  }
  if (sameModel.length > 0) {
    return { status: 301, location: vehicleUrlPath(sameModel[0]!), reason: 'similar vehicle, same model' };
  }

  // Otherwise the filtered search for that make and model — still useful.
  if (sold.make) {
    return { status: 301, location: makeLandingPath(sold.make), reason: 'no similar stock; make landing page' };
  }
  return { status: 301, location: searchPath(), reason: 'no similar stock; all stock' };
}

// ---------------------------------------------------------------- landing pages

export interface LandingPageDecision {
  render: boolean;
  index: boolean;
  reason: string;
}

/**
 * Whether a facet landing page should exist and be indexed.
 *
 * Two failure modes to avoid, both observed on the competitor's estate:
 *  - pages indexed by Google that return 404
 *  - thin pages with no stock, which drag down the whole domain
 *
 * So: render whenever the URL might be linked (never 404 a page we minted),
 * but only allow indexing when there is enough stock to justify it.
 */
export function landingPageDecision(matchingStockCount: number, minimumForIndex = 3): LandingPageDecision {
  if (matchingStockCount === 0) {
    return {
      render: true,   // render with alternatives — never 404 a URL we published
      index: false,
      reason: 'no matching stock — rendered with alternatives, noindex to avoid thin content',
    };
  }
  if (matchingStockCount < minimumForIndex) {
    return { render: true, index: false, reason: `only ${matchingStockCount} matching — below the indexing threshold` };
  }
  return { render: true, index: true, reason: `${matchingStockCount} matching vehicles` };
}

export const robotsMetaFor = (d: LandingPageDecision): string =>
  d.index ? 'index, follow' : 'noindex, follow';
