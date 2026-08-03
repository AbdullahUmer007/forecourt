/**
 * Resolving the tenant for a request.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT MIDDLEWARE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It was. Middleware is the obvious place: it runs before every request, so no
 * handler can forget to resolve the tenant. But Next middleware runs in the
 * Edge runtime, which has no TCP sockets, so it cannot query Postgres — and
 * the host-to-tenant mapping lives in Postgres.
 *
 * The production answer is an edge-readable replica of the domain table (KV,
 * or a snapshot published on deploy). That is real work and it is not what is
 * blocking anything today, so tenant resolution moved into the handlers, in
 * the Node runtime, behind this one function.
 *
 * The guarantee the middleware gave — no page renders without a resolved
 * tenant — is preserved by making this the ONLY source of a tenant id. There
 * is no other export that hands one out, so a handler that skips it has
 * nothing to pass to the data layer and does not compile.
 *
 * `resolveTenant` itself is untouched and still pure: the same tested function
 * decides that an unknown or unverified host is a 404 and never falls through
 * to a default tenant.
 */

import { resolveTenant, type ResolvedTenant } from './tenant.js';
import { lookupDomain } from './data/domains.js';

export type TenantResult =
  | { ok: true; tenant: ResolvedTenant }
  | { ok: false; response: Response };

export async function requireTenant(request: Request): Promise<TenantResult> {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;

  const resolution = resolveTenant(
    host,
    await lookupDomain(host),
    { protocol: url.protocol === 'http:' ? 'http' : 'https' },
  );

  if (!resolution.ok) return { ok: false, response: notConfigured(resolution.status) };
  return { ok: true, tenant: resolution.tenant };
}

/**
 * What an unknown or unverified host gets.
 *
 * A real page rather than a bare 404, because the most likely visitor is a
 * dealer who has just pointed their DNS at us and is wondering why nothing
 * happened. Telling them what to do next is the entire job of this response.
 */
export function notConfigured(status: 404 | 421): Response {
  return new Response(
    `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>This domain isn't connected yet</title>
<style>body{margin:0;font:16px/1.5 Inter,system-ui,sans-serif;color:#0F172A;background:#F8FAFC;
display:grid;place-items:center;min-height:100vh}main{max-width:46ch;padding:24px}
h1{font-size:24px;line-height:30px;margin:0 0 12px}p{color:#475569}
code{background:#F1F5F9;padding:2px 6px;border-radius:4px}</style>
</head><body><main>
<h1>This domain isn't connected yet</h1>
<p>No dealer site is set up for this address, or its DNS verification hasn't finished.
If you have just added the domain, add the <code>TXT</code> record we gave you; the site
goes live within a few minutes of that record propagating.</p>
<p>We never serve one dealer's stock on another dealer's domain, so until the domain is
verified there is nothing here to show.</p>
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
