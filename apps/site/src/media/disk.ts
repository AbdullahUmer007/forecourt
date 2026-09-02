/**
 * Local-disk media, same key scheme as the CRM store.
 *
 * Duplicated rather than imported from the CRM: the public site must not
 * depend on the authenticated app, and the only thing they share is the
 * directory and the tenant-prefixed key. R2 replaces both backends later.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const root = (): string =>
  process.env['MEDIA_LOCAL_ROOT'] ?? join(process.cwd(), '.media');

export async function readPublicMedia(key: string): Promise<Buffer | null> {
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) return null;
  const path = resolve(join(root(), key));
  const base = resolve(root()) + sep;
  if (!path.startsWith(base) && path !== resolve(root())) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}
