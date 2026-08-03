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
