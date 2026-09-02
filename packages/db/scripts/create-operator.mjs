/**
 * Grant somebody RixDrive staff access to the admin application.
 *
 *   pnpm db:operator alex@rixdrive.co.uk "Alex Rivers" admin
 *     → prompts, or reads the password from stdin if it is piped
 *
 * This is the ONLY way an operator record is created. There is no seed for it
 * and there deliberately never will be: a seeded account with a password
 * committed to the repository is a back door into every dealership on the
 * platform, which is a different order of mistake from a seeded demo dealer.
 *
 * The password is read from stdin rather than taken as an argument, for the
 * same reason as `set-password.mjs` — an argument lands in shell history and
 * in `ps` output on a shared machine.
 *
 * `granted_by` is left NULL for the first operator, which the table's CHECK
 * permits precisely because the first one has nobody to be granted by. Every
 * operator after that should be created by an existing `admin` through the
 * application, not through this script, so that who granted what is recorded.
 */

import postgres from 'postgres';
import { createInterface } from 'node:readline';
import { hash as argonHash } from '@node-rs/argon2';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';
import { MIN_PASSWORD_LENGTH } from '../../domain/src/auth.js';

const ROLES = ['support_read', 'support', 'approver', 'billing', 'admin'];

const [email, name, role = 'admin'] = process.argv.slice(2);

if (!email || !name || email.startsWith('--')) {
  console.error(
    'Usage: pnpm db:operator <email> <name> [role]\n\n' +
    `  role is one of: ${ROLES.join(', ')} (default: admin)\n\n` +
    '  The password is read from stdin, not from an argument — an argument\n' +
    '  ends up in shell history. Either type it when prompted, or pipe it:\n\n' +
    '    printf %s "correct horse battery staple" | pnpm db:operator you@example.com "Your Name"\n',
  );
  process.exit(1);
}

if (!ROLES.includes(role)) {
  console.error(`"${role}" is not an operator role. Pick one of: ${ROLES.join(', ')}`);
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
    // Echoed, like `set-password.mjs`: a half-working mask is worse than an
    // honest one. Pipe it in if somebody is watching.
    return await new Promise((resolve) =>
      rl.question(`Password for ${email} (it will be visible): `, resolve));
  } finally {
    rl.close();
  }
};

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

try {
  const [live] = await sql`
    SELECT u.email FROM platform_operators o
      JOIN users u ON u.id = o.user_id
     WHERE lower(u.email) = lower(${email}) AND o.revoked_at IS NULL`;
  if (live) {
    console.error(
      `${email} is already an operator. Use pnpm db:password to change their password, ` +
      'or revoke the existing record first — a second live record is refused by a unique index.',
    );
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

  const { userId, existed, first } = await sql.begin(async (tx) => {
    const [existing] = await tx`
      SELECT id FROM users WHERE lower(email) = lower(${email}) AND deleted_at IS NULL`;

    let id;
    if (existing) {
      id = String(existing.id);
      await tx`
        UPDATE users
           SET password_hash = ${passwordHash}, name = ${name},
               failed_login_count = 0, locked_until = NULL, updated_at = now()
         WHERE id = ${id}::uuid`;
    } else {
      const [created] = await tx`
        INSERT INTO users (email, name, password_hash)
        VALUES (${email}, ${name}, ${passwordHash})
        RETURNING id`;
      id = String(created.id);
    }

    const [{ count }] = await tx`
      SELECT count(*)::int AS count FROM platform_operators WHERE revoked_at IS NULL`;

    await tx`
      INSERT INTO platform_operators (user_id, role)
      VALUES (${id}::uuid, ${role}::platform_operator_role)`;

    return { userId: id, existed: Boolean(existing), first: count === 0 };
  });

  console.log(
    `\n${name} <${email}> is now a RixDrive operator with the "${role}" role.` +
    (existed ? '\n  An existing user account was reused and its password reset.' : '') +
    (first ? '\n  This is the first operator, so granted_by is NULL — there was nobody to grant it.' : ''),
  );
  console.log(`  user id: ${userId}`);

  if (process.env['ADMIN_MFA_BYPASS'] !== '1') {
    console.log(
      '\n  The admin application requires a second factor for every screen and does not yet\n' +
      '  have an enrolment page, so this account cannot sign in until either that page is\n' +
      '  built or ADMIN_MFA_BYPASS=1 is set on the admin service. See apps/admin/src/auth/session.ts.',
    );
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
