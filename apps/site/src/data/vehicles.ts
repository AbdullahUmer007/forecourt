/**
 * Vehicle reads for the public site.
 *
 * Every function here runs inside `withTenant`, so RLS is the thing that
 * decides what comes back — not the WHERE clause. The `tenant_id` predicates
 * you will NOT find below are absent deliberately: adding them would make the
 * queries look safe while hiding whether the policy is actually doing its job.
 * The isolation suite proves the policy works; these queries rely on it.
 *
 * The one filter that is a business rule rather than a boundary is `state`:
 * only `live` and `reserved` vehicles are advertisable, and a sold car is a
 * redirect (see `resolveSoldVehicle`), never a page.
 */

import { withTenant, toPence, toInt, toIsoDate, toDate, type Tx } from './db.js';
import type { VdpInput, MediaView, MotTestView } from '../render/vdp.js';
import type { SitemapVehicle, SitemapStaticPage, SimilarVehicle } from '../../../../packages/domain/src/seo.js';
import { slugify } from '../../../../packages/domain/src/seo.js';

const ADVERTISABLE = ['live', 'reserved'] as const;

const VEHICLE_COLUMNS = `
  v.id, v.stock_number, v.registration, v.make, v.model, v.derivative, v.body_style,
  v.doors, v.seats, v.transmission, v.fuel_type, v.engine_cc, v.power_bhp, v.co2_gkm,
  v.colour, v.mileage, v.mot_expires_on, v.former_keepers, v.key_count,
  v.service_history_type, v.retail_price_pence, v.currency, v.state,
  v.advert_description, v.provenance_checked_at, v.price_changed_at,
  v.live_at, v.updated_at, v.first_registered_on, v.model_year
`;

interface Row { [key: string]: unknown }

const yearOf = (row: Row): number | null =>
  toInt(row['model_year']) ?? (row['first_registered_on'] ? new Date(String(row['first_registered_on'])).getFullYear() : null);

/** The slug tail our URLs end with: `dual-motor-long-range-2022-wn22hnl`. */
const slugTail = (row: Row): string =>
  [slugify(String(row['derivative'] ?? '')), yearOf(row) ?? '', slugify(String(row['registration'] ?? ''))]
    .filter(Boolean).join('-');

async function mediaFor(tx: Tx, vehicleId: string): Promise<MediaView[]> {
  const rows = await tx`
    SELECT variants, alt_text, is_disclosure_evidence, caption
      FROM vehicle_media
     WHERE vehicle_id = ${vehicleId}::uuid
       AND published AND deleted_at IS NULL AND kind = 'photo'
     ORDER BY is_disclosure_evidence, is_hero DESC, position`;

  return rows.map((r): MediaView => {
    const view: MediaView = {
      variants: (r['variants'] as MediaView['variants']) ?? [],
      alt: String(r['alt_text'] ?? 'Photograph of this vehicle'),
      isDamage: Boolean(r['is_disclosure_evidence']),
    };
    // A declared mark is named, not just photographed.
    return r['caption'] ? { ...view, damageLabel: String(r['caption']) } : view;
  });
}

async function motFor(tx: Tx, vehicleId: string): Promise<MotTestView[]> {
  const rows = await tx`
    SELECT test_date, result, odometer_miles, advisories
      FROM mot_records
     WHERE vehicle_id = ${vehicleId}::uuid
     ORDER BY test_date DESC`;
  return rows.map((r) => ({
    testDate: toIsoDate(r['test_date']) ?? '',
    result: String(r['result']),
    odometerMiles: toInt(r['odometer_miles']),
    advisories: (r['advisories'] as string[] | null) ?? [],
  }));
}

/**
 * A type alias with an intersection, NOT `interface ... extends`. An interface
 * can only extend a named type; `VdpInput['vehicle']` is an indexed access, and
 * `interface X extends VdpInput['vehicle']` is invalid TypeScript that SWC
 * reports as a bare syntax error several lines later.
 */
export type LoadedVehicle = VdpInput['vehicle'] & {
  id: string;
  media: readonly MediaView[];
  mot: readonly MotTestView[];
  provenanceCheckedAt: string | null;
  priceContext: { previousPence: bigint; changedOn: string } | null;
  metaTitle: string;
};

function toVehicle(row: Row, origin: string): Omit<LoadedVehicle, 'media' | 'mot' | 'metaTitle'> {
  const price = toPence(row['retail_price_pence']);
  return {
    id: String(row['id']),
    make: (row['make'] as string) ?? null,
    model: (row['model'] as string) ?? null,
    derivative: (row['derivative'] as string) ?? null,
    year: yearOf(row),
    registration: String(row['registration'] ?? ''),
    vin: null,                                   // never published
    mileage: toInt(row['mileage']),
    mileageUnit: 'SMI',
    pricePence: price,
    currency: String(row['currency'] ?? 'GBP') as 'GBP',
    colour: (row['colour'] as string) ?? null,
    fuelType: (row['fuel_type'] as string) ?? null,
    transmission: (row['transmission'] as string) ?? null,
    bodyStyle: (row['body_style'] as string) ?? null,
    doors: toInt(row['doors']),
    seats: toInt(row['seats']),
    engineCc: toInt(row['engine_cc']),
    powerBhp: toInt(row['power_bhp']),
    co2Gkm: toInt(row['co2_gkm']),
    formerKeepers: toInt(row['former_keepers']),
    state: String(row['state']),
    imageUrls: [],
    description: (row['advert_description'] as string) ?? null,
    url: `${origin}/used-cars/${slugify(String(row['make'] ?? 'used'))}/${slugify(String(row['model'] ?? 'car'))}/${slugTail(row)}`,
    stockNumber: String(row['stock_number'] ?? ''),
    keyCount: toInt(row['key_count']),
    serviceHistory: (row['service_history_type'] as string) ?? null,
    motExpiresOn: toIsoDate(row['mot_expires_on']),
    warranty: null,
    provenanceCheckedAt: toIsoDate(row['provenance_checked_at']),
    priceContext: null,
  };
}

/** One vehicle, by the slug tail in its URL. */
export async function loadVehicleBySlug(tenantId: string, slug: string, origin = ''): Promise<LoadedVehicle | null> {
  return withTenant(tenantId, async (tx) => {
    // The registration is the uniqueness guarantee in the URL, so match on it
    // rather than on the whole slug — a dealer editing a derivative must not
    // break every link to the car.
    const reg = slug.split('-').at(-1)?.toUpperCase() ?? '';
    const rows = await tx.unsafe(
      `SELECT ${VEHICLE_COLUMNS} FROM vehicles v
        WHERE upper(replace(v.registration, ' ', '')) = $1 AND v.deleted_at IS NULL
        LIMIT 1`,
      [reg],
    );
    const row = rows[0] as Row | undefined;
    if (!row) return null;

    const base = toVehicle(row, origin);
    const [media, mot] = await Promise.all([mediaFor(tx, base.id), motFor(tx, base.id)]);

    // A price reduction the buyer can see, from our own history.
    const previous = await tx`
      SELECT price_pence FROM vehicle_prices
       WHERE vehicle_id = ${base.id}::uuid
       ORDER BY effective_from DESC OFFSET 1 LIMIT 1`;
    const previousPence = toPence(previous[0]?.['price_pence']);
    const changedOn = toIsoDate(row['price_changed_at']);

    return {
      ...base, media, mot,
      metaTitle: [base.year, base.make, base.model, base.derivative].filter(Boolean).join(' '),
      priceContext: previousPence !== null && changedOn !== null && base.pricePence !== null && previousPence > base.pricePence
        ? { previousPence, changedOn }
        : null,
    };
  });
}

/** Candidates for the sold-vehicle redirect. */
export async function loadSimilarVehicles(
  tenantId: string,
  sold: { make: string | null; model: string | null },
): Promise<SimilarVehicle[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.unsafe(
      `SELECT ${VEHICLE_COLUMNS} FROM vehicles v
        WHERE v.state = ANY($1) AND v.deleted_at IS NULL
          AND ($2::text IS NULL OR lower(v.make) = lower($2))
        ORDER BY v.live_at DESC NULLS LAST LIMIT 40`,
      [ADVERTISABLE as unknown as string[], sold.make],
    );
    return (rows as Row[]).map((r) => ({
      make: (r['make'] as string) ?? null,
      model: (r['model'] as string) ?? null,
      derivative: (r['derivative'] as string) ?? null,
      year: yearOf(r),
      registration: String(r['registration'] ?? ''),
      pricePence: toPence(r['retail_price_pence']),
    }));
  });
}

export async function loadSitemapVehicles(tenantId: string): Promise<SitemapVehicle[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.unsafe(
      `SELECT ${VEHICLE_COLUMNS} FROM vehicles v
        WHERE v.state = ANY($1) AND v.deleted_at IS NULL`,
      [ADVERTISABLE as unknown as string[]],
    );
    return (rows as Row[]).map((r) => ({
      make: (r['make'] as string) ?? null,
      model: (r['model'] as string) ?? null,
      derivative: (r['derivative'] as string) ?? null,
      year: yearOf(r),
      registration: String(r['registration'] ?? ''),
      updatedAt: toDate(r['updated_at']) ?? new Date(),
      state: String(r['state']),
    }));
  });
}

export async function loadStaticPages(_tenantId: string): Promise<SitemapStaticPage[]> {
  const now = new Date();
  return [
    { path: '/', updatedAt: now, priority: 1 },
    { path: '/used-cars', updatedAt: now, priority: 0.9 },
    { path: '/finance', updatedAt: now },
    { path: '/initial-disclosure', updatedAt: now },
    { path: '/complaints-procedure', updatedAt: now },
    { path: '/privacy-policy', updatedAt: now },
  ];
}

export type LoadedDealer = VdpInput['dealer'] & {
  fcaFrn: string | null;
  theme: undefined;
};

export async function loadDealer(tenantId: string, origin: string): Promise<LoadedDealer> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      SELECT t.name, t.legal_name, t.fca_frn, t.settings AS tenant_settings,
             s.address, s.phone, s.email, s.lat, s.lng, s.opening_hours
        FROM tenants t
        LEFT JOIN LATERAL (
          SELECT * FROM sites WHERE tenant_id = t.id ORDER BY created_at LIMIT 1
        ) s ON true
       WHERE t.id = ${tenantId}::uuid`;
    const r = (rows[0] ?? {}) as Row;
    const address = (r['address'] as Record<string, string> | null) ?? {};
    // WhatsApp is a TENANT setting, not a site one — it is the number the
    // dealer answers, and it does not change per branch.
    const settings = (r['tenant_settings'] as Record<string, string> | null) ?? {};
    const hours = (r['opening_hours'] as VdpInput['dealer']['openingHours'] | null) ?? [];
    return {
      name: String(r['name'] ?? 'Used cars'),
      url: origin,
      logoUrl: null,
      telephone: (r['phone'] as string) ?? null,
      email: (r['email'] as string) ?? null,
      whatsapp: settings['whatsapp'] ?? null,
      street: [address['line1'], address['line2']].filter(Boolean).join(', '),
      locality: String(address['city'] ?? ''),
      region: String(address['county'] ?? ''),
      postcode: String(address['postcode'] ?? ''),
      country: 'GB',
      latitude: r['lat'] === null || r['lat'] === undefined ? null : Number(r['lat']),
      longitude: r['lng'] === null || r['lng'] === undefined ? null : Number(r['lng']),
      openingHours: hours.length > 0 ? hours : [{ days: ['Monday', 'Saturday'], opens: '10:00', closes: '18:00' }],
      // Omitted rather than invented: an aggregateRating with no reviews behind
      // it is a structured-data violation that can earn a manual penalty.
      ratingValue: null,
      reviewCount: null,
      priceRange: '££',
      fcaFrn: (r['fca_frn'] as string) ?? null,
      theme: undefined,
    };
  });
}
