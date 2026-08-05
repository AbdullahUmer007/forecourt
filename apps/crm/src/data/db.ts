/**
 * The CRM's database access.
 *
 * Read AND write, unlike the public site — but with the same single door:
 * every query runs inside `withSession`, which opens a transaction and calls
 * `set_tenant_context` before anything else. RLS then does the work.
 *
 * `SET LOCAL` inside a transaction matters with a pooled connection. A plain
 * `SET` would leak the last request's tenant into the next request that
 * happened to reuse the connection — which is exactly the failure RLS exists
 * to prevent, and it would not show up in testing because it needs two
 * tenants and a shared pool to reproduce.
 *
 * Unlike the site, the CRM passes the real USER id and site scope, so the
 * `site_scope` RESTRICTIVE policies apply: a prep user attached to one branch
 * sees one branch's cars. Those policies are RESTRICTIVE rather than
 * permissive for a reason recorded in DECISIONS.md — Postgres OR-combines
 * permissive policies, so a permissive site_scope OR'd away tenant isolation
 * entirely on every table carrying a site_id.
 */

import postgres, { type TransactionSql } from 'postgres';
import type { Session } from '@/auth/session';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your local Postgres, ' +
    'then run `pnpm db:setup && pnpm db:seed`.',
  );
}

export const sql = postgres(url, {
  max: 8,
  idle_timeout: 20,
  prepare: true,
  transform: { undefined: null },
});

/**
 * `sql.begin` is overloaded, so deriving this with `Parameters<...>` picks the
 * wrong signature and every `tx` silently becomes `never` — which type-checks
 * fine as long as you never call a method on it. Name the library's own type.
 * (The public site learned this the hard way; see apps/site/src/data/db.ts.)
 */
export type Tx = TransactionSql<Record<string, never>>;

/**
 * Every tenant-scoped read and write in the CRM goes through here.
 *
 * `SET LOCAL ROLE app_user` FIRST, before anything else.
 *
 * This was missing, and its absence made RLS inert in the running application.
 * The header above says "RLS then does the work" — but a policy is not
 * consulted at all for a role with BYPASSRLS, and `postgres` has it. Local dev
 * connects as `postgres`, so every screen in this app was reading across
 * tenants; the VAT stock book made it visible by showing nine entries when the
 * dealership had six. Almost none of these loaders filter by `tenant_id` in
 * SQL — they were written to rely on RLS — so with RLS bypassed there was no
 * tenant filter at all.
 *
 * The isolation suite never caught it because it does this same `SET LOCAL
 * ROLE` itself before asserting. It was proving the POLICIES are right, which
 * they are. Nothing was proving the app arrives at them.
 *
 * Setting the role here rather than relying on the connection string makes the
 * guarantee a property of the code instead of a property of somebody's
 * deployment configuration. `SET LOCAL` so it ends with the transaction.
 */
export async function withSession<T>(
  session: Session,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: Tx) => {
    await tx`SET LOCAL ROLE app_user`;
    await tx`SELECT set_tenant_context(
      ${session.tenantId}::uuid,
      ${session.userId}::uuid,
      ${session.siteIds as unknown as string[]}::uuid[],
      ${session.scope === 'all_sites'}
    )`;
    return fn(tx);
  }) as Promise<T>;
}

/** pence (bigint in Postgres, string over the wire) → bigint. */
export const toPence = (v: string | number | null): bigint =>
  v === null ? 0n : BigInt(v);

export const toInt = (v: string | number | null): number | null =>
  v === null ? null : Number(v);

export const toDate = (v: string | Date | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);
