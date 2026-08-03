/**
 * The search results route.
 *
 * One handler serves every listing shape, because they are the same page with
 * different filters:
 *
 *   /used-cars                    all stock
 *   /used-cars/tesla              make landing page
 *   /used-cars/tesla/model-x      make + model landing page
 *   /used-cars?fuel=electric      any filtered view
 *
 * Three segments is a vehicle, and that route is more specific, so Next
 * matches it first and this catch-all never sees it.
 *
 * A landing page with no stock RENDERS rather than 404s: we minted the URL, it
 * may be linked from anywhere, and 404-ing a page Google has indexed is one of
 * the failures we score competitors down for. The `noindex` comes from
 * `searchIndexability` inside the renderer.
 */
import { requireTenant } from '../../../src/request.js';
import { renderResultsPage } from '../../../src/render/results.js';
import { loadDealer } from '../../../src/data/vehicles.js';
import { searchVehicles, countVehicles, facetCounts, labelFor } from '../../../src/data/search.js';
import { recordDemandSignal } from '../../../src/data/demand.js';
import {
  parseSearchQuery, demandSignal, relaxationLadder, PER_PAGE,
  type SearchQuery,
} from '../../../../../packages/domain/src/search.js';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ segments?: string[] }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;

  const { segments = [] } = await params;
  // Four or more segments is not a listing URL we ever mint.
  if (segments.length > 2) return new Response('Not found', { status: 404 });

  const raw: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) raw[k] = v;

  // Throws if a monthly-payment parameter appears without an approved
  // representative example. No promotion is passed here, which is the safe
  // default — M8 unlocks the facet by handing one in.
  let query: SearchQuery;
  try {
    query = parseSearchQuery(raw, segments).query;
  } catch (error) {
    return new Response(
      `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Search unavailable</title></head>` +
      `<body><h1>That search isn't available</h1><p>${(error as Error).message}</p>` +
      `<p><a href="/used-cars">Back to all stock</a></p></body></html>`,
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  const [dealer, total, vehicles, facets] = await Promise.all([
    loadDealer(tenantId, origin),
    countVehicles(tenantId, query),
    searchVehicles(tenantId, query, PER_PAGE),
    facetCounts(tenantId, query),
  ]);

  // Nothing matched: walk the relaxation ladder and show the closest real cars
  // rather than an apology. Counts come from the same engine as the results.
  let fallbackVehicles: Awaited<ReturnType<typeof searchVehicles>> = [];
  const counts = new Map<string, number>();
  if (total === 0) {
    for (const step of relaxationLadder(query)) {
      const n = await countVehicles(tenantId, step.query);
      counts.set(JSON.stringify(step.query), n);
      if (n > 0) {
        fallbackVehicles = await searchVehicles(tenantId, step.query, 6);
        break;
      }
    }
  }

  // Only thin and empty results are recorded, and what is stored is the
  // normalised query — never the raw URL, and nothing identifying.
  const signal = demandSignal(query, total, new Date());
  if (signal) await recordDemandSignal(tenantId, signal);

  const html = renderResultsPage({
    query, dealer, vehicles, totalCount: total,
    facetCounts: facets,
    labelFor: labelFor(tenantId),
    countFor: (q) => counts.get(JSON.stringify(q)) ?? 0,
    fallbackVehicles,
    now: new Date(),
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
