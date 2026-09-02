/**
 * Photograph bytes. The CRM writes; the CRM and the public site both read.
 *
 * Two backends, one key scheme:
 *
 *   - **R2** when the four `R2_*` variables are set. Production. One private
 *     bucket shared by crm and site, which Railway volumes cannot do.
 *   - **Local disk** otherwise (`MEDIA_LOCAL_ROOT`, or `.media` in cwd).
 *     Development and the EXIF suite.
 *
 * Nothing above this package knows which one is live. Keys stay
 * `t/{tenantId}/…` either way.
 *
 * The bucket is private. Bytes leave through the `/media` routes, which
 * check the session (CRM) or the published row (site) before a GetObject.
 * A public bucket would leak unpublished interiors and part-exchange
 * photographs — those are often taken at a customer's house.
 */

import { join } from 'node:path';
import { LocalDiskStorage } from './disk.js';
import { R2Storage, type R2Config } from './r2.js';

export interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export const R2_REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

export type MediaEnv = Record<string, string | undefined>;

export type R2Jurisdiction = 'eu' | 'us' | 'fedramp';

const JURISDICTION_HOST: Record<R2Jurisdiction, string> = {
  eu: 'eu.r2.cloudflarestorage.com',
  us: 'us.r2.cloudflarestorage.com',
  fedramp: 'fedramp.r2.cloudflarestorage.com',
};

export function parseR2Jurisdiction(raw: string | undefined): R2Jurisdiction | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value === 'eu' || value === 'us' || value === 'fedramp') return value;
  throw new Error(
    `R2_JURISDICTION must be eu, us or fedramp — got '${raw}'. ` +
      'For UK dealer photographs use eu, and create the bucket in the EU jurisdiction.',
  );
}

export function r2EndpointFor(accountId: string, env: MediaEnv): string {
  const explicit = env['R2_ENDPOINT']?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const jurisdiction = parseR2Jurisdiction(env['R2_JURISDICTION']);
  const host = jurisdiction ? JURISDICTION_HOST[jurisdiction] : 'r2.cloudflarestorage.com';
  return `https://${accountId}.${host}`;
}

export function r2ConfigFrom(env: MediaEnv): R2Config | null {
  const present = R2_REQUIRED.filter((name) => Boolean(env[name]?.trim()));
  if (present.length === 0) return null;
  if (present.length !== R2_REQUIRED.length) {
    const missing = R2_REQUIRED.filter((name) => !present.includes(name));
    throw new Error(
      `R2 is half-configured. Set ${missing.join(', ')} as well, or remove ` +
        `${present.join(', ')} to keep photographs on local disk.`,
    );
  }
  const accountId = env['R2_ACCOUNT_ID']!.trim();
  return {
    accountId,
    accessKeyId: env['R2_ACCESS_KEY_ID']!.trim(),
    secretAccessKey: env['R2_SECRET_ACCESS_KEY']!.trim(),
    bucket: env['R2_BUCKET']!.trim(),
    endpoint: r2EndpointFor(accountId, env),
  };
}

export function localMediaRoot(env: MediaEnv = process.env): string {
  return env['MEDIA_LOCAL_ROOT'] ?? join(process.cwd(), '.media');
}

export function createMediaBackend(env: MediaEnv = process.env): StorageBackend {
  const r2 = r2ConfigFrom(env);
  if (r2) return new R2Storage(r2);
  return new LocalDiskStorage(localMediaRoot(env));
}

let cached: { id: string; backend: StorageBackend } | null = null;

const backendId = (env: MediaEnv): string => {
  const r2 = r2ConfigFrom(env);
  if (r2) return `r2:${r2.accountId}:${r2.bucket}:${r2.endpoint}`;
  return `disk:${localMediaRoot(env)}`;
};

/** Process-wide backend. Recreated if the env fingerprint changes (tests). */
export function mediaBackend(env: MediaEnv = process.env): StorageBackend {
  const id = backendId(env);
  if (cached?.id === id) return cached.backend;
  const backend = createMediaBackend(env);
  cached = { id, backend };
  return backend;
}

export function resetMediaBackendForTests(): void {
  cached = null;
}
