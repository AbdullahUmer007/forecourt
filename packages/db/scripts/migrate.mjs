/**
 * Apply pending migrations, in order, once each.
 *
 *   pnpm db:migrate                 apply everything not yet applied
 *   pnpm db:migrate --dry-run       list what would run, change nothing
 *   pnpm db:migrate --baseline=0010 record 0001..0010 as applied WITHOUT
 *                                   running them, for a database that was
 *                                   built by `db:setup` before this runner
 *                                   existed
 *
 * `db:setup` builds a database from nothing and is the CI path. This is the
 * other half: an existing database that needs the one new migration, without
 * dropping the schema to get it. Until now `db:migrate` was wired to
 * `drizzle-kit migrate` with no `drizzle.config.json` in the repository, so the
 * command CLAUDE.md documents has never once run — the only way to pick up a
 * migration was `db:setup --reset`, which destroys local data.
 *
 * Each migration runs inside its own transaction, and every file here already
 * opens with BEGIN/COMMIT of its own, so the record of having applied it
 * commits with the migration rather than after it. A crash between the two
 * would otherwise leave a migration applied and unrecorded, which the next run
 * would try to apply again.
 */

import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

const DRY_RUN = process.argv.includes('--dry-run');
const baselineArg = process.argv.find((a) => a.startsWith('--baseline='));
const BASELINE = baselineArg ? baselineArg.split('=')[1] : null;

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

if (files.length === 0) throw new Error('No migrations found — check packages/db/migrations.');

async function migrate() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
  );

  if (BASELINE) {
    const upTo = files.filter((f) => f.slice(0, 4) <= BASELINE);
    if (upTo.length === 0) {
      console.error(`No migrations at or below ${BASELINE}.`);
      process.exitCode = 1;
      return;
    }
    for (const f of upTo) {
      await sql`INSERT INTO schema_migrations (filename) VALUES (${f})
                ON CONFLICT (filename) DO NOTHING`;
    }
    console.log(`Baselined ${upTo.length} migrations up to ${BASELINE} as already applied.`);
    console.log('Nothing was executed. Run pnpm db:migrate to apply the rest.');
    return;
  }

  const pending = files.filter((f) => !applied.has(f));

  // A database built by `db:setup` before this runner existed has every table
  // and no record of any of it. Applying 0001 to it would fail on the first
  // CREATE TYPE and read like a broken migration, so say what it actually is.
  if (applied.size === 0 && pending.length === files.length) {
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`;
    if (n > 0) {
      console.log(`This database has ${n} tables but no migration history.`);
      console.log('It was built by db:setup before this runner existed.\n');
      console.log('  Record what it already has, then apply the rest:');
      console.log(`    pnpm db:migrate --baseline=<last applied, e.g. ${
        files[files.length - 2]?.slice(0, 4) ?? '0001'}>\n`);
      console.log('  Or rebuild from scratch (DESTROYS ALL LOCAL DATA):');
      console.log('    pnpm db:setup --reset');
      process.exitCode = 1;
      return;
    }
  }

  if (pending.length === 0) {
    console.log(`Up to date — ${applied.size} migrations applied.`);
    return;
  }

  if (DRY_RUN) {
    console.log(`${pending.length} migration(s) would run:`);
    for (const f of pending) console.log(`  ${f}`);
    return;
  }

  for (const file of pending) {
    process.stdout.write(`  ${file.padEnd(38)}`);
    const text = readFileSync(join(MIGRATIONS, file), 'utf8');
    // The migration file carries its own BEGIN/COMMIT. Recording it in the
    // same statement batch keeps the record inside that transaction.
    await sql.unsafe(
      `${text}\nINSERT INTO schema_migrations (filename) VALUES ('${file}');`,
    );
    console.log('ok');
  }

  console.log(`\n✓ ${pending.length} migration(s) applied.`);
  console.log('  Now run: pnpm db:policies');
}

try {
  await migrate();
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
