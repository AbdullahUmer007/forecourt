/**
 * Object keys are tenant-prefixed and content-hashed. A key that escapes
 * that shape is refused before it reaches disk or R2 — the storage backend
 * is not the place a path-traversal should first be noticed.
 */
export const isSafeObjectKey = (key: string): boolean =>
  key.length > 0
  && !key.includes('..')
  && !key.startsWith('/')
  && !key.includes('\\')
  && !key.includes('\0');
