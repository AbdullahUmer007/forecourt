/**
 * robots.txt.
 *
 * The Sitemap directive is derived from the request's own origin, so it can
 * NEVER point at a dev host. The competitor's live customer site pointed
 * crawlers at dev.<domain>, publicly exposing a staging environment and
 * sending them to the wrong sitemap.
 */
import { requireTenant } from '../../src/request.js';
import { renderRobotsTxt } from '../../../../packages/domain/src/seo.js';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { origin, allowIndexing } = resolved.tenant;

  return new Response(renderRobotsTxt({ origin, allowIndexing }), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
