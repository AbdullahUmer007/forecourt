/**
 * Search, facets and counts.
 *
 * v1 is Postgres: a filtered SELECT plus one grouped query per facet
 * dimension. `03-architecture-and-data-model.md` §6.2 sets the switch point —
 * when a tenant passes ~5,000 live vehicles, or facet latency passes 150ms,
 * that tenant moves to Typesense behind this same interface. The interface is
 * the point: nothing above this file knows which engine answered.
 *
 * Everything runs inside `withTenant`, so RLS decides what is visible and
 * these queries only decide what is relevant.
 */

import { withTenant, toPence, toInt, toDate } from './db.js';
import { baseColour, type SearchQuery, type FacetCount, type MultiDimension } from '../../../../packages/domain/src/search.js';
import { slugify } from '../../../../packages/domain/src/seo.js';
import type { ResultVehicle } from '../render/results.js';

interface Row { [key: string]: unknown }

/**
 * Build the WHERE fragment and its parameters.
 *
 * Every value is a bound parameter. The only things interpolated into SQL text
 * are placeholders this function generates — a filter value never reaches the
 * statement as text.
 */
type Param = string | number | null;

function predicates(q: SearchQuery): { sql: string; params: Param[] } {
  const params: Param[] = [];
  const clauses: string[] = [`v.state = ANY('{live,reserved}')`, 'v.deleted_at IS NULL'];
  const bind = (value: Param | readonly Param[]): string => `$${params.push(value as Param)}`;

  const inList = (column: string, values: readonly string[], normalise = (s: string) => slugify(s)) => {
    if (values.length === 0) return;
    void normalise;
    clauses.push(`lower(regexp_replace(coalesce(${column}, ''), '[^a-zA-Z0-9]+', '-', 'g')) = ANY(${bind(values)})`);
  };

  inList('v.make', q.filters.make);
  inList('v.model', q.filters.model);
  inList('v.fuel_type', q.filters.fuel);
  inList('v.transmission', q.filters.transmission);
  inList('v.body_style', q.filters.body);
  if (q.filters.doors.length > 0) clauses.push(`v.doors = ANY(${bind(q.filters.doors.map(Number))})`);
  if (q.filters.seats.length > 0) clauses.push(`v.seats = ANY(${bind(q.filters.seats.map(Number))})`);

  if (q.minPricePence !== null) clauses.push(`v.retail_price_pence >= ${bind(String(q.minPricePence))}`);
  if (q.maxPricePence !== null) clauses.push(`v.retail_price_pence <= ${bind(String(q.maxPricePence))}`);
  if (q.minYear !== null) clauses.push(`coalesce(v.model_year, extract(year from v.first_registered_on)) >= ${bind(q.minYear)}`);
  if (q.maxMileage !== null) clauses.push(`v.mileage <= ${bind(q.maxMileage)}`);

  if (q.keyword) {
    // A registration typed into the box is the most common "search" a buyer
    // does, and it must find the car even though it is not in the text index.
    clauses.push(`(
      v.search_vector @@ plainto_tsquery('english', ${bind(q.keyword)})
      OR upper(replace(v.registration, ' ', '')) = ${bind(q.keyword.toUpperCase().replace(/\s+/g, ''))}
    )`);
  }

  // Colour is matched on the BASE colour, because that is what the facet
  // offers — a buyer filtering "Grey" means Moonstone Grey too.
  if (q.filters.colour.length > 0) {
    clauses.push(`lower(coalesce(v.colour, '')) ~ ${bind(colourPattern(q.filters.colour))}`);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Turn base-colour slugs back into the paint names that match them. */
function colourPattern(slugs: readonly string[]): string {
  const words: Record<string, string[]> = {
    black: ['black', 'ebony', 'onyx', 'obsidian', 'panther', 'carbon'],
    white: ['white', 'alpine', 'polar', 'glacier', 'ice', 'pearl'],
    silver: ['silver', 'aluminium', 'platinum', 'chrome', 'metallic'],
    grey: ['grey', 'gray', 'graphite', 'granite', 'slate', 'gunmetal', 'anthracite', 'quartz', 'moonstone'],
    blue: ['blue', 'navy', 'cobalt', 'azure', 'indigo', 'sapphire', 'reef'],
    red: ['red', 'crimson', 'scarlet', 'burgundy', 'maroon', 'ruby', 'flame'],
    green: ['green', 'emerald', 'olive', 'jade'],
    brown: ['brown', 'bronze', 'chestnut', 'mocha', 'coffee', 'walnut'],
    beige: ['beige', 'sand', 'champagne', 'cream', 'ivory', 'gold'],
    orange: ['orange', 'copper', 'amber', 'sunset'],
    yellow: ['yellow', 'lime'],
    purple: ['purple', 'violet', 'plum', 'aubergine'],
  };
  const alts = slugs.flatMap((s) => words[s] ?? [s]);
  return alts.length === 0 ? '.*' : `(${alts.join('|')})`;
}

const SORTS: Record<SearchQuery['sort'], string> = {
  relevance: 'v.live_at DESC NULLS LAST',
  newest: 'v.live_at DESC NULLS LAST',
  'price-asc': 'v.retail_price_pence ASC NULLS LAST',
  'price-desc': 'v.retail_price_pence DESC NULLS LAST',
  'mileage-asc': 'v.mileage ASC NULLS LAST',
  'year-desc': 'coalesce(v.model_year, extract(year from v.first_registered_on)) DESC NULLS LAST',
};

export async function countVehicles(tenantId: string, q: SearchQuery): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const { sql: where, params } = predicates(q);
    const rows = await tx.unsafe(`SELECT count(*)::int AS n FROM vehicles v WHERE ${where}`, params);
    return toInt((rows[0] as Row)?.['n']) ?? 0;
  });
}

export async function searchVehicles(tenantId: string, q: SearchQuery, perPage: number): Promise<ResultVehicle[]> {
  return withTenant(tenantId, async (tx) => {
    const { sql: where, params } = predicates(q);
    const offset = (q.page - 1) * perPage;
    const rows = await tx.unsafe(
      `SELECT v.id, v.make, v.model, v.derivative, v.registration, v.mileage,
              v.retail_price_pence, v.fuel_type, v.transmission, v.state,
              v.live_at, v.price_changed_at, v.model_year, v.first_registered_on,
              (SELECT variants FROM vehicle_media m
                WHERE m.vehicle_id = v.id AND m.published AND m.deleted_at IS NULL
                  AND NOT m.is_disclosure_evidence
                ORDER BY m.is_hero DESC, m.position LIMIT 1) AS hero_variants,
              (SELECT alt_text FROM vehicle_media m
                WHERE m.vehicle_id = v.id AND m.published AND m.deleted_at IS NULL
                  AND NOT m.is_disclosure_evidence
                ORDER BY m.is_hero DESC, m.position LIMIT 1) AS hero_alt
         FROM vehicles v
        WHERE ${where}
        ORDER BY ${SORTS[q.sort]}, v.id
        LIMIT ${perPage} OFFSET ${offset}`,
      params,
    );
    return (rows as Row[]).map(toResultVehicle);
  });
}

type Variant = { width: number; format: string; url: string };

function toResultVehicle(r: Row): ResultVehicle {
  const variants = ((r['hero_variants'] as Variant[] | null) ?? []).filter((v) => v.format === 'jpeg');
  const largest = variants.at(-1) ?? ((r['hero_variants'] as Variant[] | null) ?? []).at(-1);
  return {
    id: String(r['id']),
    make: (r['make'] as string) ?? null,
    model: (r['model'] as string) ?? null,
    derivative: (r['derivative'] as string) ?? null,
    year: toInt(r['model_year']) ?? (r['first_registered_on'] ? new Date(String(r['first_registered_on'])).getFullYear() : null),
    registration: String(r['registration'] ?? ''),
    mileage: toInt(r['mileage']),
    pricePence: toPence(r['retail_price_pence']),
    fuelType: (r['fuel_type'] as string) ?? null,
    transmission: (r['transmission'] as string) ?? null,
    state: String(r['state']),
    liveSince: toDate(r['live_at']),
    priceReducedAt: toDate(r['price_changed_at']),
    thumbnail: largest
      ? {
          url: largest.url,
          srcset: variants.map((v) => `${v.url} ${v.width}w`).join(', '),
          alt: String(r['hero_alt'] ?? 'Photograph of this vehicle'),
        }
      : null,
  };
}

/**
 * Facet counts.
 *
 * Counted against the CURRENT filter set, so the numbers beside each option
 * are what the buyer would actually get — a count computed against unfiltered
 * stock is worse than no count at all, because it promises results that are
 * not there.
 */
export async function facetCounts(
  tenantId: string,
  q: SearchQuery,
): Promise<Partial<Record<MultiDimension, readonly FacetCount[]>>> {
  return withTenant(tenantId, async (tx) => {
    const { sql: where, params } = predicates(q);
    const out: Partial<Record<MultiDimension, readonly FacetCount[]>> = {};

    const group = async (dimension: MultiDimension, column: string): Promise<void> => {
      const rows = await tx.unsafe(
        `SELECT ${column} AS label, count(*)::int AS n FROM vehicles v
          WHERE ${where} AND ${column} IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC, 1`,
        params,
      );
      out[dimension] = (rows as Row[]).map((r) => ({
        value: slugify(String(r['label'])),
        label: String(r['label']),
        count: toInt(r['n']) ?? 0,
      }));
    };

    await Promise.all([
      group('make', 'v.make'),
      group('fuel', 'v.fuel_type'),
      group('transmission', 'v.transmission'),
      group('body', 'v.body_style'),
      ...(q.filters.make.length === 1 ? [group('model', 'v.model')] : []),
    ]);

    // Colour is folded to base colours in application code rather than SQL:
    // the mapping is a product decision that belongs beside the facet, not in
    // a CASE expression nobody will find.
    const colourRows = await tx.unsafe(
      `SELECT v.colour AS label, count(*)::int AS n FROM vehicles v
        WHERE ${where} AND v.colour IS NOT NULL GROUP BY 1`,
      params,
    );
    const folded = new Map<string, { label: string; count: number }>();
    for (const r of colourRows as Row[]) {
      const base = baseColour(String(r['label'])) ?? 'Other';
      const key = slugify(base);
      const existing = folded.get(key);
      const n = toInt(r['n']) ?? 0;
      if (existing) existing.count += n; else folded.set(key, { label: base, count: n });
    }
    out.colour = [...folded.entries()]
      .map(([value, v]) => ({ value, ...v }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return out;
  });
}

/** Human labels for slugs, so `model-x` renders as `Model X`. */
export function labelFor(_tenantId: string): (dimension: MultiDimension, value: string) => string {
  return (_dimension, value) =>
    value.split('-').map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
