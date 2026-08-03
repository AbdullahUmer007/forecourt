/**
 * M6b — the sitemap, built from live stock.
 *
 * The competitor's equivalent had 27 URLs and not one of them was a car,
 * against ~120 cars in stock.
 */
import { requireTenant } from '../../src/request.js';
import { buildSitemap, renderSitemapXml } from '../../../../packages/domain/src/seo.js';
import { loadSitemapVehicles, loadStaticPages } from '../../src/data/vehicles.js';

export const revalidate = 600;
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;

  const [vehicles, staticPages] = await Promise.all([
    loadSitemapVehicles(tenantId),
    loadStaticPages(tenantId),
  ]);

  return new Response(renderSitemapXml(buildSitemap(origin, vehicles, staticPages)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600, stale-while-revalidate=86400',
    },
  });
}
