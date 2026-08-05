/**
 * Platform operator authentication.
 *
 * SEPARATE from the CRM's, deliberately and at every level:
 *
 *  - a different cookie name, so a CRM session is not an admin session and
 *    cannot become one by being sent to a different port
 *  - a different table for identity — `platform_operators`, not
 *    `tenant_memberships` — so being a dealer's owner grants nothing here
 *  - MFA required unconditionally, not per-permission. Every screen in this
 *    application can see across every dealership on the platform; there is no
 *    read here that is casual enough to skip a second factor for.
 *  - a shorter session. Support access is a visit, not a place somebody works
 *    all day.
 *
 * The reason the separation is this hard: §28 exists because one member of
 * Forecourt staff being able to read a dealer's customer data quietly is the
 * failure that ends the company faster than a tenant leak, because it is
 * deliberate rather than accidental.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '@/data/db';

/** Not `forecourt_session`. A CRM cookie must never be an admin cookie. */
export const OPERATOR_COOKIE = 'forecourt_operator';

/** Four hours. A support visit, not a working day. */
const SESSION_HOURS = 4;

export type OperatorRole =
  | 'support_read' | 'support' | 'approver' | 'billing' | 'admin';

export interface OperatorSession {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: OperatorRole;
  mfaSatisfiedAt: Date | null;
  /** A correct password with no second factor. It EXISTS and must reach nothing. */
  mfaPending: boolean;
  /** Platform access with no enrolled second factor is refused outright. */
  mfaEnrolmentRequired: boolean;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * What a role may do.
 *
 * Deliberately small and explicit rather than a permission catalogue: there
 * are five roles and four things worth gating, and a table somebody can read
 * in ten seconds is a table somebody checks.
 */
export const OPERATOR_CAN: Record<OperatorRole, readonly string[]> = {
  support_read: ['tenant.read'],
  support: ['tenant.read', 'impersonate.request'],
  // An approver cannot request access themselves — that is the four-eyes rule,
  // and it is also a CHECK constraint (`elevated_by <> operator_id`) so it
  // holds even if this table is edited carelessly.
  approver: ['tenant.read', 'impersonate.approve'],
  billing: ['tenant.read', 'billing.update'],
  admin: ['tenant.read', 'impersonate.request', 'impersonate.approve',
    'billing.update', 'operator.manage'],
};

export const operatorCan = (session: OperatorSession, action: string): boolean =>
  OPERATOR_CAN[session.role].includes(action);

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const token = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!token) return null;

  const [row] = await sql`
    SELECT s.id, s.user_id, s.mfa_satisfied_at, s.expires_at,
           u.email, u.name, u.mfa_enrolled_at,
           o.role::text AS role
    FROM operator_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN platform_operators o ON o.user_id = s.user_id AND o.revoked_at IS NULL
    WHERE s.token_hash = ${hashToken(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()`;

  if (!row) return null;

  const mfaSatisfiedAt = row['mfa_satisfied_at'] === null
    ? null : new Date(row['mfa_satisfied_at'] as string);
  const enrolled = row['mfa_enrolled_at'] !== null;

  return {
    sessionId: String(row['id']),
    userId: String(row['user_id']),
    email: String(row['email']),
    displayName: String(row['name']),
    role: row['role'] as OperatorRole,
    mfaSatisfiedAt,
    // Unconditional. Every screen here reads across every dealership.
    mfaPending: enrolled && mfaSatisfiedAt === null,
    mfaEnrolmentRequired: !enrolled,
  };
}

/** Redirects rather than throwing, so a page never renders half-signed-in. */
export async function requireOperator(): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect('/sign-in');
  if (session.mfaPending || session.mfaEnrolmentRequired) redirect('/sign-in?mfa=1');
  return session;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Sign in as an operator.
 *
 * The failure message is identical whether the email is unknown, the password
 * is wrong, or the person is simply not Forecourt staff. Distinguishing them
 * tells an attacker which of our own colleagues' addresses are worth trying.
 */
export async function signInOperator(
  email: string,
  password: string,
  verify: (hash: string, password: string) => Promise<boolean>,
): Promise<SignInResult & { token?: string }> {
  const generic = {
    ok: false,
    error: 'That email address and password do not match a Forecourt operator account.',
  };

  const [row] = await sql`
    SELECT u.id, u.password_hash, u.status
    FROM users u
    JOIN platform_operators o ON o.user_id = u.id AND o.revoked_at IS NULL
    WHERE lower(u.email) = lower(${email})`;

  if (!row || row['status'] !== 'active') {
    // Burn comparable time so a missing account is not faster than a wrong
    // password — the CRM learned this the same way.
    await verify('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password);
    return generic;
  }

  const correct = await verify(String(row['password_hash']), password);
  if (!correct) return generic;

  const token = newToken();
  await sql`
    INSERT INTO operator_sessions (user_id, token_hash, expires_at)
    VALUES (${String(row['id'])}::uuid, ${hashToken(token)},
            now() + (${SESSION_HOURS} || ' hours')::interval)`;

  return { ok: true, token };
}

export async function setOperatorCookie(token: string): Promise<void> {
  (await cookies()).set(OPERATOR_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function signOutOperator(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(OPERATOR_COOKIE)?.value;
  if (token) {
    await sql`
      UPDATE operator_sessions SET revoked_at = now()
      WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL`;
  }
  jar.delete(OPERATOR_COOKIE);
}

/** Constant-time compare, for anything secret-shaped. */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};
