/**
 * M7 — the search results route.
 *
 * One route serves every listing shape, because they are all the same page
 * with different filters:
 *
 *   /used-cars                    all stock
 *   /used-cars/tesla              make landing page
 *   /used-cars/tesla/model-x      make + model landing page
 *   /used-cars?fuel=electric      any filtered view
 *
 * Three segments is a vehicle, not a listing — that route is more specific, so
 * Next matches it first and this catch-all never sees it.
 *
 * A landing page with no stock RENDERS rather than 404s (`landingPageDecision`
 * in M6a): we minted the URL, it may be linked from anywhere, and 404-ing a
 * page Google has indexed is one of the failures we score competitors down for.
 * The `noindex` comes from `searchIndexability`, inside the renderer.
 */
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { renderResultsPage } from '../../../src/render/results.js';
import { loadDealer } from '../../../src/data/vehicles.js';
import { searchVehicles, countVehicles, facetCounts, labelFor } from '../../../src/data/search.js';
import { recordDemandSignal } from '../../../src/data/demand.js';
import { parseSearchQuery, demandSignal, PER_PAGE } from '../../../../../packages/domain/src/search.js';

export const revalidate = 300;
export const dynamicParams = true;

interface Props {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResultsPage({ params, searchParams }: Props) {
  const h = await headers();
  const tenantId = h.get('x-forecourt-tenant')!;
  const origin = h.get('x-forecourt-origin')!;

  const { segments = [] } = await params;
  // Four or more segments is not a listing URL we ever mint.
  if (segments.length > 2) notFound();

  const raw = await searchParams;
  // Throws if a monthly-payment parameter appears — blocked until M8 supplies
  // <FinancePromotion> and its representative example.
  const { query } = parseSearchQuery(raw, segments);

  const [dealer, total, vehicles, facets] = await Promise.all([
    loadDealer(tenantId, origin),
    countVehicles(tenantId, query),
    searchVehicles(tenantId, query, PER_PAGE),
    facetCounts(tenantId, query),
  ]);

  // Only thin and empty results are recorded, and the record is the normalised
  // query — never the raw URL. "Eleven people wanted an automatic Qashqai
  // under £12,000 and we had none" is what a dealer buys stock from.
  const signal = demandSignal(query, total, new Date());
  if (signal) await recordDemandSignal(tenantId, signal);

  const html = renderResultsPage({
    query, dealer, vehicles, totalCount: total,
    facetCounts: facets,
    labelFor: labelFor(tenantId),
    countFor: () => 0,   // the relaxation ladder is walked by the data layer in `fallbackVehicles`
    fallbackVehicles: [],
    now: new Date(),
    theme: dealer.theme,
  });

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
