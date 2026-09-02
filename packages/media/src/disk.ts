import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { StorageBackend } from './backend.js';
import { isSafeObjectKey } from './keys.js';

/**
 * Local disk, for development. Writes under the SAME key shape production
 * uses, so a bug in the key scheme shows up here rather than the first time
 * a real bucket is attached.
 */
export class LocalDiskStorage implements StorageBackend {
  constructor(private readonly root: string) {}

  private resolveKey(key: string): string | null {
    if (!isSafeObjectKey(key)) return null;
    const path = resolve(join(this.root, key));
    const root = resolve(this.root) + sep;
    if (!path.startsWith(root) && path !== resolve(this.root)) return null;
    return path;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    if (!path) throw new Error('Refusing a media key that escapes the store.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.resolveKey(key);
    if (!path) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }
}
