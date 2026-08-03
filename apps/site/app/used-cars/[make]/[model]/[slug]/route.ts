/**
 * The vehicle detail page.
 *
 * A ROUTE HANDLER, not a page component, and that is the architectural point.
 * `renderVehiclePage` returns a complete HTML document — doctype, head, the
 * inlined critical CSS, the JSON-LD. Wrapping that in a React page would nest
 * one document inside another and hand the buyer a client bundle we have
 * spent the whole project refusing to ship.
 *
 * So Next does what Next is good at here — routing, caching, revalidation —
 * and nothing stands between a buyer and the markup.
 */
import { requireTenant } from '../../../../../src/request.js';
import { renderVehiclePage } from '../../../../../src/render/vdp.js';
import { loadVehicleBySlug, loadSimilarVehicles, loadDealer } from '../../../../../src/data/vehicles.js';
import { loadFinanceBlock } from '../../../../../src/data/finance.js';
import { resolveSoldVehicle, vehicleUrlPath } from '../../../../../../../packages/domain/src/seo.js';

export const revalidate = 300;          // a stock change revalidates by tag immediately
export const dynamic = 'force-dynamic'; // dev: always fresh. ISR is configured at deploy.

interface Params { params: Promise<{ make: string; model: string; slug: string }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;
  const { slug } = await params;

  const vehicle = await loadVehicleBySlug(tenantId, slug, origin);
  if (!vehicle) return notFound(origin);

  // A sold car is a redirect to the closest live stock, never a 200 "Sold Out"
  // page. Those accumulate as dead ends and drop a buyer who came from search.
  if (vehicle.state !== 'live' && vehicle.state !== 'reserved') {
    const target = resolveSoldVehicle(
      { path: vehicleUrlPath(vehicle), make: vehicle.make, model: vehicle.model, pricePence: vehicle.pricePence },
      await loadSimilarVehicles(tenantId, vehicle),
    );
    if (target.location) {
      return new Response(null, { status: target.status, headers: { location: target.location } });
    }
    return notFound(origin);
  }

  const [dealer, finance] = await Promise.all([
    loadDealer(tenantId, origin),
    loadFinanceBlock(tenantId, vehicle, new Date()),
  ]);

  const html = renderVehiclePage({
    vehicle,
    dealer,
    media: vehicle.media,
    mot: vehicle.mot,
    provenanceCheckedAt: vehicle.provenanceCheckedAt,
    priceContext: vehicle.priceContext,
    finance,
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}

const notFound = (origin: string): Response =>
  new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Car not found</title></head>` +
    `<body><h1>We haven't got that car</h1><p>It may have sold. ` +
    `<a href="${origin}/used-cars">See what we have in stock</a>.</p></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
