import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/data/db';
import { hashResetToken, newResetToken, hashRecoveryCode, newRecoveryCode } from '@/auth/crypto';
import { checkResetToken, resetTokenExpiry } from '@forecourt/domain';
import { ensureFixtures, T } from './fixtures';

/**
 * Reset tokens and recovery codes against the real database.
 *
 * The policy is unit-tested in `auth.test.ts`. What only exists once there is
 * a database is the SPEND: that a token or a code can be used exactly once
 * even when two requests arrive together, because the check and the spend are
 * one statement rather than a read followed by a write.
 */

let ready = false;
let reason = '';

beforeAll(async () => {
  try {
    await ensureFixtures();
    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  if (ready) {
    await sql`DELETE FROM password_reset_tokens WHERE user_id = ${T.user}::uuid`;
    await sql`DELETE FROM mfa_recovery_codes WHERE user_id = ${T.user}::uuid`;
  }
  await sql.end();
});

it('the auth integration fixtures build', () => {
  expect(ready, `Could not build the integration fixtures: ${reason}`).toBe(true);
});

describe('reset tokens', () => {
  const issue = async (expiresAt?: Date): Promise<string> => {
    const token = newResetToken();
    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${T.user}::uuid, ${hashResetToken(token)},
              ${expiresAt ?? resetTokenExpiry(new Date())})`;
    return token;
  };

  /** The spend, exactly as `completeReset` does it. */
  const spend = async (token: string): Promise<boolean> => {
    const rows = await sql<{ id: string }[]>`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE token_hash = ${hashResetToken(token)} AND used_at IS NULL
      RETURNING id`;
    return rows.length > 0;
  };

  it('the raw token is never stored', async () => {
    const token = await issue();
    const [row] = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM password_reset_tokens
      WHERE user_id = ${T.user}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toBe(hashResetToken(token));
  });

  it('can be spent exactly ONCE', async () => {
    // A link sitting in an inbox, or in a mail server's log, must not still
    // work next month.
    const token = await issue();
    expect(await spend(token)).toBe(true);
    expect(await spend(token)).toBe(false);
  });

  it('two simultaneous spends cannot both succeed', async () => {
    // The check and the spend are one UPDATE precisely so this race has one
    // winner. A read-then-write would let both through.
    const token = await issue();
    const results = await Promise.all([spend(token), spend(token), spend(token)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('an expired token is refused by the domain check', async () => {
    const past = new Date(Date.now() - 60_000);
    const token = newResetToken();
    // `expires_at > created_at` is a CHECK constraint, so an already-expired
    // row is inserted by back-dating creation — which is what a token issued
    // an hour ago looks like.
    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (${T.user}::uuid, ${hashResetToken(token)}, ${past},
              ${new Date(past.getTime() - 60_000)})`;

    const [row] = await sql<{ expires_at: Date; used_at: Date | null }[]>`
      SELECT expires_at, used_at FROM password_reset_tokens
      WHERE token_hash = ${hashResetToken(token)}`;

    // Mapped, not passed straight through: the row is snake_case, and handing
    // it to `checkResetToken` directly leaves `usedAt` undefined — which reads
    // as "already used" and hides the expiry it was meant to test.
    expect(checkResetToken(
      { expiresAt: row!.expires_at, usedAt: row!.used_at },
      new Date(),
    ).problem).toBe('expired');
  });

  it('an unknown token is refused with the same message as an expired one', async () => {
    const unknown = checkResetToken(null, new Date());
    const used = checkResetToken(
      { expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() }, new Date());
    expect(unknown.message).toBe(used.message);
  });
});

describe('recovery codes', () => {
  const issue = async (): Promise<string> => {
    const code = newRecoveryCode();
    await sql`
      INSERT INTO mfa_recovery_codes (user_id, code_hash)
      VALUES (${T.user}::uuid, ${hashRecoveryCode(code)})`;
    return code;
  };

  /** The spend, exactly as `completeChallenge` does it. */
  const spend = async (code: string): Promise<boolean> => {
    const rows = await sql<{ id: string }[]>`
      UPDATE mfa_recovery_codes SET used_at = now()
      WHERE user_id = ${T.user}::uuid AND code_hash = ${hashRecoveryCode(code)}
        AND used_at IS NULL
      RETURNING id`;
    return rows.length > 0;
  };

  it('the raw code is never stored', async () => {
    const code = await issue();
    const [row] = await sql<{ code_hash: string }[]>`
      SELECT code_hash FROM mfa_recovery_codes
      WHERE user_id = ${T.user}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(row!.code_hash).not.toBe(code);
  });

  it('works once and then never again', async () => {
    const code = await issue();
    expect(await spend(code)).toBe(true);
    expect(await spend(code)).toBe(false);
  });

  it('is accepted in lower case with the dash missing', async () => {
    // Somebody is reading this off paper, in a hurry, because they have lost
    // their phone.
    const code = await issue();
    expect(await spend(code.toLowerCase().replace('-', ''))).toBe(true);
  });

  it('two simultaneous uses cannot both succeed', async () => {
    const code = await issue();
    const results = await Promise.all([spend(code), spend(code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a code is unique across the whole table, so one user cannot spend another’s', async () => {
    const code = newRecoveryCode();
    await sql`
      INSERT INTO mfa_recovery_codes (user_id, code_hash)
      VALUES (${T.user}::uuid, ${hashRecoveryCode(code)})`;
    // The unique index on code_hash means a second row with the same hash —
    // for any user — is refused outright.
    await expect(sql`
      INSERT INTO mfa_recovery_codes (user_id, code_hash)
      VALUES (${T.user}::uuid, ${hashRecoveryCode(code)})`).rejects.toThrow(/unique/i);
  });
});

describe('the attempt log', () => {
  const IP = '203.0.113.200';

  afterAll(async () => {
    await sql`DELETE FROM auth_attempts WHERE ip = ${IP}`;
  });

  it('counts failures per address AND per identifier', async () => {
    await sql`DELETE FROM auth_attempts WHERE ip = ${IP}`;
    for (let i = 0; i < 4; i += 1) {
      await sql`
        INSERT INTO auth_attempts (kind, ip, identifier, succeeded)
        VALUES ('password', ${IP}, 'target@example.test', false)`;
    }

    const [counts] = await sql<{ by_ip: number; by_identifier: number }[]>`
      SELECT * FROM count_auth_attempts('password'::auth_attempt_kind, ${IP},
        'target@example.test', now() - interval '15 minutes')`;

    expect(counts!.by_ip).toBe(4);
    expect(counts!.by_identifier).toBe(4);
  });

  it('does not count a SUCCESS against the budget', async () => {
    await sql`
      INSERT INTO auth_attempts (kind, ip, identifier, succeeded)
      VALUES ('password', ${IP}, 'target@example.test', true)`;

    const [counts] = await sql<{ by_ip: number }[]>`
      SELECT * FROM count_auth_attempts('password'::auth_attempt_kind, ${IP},
        'target@example.test', now() - interval '15 minutes')`;
    expect(counts!.by_ip).toBe(4);
  });

  it('counts an attempt against an account that does not exist', async () => {
    // Otherwise enumerating who has an account here is free: a stranger's
    // typo would cost the attacker nothing.
    await sql`
      INSERT INTO auth_attempts (kind, ip, identifier, succeeded)
      VALUES ('password', ${IP}, 'nobody-at-all@example.test', false)`;

    const [counts] = await sql<{ by_ip: number }[]>`
      SELECT * FROM count_auth_attempts('password'::auth_attempt_kind, ${IP}, NULL,
        now() - interval '15 minutes')`;
    expect(counts!.by_ip).toBe(5);
  });
});
