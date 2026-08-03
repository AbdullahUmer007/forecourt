/**
 * Who is asking, and on behalf of which dealer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY SOURCE OF A TENANT ID IN THE CRM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Same guarantee as `requireTenant` on the public site, and for the same
 * reason: if there is no other export that hands one out, a handler that skips
 * the check has nothing to pass to the data layer and does not compile.
 *
 * ⚠️ AUTHENTICATION IS NOT BUILT YET. M2 created the identity tables — users,
 * tenant_memberships, roles, user_sites — but no login flow, no password
 * hashing, no session cookie and no provider are wired up. Until that exists
 * this module resolves a development session from the environment.
 *
 * It is deliberately loud about that rather than quietly convenient:
 *
 *   1. It refuses to run at all when NODE_ENV is 'production'. A dev auth
 *      bypass that ships is the whole reason this file has a warning on it.
 *   2. It reads the membership from the DATABASE rather than trusting the
 *      environment variable, so the permissions and site scope on screen are
 *      the real ones for that user. Only the *identity* is stubbed.
 *   3. `set_tenant_context` is still called with the real user id and site
 *      scope, so RLS behaves exactly as it will in production.
 */

import { sql } from './data/db';
import type { Permission, Scope } from '@forecourt/domain';

export interface Session {
  userId: string;
  tenantId: string;
  roleKey: string;
  permissions: readonly Permission[];
  scope: Scope;
  siteIds: readonly string[];
  displayName: string;
  tenantName: string;
  /** True when the identity came from the environment rather than a login. */
  development: boolean;
}

let cached: Session | null = null;

export async function requireSession(): Promise<Session> {
  if (cached) return cached;

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'The CRM has no authentication yet and refuses to serve a production request. ' +
      'Build the login flow against the M2 identity tables before deploying this app.',
    );
  }

  const email = process.env['CRM_DEV_USER'];
  if (!email) {
    throw new Error(
      'CRM_DEV_USER is not set. The CRM has no login yet, so it needs to be told which ' +
      'seeded user to act as — add CRM_DEV_USER=owner@kenningtoncarsales.co.uk to .env, ' +
      'then run `pnpm db:seed` if you have not already.',
    );
  }

  // Read as the platform role: this query runs BEFORE a tenant context exists,
  // which is precisely the bootstrap problem a login endpoint has. It is the
  // one query in the CRM that is not tenant-scoped, and it is scoped by the
  // user's own email instead.
  const rows = await sql<{
    user_id: string; membership_id: string; tenant_id: string; role_key: string;
    permissions: string[]; scope_all_sites: boolean;
    display_name: string; tenant_name: string;
  }[]>`
    SELECT u.id          AS user_id,
           m.id          AS membership_id,
           m.tenant_id   AS tenant_id,
           r.key::text   AS role_key,
           r.permissions AS permissions,
           -- The membership may widen the role's scope for one person, so it
           -- wins where it is set. Both are booleans in the schema; the domain
           -- models scope as an enum, and the translation happens below.
           (m.scope_all_sites OR r.scope_all_sites) AS scope_all_sites,
           u.name        AS display_name,
           t.name        AS tenant_name
    FROM users u
    JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
    JOIN roles r              ON r.id = m.role_id
    JOIN tenants t            ON t.id = m.tenant_id
    WHERE lower(u.email) = lower(${email})
    ORDER BY m.created_at
    LIMIT 1`;

  const row = rows[0];
  if (!row) {
    throw new Error(
      `No active membership found for ${email}. Run \`pnpm db:seed\` to create the ` +
      'Kennington demo tenant, or set CRM_DEV_USER to a user that exists.',
    );
  }

  // Site access hangs off the MEMBERSHIP, not the user: one person can work
  // for two dealers, and their site access differs per dealer.
  const siteRows = await sql<{ site_id: string }[]>`
    SELECT site_id FROM user_sites WHERE membership_id = ${row.membership_id}::uuid`;

  cached = {
    userId: row.user_id,
    tenantId: row.tenant_id,
    roleKey: row.role_key,
    permissions: row.permissions as readonly Permission[],
    // `own_records` is a narrower scope than the schema's two booleans can
    // express, so it is not reachable from here yet. Widening a scope by
    // accident is the dangerous direction, so the fallback is the narrower of
    // the two the schema does model.
    scope: (row.scope_all_sites ? 'all_sites' : 'my_sites') satisfies Scope,
    siteIds: siteRows.map((s) => s.site_id),
    displayName: row.display_name,
    tenantName: row.tenant_name,
    development: true,
  };
  return cached;
}

/** Test seam — the dev session is cached for the process lifetime. */
export const clearSessionCache = (): void => {
  cached = null;
};
