import {
  parseSearchQuery,
  searchUrlPath,
  type SearchQuery,
} from '../../../packages/domain/src/search.js';
/** Accept inventory search pages only, never arbitrary redirect targets or vehicle detail URLs. */
export function parseBookmark(value: string): {
  query: SearchQuery;
  path: string;
} {
  if (
    value.length > 2000 ||
    !/^\/used-cars(?:\/[a-z0-9-]+){0,2}(?:\?[^#]*)?$/.test(value) ||
    /[\\\r\n]/.test(value)
  )
    throw new Error('Choose a search from the stock page and try again.');
  const url = new URL(value, 'https://search.invalid');
  const raw: Record<string, string[]> = Object.create(null) as Record<
    string,
    string[]
  >;
  url.searchParams.forEach((v, k) => {
    (raw[k] ??= []).push(v);
  });
  const { query, ignored } = parseSearchQuery(
    raw,
    url.pathname.split('/').slice(2),
  );
  if (ignored.length)
    throw new Error(
      'This search contains unsupported filters. Open the stock page and save it again.',
    );
  const normal = { ...query, page: 1 };
  return { query: normal, path: searchUrlPath(normal) };
}
