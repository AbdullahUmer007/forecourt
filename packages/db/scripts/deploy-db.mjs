/**
 * Bring a REMOTE database up to date. The deployment counterpart of db:setup.
 *
 *   pnpm db:deploy            extensions, RLS scaffolding, pending migrations,
 *                             policy verification
 *   pnpm db:deploy --check    say what would run, change nothing
 *
 * Why this exists rather than reusing db:setup or db:migrate:
 *
 *  - `db:setup` refuses any host that is not localhost, and rightly so: it is
 *    written to build a database from nothing and takes `--reset`, which drops
 *    the public schema. That guard must not be relaxed for a deployment.
 *  - `db:migrate` applies migrations but does NOT create the extensions or run
 *    `rls.sql`, which is where the four application roles and
 *    `set_tenant_context` come from. Pointed at an empty Railway database it
 *    dies on the first migration, because 0001 calls a function that does not
 *    exist yet.
 *
 * So this is the union of the two, minus everything destructive. It is
 * STRICTLY ADDITIVE — no DROP SCHEMA, no --reset, no truncation, nothing that
 * can lose a row — which is what makes it safe to point at production without
 * the hostname guard. Every step is idempotent, so re-running it is a no-op.
 *
 * It takes a Postgres advisory lock first. Three application services starting
 * at once would otherwise all try to migrate the same database simultaneously,
 * and two of them would fail on a duplicate CREATE TYPE. The lock makes the
 * second and third wait and then find nothing to do.
 */

import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, '..');
const CHECK_ONLY = process.argv.includes('--check');

/** Arbitrary but fixed. Any two runs must pick the same number to queue. */
const LOCK_KEY = 4_071_120_260;

const url = requireDatabaseUrl();
const safeUrl = url.replace(/:[^:@/]*@/, ':***@');

const sql = postgres(url, {
  max: 1,
  onnotice: () => {},
  // A managed database over the public internet needs TLS, and the provider's
  // certificate is not in Node's trust store. `sslmode=require` in the URL is
  // the usual way to say so; honour it here too for the case where somebody
  // passes a bare URL to a host that demands TLS anyway.
  ...(process.env['PGSSLMODE'] === 'require' ? { ssl: 'require' } : {}),
  // Migrations rebuild large indexes. The default is no timeout, which is
  // right; this only guards against a connection that has silently died.
  connect_timeout: 30,
});

const step = async (label, text) => {
  process.stdout.write(`  ${label.padEnd(38)}`);
  if (CHECK_ONLY) return console.log('would run');
  await sql.unsafe(text);
  console.log('ok');
};

async function deploy() {
  console.log(`Deploying schema to ${safeUrl}\n`);

  // Wait rather than fail. A concurrent service start is the normal case, not
  // an error, and `pg_try_advisory_lock` would make it one.
  process.stdout.write('  waiting for the migration lock…     ');
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  console.log('held');

  try {
    // ---------------------------------------------------------- extensions
    //
    // A managed provider may or may not have these. All three are in
    // postgres-contrib and available on every provider we care about; if one
    // is not, the error names it and there is nothing this script can do about
    // it anyway.
    await step('extensions', `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE EXTENSION IF NOT EXISTS btree_gin;`);

    // ----------------------------------------------------- RLS scaffolding
    //
    // Idempotent by construction: every role is created behind an
    // `IF NOT EXISTS`, every function is `CREATE OR REPLACE`, every policy is
    // dropped before being recreated. Re-running it is how a policy change
    // reaches an existing database.
    await step('rls scaffolding (roles, policies)',
      readFileSync(join(DB, 'src', 'rls.sql'), 'utf8'));

    // --------------------------------------- the login role may assume them
    //
    // The applications do `SET LOCAL ROLE app_user` / `app_public` inside
    // every transaction — that is layer 2 of the four, and without it the
    // policies are never consulted because the connecting role bypasses RLS.
    //
    // A superuser may SET ROLE to anything, so on a provider whose default
    // user is a superuser this is a no-op. On one where it is not, the
    // applications would fail on their first query with "permission denied to
    // set role". Granting membership here means the same deployment works
    // either way, and it grants nothing the connecting role could not already
    // reach some other way.
    await step('grant the app roles to the login role', `
      DO $$ BEGIN
        EXECUTE format('GRANT app_user, app_public, app_platform, app_migrator TO %I',
                       current_user);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Could not grant the app roles to %; assuming superuser.', current_user;
      END $$;`);

    // ------------------------------------------------------- migrations
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);

    const files = readdirSync(join(DB, 'migrations'))
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();
    if (files.length === 0) throw new Error('No migrations found — check packages/db/migrations.');

    const applied = new Set(
      (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
    );
    const pending = files.filter((f) => !applied.has(f));

    // A database with tables but no history was built by an older path and
    // must not have 0001 replayed over it. Say what it is instead of dying on
    // a duplicate CREATE TYPE, which reads like a broken migration.
    if (applied.size === 0 && pending.length === files.length) {
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`;
      if (n > 0) {
        throw new Error(
          `This database has ${n} tables but no migration history, so it was not built by ` +
          `this runner.\nRecord what it already has before deploying:\n\n` +
          `  pnpm db:migrate --baseline=<last applied migration, e.g. 0022>\n`,
        );
      }
    }

    if (pending.length === 0) {
      console.log(`  migrations                            up to date (${applied.size} applied)`);
    } else {
      for (const file of pending) {
        // The migration file carries its own BEGIN/COMMIT, so recording it in
        // the same batch keeps the record inside that transaction. A crash
        // between the two would otherwise leave a migration applied and
        // unrecorded, and the next run would try to apply it again.
        await step(file, CHECK_ONLY ? '' : readFileSync(join(DB, 'migrations', file), 'utf8')
          + `\nINSERT INTO schema_migrations (filename) VALUES ('${file}');`);
      }
    }

    if (CHECK_ONLY) {
      console.log(`\n${pending.length} migration(s) pending. Nothing was changed.`);
      return;
    }

    // ----------------------------------------------------- and prove it
    //
    // Policies re-applied after the migrations rather than before: a migration
    // that adds a tenant-scoped table needs the generator to run over it, and
    // several of them call it themselves. Running it again here costs
    // milliseconds and covers the one that forgets.
    await step('apply tenant policies', 'SELECT apply_tenant_policies()');

    const [{ tables }] = await sql`
      SELECT count(*)::int AS tables FROM information_schema.tables
      WHERE table_schema = 'public'`;

    // The gate, inline. A deployment that has left a table unprotected must
    // fail here rather than start serving.
    const unprotected = await sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname
            AND col.column_name = 'tenant_id')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`;

    if (unprotected.length > 0) {
      throw new Error(
        `${unprotected.length} tenant table(s) are not protected by row-level security:\n  ` +
        unprotected.map((r) => r.relname).join('\n  ') +
        `\n\nThe deployment is stopping rather than serving. Run pnpm db:policies for detail.`,
      );
    }

    console.log(`\n✓ Schema up to date — ${tables} tables, every tenant table RLS-forced.`);
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}

try {
  await deploy();
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
