/**
 * Authentication policy.
 *
 * Everything here is a pure decision — no hashing, no database, no cookies.
 * The argon2 call and the session row live in the app; what belongs in the
 * domain is the set of rules that must hold identically wherever they are
 * asked, and which are easy to get subtly wrong in a request handler:
 *
 *   1. WHY a sign-in failed is not told to the person signing in. A wrong
 *      password and an unknown email produce the same answer, because the
 *      difference is a list of who has an account here.
 *
 *   2. Lockout counts failures and releases on time, not on a successful
 *      guess. It also refuses to be reset by anything except a genuine
 *      success — an attacker who can trigger a reset has no lockout.
 *
 *   3. A session has BOTH an absolute lifetime and an idle timeout. Only the
 *      idle one is refreshed by use; a session that has been alive for
 *      fourteen days ends whether or not somebody is still clicking.
 *
 *   4. MFA is required by what a role can DO, not by which role it is. A
 *      dealer who grants `finance.commission.read` to a business manager has
 *      just made MFA mandatory for that person, without anyone remembering to
 *      update a list of role names.
 */

import { requiresMfa, type Permission } from './permissions.js';

// ------------------------------------------------------------- passwords

/**
 * NCSC guidance rather than the classic complexity rules: length is what
 * matters, and forcing a symbol produces `Password1!` on every account in the
 * dealership. The blocklist is the part that actually helps.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Rejected outright. Short, and deliberately about THIS product: a dealer
 * setting a password for a forecourt system reaches for the trade words first.
 */
const BANNED = [
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin',
  'forecourt', 'dealership', 'carsales', 'motortrade', '123456', 'iloveyou',
  'changeme', 'monkey', 'dragon', 'football', 'sunshine',
];

export interface PasswordProblem {
  code: 'too_short' | 'too_long' | 'banned' | 'contains_identity' | 'single_character';
  message: string;
}

/**
 * Reports EVERY problem, not the first.
 *
 * Same reasoning as M9's soft opt-in test: short-circuiting turns one fix into
 * four attempts, and a password form that rejects you four times in a row is
 * how people end up writing it on a card by the till.
 */
export function checkPassword(
  password: string,
  identity: { email?: string; name?: string } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const lower = password.toLowerCase();

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push({
      code: 'too_short',
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters. Three or four unrelated words is easier to remember and harder to guess than a short one with symbols in it.`,
    });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push({
      code: 'too_long',
      message: `That is longer than ${MAX_PASSWORD_LENGTH} characters.`,
    });
  }
  if (BANNED.some((b) => lower.includes(b))) {
    problems.push({
      code: 'banned',
      message: 'That contains a very common password. Pick something that is not on every guess list.',
    });
  }

  const local = identity.email?.split('@')[0]?.toLowerCase();
  const parts = [local, identity.name?.toLowerCase()].filter(
    (p): p is string => typeof p === 'string' && p.length >= 4,
  );
  if (parts.some((p) => lower.includes(p))) {
    problems.push({
      code: 'contains_identity',
      message: 'That contains your name or email address, which is the first thing anyone tries.',
    });
  }

  if (password.length > 0 && new Set(password).size === 1) {
    problems.push({
      code: 'single_character',
      message: 'That is the same character repeated.',
    });
  }

  return problems;
}

export const passwordAcceptable = (
  password: string,
  identity?: { email?: string; name?: string },
): boolean => checkPassword(password, identity).length === 0;

// --------------------------------------------------------------- lockout

export const MAX_FAILED_ATTEMPTS = 8;
export const LOCKOUT_MINUTES = 15;

export interface LockoutState {
  failedCount: number;
  lockedUntil: Date | null;
}

export const isLockedOut = (state: LockoutState, asAt: Date): boolean =>
  state.lockedUntil !== null && state.lockedUntil.getTime() > asAt.getTime();

/**
 * The new lockout state after a failed attempt.
 *
 * Returned rather than mutated, so the caller has a value it must persist and
 * cannot silently forget — the same shape as M11's `allocateNumber`.
 */
export function recordFailure(state: LockoutState, asAt: Date): LockoutState {
  const failedCount = state.failedCount + 1;
  if (failedCount < MAX_FAILED_ATTEMPTS) return { failedCount, lockedUntil: null };
  return {
    failedCount,
    lockedUntil: new Date(asAt.getTime() + LOCKOUT_MINUTES * 60_000),
  };
}

/** Only a genuine success clears the count. Nothing else may. */
export const recordSuccess = (): LockoutState => ({ failedCount: 0, lockedUntil: null });

export const lockoutMessage = (state: LockoutState, asAt: Date): string | null => {
  if (!isLockedOut(state, asAt)) return null;
  const minutes = Math.max(
    1, Math.ceil((state.lockedUntil!.getTime() - asAt.getTime()) / 60_000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, ` +
    'or ask whoever manages your dealership account to reset it.';
};

// --------------------------------------------------------------- sign-in

export type SignInFailure =
  | 'invalid_credentials'
  | 'locked_out'
  | 'account_disabled'
  | 'no_membership'
  | 'password_not_set';

export interface SignInDecision {
  ok: boolean;
  failure?: SignInFailure;
  /** What the person signing in is told. Deliberately uniform — see below. */
  message?: string;
  /** True when the failure should increment the lockout counter. */
  countsAsFailedAttempt: boolean;
  /** MFA is required by this account's permissions but not yet enrolled. */
  mfaEnrolmentRequired: boolean;
}

/**
 * The single message every credential failure gets.
 *
 * "No account with that email" and "wrong password" are the same sentence on
 * purpose: told apart, they enumerate who has an account here — which for a
 * dealer CRM is a list of that dealership's staff, and for a multi-tenant
 * platform is a list of our customers.
 */
const UNIFORM_FAILURE =
  'That email address and password do not match. Check both and try again.';

export function decideSignIn(input: {
  userExists: boolean;
  passwordSet: boolean;
  passwordMatches: boolean;
  status: string;
  hasActiveMembership: boolean;
  lockout: LockoutState;
  permissions: readonly Permission[];
  mfaEnrolled: boolean;
  asAt: Date;
}): SignInDecision {
  const base = { mfaEnrolmentRequired: false };

  if (isLockedOut(input.lockout, input.asAt)) {
    return {
      ...base, ok: false, failure: 'locked_out',
      message: lockoutMessage(input.lockout, input.asAt)!,
      // Already locked: counting again would extend the lockout for free and
      // let anyone keep a colleague locked out indefinitely.
      countsAsFailedAttempt: false,
    };
  }

  if (!input.userExists || !input.passwordSet || !input.passwordMatches) {
    return {
      ...base, ok: false,
      failure: !input.userExists ? 'invalid_credentials'
        : !input.passwordSet ? 'password_not_set' : 'invalid_credentials',
      message: UNIFORM_FAILURE,
      // Only count against an account that exists — otherwise a stranger's
      // typo raises the counter on nothing, and the counter is per-account.
      countsAsFailedAttempt: input.userExists,
    };
  }

  if (input.status !== 'active') {
    return {
      ...base, ok: false, failure: 'account_disabled',
      message: 'That account has been disabled. Ask whoever manages your dealership account.',
      countsAsFailedAttempt: false,
    };
  }

  if (!input.hasActiveMembership) {
    return {
      ...base, ok: false, failure: 'no_membership',
      message: 'That account is not attached to a dealership. Ask to be invited again.',
      countsAsFailedAttempt: false,
    };
  }

  return {
    ok: true,
    countsAsFailedAttempt: false,
    // Required by what the account CAN DO, not by its role name — so granting
    // a sensitive permission makes MFA mandatory without anyone maintaining a
    // list of role names.
    mfaEnrolmentRequired: requiresMfa(input.permissions) && !input.mfaEnrolled,
  };
}

// -------------------------------------------------------------- sessions

/** How long a session may live at all, however active. */
export const SESSION_ABSOLUTE_HOURS = 12;
/** How long it may sit unused. */
export const SESSION_IDLE_MINUTES = 60;
/** A trusted device gets a longer absolute life, never a longer idle window. */
export const TRUSTED_DEVICE_ABSOLUTE_DAYS = 14;
/** Step-up re-authentication is good for this long. */
export const STEP_UP_MINUTES = 10;

export interface SessionState {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  trustedDevice: boolean;
}

export type SessionInvalid = 'revoked' | 'expired' | 'idle';

export interface SessionCheck {
  valid: boolean;
  reason?: SessionInvalid;
  message?: string;
}

export const sessionExpiry = (createdAt: Date, trustedDevice: boolean): Date =>
  new Date(createdAt.getTime() + (trustedDevice
    ? TRUSTED_DEVICE_ABSOLUTE_DAYS * 24 * 60 * 60_000
    : SESSION_ABSOLUTE_HOURS * 60 * 60_000));

/**
 * Both clocks are checked, and only the idle one is refreshed by use.
 *
 * A session with only an idle timeout never ends for someone who keeps a tab
 * open, which on a shared forecourt machine is most of them.
 */
export function checkSession(state: SessionState, asAt: Date): SessionCheck {
  if (state.revokedAt !== null) {
    return { valid: false, reason: 'revoked', message: 'You were signed out. Sign in again.' };
  }
  if (state.expiresAt.getTime() <= asAt.getTime()) {
    return { valid: false, reason: 'expired', message: 'Your session has expired. Sign in again.' };
  }
  const idleMs = asAt.getTime() - state.lastSeenAt.getTime();
  if (idleMs > SESSION_IDLE_MINUTES * 60_000) {
    return {
      valid: false, reason: 'idle',
      message: `You were signed out after ${SESSION_IDLE_MINUTES} minutes of inactivity. Sign in again.`,
    };
  }
  return { valid: true };
}

export const stepUpSatisfied = (stepUpAt: Date | null, asAt: Date): boolean =>
  stepUpAt !== null && asAt.getTime() - stepUpAt.getTime() <= STEP_UP_MINUTES * 60_000;

/**
 * The session token's shape, as a rule rather than as whatever the caller
 * happened to generate. 32 bytes from a CSPRNG, base64url, no padding.
 *
 * The token is stored HASHED. A database backup, a log line or a support
 * screenshot containing the sessions table must not hand over live sessions —
 * the same reasoning that makes M7's shortlist token a credential.
 */
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_LENGTH = 43; // ceil(32 / 3) * 4 minus padding

export const isWellFormedToken = (token: string): boolean =>
  token.length === SESSION_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token);

// ------------------------------------------------------------------ TOTP

export const TOTP_STEP_SECONDS = 30;
/** One step either side, for clock drift. Not more: each step widens the window. */
export const TOTP_DRIFT_STEPS = 1;
export const TOTP_DIGITS = 6;

/**
 * The counters a code may legitimately be checked against at a moment.
 *
 * Pure, so the drift policy is testable without a clock or an HMAC. The app
 * computes the HMAC for each counter and compares in constant time.
 */
export function totpCounters(asAt: Date, drift = TOTP_DRIFT_STEPS): number[] {
  const current = Math.floor(asAt.getTime() / 1000 / TOTP_STEP_SECONDS);
  const counters: number[] = [];
  for (let i = -drift; i <= drift; i += 1) counters.push(current + i);
  return counters;
}

/** Derive the 6-digit code from an HMAC-SHA1 digest (RFC 4226 §5.3). */
export function truncateOtp(digest: Uint8Array, digits = TOTP_DIGITS): string {
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}
