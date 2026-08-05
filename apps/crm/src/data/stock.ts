import { withSession, toPence, toInt, toDate } from './db';
import type { Session } from '@/auth/session';
import { money, type Money, type VehicleState } from '@forecourt/domain';

/**
 * The stock list.
 *
 * CLAUDE.md sets a build gate for this screen specifically — "a 1,000-row
 * stock list filters in < 400ms" — so the filtering happens in Postgres
 * against M3's indexes, never in JavaScript over a fetched array. Pulling a
 * thousand rows to filter them in the browser would meet the letter of the
 * budget on a fast laptop and miss it entirely on the machine in the office.
 *
 * `tests/integration/stock-performance.test.ts` measures it against a
 * thousand real rows rather than trusting that.
 */

export interface StockFilters {
  // Optional AND undefined-able: these come straight from searchParams,
  // where a missing key IS undefined. Under exactOptionalPropertyTypes the
  // two are different, and pretending otherwise pushes a cast to every
  // caller.
  q?: string | undefined;
  state?: string | undefined;
  make?: string | undefined;
  siteId?: string | undefined;
  /** 90+ days in stock — capital the dealer cannot get at. */
  overageOnly?: boolean | undefined;
  sort?: 'newest' | 'oldest' | 'price_high' | 'price_low' | 'days' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface StockRow {
  id: string;
  stockNumber: string;
  registration: string;
  make: string | null;
  model: string | null;
  derivative: string | null;
  colour: string | null;
  mileage: number | null;
  state: VehicleState;
  retailPrice: Money | null;
  /** Cost data — only populated when the principal may see it. */
  totalCost: Money | null;
  daysInStock: number | null;
  publishedPhotoCount: number;
  provenanceCheckedAt: Date | null;
  provenanceAdverse: boolean;
  vatScheme: string | null;
  siteName: string | null;
  bookedInAt: Date | null;
}

export interface StockPage {
  rows: readonly StockRow[];
  total: number;
  /** Facet counts for the filter bar, from the same WHERE clause. */
  makes: readonly { make: string; count: number }[];
  states: readonly { state: string; count: number }[];
  /** Milliseconds the query took, so the budget is visible rather than assumed. */
  queryMs: number;
}

const SORTS: Record<NonNullable<StockFilters['sort']>, string> = {
  newest: 'v.booked_in_at DESC NULLS LAST',
  oldest: 'v.booked_in_at ASC NULLS LAST',
  price_high: 'v.retail_price_pence DESC NULLS LAST',
  price_low: 'v.retail_price_pence ASC NULLS LAST',
  days: 'v.booked_in_at ASC NULLS LAST',
};

/**
 * One query for the page, one for the count, two for the facets — all against
 * the same predicate.
 *
 * The facet counts deliberately reflect the CURRENT filter rather than the
 * whole book: a make list that never changes as you filter tells you nothing
 * about what you are looking at. M7 settled the same question for the public
 * site, and a zero-count option is shown and disabled rather than vanishing.
 */
export async function loadStock(
  session: Session,
  filters: StockFilters,
  canSeeCost: boolean,
): Promise<StockPage> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(0, filters.offset ?? 0);
  const sort = SORTS[filters.sort ?? 'newest'];

  const q = filters.q?.trim() || null;
  const state = filters.state?.trim() || null;
  const make = filters.make?.trim() || null;
  const siteId = filters.siteId?.trim() || null;
  const overage = filters.overageOnly ?? false;

  return withSession(session, async (tx) => {
    const started = Date.now();

    // `plainto_tsquery` rather than `to_tsquery`: the input is whatever
    // somebody typed into a box on a forecourt, and to_tsquery throws on a
    // stray ampersand.
    const rows = await tx<Record<string, never>[]>`
      SELECT v.id, v.stock_number, v.registration, v.make, v.model, v.derivative,
             v.colour, v.mileage, v.state, v.retail_price_pence,
             ${canSeeCost ? tx`v.total_cost_pence` : tx`NULL::bigint`} AS total_cost_pence,
             v.published_photo_count, v.provenance_checked_at, v.provenance_adverse,
             v.vat_scheme, v.booked_in_at, s.name AS site_name,
             CASE WHEN v.booked_in_at IS NULL THEN NULL
                  ELSE (now()::date - v.booked_in_at::date) END AS days_in_stock
      FROM vehicles v
      LEFT JOIN sites s ON s.id = v.site_id
      WHERE v.deleted_at IS NULL
        AND (${q}::text IS NULL OR v.search_vector @@ plainto_tsquery('english', ${q}))
        AND (${state}::text IS NULL OR v.state::text = ${state})
        AND (${make}::text IS NULL OR v.make = ${make})
        AND (${siteId}::text IS NULL OR v.site_id = ${siteId}::uuid)
        AND (NOT ${overage} OR (v.booked_in_at IS NOT NULL
             AND v.booked_in_at < now() - interval '90 days'))
      ORDER BY ${tx.unsafe(sort)}
      LIMIT ${limit} OFFSET ${offset}`;

    const [[count], makes, states] = await Promise.all([
      tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND (${q}::text IS NULL OR v.search_vector @@ plainto_tsquery('english', ${q}))
          AND (${state}::text IS NULL OR v.state::text = ${state})
          AND (${make}::text IS NULL OR v.make = ${make})
          AND (${siteId}::text IS NULL OR v.site_id = ${siteId}::uuid)
          AND (NOT ${overage} OR (v.booked_in_at IS NOT NULL
               AND v.booked_in_at < now() - interval '90 days'))`,
      tx<{ make: string; n: number }[]>`
        SELECT v.make, count(*)::int AS n FROM vehicles v
        WHERE v.deleted_at IS NULL AND v.make IS NOT NULL
          AND (${q}::text IS NULL OR v.search_vector @@ plainto_tsquery('english', ${q}))
          AND (${state}::text IS NULL OR v.state::text = ${state})
          AND (${siteId}::text IS NULL OR v.site_id = ${siteId}::uuid)
        GROUP BY v.make ORDER BY count(*) DESC, v.make LIMIT 30`,
      tx<{ state: string; n: number }[]>`
        SELECT v.state::text AS state, count(*)::int AS n FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND (${q}::text IS NULL OR v.search_vector @@ plainto_tsquery('english', ${q}))
          AND (${make}::text IS NULL OR v.make = ${make})
          AND (${siteId}::text IS NULL OR v.site_id = ${siteId}::uuid)
        GROUP BY v.state ORDER BY count(*) DESC`,
    ]);

    return {
      rows: rows.map((r) => {
        const row = r as unknown as Record<string, string | number | boolean | Date | null>;
        return {
          id: String(row['id']),
          stockNumber: String(row['stock_number']),
          registration: String(row['registration']),
          make: row['make'] as string | null,
          model: row['model'] as string | null,
          derivative: row['derivative'] as string | null,
          colour: row['colour'] as string | null,
          mileage: toInt(row['mileage'] as number | null),
          state: row['state'] as VehicleState,
          retailPrice: row['retail_price_pence'] === null
            ? null : money(toPence(row['retail_price_pence'] as string), 'GBP'),
          totalCost: row['total_cost_pence'] === null
            ? null : money(toPence(row['total_cost_pence'] as string), 'GBP'),
          daysInStock: toInt(row['days_in_stock'] as number | null),
          publishedPhotoCount: toInt(row['published_photo_count'] as number | null) ?? 0,
          provenanceCheckedAt: toDate(row['provenance_checked_at'] as Date | null),
          provenanceAdverse: Boolean(row['provenance_adverse']),
          vatScheme: row['vat_scheme'] as string | null,
          siteName: row['site_name'] as string | null,
          bookedInAt: toDate(row['booked_in_at'] as Date | null),
        };
      }),
      total: count?.n ?? 0,
      makes: makes.map((m) => ({ make: m.make, count: m.n })),
      states: states.map((s) => ({ state: s.state, count: s.n })),
      queryMs: Date.now() - started,
    };
  });
}

export interface VehicleDetail extends StockRow {
  vin: string | null;
  bodyStyle: string | null;
  doors: number | null;
  transmission: string | null;
  fuelType: string | null;
  engineCc: number | null;
  firstRegisteredOn: Date | null;
  motExpiresOn: Date | null;
  formerKeepers: number | null;
  serviceHistoryType: string | null;
  keyCount: number | null;
  v5cPresent: boolean;
  highestMotMileage: number | null;
  mileageAnomalyAcknowledged: boolean;
  advertHeadline: string | null;
  advertDescription: string | null;
  purchasePrice: Money | null;
  purchaseDate: Date | null;
  purchaseSource: string | null;
  minimumPrice: Money | null;
  liveAt: Date | null;
  notes: string | null;
}

export async function loadVehicle(
  session: Session,
  id: string,
  canSeeCost: boolean,
): Promise<VehicleDetail | null> {
  return withSession(session, async (tx) => {
    const [row] = await tx<Record<string, never>[]>`
      SELECT v.*, s.name AS site_name,
             CASE WHEN v.booked_in_at IS NULL THEN NULL
                  ELSE (now()::date - v.booked_in_at::date) END AS days_in_stock
      FROM vehicles v
      LEFT JOIN sites s ON s.id = v.site_id
      WHERE v.id = ${id}::uuid AND v.deleted_at IS NULL`;

    // Absent and another dealer's are indistinguishable here — RLS returned
    // nothing either way, and the route turns both into the same 404.
    if (!row) return null;

    const r = row as unknown as Record<string, string | number | boolean | Date | null>;
    const gbp = (v: unknown): Money | null =>
      v === null || v === undefined ? null : money(toPence(v as string), 'GBP');

    return {
      id: String(r['id']),
      stockNumber: String(r['stock_number']),
      registration: String(r['registration']),
      make: r['make'] as string | null,
      model: r['model'] as string | null,
      derivative: r['derivative'] as string | null,
      colour: r['colour'] as string | null,
      mileage: toInt(r['mileage'] as number | null),
      state: r['state'] as VehicleState,
      retailPrice: gbp(r['retail_price_pence']),
      // Cost data, gated server-side. Not sent, not hidden.
      totalCost: canSeeCost ? gbp(r['total_cost_pence']) : null,
      purchasePrice: canSeeCost ? gbp(r['purchase_price_pence']) : null,
      minimumPrice: canSeeCost ? gbp(r['minimum_price_pence']) : null,
      daysInStock: toInt(r['days_in_stock'] as number | null),
      publishedPhotoCount: toInt(r['published_photo_count'] as number | null) ?? 0,
      provenanceCheckedAt: toDate(r['provenance_checked_at'] as Date | null),
      provenanceAdverse: Boolean(r['provenance_adverse']),
      vatScheme: r['vat_scheme'] as string | null,
      siteName: r['site_name'] as string | null,
      bookedInAt: toDate(r['booked_in_at'] as Date | null),
      vin: r['vin'] as string | null,
      bodyStyle: r['body_style'] as string | null,
      doors: toInt(r['doors'] as number | null),
      transmission: r['transmission'] as string | null,
      fuelType: r['fuel_type'] as string | null,
      engineCc: toInt(r['engine_cc'] as number | null),
      firstRegisteredOn: toDate(r['first_registered_on'] as Date | null),
      motExpiresOn: toDate(r['mot_expires_on'] as Date | null),
      formerKeepers: toInt(r['former_keepers'] as number | null),
      serviceHistoryType: r['service_history_type'] as string | null,
      keyCount: toInt(r['key_count'] as number | null),
      v5cPresent: Boolean(r['v5c_present']),
      highestMotMileage: toInt(r['highest_mot_mileage'] as number | null),
      mileageAnomalyAcknowledged: r['mileage_anomaly_acknowledged_by'] !== null,
      advertHeadline: r['advert_headline'] as string | null,
      advertDescription: r['advert_description'] as string | null,
      purchaseDate: toDate(r['purchase_date'] as Date | null),
      purchaseSource: canSeeCost ? (r['purchase_source'] as string | null) : null,
      liveAt: toDate(r['live_at'] as Date | null),
      notes: r['notes'] as string | null,
    };
  });
}
