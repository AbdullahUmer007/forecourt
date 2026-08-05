'use server';

// NOTE: nothing but async functions may be exported from this file — it
// carries `'use server'`.

import { headers } from 'next/headers';
import { sql } from '@/data/db';
import { requireSession, checkRateLimit, recordAttempt } from './session';
import { hashPassword, newResetToken, hashResetToken } from './crypto';
import { authorize, checkPassword, checkResetToken, resetTokenExpiry } from '@forecourt/domain';

/**
 * Password reset.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SELF-SERVICE IS NOT BUILT, AND THE REASON IS HONEST
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Email me a reset link" needs an email adapter, and there isn't one — no
 * Postmark, no Resend, nothing in `packages/adapters` but the vehicle lookups.
 * Building a request form that silently sends nothing would be worse than not
 * building it, so what exists is the ADMIN-INITIATED path: someone with
 * `user.update` issues a link and conveys it however they already convey
 * things to their own staff.
 *
 * The token machinery is the real thing — hashed at rest, single-use,
 * thirty-minute expiry, rate-limited — so when the comms adapter lands, the
 * self-service half is a form and a job, not a rewrite.
 */

const ip = async (): Promise<string | null> => {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
};

export interface IssueResult {
  ok: boolean;
  error?: string;
  /** The link, returned ONCE. It is hashed in the database and unreadable after this. */
  link?: string;
  expiresAt?: Date;
}

/**
 * Issue a reset link for another user in this dealership.
 *
 * Scoped by membership, so an owner at one dealer cannot issue a link for
 * somebody else's staff even knowing their id — the query joins through
 * `tenant_memberships` on the caller's own tenant rather than trusting the
 * supplied id.
 */
export async function issueResetLink(
  _previous: IssueResult | null,
  formData: FormData,
): Promise<IssueResult> {
  const session = await requireSession();

  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt,
    mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'user.update');

  if (!decision.allowed) return { ok: false, error: decision.reason };

  const targetId = String(formData.get('userId') ?? '');

  const [target] = await sql<{ id: string; email: string }[]>`
    SELECT u.id, u.email
    FROM users u
    JOIN tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
    WHERE u.id = ${targetId}::uuid
      AND m.tenant_id = ${session.tenantId}::uuid
      AND u.deleted_at IS NULL`;

  if (!target) {
    return { ok: false, error: 'That person is not a member of this dealership.' };
  }

  const token = newResetToken();
  const issuedAt = new Date();
  const expiresAt = resetTokenExpiry(issuedAt);

  await sql.begin(async (tx) => {
    // Any outstanding link is spent. Two live reset links for one account is
    // one more than anybody needs and one more to steal.
    await tx`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE user_id = ${target.id}::uuid AND used_at IS NULL`;

    await tx`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip, requested_by)
      VALUES (${target.id}::uuid, ${hashResetToken(token)}, ${expiresAt},
              ${await ip()}, ${session.userId}::uuid)`;

    await tx`
      INSERT INTO audit_events (tenant_id, actor_type, actor_id, resource_type,
                                resource_id, action, occurred_at)
      VALUES (${session.tenantId}::uuid, 'user', ${session.userId}::uuid, 'user',
              ${target.id}::uuid, 'password_reset_issued', now())`;
  });

  return {
    ok: true,
    link: `/reset/${token}`,
    expiresAt,
  };
}

export interface CompleteResult {
  ok: boolean;
  error?: string;
  problems?: readonly string[];
}

/**
 * Spend a reset link and set a new password.
 *
 * The token is spent in the SAME transaction as the password change, and the
 * UPDATE only matches an unused row — so two submissions of one link cannot
 * both succeed. Every session that user has is revoked at the same time: a
 * password reset that leaves the attacker's session alive has achieved
 * nothing, and that is the whole reason someone resets a password.
 */
export async function completeReset(
  _previous: CompleteResult | null,
  formData: FormData,
): Promise<CompleteResult> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const from = await ip();
  const now = new Date();

  const limit = await checkRateLimit('password_reset', from, token.slice(0, 12), now);
  if (!limit.allowed) return { ok: false, ...(limit.message ? { error: limit.message } : {}) };

  const [row] = await sql<{
    id: string; user_id: string; email: string; name: string;
    expires_at: Date; used_at: Date | null;
  }[]>`
    SELECT t.id, t.user_id, u.email, u.name, t.expires_at, t.used_at
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${hashResetToken(token)}`;

  const check = checkResetToken(
    row ? { expiresAt: row.expires_at, usedAt: row.used_at } : null,
    now,
  );
  if (!check.valid) {
    await recordAttempt('password_reset', from, token.slice(0, 12), row?.user_id ?? null, false);
    return { ok: false, ...(check.message ? { error: check.message } : {}) };
  }

  const problems = checkPassword(password, { email: row!.email, name: row!.name });
  if (problems.length > 0) {
    return {
      ok: false,
      error: 'That password cannot be used.',
      problems: problems.map((p) => p.message),
    };
  }

  const hash = await hashPassword(password);

  const spent = await sql.begin(async (tx) => {
    // Only matches an unused row, so a second submission of the same link
    // changes nothing — the check and the spend are one statement.
    const used = await tx<{ id: string }[]>`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE id = ${row!.id}::uuid AND used_at IS NULL
      RETURNING id`;
    if (used.length === 0) return false;

    await tx`
      UPDATE users
      SET password_hash = ${hash}, failed_login_count = 0, locked_until = NULL
      WHERE id = ${row!.user_id}::uuid`;

    // Every existing session goes. A reset that leaves the intruder signed in
    // has achieved nothing, which is the whole reason someone resets.
    await tx`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = ${row!.user_id}::uuid AND revoked_at IS NULL`;

    return true;
  });

  if (!spent) {
    await recordAttempt('password_reset', from, token.slice(0, 12), row!.user_id, false);
    return { ok: false, error: 'That reset link has already been used.' };
  }

  await recordAttempt('password_reset', from, token.slice(0, 12), row!.user_id, true);
  return { ok: true };
}
