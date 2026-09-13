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
import { renderTenantHome } from '../src/data/home.js';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;

  const html = await renderTenantHome(tenantId, origin);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
