import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  checkPassword, passwordAcceptable, MIN_PASSWORD_LENGTH,
  isLockedOut, recordFailure, recordSuccess, lockoutMessage,
  MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES,
  decideSignIn, checkSession, sessionExpiry, stepUpSatisfied,
  SESSION_IDLE_MINUTES, SESSION_ABSOLUTE_HOURS, STEP_UP_MINUTES,
  isWellFormedToken, SESSION_TOKEN_LENGTH,
  totpCounters, truncateOtp, TOTP_STEP_SECONDS,
  type LockoutState, type SessionState,
} from './auth.js';
import type { Permission } from './permissions.js';

const AT = (h: number, m = 0): Date => new Date(Date.UTC(2026, 7, 3, h, m));

// ------------------------------------------------------------- passwords

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(passwordAcceptable('correct horse battery staple')).toBe(true);
  });

  it('rejects anything under the minimum length', () => {
    const problems = checkPassword('short1');
    expect(problems.map((p) => p.code)).toContain('too_short');
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('does NOT demand a symbol or a digit', () => {
    // Complexity rules produce `Password1!` on every account in the building.
    // Length is what actually helps, so the policy asks for length.
    expect(passwordAcceptable('thistlewhistlecandle')).toBe(true);
  });

  it('rejects a common password even when it is long enough', () => {
    expect(checkPassword('passwordpassword').map((p) => p.code)).toContain('banned');
  });

  it('rejects trade words a dealer reaches for first', () => {
    expect(checkPassword('forecourt2026!!').map((p) => p.code)).toContain('banned');
    expect(checkPassword('kenningtoncarsales').map((p) => p.code)).toContain('banned');
  });

  it('rejects a password containing the user’s own name or email', () => {
    expect(checkPassword('whitfieldwhitfield', { name: 'whitfield' })
      .map((p) => p.code)).toContain('contains_identity');
    expect(checkPassword('marie.whitfield.99', { email: 'marie.whitfield@example.com' })
      .map((p) => p.code)).toContain('contains_identity');
  });

  it('ignores a very short name rather than banning half the alphabet', () => {
    // A user called "Jo" must not make every password containing "jo" invalid.
    expect(passwordAcceptable('projectorlantern', { name: 'Jo' })).toBe(true);
  });

  it('rejects one character repeated', () => {
    expect(checkPassword('aaaaaaaaaaaaaaaa').map((p) => p.code)).toContain('single_character');
  });

  it('reports EVERY problem, not just the first', () => {
    // Short AND banned AND identity-containing. Fixing one at a time turns a
    // password reset into four attempts.
    const problems = checkPassword('admin', { email: 'admin@x.co.uk' });
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.map((p) => p.code)).toContain('too_short');
    expect(problems.map((p) => p.code)).toContain('banned');
  });

  it('every problem explains what to do instead', () => {
    for (const p of checkPassword('admin', { email: 'admin@x.co.uk' })) {
      expect(p.message.length).toBeGreaterThan(20);
    }
  });

  it('property: any passphrase of four unrelated long words is accepted', () => {
    fc.assert(fc.property(
      fc.array(fc.stringMatching(/^[a-z]{5,9}$/), { minLength: 4, maxLength: 4 }),
      (words) => {
        const phrase = words.join(' ');
        // Only assert when the generator has not accidentally produced a
        // banned substring — the blocklist is allowed to win.
        const problems = checkPassword(phrase);
        if (problems.some((p) => p.code === 'banned')) return;
        expect(problems).toEqual([]);
      },
    ));
  });
});

// --------------------------------------------------------------- lockout

describe('lockout', () => {
  const fresh: LockoutState = { failedCount: 0, lockedUntil: null };

  it('does not lock before the threshold', () => {
    let state = fresh;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) state = recordFailure(state, AT(9));
    expect(state.failedCount).toBe(MAX_FAILED_ATTEMPTS - 1);
    expect(isLockedOut(state, AT(9))).toBe(false);
  });

  it('locks exactly at the threshold', () => {
    let state = fresh;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) state = recordFailure(state, AT(9));
    expect(isLockedOut(state, AT(9))).toBe(true);
  });

  it('releases on time, not on a correct guess', () => {
    let state = fresh;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) state = recordFailure(state, AT(9));
    expect(isLockedOut(state, AT(9, LOCKOUT_MINUTES - 1))).toBe(true);
    expect(isLockedOut(state, AT(9, LOCKOUT_MINUTES + 1))).toBe(false);
  });

  it('only a genuine success clears the counter', () => {
    expect(recordSuccess()).toEqual({ failedCount: 0, lockedUntil: null });
  });

  it('says how long is left, and what to do', () => {
    let state = fresh;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) state = recordFailure(state, AT(9));
    const message = lockoutMessage(state, AT(9, 5))!;
    expect(message).toMatch(/10 minutes/);
    expect(message).toMatch(/reset it/);
  });

  it('says nothing when not locked out', () => {
    expect(lockoutMessage(fresh, AT(9))).toBeNull();
  });
});

// --------------------------------------------------------------- sign-in

const SAFE: Permission[] = ['vehicle.read'];
const SENSITIVE: Permission[] = ['finance.commission.read'];

const attempt = (over: Partial<Parameters<typeof decideSignIn>[0]> = {}) => decideSignIn({
  userExists: true, passwordSet: true, passwordMatches: true,
  status: 'active', hasActiveMembership: true,
  lockout: { failedCount: 0, lockedUntil: null },
  permissions: SAFE, mfaEnrolled: false, asAt: AT(9),
  ...over,
});

describe('the sign-in decision', () => {
  it('lets a correct credential through', () => {
    expect(attempt().ok).toBe(true);
  });

  it('gives a WRONG PASSWORD and an UNKNOWN EMAIL the identical message', () => {
    // Told apart, they enumerate who has an account here — which is a list of
    // this dealership's staff, and of our customers.
    const wrongPassword = attempt({ passwordMatches: false });
    const unknownEmail = attempt({ userExists: false, passwordSet: false, passwordMatches: false });
    expect(wrongPassword.message).toBe(unknownEmail.message);
    expect(wrongPassword.ok).toBe(false);
    expect(unknownEmail.ok).toBe(false);
  });

  it('counts a failure against a real account but not against an unknown one', () => {
    expect(attempt({ passwordMatches: false }).countsAsFailedAttempt).toBe(true);
    expect(attempt({ userExists: false, passwordMatches: false }).countsAsFailedAttempt).toBe(false);
  });

  it('refuses while locked out, and does NOT extend the lockout', () => {
    // Otherwise anyone can keep a colleague locked out indefinitely by
    // hammering the form.
    const decision = attempt({
      lockout: { failedCount: 9, lockedUntil: AT(9, 10) },
    });
    expect(decision.failure).toBe('locked_out');
    expect(decision.countsAsFailedAttempt).toBe(false);
  });

  it('refuses a disabled account with its own message', () => {
    const decision = attempt({ status: 'suspended' });
    expect(decision.failure).toBe('account_disabled');
    expect(decision.message).toMatch(/disabled/);
  });

  it('refuses an account with no active membership', () => {
    expect(attempt({ hasActiveMembership: false }).failure).toBe('no_membership');
  });

  it('an account with no password set fails like a wrong password', () => {
    const decision = attempt({ passwordSet: false, passwordMatches: false });
    expect(decision.ok).toBe(false);
    expect(decision.message).toMatch(/do not match/);
  });

  it('requires MFA enrolment based on PERMISSIONS, not on the role name', () => {
    // Granting a sensitive permission to any role makes MFA mandatory for that
    // person, with nobody maintaining a list of role names.
    expect(attempt({ permissions: SENSITIVE, mfaEnrolled: false }).mfaEnrolmentRequired).toBe(true);
    expect(attempt({ permissions: SENSITIVE, mfaEnrolled: true }).mfaEnrolmentRequired).toBe(false);
    expect(attempt({ permissions: SAFE, mfaEnrolled: false }).mfaEnrolmentRequired).toBe(false);
  });

  it('a failed sign-in never reports MFA state', () => {
    // It would confirm the account exists and hint at its privilege level.
    expect(attempt({ passwordMatches: false, permissions: SENSITIVE }).mfaEnrolmentRequired)
      .toBe(false);
  });
});

// -------------------------------------------------------------- sessions

describe('session validity', () => {
  const session = (over: Partial<SessionState> = {}): SessionState => ({
    createdAt: AT(9), lastSeenAt: AT(9), expiresAt: AT(21),
    revokedAt: null, trustedDevice: false, ...over,
  });

  it('accepts a fresh session', () => {
    expect(checkSession(session(), AT(9, 30)).valid).toBe(true);
  });

  it('rejects a revoked session', () => {
    expect(checkSession(session({ revokedAt: AT(9, 5) }), AT(9, 30)).reason).toBe('revoked');
  });

  it('rejects past the ABSOLUTE expiry even if actively used', () => {
    // The failure an idle-only timeout has: a tab left open on a shared
    // forecourt machine never ends.
    const active = session({ lastSeenAt: AT(21), expiresAt: AT(21) });
    expect(checkSession(active, AT(21, 1)).reason).toBe('expired');
  });

  it('rejects an idle session inside its absolute lifetime', () => {
    const idle = session({ lastSeenAt: AT(9) });
    expect(checkSession(idle, AT(10, 1)).reason).toBe('idle');
  });

  it('the idle window is exactly the stated one', () => {
    const idle = session({ lastSeenAt: AT(9) });
    expect(checkSession(idle, AT(9, SESSION_IDLE_MINUTES)).valid).toBe(true);
    expect(checkSession(idle, AT(9, SESSION_IDLE_MINUTES + 1)).valid).toBe(false);
  });

  it('every rejection tells the person what to do', () => {
    for (const s of [
      session({ revokedAt: AT(9) }),
      session({ expiresAt: AT(9) }),
      session({ lastSeenAt: AT(7) }),
    ]) {
      expect(checkSession(s, AT(9, 30)).message).toMatch(/Sign in again/);
    }
  });

  it('a trusted device gets a longer ABSOLUTE life', () => {
    const plain = sessionExpiry(AT(9), false);
    const trusted = sessionExpiry(AT(9), true);
    expect(plain.getTime()).toBe(AT(9).getTime() + SESSION_ABSOLUTE_HOURS * 3_600_000);
    expect(trusted.getTime()).toBeGreaterThan(plain.getTime());
  });

  it('a trusted device does NOT get a longer idle window', () => {
    // Trust says "this laptop is ours", not "nobody will walk past it".
    const idle = session({ trustedDevice: true, lastSeenAt: AT(9), expiresAt: AT(23) });
    expect(checkSession(idle, AT(10, 30)).reason).toBe('idle');
  });
});

describe('step-up re-authentication', () => {
  it('is good for a short window and then is not', () => {
    expect(stepUpSatisfied(AT(9), AT(9, STEP_UP_MINUTES - 1))).toBe(true);
    expect(stepUpSatisfied(AT(9), AT(9, STEP_UP_MINUTES + 1))).toBe(false);
  });

  it('never satisfied when it never happened', () => {
    expect(stepUpSatisfied(null, AT(9))).toBe(false);
  });
});

describe('session tokens', () => {
  it('accepts a 43-character base64url token', () => {
    expect(isWellFormedToken('a'.repeat(SESSION_TOKEN_LENGTH))).toBe(true);
    expect(isWellFormedToken('Ab9_-'.padEnd(SESSION_TOKEN_LENGTH, 'x'))).toBe(true);
  });

  it('rejects the wrong length or the wrong alphabet', () => {
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken('+'.repeat(SESSION_TOKEN_LENGTH))).toBe(false);
    expect(isWellFormedToken('='.repeat(SESSION_TOKEN_LENGTH))).toBe(false);
  });
});

// ------------------------------------------------------------------ TOTP

describe('TOTP', () => {
  it('offers one step either side for clock drift', () => {
    const counters = totpCounters(AT(9));
    expect(counters).toHaveLength(3);
    expect(counters[1]! - counters[0]!).toBe(1);
  });

  it('the window is narrow on purpose', () => {
    // Each extra step is another 30 seconds in which a shoulder-surfed code
    // still works.
    expect(totpCounters(AT(9), 1)).toHaveLength(3);
    expect(totpCounters(AT(9), 0)).toHaveLength(1);
  });

  it('the counter advances once per step', () => {
    const before = totpCounters(new Date(Date.UTC(2026, 7, 3, 9, 0, 0)), 0)[0]!;
    const after = totpCounters(
      new Date(Date.UTC(2026, 7, 3, 9, 0, TOTP_STEP_SECONDS)), 0)[0]!;
    expect(after - before).toBe(1);
  });

  it('truncates an RFC 4226 test vector correctly', () => {
    // The published HMAC-SHA1 digest for counter 0 of the RFC's shared secret,
    // whose expected code is 755224.
    const digest = Uint8Array.from(Buffer.from(
      'cc93cf18508d94934c64b65d8ba7667fb7cde4b0', 'hex'));
    expect(truncateOtp(digest)).toBe('755224');
  });

  it('always produces exactly six digits, zero-padded', () => {
    fc.assert(fc.property(
      fc.uint8Array({ minLength: 20, maxLength: 20 }),
      (bytes) => {
        const code = truncateOtp(bytes);
        expect(code).toMatch(/^\d{6}$/);
      },
    ));
  });
});
