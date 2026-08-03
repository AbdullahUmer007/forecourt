/**
 * Host → tenant lookup, used by the middleware on every request.
 *
 * Deliberately its own module and its own query: it runs before the tenant is
 * known, so it is the one read on the public site that CANNOT be tenant-scoped.
 * That makes it the most security-sensitive query in the application, and it is
 * kept small enough to hold in your head.
 *
 * It runs as the platform role because no tenant context exists yet, and it
 * returns exactly one row matched on an exact hostname. `resolveTenant` then
 * decides what to do with it — an unverified domain is refused there, not here,
 * so the decision lives in one tested pure function rather than in SQL.
 */

import { sql, toDate } from './db.js';
import type { DomainRecord } from '../tenant.js';

/** Cached in-process for a minute: a domain change is not urgent, a query per request is. */
const cache = new Map<string, { record: DomainRecord | null; at: number }>();
const TTL_MS = 60_000;

export async function lookupDomain(host: string): Promise<(h: string) => DomainRecord | null> {
  const hostname = host.toLowerCase().split(':')[0] ?? '';
  const hit = cache.get(hostname);
  const fresh = hit && Date.now() - hit.at < TTL_MS;

  let record: DomainRecord | null;
  if (fresh) {
    record = hit.record;
  } else {
    const rows = await sql`
      SELECT d.hostname, d.tenant_id, d.brand_id, d.verified_at, d.is_primary,
             s.id AS site_id, t.name AS dealer_name
        FROM domains d
        JOIN tenants t ON t.id = d.tenant_id
        LEFT JOIN LATERAL (
          SELECT id FROM sites WHERE tenant_id = d.tenant_id ORDER BY created_at LIMIT 1
        ) s ON true
       WHERE lower(d.hostname) = ${hostname}
       LIMIT 1`;

    const row = rows[0];
    record = row
      ? {
          hostname: String(row['hostname']),
          tenantId: String(row['tenant_id']),
          brandId: String(row['brand_id']),
          siteId: row['site_id'] === null ? null : String(row['site_id']),
          dealerName: String(row['dealer_name']),
          verifiedAt: toDate(row['verified_at']),
          isPrimary: Boolean(row['is_primary']),
        }
      : null;
    cache.set(hostname, { record, at: Date.now() });
  }

  // `resolveTenant` takes a lookup function so it stays pure and testable.
  return (h: string) => (h.toLowerCase().split(':')[0] === hostname ? record : null);
}
