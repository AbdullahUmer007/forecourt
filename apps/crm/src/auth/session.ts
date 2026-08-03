import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from '@/data/db';
import {
  checkSession, sessionExpiry, stepUpSatisfied, isWellFormedToken,
  decideSignIn, recordFailure, recordSuccess,
  type Permission, type Scope, type SignInDecision,
} from '@forecourt/domain';
import {
  verifyPassword, burnPasswordTime, newSessionToken, hashSessionToken,
} from './crypto';

export const SESSION_COOKIE = 'forecourt_session';

export interface Session {
  sessionId: string;
  userId: string;
  membershipId: string;
  tenantId: string;
  roleKey: string;
  permissions: readonly Permission[];
  scope: Scope;
  siteIds: readonly string[];
  displayName: string;
  email: string;
  tenantName: string;
  mfaSatisfiedAt: Date | null;
  stepUpSatisfiedAt: Date | null;
  /** True when a sensitive permission needs re-authentication right now. */
  stepUpValid: boolean;
}

/**
 * The identity behind a request, or null.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY SOURCE OF A TENANT ID IN THE CRM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Same guarantee the public site's `requireTenant` gives: no other export
 * hands one out, so a handler that skips it has nothing to pass to the data
 * layer and does not compile.
 *
 * The session lookup runs OUTSIDE a tenant context, because the tenant is what
 * it is resolving — the bootstrap problem every login endpoint has. It is
 * scoped by an unguessable token instead, and it is the only unscoped query in
 * the CRM besides sign-in itself.
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !isWellFormedToken(token)) return null;

  const now = new Date();
  const rows = await sql<{
    session_id: string; user_id: string; membership_id: string; tenant_id: string;
    role_key: string; permissions: string[]; scope_all_sites: boolean;
    display_name: string; email: string; tenant_name: string;
    created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
    trusted_device: boolean; mfa_satisfied_at: Date | null; step_up_satisfied_at: Date | null;
  }[]>`
    SELECT s.id AS session_id, s.user_id, m.id AS membership_id, m.tenant_id,
           r.key::text AS role_key, r.permissions,
           (m.scope_all_sites OR r.scope_all_sites) AS scope_all_sites,
           u.name AS display_name, u.email, t.name AS tenant_name,
           s.created_at, s.last_seen_at, s.expires_at, s.revoked_at, s.trusted_device,
           s.mfa_satisfied_at, s.step_up_satisfied_at
    FROM sessions s
    JOIN users u              ON u.id = s.user_id AND u.deleted_at IS NULL
    JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = s.tenant_id
                             AND m.status = 'active'
    JOIN roles r              ON r.id = m.role_id
    JOIN tenants t            ON t.id = m.tenant_id
    WHERE s.token_hash = ${hashSessionToken(token)}
    LIMIT 1`;

  const row = rows[0];
  if (!row) return null;

  const check = checkSession({
    createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at,
    revokedAt: row.revoked_at, trustedDevice: row.trusted_device,
  }, now);

  if (!check.valid) {
    // An expired or idle session is revoked rather than left to be retried.
    // Leaving it valid-looking in the table means the next request re-runs the
    // same check forever, and an idle session that later gets used is exactly
    // the one worth closing.
    await sql`UPDATE sessions SET revoked_at = now() WHERE id = ${row.session_id}::uuid
              AND revoked_at IS NULL`;
    return null;
  }

  // Refresh the idle clock. Throttled to once a minute: this runs on every
  // request and a write per page view is a lot of writes for a timestamp
  // nobody reads to the second.
  if (now.getTime() - row.last_seen_at.getTime() > 60_000) {
    await sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${row.session_id}::uuid`;
  }

  const siteRows = await sql<{ site_id: string }[]>`
    SELECT site_id FROM user_sites WHERE membership_id = ${row.membership_id}::uuid`;

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    roleKey: row.role_key,
    permissions: row.permissions as readonly Permission[],
    scope: row.scope_all_sites ? 'all_sites' : 'my_sites',
    siteIds: siteRows.map((s) => s.site_id),
    displayName: row.display_name,
    email: row.email,
    tenantName: row.tenant_name,
    mfaSatisfiedAt: row.mfa_satisfied_at,
    stepUpSatisfiedAt: row.step_up_satisfied_at,
    stepUpValid: stepUpSatisfied(row.step_up_satisfied_at, now),
  };
}

/**
 * For anything that must have a session.
 *
 * REDIRECTS rather than throws. A throw here becomes a 500 with a stack trace,
 * which is both a bad experience and the wrong signal — a signed-out request
 * is an ordinary state, not a fault. The `(app)` layout redirects first, so in
 * practice this is the backstop for a server action called after the session
 * expired mid-page, which is exactly when a 500 would be most confusing.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  return session;
}

// -------------------------------------------------------------- sign-in

export interface SignInResult {
  ok: boolean;
  message?: string;
  mfaEnrolmentRequired?: boolean;
}

/**
 * Verify a credential and, if it holds, open a session.
 *
 * The DECISION is the domain's; this function's job is to gather the facts
 * honestly, take the same amount of time whether or not the account exists,
 * and persist what the decision says to persist.
 */
export async function signIn(
  email: string,
  password: string,
  opts: { trustedDevice?: boolean } = {},
): Promise<SignInResult> {
  const now = new Date();
  const hdrs = await headers();

  const rows = await sql<{
    id: string; email: string; name: string; password_hash: string | null;
    status: string; failed_login_count: number; locked_until: Date | null;
    mfa_enrolled_at: Date | null;
    tenant_id: string | null; permissions: string[] | null;
  }[]>`
    SELECT u.id, u.email, u.name, u.password_hash, u.status,
           u.failed_login_count, u.locked_until, u.mfa_enrolled_at,
           m.tenant_id, r.permissions
    FROM users u
    LEFT JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
    LEFT JOIN roles r              ON r.id = m.role_id
    WHERE lower(u.email) = lower(${email}) AND u.deleted_at IS NULL
    ORDER BY m.created_at
    LIMIT 1`;

  const user = rows[0];

  // Spend the same time on an unknown email as on a real one. Without this the
  // identical error message the domain produces is undone by a stopwatch.
  const passwordMatches = user?.password_hash
    ? await verifyPassword(user.password_hash, password)
    : await burnPasswordTime(password).then(() => false);

  const lockout = {
    failedCount: user?.failed_login_count ?? 0,
    lockedUntil: user?.locked_until ?? null,
  };

  const decision: SignInDecision = decideSignIn({
    userExists: Boolean(user),
    passwordSet: Boolean(user?.password_hash),
    passwordMatches,
    status: user?.status ?? 'active',
    hasActiveMembership: Boolean(user?.tenant_id),
    lockout,
    permissions: (user?.permissions ?? []) as readonly Permission[],
    mfaEnrolled: Boolean(user?.mfa_enrolled_at),
    asAt: now,
  });

  if (!decision.ok) {
    if (user && decision.countsAsFailedAttempt) {
      const next = recordFailure(lockout, now);
      await sql`
        UPDATE users SET failed_login_count = ${next.failedCount},
                         locked_until = ${next.lockedUntil}
        WHERE id = ${user.id}::uuid`;
    }
    if (user) await auditAuth(user.id, user.tenant_id, 'sign_in_failed', decision.failure ?? null);
    return { ok: false, ...(decision.message ? { message: decision.message } : {}) };
  }

  const cleared = recordSuccess();
  await sql`
    UPDATE users SET failed_login_count = ${cleared.failedCount},
                     locked_until = ${cleared.lockedUntil}, last_login_at = now()
    WHERE id = ${user!.id}::uuid`;

  const token = newSessionToken();
  const trusted = opts.trustedDevice ?? false;
  await sql`
    INSERT INTO sessions (user_id, tenant_id, token_hash, user_agent, ip,
                          trusted_device, expires_at)
    VALUES (${user!.id}::uuid, ${user!.tenant_id}::uuid, ${hashSessionToken(token)},
            ${hdrs.get('user-agent')}, ${clientIp(hdrs)}, ${trusted},
            ${sessionExpiry(now, trusted)})`;

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,                       // JavaScript must never read it
    sameSite: 'lax',                      // survives a normal link, blocks CSRF POSTs
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    expires: sessionExpiry(now, trusted),
  });

  await auditAuth(user!.id, user!.tenant_id, 'sign_in', null);
  return { ok: true, mfaEnrolmentRequired: decision.mfaEnrolmentRequired };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && isWellFormedToken(token)) {
    // Revoked, never deleted: "this session ended, and when" is the record a
    // dealer needs when a laptop goes missing.
    await sql`UPDATE sessions SET revoked_at = now()
              WHERE token_hash = ${hashSessionToken(token)} AND revoked_at IS NULL`;
  }
  jar.delete(SESSION_COOKIE);
}

const clientIp = (hdrs: Headers): string | null =>
  hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? null;

/**
 * Sign-in and sign-out are audited like any other mutation.
 *
 * Written outside a tenant context on purpose — a failed sign-in may have no
 * tenant at all, and the one thing worse than an unattributed audit row is no
 * audit row. Rows without a tenant are skipped rather than guessed at.
 */
async function auditAuth(
  userId: string,
  tenantId: string | null,
  action: string,
  detail: string | null,
): Promise<void> {
  if (!tenantId) return;
  await sql`
    INSERT INTO audit_events (tenant_id, actor_type, actor_id, resource_type,
                              resource_id, action, diff, occurred_at)
    VALUES (${tenantId}::uuid, 'user', ${userId}::uuid, 'session',
            ${userId}::uuid, ${action},
            ${detail ? sql.json({ failure: detail }) : null}, now())`;
}

export async function markStepUp(sessionId: string): Promise<void> {
  await sql`UPDATE sessions SET step_up_satisfied_at = now() WHERE id = ${sessionId}::uuid`;
}

export async function markMfaSatisfied(sessionId: string): Promise<void> {
  await sql`UPDATE sessions SET mfa_satisfied_at = now() WHERE id = ${sessionId}::uuid`;
}
