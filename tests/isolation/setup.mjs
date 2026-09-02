/**
 * Load the root `.env` before the isolation suite is imported.
 *
 * Vitest does not read `.env` — only Next does, and only inside an app
 * directory. So `pnpm test:isolation` saw no DATABASE_URL, took the
 * `describe.skip` branch, and reported **125 skipped** with a warning on
 * stderr. A skipped suite is a green suite to every runner and every CI
 * summary, so the one gate that protects against a cross-tenant leak could
 * quietly not run at all — which is exactly what it had been doing locally.
 *
 * This runs as a `setupFiles` entry, which executes BEFORE the test module is
 * imported, so the DATABASE_URL guard at the top of the suite sees the value.
 *
 * A real environment variable still wins over the file, so CI is unaffected.
 */

import { loadEnv } from '../../scripts/load-env.mjs';

loadEnv();

/**
 * Refuse to run the suites against anything but a local database.
 *
 * The suites are not read-only. The isolation suite seeds two rival tenants,
 * their users, sites, brands and a vehicle each, then spends three hundred
 * tests trying to smuggle rows between them; the integration suite seeds
 * another dealership. That is exactly what they should do to a scratch
 * database, and exactly what they should never do to a real one.
 *
 * There is nothing in `pnpm test` that asks where it is pointed. It reads
 * `DATABASE_URL` from the root `.env`, and a `.env` pointed at a deployed
 * database — while chasing a bug, or after running the migrations — turns the
 * ordinary act of running the tests into writing fixtures into production.
 * That has already happened to this repository: `Tenant A`, `Tenant B`,
 * `Rival Motors` and `Integration Motors` are in the deployed database, put
 * there by a test run, and nothing warned anybody.
 *
 * Loopback only. The escape hatch is deliberate and deliberately loud: a
 * throwaway database on another host is a legitimate thing to want, and
 * spelling out ALLOW_REMOTE_TEST_DB=1 is a sentence you cannot type by
 * accident. CI passes `localhost` and is unaffected.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 'host.docker.internal']);

const url = process.env['DATABASE_URL'];

// No URL at all is the suites' own business — they skip, and say so.
if (url && process.env['ALLOW_REMOTE_TEST_DB'] !== '1') {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a URL this can parse, so the tests cannot check it is local: ${url}`);
  }

  if (!LOOPBACK.has(host)) {
    throw new Error(
      `The test suites refuse to run against ${host}.\n\n` +
      'They are not read-only: the isolation and integration suites seed whole tenants,\n' +
      'and this host is not local, so that would be somebody\'s real data.\n\n' +
      'Point the root .env at a local database:\n\n' +
      '  DATABASE_URL=postgres://postgres:postgres@localhost:5433/forecourt\n\n' +
      'or, if this host really is a throwaway, say so explicitly:\n\n' +
      '  ALLOW_REMOTE_TEST_DB=1 pnpm test\n',
    );
  }
}
