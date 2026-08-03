/**
 * Create a local database from nothing: extensions, RLS scaffolding, every
 * migration in order, then the policy verification.
 *
 *   pnpm db:setup          fails if the database already has tables
 *   pnpm db:setup --reset  drops the public schema first, then rebuilds
 *
 * This is the same sequence CI runs, deliberately — a local database that is
 * built differently from CI's is a local database that lies to you.
 *
 * The migrations are NOT idempotent and are not meant to be. `CREATE TYPE` has
 * no `IF NOT EXISTS` in Postgres, so a second run always died on the first
 * enum with "type fca_permission_type already exists" — which reads like a
 * broken migration when it actually means "this database is already built".
 * Rewriting the migrations to be self-healing would hide real drift, so the
 * check lives here instead: we look before we leap, and say which it is.
 *
 * It refuses to run against anything that does not look local. Applying a
 * migration sequence to the wrong database is not a mistake you get to undo.
 */

import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, '..');
const url = requireDatabaseUrl();
if (!/@(localhost|127\.0\.0\.1|host\.docker\.internal|db)[:/]/.test(url)) {
  console.error(
    `Refusing to run against ${url.replace(/:[^:@/]*@/, ':***@')}.\n` +
    `db:setup applies every migration from scratch and is for local databases only.`,
  );
  process.exit(1);
}

// NOTICEs from `DROP ... IF EXISTS` are expected on a fresh database and
// drown out anything that actually matters.
const sql = postgres(url, { max: 1, onnotice: () => {} });

const run = async (label, text) => {
  process.stdout.write(`  ${label.padEnd(38)}`);
  await sql.unsafe(text);
  console.log('ok');
};

const RESET = process.argv.includes('--reset');

async function setup() {
  // Look before we leap. A populated database is the normal case for anyone
  // running this a second time, and it deserves an instruction rather than a
  // Postgres error about an enum.
  const [existing] = await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;

  if (existing.n > 0 && !RESET) {
    console.log(`This database already has ${existing.n} tables — it is already set up.`);
    console.log('');
    console.log('  To verify it:      pnpm db:policies');
    console.log('  To seed demo data: pnpm db:seed');
    console.log('  To rebuild it from scratch (DESTROYS ALL LOCAL DATA):');
    console.log('                     pnpm db:setup --reset');
    return;
  }

  console.log('Setting up the local database…');

  if (RESET) {
    // Drops enums, functions and tables together, which is why this is a
    // schema drop rather than a list of DROP TABLEs that would drift.
    await run('reset (dropping public schema)', `
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;`);
  }

  await run('extensions', `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS btree_gin;`);

  await run('rls scaffolding', readFileSync(join(DB, 'src', 'rls.sql'), 'utf8'));

  // Forward migrations only, in order. `*[0-9].sql` does NOT work here: it
  // requires a digit immediately before .sql, so it matches nothing and
  // silently applies no migrations at all. That cost us a green CI run once.
  const migrations = readdirSync(join(DB, 'migrations'))
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  if (migrations.length === 0) throw new Error('No migrations found — check packages/db/migrations.');

  for (const file of migrations) {
    await run(file, readFileSync(join(DB, 'migrations', file), 'utf8'));
  }

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log(`\n✓ ${migrations.length} migrations applied, ${n} tables.`);
  console.log('  Now run: pnpm db:policies && pnpm db:seed');
}

try {
  await setup();
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
