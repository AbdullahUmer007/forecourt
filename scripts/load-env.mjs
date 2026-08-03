/**
 * Load the repository-root `.env` into `process.env`.
 *
 * Node does not read `.env` on its own, and Next only looks inside the app
 * directory — so `pnpm db:setup` and `pnpm dev` both need this, and both need
 * to find the SAME file. One `.env` at the root, one loader, no per-app copies
 * to drift apart.
 *
 * Deliberately dependency-free and deliberately dumb: it handles `KEY=value`,
 * comments, blank lines, quotes and Windows line endings, and nothing else.
 * A `.env` parser that supports interpolation and multi-line values is a
 * config language, and a config language wants a test suite.
 *
 * An environment variable that is already set always wins, so CI and a real
 * deployment are never overridden by a file someone left in the working copy.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return { loaded: false, path: file, keys: [] };

  // Strip a BOM: PowerShell's redirection writes UTF-8 with one, and it would
  // otherwise become part of the first key's name.
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const keys = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) ||
                   (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    // Already set wins — see above.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, path: file, keys };
}

/**
 * The message someone actually needs when DATABASE_URL is missing: which file
 * we looked in, and what to do. "DATABASE_URL is not set" on its own sends
 * people to check a file that is already correct.
 */
export function requireDatabaseUrl() {
  const result = loadEnv();
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  console.error(
    result.loaded
      ? `DATABASE_URL is missing from ${result.path}.\n` +
        `That file was read, but it has no DATABASE_URL line. Add:\n\n` +
        `  DATABASE_URL=postgres://postgres:postgres@localhost:5432/forecourt\n`
      : `No .env file at ${result.path}.\n\n` +
        `  cp .env.example .env\n\n` +
        `then edit it if your Postgres is not on localhost:5432.\n`,
  );
  process.exit(1);
}
