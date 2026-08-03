/**
 * The home page.
 *
 * Was a 307 to `/used-cars` while M6b's home page was outstanding. It is now
 * the real page: a dealer's domain is what goes on their forecourt banner and
 * their business cards, and landing every direct visit on a filtered list
 * wasted it.
 *
 * Everything on the page is loaded from live stock — the count, the lowest
 * price, the just-arrived rail and the browse-by entries — so a dealer with 12
 * cars gets an honest page rather than one padded to look like a dealer with
 * 300.
 */
import { requireTenant } from '../src/request.js';
import { renderHomePage, type BrowseEntry, type HomeVehicleCard } from '../src/render/home.js';
import { loadDealer } from '../src/data/vehicles.js';
import { searchVehicles, countVehicles, facetCounts } from '../src/data/search.js';
import { EMPTY_QUERY } from '../../../packages/domain/src/search.js';
import { vehicleUrlPath } from '../../../packages/domain/src/seo.js';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;

  const [dealer, stockCount, arrivals, cheapest, facets] = await Promise.all([
    loadDealer(tenantId, origin),
    countVehicles(tenantId, EMPTY_QUERY),
    searchVehicles(tenantId, { ...EMPTY_QUERY, sort: 'newest' }, 8),
    searchVehicles(tenantId, { ...EMPTY_QUERY, sort: 'price-asc' }, 1),
    facetCounts(tenantId, EMPTY_QUERY),
  ]);

  const justArrived: HomeVehicleCard[] = arrivals.map((v) => ({
    name: [v.year, v.make, v.model].filter(Boolean).join(' '),
    href: vehicleUrlPath(v),
    pricePence: v.pricePence,
    meta: [
      v.mileage === null ? null : `${v.mileage.toLocaleString('en-GB')} miles`,
      v.fuelType, v.transmission,
    ].filter(Boolean).join(' · '),
    thumbUrl: v.thumbnail?.url ?? null,
    thumbAlt: v.thumbnail?.alt ?? '',
  }));

  // "From £x" is the cheapest car we actually have, not a marketing number.
  const fromPricePence = cheapest[0]?.pricePence ?? null;

  const toBrowse = (
    entries: readonly { value: string; label: string; count: number }[] | undefined,
    href: (value: string) => string,
  ): BrowseEntry[] =>
    (entries ?? []).filter((e) => e.count > 0).slice(0, 8)
      .map((e) => ({ label: e.label, href: href(e.value), count: e.count }));

  const html = renderHomePage({
    dealer,
    stockCount,
    fromPricePence,
    justArrived,
    // Body style and make are both in the crawl-control allow-list, so every
    // link here points at a URL a crawler is permitted to follow.
    browseByBody: toBrowse(facets.body, (v) => `/used-cars?body=${encodeURIComponent(v)}`),
    browseByMake: toBrowse(facets.make, (v) => `/used-cars/${encodeURIComponent(v)}`),
    now: new Date(),
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
