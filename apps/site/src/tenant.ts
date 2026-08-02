/**
 * M6b — host-to-tenant resolution for the public site renderer.
 *
 * This is the multi-tenancy boundary for unauthenticated traffic, and it is
 * where a public site is most likely to leak. The rules, from
 * `packages/db/src/rls.sql` and the tenancy checklist:
 *
 *  - A hostname resolves to exactly one tenant. `domains.hostname` is globally
 *    unique — the one deliberate exception to tenant-scoped uniqueness.
 *  - An unverified or unknown host returns a branded 404. It NEVER falls
 *    through to a default tenant, the first tenant, or another dealer's site.
 *  - Every cache key includes the tenant. A cache key without one is a leak
 *    that bypasses the database entirely.
 */

export interface ResolvedTenant {
  tenantId: string;
  brandId: string;
  siteId: string | null;
  hostname: string;
  origin: string;
  dealerName: string;
  /** False for a staging or preview host — drives robots.txt and meta robots. */
  allowIndexing: boolean;
}

export interface DomainRecord {
  hostname: string;
  tenantId: string;
  brandId: string;
  siteId: string | null;
  dealerName: string;
  verifiedAt: Date | null;
  isPrimary: boolean;
}

export type Resolution =
  | { ok: true; tenant: ResolvedTenant }
  | { ok: false; status: 404 | 421; reason: string };

const normaliseHost = (host: string): string =>
  host.toLowerCase().trim().replace(/:\d+$/, '').replace(/\.$/, '');

/** Hosts that must never be indexed even when a domain record exists. */
const NON_PRODUCTION = /^(localhost|127\.0\.0\.1|.*\.local|dev\..*|staging\..*|preview\..*|.*\.vercel\.app)$/;

export function resolveTenant(
  rawHost: string | null | undefined,
  lookup: (hostname: string) => DomainRecord | null,
  opts: { protocol?: 'http' | 'https' } = {},
): Resolution {
  if (!rawHost) return { ok: false, status: 421, reason: 'No Host header' };

  const hostname = normaliseHost(rawHost);
  if (!hostname) return { ok: false, status: 421, reason: 'Empty Host header' };

  const record = lookup(hostname);

  // An unknown host is a 404, never a fallback. Falling through to a default
  // tenant would serve one dealer's stock under another dealer's domain.
  if (!record) {
    return { ok: false, status: 404, reason: `No site is configured for ${hostname}` };
  }

  // An unverified domain must not serve content: anyone can point a CNAME at
  // us, and serving before the TXT challenge passes lets them impersonate a
  // dealer on a domain they do not control.
  if (!record.verifiedAt) {
    return { ok: false, status: 404, reason: `${hostname} is not verified` };
  }

  const protocol = opts.protocol ?? 'https';
  return {
    ok: true,
    tenant: {
      tenantId: record.tenantId,
      brandId: record.brandId,
      siteId: record.siteId,
      hostname,
      origin: `${protocol}://${hostname}`,
      dealerName: record.dealerName,
      allowIndexing: !NON_PRODUCTION.test(hostname),
    },
  };
}

/**
 * Cache keys ALWAYS carry the tenant.
 *
 * A cache key without a tenant is a cross-tenant leak that no RLS policy can
 * catch — the second request is served the first tenant's rendered HTML.
 */
export const cacheKey = (tenant: ResolvedTenant, ...parts: readonly string[]): string =>
  ['t', tenant.tenantId, 'b', tenant.brandId, ...parts].join(':');

/** Revalidation tags, so a stock change invalidates exactly the right pages. */
export const tags = {
  vehicle: (t: ResolvedTenant, vehicleId: string): string => cacheKey(t, 'vehicle', vehicleId),
  stockList: (t: ResolvedTenant): string => cacheKey(t, 'stock'),
  sitemap: (t: ResolvedTenant): string => cacheKey(t, 'sitemap'),
  brand: (t: ResolvedTenant): string => cacheKey(t, 'brand'),
} as const;
