import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  SESSION_TOKEN_BYTES, RESET_TOKEN_BYTES, totpCounters, truncateOtp, TOTP_DIGITS,
} from '@forecourt/domain';

/**
 * The primitives. Everything policy-shaped lives in `packages/domain/auth.ts`;
 * this file is the part that touches a CSPRNG and a KDF.
 */

/**
 * Argon2id, per the architecture document's security table.
 *
 * The parameters are the @node-rs defaults, which follow the OWASP guidance
 * (19 MiB, 2 passes, 1 lane). They are named explicitly rather than left
 * implicit so that a library default changing underneath us is a visible diff
 * rather than a silent change to every password we store.
 */
/**
 * `Algorithm.Argon2id` is an ambient const enum, which `verbatimModuleSyntax`
 * refuses to access. Its value is 2 (Argon2d 0, Argon2i 1, Argon2id 2) — and
 * rather than leave that as a magic number nobody can check, `hashPassword`
 * asserts the algorithm actually used, below. A silent downgrade to Argon2i is
 * exactly the kind of thing that would never show up in a test that only
 * checks a password round-trips.
 */
const ARGON2ID = 2;

const ARGON = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  const hash = await argonHash(plain, ARGON);
  if (!hash.startsWith('$argon2id$')) {
    throw new Error(
      `Expected an Argon2id hash and got "${hash.slice(0, 12)}…". The algorithm constant is ` +
      'wrong, and every password stored under it would be weaker than intended.',
    );
  }
  return hash;
}

/**
 * Verification never throws for a wrong password — only for a malformed hash,
 * which is a data problem rather than a sign-in outcome. A throw here would
 * become a 500 on a mistyped password.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * A dummy verify, for the case where the email does not exist.
 *
 * Without it, an unknown email returns in a millisecond and a real one takes
 * the ~50ms Argon2id deliberately costs — which is a timing oracle that hands
 * over the list of who has an account, and undoes the identical error message
 * the domain layer is careful to produce.
 */
const DUMMY_HASH = await hashPassword('forecourt-timing-equaliser');
export const burnPasswordTime = (plain: string): Promise<boolean> =>
  verifyPassword(DUMMY_HASH, plain);

// -------------------------------------------------------- session tokens

export const newSessionToken = (): string =>
  randomBytes(SESSION_TOKEN_BYTES).toString('base64url');

/**
 * Tokens are stored hashed.
 *
 * SHA-256 rather than Argon2id, deliberately: the token is 32 bytes of CSPRNG
 * output, so there is no low-entropy guess to slow down, and the hash is
 * computed on every authenticated request. What this defends against is a
 * database backup, a log line or a support screenshot handing over live
 * sessions — the same reasoning that makes M7's shortlist token a credential.
 */
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// ------------------------------------------------------------------ TOTP

/** RFC 4648 base32, which is what every authenticator app expects. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const newTotpSecret = (): string => {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
};

const base32Decode = (secret: string): Buffer => {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const codeFor = (secret: string, counter: number): string => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return truncateOtp(createHmac('sha1', base32Decode(secret)).update(buf).digest(), TOTP_DIGITS);
};

/**
 * Constant-time comparison across every counter in the drift window.
 *
 * The loop does NOT break on a match: returning early leaks which counter
 * matched through timing, and the whole point of comparing this way is not to
 * leak through timing.
 */
export function verifyTotp(secret: string, code: string, asAt: Date): boolean {
  const supplied = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(supplied)) return false;

  let matched = false;
  for (const counter of totpCounters(asAt)) {
    const expected = Buffer.from(codeFor(secret, counter));
    const given = Buffer.from(supplied);
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = true;
  }
  return matched;
}

// -------------------------------------------------------- recovery codes

/**
 * A recovery code, in the shape people can read off a printout without
 * transcription errors.
 *
 * Crockford's alphabet: no I, L, O or U, so there is no 1/I or 0/O confusion
 * and no accidental profanity. Ten bytes of entropy per code, which is far
 * more than a six-digit TOTP and is the point — this is the credential that
 * replaces the phone.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Normalised before hashing, so a code typed in lower case with the dash
 * missing still works. Somebody is reading this off paper, probably in a
 * hurry, probably because they have lost their phone.
 */
export const normaliseRecoveryCode = (code: string): string =>
  code.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Hashed with SHA-256 rather than Argon2id, for the same reason a session
 * token is: 10 bytes of CSPRNG output has no low-entropy guess to slow down,
 * and a set of ten is verified by lookup rather than by trying each one.
 */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');

// ---------------------------------------------------------- reset tokens

export const newResetToken = (): string =>
  randomBytes(RESET_TOKEN_BYTES).toString('base64url');

export const hashResetToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** The `otpauth://` URI an authenticator app scans. */
export const totpUri = (secret: string, email: string, issuer = 'Forecourt'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=30`;
