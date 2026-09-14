import type { JSONValue } from 'postgres';
import type { MultiDimension } from '../../../../packages/domain/src/search.js';
import { withVisitor, validVisitorToken, tokenDigest } from './shortlist.js';
import { parseBookmark } from '../search-bookmark.js';
import { describeSearch } from '../../../../packages/domain/src/shortlist.js';
import { labelFor, countVehicles } from './search.js';
export const MAX_SAVED_SEARCHES = 20;
export interface SearchBookmark {
  id: string;
  name: string;
  path: string;
  count: number;
}
export async function loadSavedSearches(
  tenantId: string,
  token: string | null,
): Promise<SearchBookmark[]> {
  if (!validVisitorToken(token)) return [];
  const rows = await withVisitor(
    tenantId,
    token,
    (tx) =>
      tx`SELECT id,name,canonical_path FROM saved_searches WHERE removed_at IS NULL ORDER BY created_at DESC,id LIMIT ${MAX_SAVED_SEARCHES}`,
  );
  return Promise.all(
    rows.map(async (r) => {
      const { query, path } = parseBookmark(String(r['canonical_path']));
      return {
        id: String(r['id']),
        name: String(r['name']),
        path,
        count: await countVehicles(tenantId, query),
      };
    }),
  );
}
export async function changeSavedSearch(
  tenantId: string,
  token: string,
  input: { action: string; search: string; id: string; name: string },
): Promise<{ ok: boolean; message: string }> {
  const { action, id } = input;
  if (
    !['save', 'rename', 'remove'].includes(action) ||
    (action !== 'save' &&
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
  )
    return { ok: false, message: 'Choose a saved search and try again.' };
  let bookmark: ReturnType<typeof parseBookmark> | undefined;
  if (action === 'save') {
    try {
      bookmark = parseBookmark(input.search);
    } catch {
      return {
        ok: false,
        message: 'Open your search on the stock page and save it again.',
      };
    }
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  if ((action === 'rename' && !name) || name.length > 80)
    return {
      ok: false,
      message: 'Use a search name between 1 and 80 characters.',
    };
  return withVisitor(tenantId, token, async (tx) => {
    if (action === 'save')
      await tx`INSERT INTO shortlists (tenant_id,token) VALUES (${tenantId}::uuid,${tokenDigest(token)}) ON CONFLICT (tenant_id,token) WHERE token IS NOT NULL DO NOTHING`;
    const [owner] = await tx`SELECT id FROM shortlists FOR UPDATE`;
    if (!owner)
      return {
        ok: false,
        message: 'This saved search is no longer available in this browser.',
      };
    const ownerId = String(owner['id']);
    let resourceId = id;
    let diff: JSONValue;
    if (bookmark) {
      const [existing] =
        await tx`SELECT id FROM saved_searches WHERE removed_at IS NULL AND canonical_path=${bookmark.path}`;
      if (existing)
        return { ok: true, message: 'This search is already saved.' };
      const [n] =
        await tx`SELECT count(*)::int AS n FROM saved_searches WHERE removed_at IS NULL`;
      if (Number(n?.['n']) >= MAX_SAVED_SEARCHES)
        return {
          ok: false,
          message:
            'You have 20 saved searches. Remove one before saving another.',
        };
      const title =
        name ||
        describeSearch(bookmark.query, (dimension, value) =>
          labelFor(tenantId)(dimension as MultiDimension, value),
        ).slice(0, 80);
      const query = JSON.parse(
        JSON.stringify(bookmark.query, (_, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ) as JSONValue;
      const [row] =
        await tx`INSERT INTO saved_searches (tenant_id,shortlist_id,name,canonical_path,query) VALUES (${tenantId}::uuid,${ownerId}::uuid,${title},${bookmark.path},${tx.json(query)}) RETURNING id`;
      resourceId = String(row!['id']);
      diff = { after: { name: title, path: bookmark.path, saved: true } };
    } else {
      const [before] =
        await tx`SELECT name FROM saved_searches WHERE id=${id}::uuid AND removed_at IS NULL`;
      if (!before)
        return {
          ok: false,
          message:
            'This saved search has already been removed or belongs to another browser.',
        };
      if (action === 'rename') {
        if (before['name'] === name)
          return { ok: true, message: 'Search name saved.' };
        await tx`UPDATE saved_searches SET name=${name} WHERE id=${id}::uuid`;
        diff = { before: { name: before['name'] }, after: { name } };
      } else {
        await tx`UPDATE saved_searches SET removed_at=now() WHERE id=${id}::uuid`;
        diff = { before: { saved: true }, after: { saved: false } };
      }
    }
    await tx`UPDATE shortlists SET updated_at=now(),last_seen_at=now() WHERE id=${ownerId}::uuid`;
    await tx`INSERT INTO audit_events (tenant_id,actor_type,resource_type,resource_id,action,diff) VALUES (${tenantId}::uuid,'public','saved_search',${resourceId}::uuid,${action},${tx.json(diff)})`;
    return {
      ok: true,
      message:
        action === 'save'
          ? 'Search saved. Check back here for current matches.'
          : action === 'rename'
            ? 'Search name saved.'
            : 'Search removed.',
    };
  });
}
