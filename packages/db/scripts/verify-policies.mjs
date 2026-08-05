#!/usr/bin/env node
/**
 * CI gate: every table carrying tenant_id must have RLS ENABLED, FORCED and a policy.
 * Fails the build on the table someone forgot.
 *
 *   DATABASE_URL=postgres://... node packages/db/scripts/verify-policies.mjs
 */
import { loadEnv } from '../../../scripts/load-env.mjs';

// Reads the root .env when run locally; in CI the variable is already set and
// `loadEnv` leaves it alone.
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set, and no .env at the repository root supplied one.\n' +
    'This gate must run against a real Postgres — locally: cp .env.example .env',
  );
  process.exit(2);
}

const { default: postgres } = await import('postgres').catch(() => {
  console.error('Install the `postgres` package to run this gate.');
  process.exit(2);
});

const sql = postgres(url);
const rows = await sql`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')  -- 'p' = partitioned parent
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = c.relname AND column_name = 'tenant_id'
    )
  ORDER BY c.relname`;

const failures = rows.filter((r) => !r.rls_enabled || !r.rls_forced || Number(r.policy_count) === 0);

for (const r of rows) {
  const bad = failures.includes(r);
  console.log(
    `${bad ? '✗' : '✓'} ${r.table_name.padEnd(34)} enabled=${r.rls_enabled} forced=${r.rls_forced} policies=${r.policy_count}`,
  );
}


// ---------------------------------------------------------------------------
// The tables with NO tenant_id are invisible to the query above — and "it has
// no tenant_id" is precisely how a table ends up unprotected. `tenants` is
// scoped on `id`; `users` is global by design and scoped via membership.
// Both leaked before this check existed.
// ---------------------------------------------------------------------------
// `auth_attempts`, `mfa_recovery_codes` and `password_reset_tokens` carry no
// tenant_id either — deliberately, because credentials belong to a USER and an
// attacker spraying one password across many dealerships is exactly what a
// per-tenant table cannot see. Listed here so the gate can see them, which is
// the whole point of this second half existing.
const SPECIAL = [
  'tenants', 'users',
  'auth_attempts', 'mfa_recovery_codes', 'password_reset_tokens',
];
const special = await sql`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY(${SPECIAL})`;

for (const name of SPECIAL) {
  const row = special.find((r) => r.table_name === name);
  if (!row) continue; // not created by this migration yet
  const ok = row.rls_enabled && row.rls_forced && Number(row.policy_count) > 0;
  console.log(
    `${ok ? '✓' : '✗'} ${name.padEnd(34)} enabled=${row.rls_enabled} forced=${row.rls_forced} policies=${row.policy_count}`,
  );
  if (!ok) failures.push(name);
}

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} table(s) are not protected. See packages/db/src/rls.sql.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length + special.length} tables protected (${rows.length} tenant-scoped + ${special.length} special).`);
