#!/usr/bin/env node
/**
 * CI gate: every table carrying tenant_id must have RLS ENABLED, FORCED and a policy.
 * Fails the build on the table someone forgot.
 *
 *   DATABASE_URL=postgres://... node packages/db/scripts/verify-policies.mjs
 */
import { readFileSync } from 'node:fs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. This gate must run against a real Postgres.');
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
  WHERE n.nspname = 'public' AND c.relkind = 'r'
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

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} table(s) are not protected. See packages/db/src/rls.sql.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} tenant tables protected.`);
