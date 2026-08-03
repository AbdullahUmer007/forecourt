/**
 * The public site's database access.
 *
 * READ-ONLY, and scoped to one tenant per query. Two things make that true
 * rather than merely intended:
 *
 *   1. Every query runs inside `withTenant`, which opens a transaction and
 *      calls `set_tenant_context` before anything else. RLS then does the work
 *      — the site could ask for every vehicle in the platform and get back
 *      only this dealer's.
 *   2. The connection uses the `app_public` role, which is NOBYPASSRLS and has
 *      SELECT only. A write from the public site is not a bug we have to catch;
 *      it is a privilege the connection does not hold.
 *
 * `SET LOCAL` inside a transaction matters with a pooled connection: a plain
 * `SET` would leak the last request's tenant into the next request that
 * happened to get the same connection, which is the exact failure mode RLS is
 * there to prevent.
 */

import postgres, { type TransactionSql } from 'postgres';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your local Postgres, ' +
    'then run `pnpm db:setup && pnpm db:seed`.',
  );
}

/**
 * `max: 8` because the site is read-only and served from cache: a wall of
 * idle connections costs more than it buys.
 */
export const sql = postgres(url, {
  max: 8,
  idle_timeout: 20,
  prepare: true,
  transform: { undefined: null },
});

/**
 * `sql.begin` is overloaded, so deriving this with `Parameters<...>` picks the
 * wrong signature and every `tx` in the codebase silently becomes `never` —
 * which type-checks as long as you never call a method on it. Name the
 * library's own type instead.
 */
export type Tx = TransactionSql<Record<string, never>>;

/** Every read the public site does goes through here. There is no other path. */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx: Tx) => {
    // The public site sees the whole tenant: it renders a dealer's shopfront,
    // not one branch's. Site filtering, when a dealer wants per-site stock, is
    // a query predicate rather than a security boundary.
    await tx`SELECT set_tenant_context(${tenantId}::uuid, NULL, '{}'::uuid[], true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Pence come back from `bigint` columns as strings. Never as JS numbers. */
export const toPence = (value: unknown): bigint | null =>
  value === null || value === undefined ? null : BigInt(String(value));

export const toInt = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export const toDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(String(value));

/** `2027-02-17T00:00:00.000Z` → `2027-02-17`. */
export const toIsoDate = (value: unknown): string | null => {
  const d = toDate(value);
  return d === null ? null : d.toISOString().slice(0, 10);
};
