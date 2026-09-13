import { renderHomePage, type BrowseEntry, type HomeVehicleCard } from '../render/home.js';
import { loadDealer } from './vehicles.js';
import { searchVehicles, countVehicles, facetCounts } from './search.js';
import { EMPTY_QUERY } from '../../../../packages/domain/src/search.js';
import { vehicleUrlPath } from '../../../../packages/domain/src/seo.js';

export async function renderTenantHome(tenantId: string, origin: string): Promise<string> {
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
    theme: dealer.theme,
    headline: dealer.siteTheme.copy.homeHeadline,
    lead: dealer.siteTheme.copy.homeLead,
    stockCount,
    fromPricePence,
    justArrived,
    // Body style and make are both in the crawl-control allow-list, so every
    // link here points at a URL a crawler is permitted to follow.
    browseByBody: toBrowse(facets.body, (v) => `/used-cars?body=${encodeURIComponent(v)}`),
    browseByMake: toBrowse(facets.make, (v) => `/used-cars/${encodeURIComponent(v)}`),
    now: new Date(),
  });

  return html;
}
