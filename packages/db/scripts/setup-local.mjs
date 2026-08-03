/**
 * Create a local database from nothing: extensions, RLS scaffolding, every
 * migration in order, then the policy verification.
 *
 *   pnpm db:setup
 *
 * This is the same sequence CI runs, deliberately — a local database that is
 * built differently from CI's is a local database that lies to you.
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

try {
  console.log('Setting up the local database…');

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
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
