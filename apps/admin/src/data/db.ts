/**
 * The admin application's database access.
 *
 * There is NO `withTenant` here, and that is the whole difference. This
 * application legitimately reads across every dealership on the platform —
 * a tenant directory that could only see one tenant would not be a directory —
 * so it connects as `app_platform`, which is BYPASSRLS by design and
 * separately audited for exactly that reason.
 *
 * That makes every query in this app a query with no safety net. The CRM has
 * four layers; this has one, and the one is "somebody wrote the right WHERE
 * clause". So:
 *
 *   * every read here is aggregate or explicitly tenant-scoped by id
 *   * nothing in this app reads a dealer's CUSTOMER data — no contacts, no
 *     leads, no deals. Support that needs those goes through impersonation,
 *     which is refused without the dealer's own grant and is logged.
 *
 * `SET LOCAL ROLE` is still set explicitly rather than assumed from the
 * connection string, for the same reason the CRM does it: tenant isolation
 * should be a property of the code, not of somebody's deployment. Here the
 * role is the one that CAN cross tenants, which is a decision this file is
 * making out loud rather than inheriting silently.
 */

import postgres, { type TransactionSql } from 'postgres';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your local Postgres.',
  );
}

export const sql = postgres(url, {
  max: 4,
  idle_timeout: 20,
  prepare: true,
  transform: { undefined: null },
});

export type Tx = TransactionSql<Record<string, never>>;

/**
 * Every platform read goes through here.
 *
 * Named `acrossTenants` rather than something neutral, so a reader of any
 * call site can see that this is the code that steps over the boundary the
 * rest of the product spends four layers defending.
 */
export async function acrossTenants<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx: Tx) => {
    await tx`SET LOCAL ROLE app_platform`;
    return fn(tx);
  }) as Promise<T>;
}

export const toPence = (v: string | number | null): bigint =>
  v === null ? 0n : BigInt(v);

export const toDate = (v: string | Date | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);
