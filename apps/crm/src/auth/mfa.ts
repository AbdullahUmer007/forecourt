'use server';

// NOTE: nothing but async functions may be exported from this file — it
// carries `'use server'`. Types live in the modules they belong to.

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { sql } from '@/data/db';
import {
  requireSession, checkRateLimit, recordAttempt, markMfaSatisfied,
} from './session';
import {
  newTotpSecret, verifyTotp, totpUri, newRecoveryCode, hashRecoveryCode,
} from './crypto';
import { RECOVERY_CODE_COUNT } from '@forecourt/domain';

/**
 * Enrolment, the challenge, and recovery.
 *
 * The ordering rule that matters: a secret is only written to `users` AFTER a
 * code generated from it verifies. Enabling MFA on an unverified secret locks
 * the user out of their own account with no way back in — and the accounts
 * that mandate MFA are the ones holding commission and evidence-export
 * permissions, which is to say the ones nobody can afford to lose.
 */

const ip = async (): Promise<string | null> => {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
};

export interface EnrolmentOffer {
  secret: string;
  uri: string;
}

/**
 * Produce a candidate secret and the URI an authenticator scans.
 *
 * Deliberately NOT stored yet. The secret lives in the enrolment form until a
 * code proves the user actually scanned it.
 */
export async function beginEnrolment(): Promise<EnrolmentOffer> {
  const session = await requireSession();
  const secret = newTotpSecret();
  return { secret, uri: totpUri(secret, session.email) };
}

export interface EnrolmentResult {
  ok: boolean;
  error?: string;
  /** Shown ONCE. They are not recoverable afterwards, by construction. */
  recoveryCodes?: readonly string[];
}

/**
 * Confirm enrolment with a code from the app, then issue recovery codes.
 *
 * Recovery codes are issued HERE rather than offered later: a code somebody
 * has to remember to generate is one they generate the day after they needed
 * it. They are hashed on the way in and returned in the clear exactly once.
 */
export async function confirmEnrolment(
  _previous: EnrolmentResult | null,
  formData: FormData,
): Promise<EnrolmentResult> {
  const session = await requireSession();
  const secret = String(formData.get('secret') ?? '');
  const code = String(formData.get('code') ?? '');
  const from = await ip();

  const limit = await checkRateLimit('mfa', from, session.email, new Date());
  if (!limit.allowed) return { ok: false, ...(limit.message ? { error: limit.message } : {}) };

  if (!secret || !verifyTotp(secret, code, new Date())) {
    await recordAttempt('mfa', from, session.email, session.userId, false);
    return {
      ok: false,
      error: 'That code did not match. Codes change every 30 seconds — wait for the next one and try again.',
    };
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => newRecoveryCode());

  await sql.begin(async (tx) => {
    // Only now is the secret written. Before this point the user could close
    // the tab and lose nothing.
    await tx`
      UPDATE users SET mfa_secret = ${secret}, mfa_enrolled_at = now()
      WHERE id = ${session.userId}::uuid`;

    // A re-enrolment invalidates the old set. Leaving them live means an old
    // printout still opens the account after the phone was replaced because
    // the previous one was lost.
    await tx`DELETE FROM mfa_recovery_codes WHERE user_id = ${session.userId}::uuid`;

    for (const plain of codes) {
      await tx`
        INSERT INTO mfa_recovery_codes (user_id, code_hash)
        VALUES (${session.userId}::uuid, ${hashRecoveryCode(plain)})`;
    }

    await tx`
      INSERT INTO audit_events (tenant_id, actor_type, actor_id, resource_type,
                                resource_id, action, occurred_at)
      VALUES (${session.tenantId}::uuid, 'user', ${session.userId}::uuid, 'user',
              ${session.userId}::uuid, 'mfa_enrolled', now())`;
  });

  await recordAttempt('mfa', from, session.email, session.userId, true);
  await markMfaSatisfied(session.sessionId);

  return { ok: true, recoveryCodes: codes };
}

export interface ChallengeResult {
  ok: boolean;
  error?: string;
}

/**
 * The sign-in challenge: a TOTP code, or a recovery code.
 *
 * A recovery code is single-use and is consumed by an UPDATE that only matches
 * an unused row, so two simultaneous submissions of the same code cannot both
 * succeed — the check and the spend are one statement rather than a read
 * followed by a write.
 */
export async function completeChallenge(
  _previous: ChallengeResult | null,
  formData: FormData,
): Promise<ChallengeResult> {
  const session = await requireSession();
  const code = String(formData.get('code') ?? '').trim();
  const from = await ip();
  const now = new Date();

  const limit = await checkRateLimit('mfa', from, session.email, now);
  if (!limit.allowed) return { ok: false, ...(limit.message ? { error: limit.message } : {}) };

  const [user] = await sql<{ mfa_secret: string | null }[]>`
    SELECT mfa_secret FROM users WHERE id = ${session.userId}::uuid`;

  if (user?.mfa_secret && verifyTotp(user.mfa_secret, code, now)) {
    await recordAttempt('mfa', from, session.email, session.userId, true);
    await markMfaSatisfied(session.sessionId);
    redirect('/');
  }

  // Not a code from the app — try it as a recovery code. Consumed atomically.
  const spent = await sql<{ id: string }[]>`
    UPDATE mfa_recovery_codes
    SET used_at = now(), used_ip = ${from}
    WHERE user_id = ${session.userId}::uuid
      AND code_hash = ${hashRecoveryCode(code)}
      AND used_at IS NULL
    RETURNING id`;

  if (spent.length > 0) {
    await recordAttempt('recovery_code', from, session.email, session.userId, true);
    await markMfaSatisfied(session.sessionId);

    await sql`
      INSERT INTO audit_events (tenant_id, actor_type, actor_id, resource_type,
                                resource_id, action, occurred_at)
      VALUES (${session.tenantId}::uuid, 'user', ${session.userId}::uuid, 'user',
              ${session.userId}::uuid, 'mfa_recovery_code_used', now())`;
    redirect('/');
  }

  await recordAttempt('mfa', from, session.email, session.userId, false);
  return {
    ok: false,
    error: 'That code did not match. Use the six digits from your authenticator app, or one of your recovery codes.',
  };
}
