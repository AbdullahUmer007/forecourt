/**
 * Shared vehicle catalogue — make, model, variant.
 *
 * The lists themselves live in Postgres. This module is the pure half:
 * slugs, labels, and matching a typed value to a catalogue row so a book-in
 * cannot invent a derivative (CLAUDE.md: never guess when the lookup is
 * ambiguous — show a picker).
 */

export const catalogueSlug = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export function variantLabel(parts: {
  typeName?: string | null;
  name: string;
  hp?: number | null;
}): string {
  const power = parts.hp != null && parts.hp > 0 ? `${parts.hp} HP` : null;
  return [parts.typeName?.trim() || null, parts.name.trim(), power]
    .filter((p): p is string => Boolean(p))
    .join(' · ');
}

export const namesMatch = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Pick the unique catalogue row whose name (or label) equals the typed value.
 * Zero matches → not in the list. Two or more → ambiguous; the caller shows
 * a picker rather than guessing.
 */
export function uniqueByName<T extends { name: string; label?: string }>(
  rows: readonly T[],
  typed: string,
): { ok: true; row: T } | { ok: false; reason: 'missing' | 'ambiguous'; matches: T[] } {
  const needle = typed.trim().toLowerCase();
  if (!needle) return { ok: false, reason: 'missing', matches: [] };
  const matches = rows.filter((r) =>
    r.name.trim().toLowerCase() === needle
    || (r.label !== undefined && r.label.trim().toLowerCase() === needle),
  );
  if (matches.length === 1) return { ok: true, row: matches[0]! };
  if (matches.length === 0) return { ok: false, reason: 'missing', matches: [] };
  return { ok: false, reason: 'ambiguous', matches: [...matches] };
}
