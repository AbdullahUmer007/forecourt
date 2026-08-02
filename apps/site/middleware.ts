/**
 * M6b — tenant resolution at the edge.
 *
 * Runs before every request. An unknown or unverified host 404s here rather
 * than reaching a route handler, so there is no code path in which a page
 * renders without a resolved tenant.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant } from './src/tenant.js';
import { lookupDomain } from './src/data/domains.js';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|i/).*)'],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const resolution = resolveTenant(
    request.headers.get('host'),
    await lookupDomain(request.headers.get('host') ?? ''),
    { protocol: request.nextUrl.protocol === 'http:' ? 'http' : 'https' },
  );

  if (!resolution.ok) {
    // Branded 404 — never a fallback to a default tenant.
    return NextResponse.rewrite(new URL('/_not-configured', request.url), { status: resolution.status });
  }

  // Hand the resolved tenant to route handlers via request headers, so no
  // handler has to re-resolve it (and none can forget to).
  const headers = new Headers(request.headers);
  headers.set('x-forecourt-tenant', resolution.tenant.tenantId);
  headers.set('x-forecourt-brand', resolution.tenant.brandId);
  headers.set('x-forecourt-origin', resolution.tenant.origin);
  headers.set('x-forecourt-indexable', String(resolution.tenant.allowIndexing));

  return NextResponse.next({ request: { headers } });
}
