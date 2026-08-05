/**
 * Set a user's password, and close every session they had.
 *
 *   pnpm db:password owner@kenningtoncarsales.co.uk
 *     → prompts, or reads the password from stdin if it is piped
 *
 * The password is NOT an argument, deliberately. An argument goes into shell
 * history, into `ps` output on a shared machine, and into the scrollback of
 * whatever terminal it was typed in — and this is the credential for an
 * account that can see cost prices and commission.
 *
 * It exists because the seeds create accounts with a password that is written
 * in `seed-crm.mjs`, in the repository, and is therefore known to everyone who
 * can read it. That is fine on a laptop and not fine on a public URL. Seeding
 * a demo and then immediately setting a password only you know is the
 * difference between the two.
 *
 * Every existing session is revoked, for the same reason the reset flow does
 * it: if the reason for changing the password is that somebody else might have
 * had it, leaving their session open changes nothing.
 */

import postgres from 'postgres';
import { createInterface } from 'node:readline';
import { hash as argonHash } from '@node-rs/argon2';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';
import { MIN_PASSWORD_LENGTH } from '../../domain/src/auth.js';

const email = process.argv[2];
if (!email || email.startsWith('--')) {
  console.error(
    'Usage: pnpm db:password <email>\n\n' +
    '  The password is read from stdin, not from an argument — an argument\n' +
    '  ends up in shell history. Either type it when prompted, or pipe it:\n\n' +
    '    printf %s "correct horse battery staple" | pnpm db:password owner@example.co.uk\n',
  );
  process.exit(1);
}

/** The application's parameters, named rather than left to a library default. */
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const readPassword = async () => {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    // Echoed. Hiding it properly needs raw-mode handling that behaves
    // differently in every terminal, and a half-working mask is worse than an
    // honest one — pipe it in if somebody is watching.
    return await new Promise((resolve) =>
      rl.question(`New password for ${email} (it will be visible): `, resolve));
  } finally {
    rl.close();
  }
};

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

try {
  const [user] = await sql`
    SELECT id, name FROM users WHERE lower(email) = lower(${email}) AND deleted_at IS NULL`;
  if (!user) {
    console.error(`No account for ${email}. Run pnpm db:seed:crm to create the demo staff.`);
    process.exit(1);
  }

  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `\nThat is ${password.length} characters and the policy is ${MIN_PASSWORD_LENGTH}. ` +
      'Three or four unrelated words is easier to remember and harder to guess than a short ' +
      'one with symbols in it.',
    );
    process.exit(1);
  }

  const passwordHash = await argonHash(password, ARGON);
  if (!passwordHash.startsWith('$argon2id$')) {
    throw new Error('Expected an Argon2id hash. The algorithm constant is wrong.');
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE users
         SET password_hash = ${passwordHash},
             failed_login_count = 0,
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${user.id}::uuid`;

    // Revoked, never deleted — "this session ended, and when" is the record
    // somebody needs afterwards.
    await tx`
      UPDATE sessions SET revoked_at = now()
       WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL`;
  });

  console.log(`\nPassword set for ${user.name} <${email}>. Every existing session was revoked.`);

  const [mfa] = await sql`
    SELECT mfa_enrolled_at IS NOT NULL AS enrolled FROM users WHERE id = ${user.id}::uuid`;
  if (!mfa?.enrolled) {
    console.log(
      '\n  This account has NO authenticator enrolled. If its permissions require one — an\n' +
      '  owner\'s do — the first sign-in is an ENROLMENT screen, so whoever signs in first\n' +
      '  claims the second factor. On a publicly reachable URL, sign in and enrol now\n' +
      '  rather than later.',
    );
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
