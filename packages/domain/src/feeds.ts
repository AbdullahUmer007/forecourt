/**
 * M16 — channel feeds.
 *
 * There is no universal UK stock-feed standard. Every portal defines its own
 * schema, its own required fields and its own idea of a valid mileage, so the
 * only shape that survives a fifth channel is ONE canonical internal vehicle
 * and one versioned adapter per channel.
 *
 * Three rules here are load-bearing, and each exists because breaking it is
 * expensive rather than untidy:
 *
 *   1. A COST-OF-CREDIT FIGURE NEVER REACHES A FEED. On our own site a payment
 *      renders through the M8 gate with the representative example beside it.
 *      In a feed, a third party renders our payload on their page, in their
 *      layout, and there is nowhere to attach the example CONC 3.5.3R
 *      requires. `assertNoFinanceInFeed` runs on every payload every adapter
 *      builds — there is no path around it, the same way there is no path
 *      around `<FinancePromotion>`.
 *
 *   2. DELISTING IS A DEADLINE, NOT AN EVENT. A sold car left live generates
 *      enquiries the dealer cannot fulfil, and is arguably a misleading action
 *      under the CPRs. `delistDueAt` is computed when the car sells, so an
 *      overdue delisting is a query rather than a job somebody hopes ran.
 *
 *   3. THE GO-LIVE GATE APPLIES TO FEEDS TOO. A car that may not appear on our
 *      own site because it has no price, no photographs or no provenance check
 *      must not appear on Auto Trader either. It would be absurd to hold our
 *      own shopfront to a higher standard than the portal a dealer pays for.
 */

import { type Money, money, format } from './money.js';

// ------------------------------------------------------------------ types

export type ChannelKey =
  | 'auto_trader' | 'ebay_motors_group' | 'cargurus' | 'carwow'
  | 'meta_catalogue' | 'google_vehicle_ads' | 'generic_xml' | 'generic_csv';

export type ListingStatus =
  | 'not_published' | 'queued' | 'published' | 'failed' | 'delist_queued' | 'delisted';

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  auto_trader: 'Auto Trader',
  ebay_motors_group: 'eBay Motors Group',
  cargurus: 'CarGurus',
  carwow: 'Carwow',
  meta_catalogue: 'Meta catalogue',
  google_vehicle_ads: 'Google Vehicle Ads',
  generic_xml: 'XML export',
  generic_csv: 'CSV export',
};

/**
 * The canonical vehicle. One internal shape; every adapter maps FROM this and
 * nothing maps between channels.
 */
export interface CanonicalVehicle {
  id: string;
  registration: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  derivative: string | null;
  bodyStyle: string | null;
  doors: number | null;
  seats: number | null;
  transmission: string | null;
  fuelType: string | null;
  engineCc: number | null;
  colour: string | null;
  mileage: number | null;
  firstRegisteredOn: Date | null;
  co2Gkm: number | null;
  price: Money | null;
  vatScheme: 'margin' | 'qualifying' | 'non_qualifying' | null;
  headline: string | null;
  description: string | null;
  features: readonly string[];
  photoUrls: readonly string[];
  publishedPhotoCount: number;
  state: string;
  provenanceCheckedAt: Date | null;
  /** Fees the buyer must pay on top — §8.3 requires these disclosed. */
  mandatoryFees: readonly { label: string; amount: Money }[];
}

export interface ChannelOverride {
  price?: Money | null;
  headline?: string | null;
  description?: string | null;
  photoUrls?: readonly string[] | null;
  features?: readonly string[] | null;
}

/** What an adapter produces. Deliberately a flat record — every portal wants
 *  a different subset, and a nested shape makes the field mapping unreadable. */
export type ChannelPayload = Record<string, string | number | boolean | readonly string[] | null>;

export interface FieldProblem {
  field: string;
  message: string;
  /** A blocking problem stops the publish; a warning is reported and sent. */
  blocking: boolean;
}

export interface ChannelAdapter {
  channel: ChannelKey;
  /** Bumped whenever the mapping changes, and recorded on every sync event so
   *  "which mapping produced this?" has an answer when a portal starts
   *  rejecting things. */
  version: number;
  map(vehicle: CanonicalVehicle, override?: ChannelOverride): ChannelPayload;
  validate(payload: ChannelPayload): FieldProblem[];
}

// ------------------------------------------------- THE compliance guard

/**
 * Patterns that indicate a cost-of-credit figure.
 *
 * Anchored on the credit signal — a period, a rate, an APR, a credit word —
 * and never on the mere presence of a number, because a scanner that flags
 * every cash price gets switched off within a week and then protects nothing.
 * Same reasoning as M8's free-text language scanner.
 */
const FINANCE_SIGNALS: readonly RegExp[] = [
  /\bapr\b/i,
  /\bper\s*month\b/i,
  /\bpcm\b/i,
  /\ba\s*month\b/i,
  /\bmonthly\s+payment/i,
  /\bmonthly\s+repayment/i,
  /\bdeposit\b/i,
  /\bfinance\s+from\b/i,
  /\bhp\s+from\b/i,
  /\bpcp\b/i,
  /\brepresentative\s+example/i,
  /\binterest\s+rate\b/i,
  /\bcredit\b/i,
];

/**
 * Refuse any payload carrying a cost-of-credit figure.
 *
 * Runs inside every adapter, so there is no code path from a vehicle to a feed
 * that skips it — the same structural argument as `<FinancePromotion>` and
 * `assertNoFinanceFigures`. A portal renders our payload in their layout, and
 * a monthly payment there is a financial promotion with no representative
 * example anywhere near it.
 */
export function assertNoFinanceInFeed(payload: ChannelPayload, channel: ChannelKey): void {
  const offenders: string[] = [];

  for (const [field, value] of Object.entries(payload)) {
    const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
    if (!text) continue;
    for (const signal of FINANCE_SIGNALS) {
      if (signal.test(text)) {
        offenders.push(`${field} (matched ${signal.source})`);
        break;
      }
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `Refusing to send a cost-of-credit figure to ${CHANNEL_LABELS[channel]}: ` +
      `${offenders.join(', ')}. A monthly payment or APR is a financial promotion under ` +
      'CONC 3.5.3R and must carry a representative example, which we cannot attach to ' +
      'somebody else’s page. Remove it from the description, or advertise the cash price only.',
    );
  }
}

// ------------------------------------------------------- publishability

export interface PublishBlocker {
  code: string;
  message: string;
}

/**
 * Whether a vehicle may go to a channel at all.
 *
 * This is M3's go-live gate applied to feeds. A car that cannot appear on our
 * own site because it has no price, no photographs or no provenance check must
 * not appear on a portal the dealer is paying for — holding our own shopfront
 * to a higher standard than Auto Trader would be exactly backwards.
 */
export function publishBlockers(
  vehicle: CanonicalVehicle,
  rule: { minPhotos?: number | null; minPrice?: Money | null; maxPrice?: Money | null;
          makes?: readonly string[]; excludeMakes?: readonly string[] } = {},
  override: ChannelOverride = {},
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  const price = override.price ?? vehicle.price;

  if (vehicle.state !== 'live' && vehicle.state !== 'reserved') {
    blockers.push({
      code: 'not_live',
      message: `This car is ${vehicle.state.replace(/_/g, ' ')}, not live. Only live stock is advertised.`,
    });
  }

  if (!price || price.amount <= 0n) {
    blockers.push({
      code: 'no_price',
      message: 'No retail price. A portal listing without a price is rejected, and an advertised price must be one you will honour.',
    });
  }

  if (vehicle.publishedPhotoCount === 0) {
    blockers.push({
      code: 'no_photos',
      message: 'No published photographs. Every portal ranks a listing without pictures last, if it accepts it at all.',
    });
  }

  if (vehicle.provenanceCheckedAt === null) {
    blockers.push({
      code: 'no_provenance',
      message: 'No provenance check recorded. Advertising a car we have not checked is the risk this gate exists to stop.',
    });
  }

  const photoRule = rule.minPhotos ?? null;
  if (photoRule !== null && vehicle.publishedPhotoCount < photoRule) {
    blockers.push({
      code: 'below_photo_rule',
      message: `${vehicle.publishedPhotoCount} of ${photoRule} photographs. This channel's own rule holds it back.`,
    });
  }

  if (price && rule.minPrice && price.amount < rule.minPrice.amount) {
    blockers.push({
      code: 'below_price_rule',
      message: `${format(price)} is below this channel's ${format(rule.minPrice)} floor.`,
    });
  }
  if (price && rule.maxPrice && price.amount > rule.maxPrice.amount) {
    blockers.push({
      code: 'above_price_rule',
      message: `${format(price)} is above this channel's ${format(rule.maxPrice)} ceiling.`,
    });
  }

  const make = vehicle.make?.toLowerCase() ?? '';
  if (rule.makes && rule.makes.length > 0
      && !rule.makes.some((m) => m.toLowerCase() === make)) {
    blockers.push({
      code: 'make_not_included',
      message: `${vehicle.make ?? 'This make'} is not in this channel's list.`,
    });
  }
  if (rule.excludeMakes?.some((m) => m.toLowerCase() === make)) {
    blockers.push({
      code: 'make_excluded',
      message: `${vehicle.make ?? 'This make'} is excluded from this channel.`,
    });
  }

  return blockers;
}

export const canPublish = (
  vehicle: CanonicalVehicle,
  rule?: Parameters<typeof publishBlockers>[1],
  override?: ChannelOverride,
): boolean => publishBlockers(vehicle, rule, override).length === 0;

// ------------------------------------------------------------ delisting

export type DelistTrigger = 'sold' | 'reserved' | 'withdrawn' | 'archived';

export interface DelistDecision {
  required: boolean;
  dueAt: Date | null;
  overdue: boolean;
  reason: string;
}

/**
 * When a listing must be gone by.
 *
 * §10.2 allows a configured delay — some dealers keep a sold car up for a day
 * to catch "similar vehicle" enquiries — but the default is immediate, and the
 * deadline is a stored timestamp rather than an intention. A car past its
 * deadline and still published is findable with a WHERE clause, which is the
 * difference between a feature and a promise.
 *
 * A RESERVED car is not delisted by default: a reservation falls through often
 * enough that pulling the advert costs the dealer the next buyer. Selling is
 * what ends an advert.
 */
/** A date as a dealer reads it: 12 Aug 2026, 14:30. */
const humanDate = (d: Date): string =>
  d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });

export function delistDecision(input: {
  trigger: DelistTrigger | null;
  triggeredAt: Date | null;
  delayMinutes: number;
  status: ListingStatus;
  asAt: Date;
  delistOnReserve?: boolean;
}): DelistDecision {
  const live = input.status === 'published' || input.status === 'queued'
    || input.status === 'delist_queued';

  if (!input.trigger || !input.triggeredAt || !live) {
    return { required: false, dueAt: null, overdue: false, reason: 'Nothing to take down.' };
  }

  if (input.trigger === 'reserved' && !(input.delistOnReserve ?? false)) {
    return {
      required: false, dueAt: null, overdue: false,
      reason: 'Reserved, not sold. A reservation falls through often enough that pulling the '
        + 'advert costs the next buyer; the listing stays until it sells.',
    };
  }

  const dueAt = new Date(input.triggeredAt.getTime() + input.delayMinutes * 60_000);
  const overdue = dueAt.getTime() <= input.asAt.getTime();

  return {
    required: true,
    dueAt,
    overdue,
    // Written the way a dealer reads a date, not the way a machine writes
    // one. "2026-08-02T12:39:02.369Z" on a screen is a string somebody has to
    // decode before they can act on it, and this message exists to be acted on.
    reason: overdue
      ? `Should have come down on ${humanDate(dueAt)} — it is still advertised, and enquiries `
        + 'for it cannot be fulfilled.'
      : `Comes down on ${humanDate(dueAt)}.`,
  };
}

// -------------------------------------------------------- payload hash

/**
 * A stable hash of a payload, for deduplication.
 *
 * Rule 8: feed publishes deduplicate by payload hash. Without it a nightly
 * rebuild re-pushes every unchanged car to every channel every night, which is
 * how a dealer exhausts their own rate limit with their own stock.
 *
 * Keys are sorted, so two payloads that differ only in property order hash the
 * same — the same reasoning as M12's canonical JSON, and the same trap:
 * `JSON.stringify` follows insertion order.
 */
export function payloadHash(payload: ChannelPayload): string {
  const canonical = JSON.stringify(
    Object.keys(payload).sort().map((k) => [k, payload[k]]),
  );

  // FNV-1a. Not cryptographic and does not need to be — this detects "did
  // anything change?", not tampering, and the evidence hashes in M12 are where
  // cryptographic strength actually matters.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const shouldRepublish = (
  previousHash: string | null,
  payload: ChannelPayload,
): boolean => previousHash !== payloadHash(payload);

/** Rule 8: an idempotency key on every external call. */
export const feedIdempotencyKey = (input: {
  channel: ChannelKey; vehicleId: string; action: string; payloadHash: string;
}): string => `${input.channel}:${input.action}:${input.vehicleId}:${input.payloadHash}`;

// ------------------------------------------------------------- adapters

const yearOf = (d: Date | null): number | null => d?.getUTCFullYear() ?? null;

const pounds = (m: Money | null | undefined): number | null =>
  m ? Number(m.amount) / 100 : null;

const describe = (v: CanonicalVehicle, o: ChannelOverride): string =>
  o.description ?? v.description ?? '';

const photos = (v: CanonicalVehicle, o: ChannelOverride): readonly string[] =>
  o.photoUrls ?? v.photoUrls;

const priceOf = (v: CanonicalVehicle, o: ChannelOverride): Money | null =>
  o.price ?? v.price;

/**
 * Wraps a mapping so the finance guard cannot be forgotten.
 *
 * Every adapter below is built through this, so a new channel added next year
 * gets the CONC guard whether or not whoever adds it has read this file.
 */
const adapter = (
  channel: ChannelKey,
  version: number,
  map: (v: CanonicalVehicle, o: ChannelOverride) => ChannelPayload,
  validate: (p: ChannelPayload) => FieldProblem[],
): ChannelAdapter => ({
  channel,
  version,
  map(vehicle, override = {}) {
    const payload = map(vehicle, override);
    assertNoFinanceInFeed(payload, channel);
    return payload;
  },
  validate,
});

const required = (
  payload: ChannelPayload,
  fields: readonly [field: string, label: string][],
): FieldProblem[] =>
  fields
    .filter(([f]) => payload[f] === null || payload[f] === undefined || payload[f] === '')
    .map(([field, label]) => ({
      field,
      message: `${label} is required by this channel and is missing.`,
      blocking: true,
    }));

/**
 * Auto Trader. Mileage must be a whole number — the error CLAUDE.md quotes as
 * the model of a good message — and the derivative is what their search is
 * built on, so a missing one buries the car.
 */
export const autoTraderAdapter = adapter('auto_trader', 1,
  (v, o) => ({
    registration: v.registration,
    vin: v.vin,
    make: v.make,
    model: v.model,
    derivative: v.derivative,
    bodyType: v.bodyStyle,
    doors: v.doors,
    seats: v.seats,
    transmission: v.transmission,
    fuelType: v.fuelType,
    engineCapacityCC: v.engineCc,
    colour: v.colour,
    odometerReadingMiles: v.mileage === null ? null : Math.round(v.mileage),
    yearOfManufacture: yearOf(v.firstRegisteredOn),
    co2Emissions: v.co2Gkm,
    priceGBP: pounds(priceOf(v, o)),
    attentionGrabber: o.headline ?? v.headline,
    description: describe(v, o),
    features: o.features ?? v.features,
    images: photos(v, o),
  }),
  (p) => {
    const problems = required(p, [
      ['registration', 'Registration'], ['make', 'Make'], ['model', 'Model'],
      ['derivative', 'Derivative'], ['priceGBP', 'Price'],
      ['odometerReadingMiles', 'Mileage'],
    ]);
    if (typeof p['odometerReadingMiles'] === 'number'
        && !Number.isInteger(p['odometerReadingMiles'])) {
      problems.push({
        field: 'odometerReadingMiles',
        message: 'Auto Trader rejects a mileage that is not a whole number. Fix the mileage and retry.',
        blocking: true,
      });
    }
    if (Array.isArray(p['images']) && p['images'].length < 5) {
      problems.push({
        field: 'images',
        message: 'Fewer than five photographs. Auto Trader will accept this and rank it below everything with a full set.',
        blocking: false,
      });
    }
    return problems;
  },
);

/** eBay Motors Group — Motors.co.uk and Gumtree. */
export const ebayMotorsAdapter = adapter('ebay_motors_group', 1,
  (v, o) => ({
    vrm: v.registration,
    manufacturer: v.make,
    model: v.model,
    variant: v.derivative,
    body: v.bodyStyle,
    doors: v.doors,
    gearbox: v.transmission,
    fuel: v.fuelType,
    engineSize: v.engineCc,
    colour: v.colour,
    mileage: v.mileage,
    regYear: yearOf(v.firstRegisteredOn),
    price: pounds(priceOf(v, o)),
    strapline: o.headline ?? v.headline,
    advertText: describe(v, o),
    equipment: o.features ?? v.features,
    pictures: photos(v, o),
  }),
  (p) => required(p, [
    ['vrm', 'Registration'], ['manufacturer', 'Make'], ['model', 'Model'],
    ['price', 'Price'], ['mileage', 'Mileage'],
  ]),
);

export const carGurusAdapter = adapter('cargurus', 1,
  (v, o) => ({
    vin: v.vin,
    licensePlate: v.registration,
    make: v.make,
    model: v.model,
    trim: v.derivative,
    bodyStyle: v.bodyStyle,
    transmission: v.transmission,
    fuelType: v.fuelType,
    exteriorColor: v.colour,
    mileage: v.mileage,
    year: yearOf(v.firstRegisteredOn),
    price: pounds(priceOf(v, o)),
    sellerComments: describe(v, o),
    photoUrls: photos(v, o),
  }),
  (p) => {
    // CarGurus keys on VIN; without one a listing deduplicates against the
    // wrong car, which is worse than not appearing.
    const problems = required(p, [
      ['make', 'Make'], ['model', 'Model'], ['price', 'Price'], ['mileage', 'Mileage'],
    ]);
    if (!p['vin']) {
      problems.push({
        field: 'vin',
        message: 'CarGurus matches listings on VIN. Without one this car can be merged with a different vehicle.',
        blocking: true,
      });
    }
    return problems;
  },
);

export const carwowAdapter = adapter('carwow', 1,
  (v, o) => ({
    registration: v.registration,
    make: v.make,
    model: v.model,
    trim: v.derivative,
    transmission: v.transmission,
    fuel: v.fuelType,
    mileage: v.mileage,
    year: yearOf(v.firstRegisteredOn),
    price: pounds(priceOf(v, o)),
    description: describe(v, o),
    images: photos(v, o),
  }),
  (p) => required(p, [
    ['registration', 'Registration'], ['make', 'Make'], ['model', 'Model'], ['price', 'Price'],
  ]),
);

/**
 * Meta catalogue. `availability` and `condition` are enum-valued and Meta
 * rejects anything else, so they are produced rather than passed through.
 */
export const metaCatalogueAdapter = adapter('meta_catalogue', 1,
  (v, o) => ({
    id: v.id,
    title: [yearOf(v.firstRegisteredOn), v.make, v.model, v.derivative]
      .filter(Boolean).join(' ').trim(),
    description: describe(v, o),
    availability: 'in stock',
    condition: 'used',
    price: priceOf(v, o) ? `${pounds(priceOf(v, o))!.toFixed(2)} GBP` : null,
    link: null,
    image_link: photos(v, o)[0] ?? null,
    additional_image_link: photos(v, o).slice(1, 20),
    brand: v.make,
    vehicle_registration_plate: v.registration,
    mileage: v.mileage === null ? null : `${v.mileage} MI`,
    transmission: v.transmission,
    fuel_type: v.fuelType,
    body_style: v.bodyStyle,
    exterior_color: v.colour,
    year: yearOf(v.firstRegisteredOn),
  }),
  (p) => required(p, [
    ['id', 'Identifier'], ['title', 'Title'], ['price', 'Price'],
    ['image_link', 'Main image'], ['brand', 'Make'],
  ]),
);

export const googleVehicleAdsAdapter = adapter('google_vehicle_ads', 1,
  (v, o) => ({
    id: v.id,
    title: [yearOf(v.firstRegisteredOn), v.make, v.model, v.derivative]
      .filter(Boolean).join(' ').trim(),
    description: describe(v, o),
    price: priceOf(v, o) ? `${pounds(priceOf(v, o))!.toFixed(2)} GBP` : null,
    condition: 'used',
    availability: 'in_stock',
    vin: v.vin,
    mileage_value: v.mileage,
    mileage_unit: 'MI',
    make: v.make,
    model: v.model,
    trim: v.derivative,
    year: yearOf(v.firstRegisteredOn),
    color: v.colour,
    fuel_type: v.fuelType,
    transmission: v.transmission,
    image_link: photos(v, o)[0] ?? null,
  }),
  (p) => {
    const problems = required(p, [
      ['id', 'Identifier'], ['title', 'Title'], ['price', 'Price'],
      ['image_link', 'Main image'], ['make', 'Make'], ['model', 'Model'], ['year', 'Year'],
    ]);
    if (typeof p['title'] === 'string' && p['title'].length > 150) {
      problems.push({
        field: 'title',
        message: 'Google truncates a title over 150 characters. Shorten it so the derivative is not cut off.',
        blocking: false,
      });
    }
    return problems;
  },
);

/** Everything else — a flat record the tenant maps themselves. */
export const genericAdapter = (channel: 'generic_xml' | 'generic_csv'): ChannelAdapter =>
  adapter(channel, 1,
    (v, o) => ({
      id: v.id,
      registration: v.registration,
      vin: v.vin,
      make: v.make,
      model: v.model,
      derivative: v.derivative,
      body_style: v.bodyStyle,
      doors: v.doors,
      seats: v.seats,
      transmission: v.transmission,
      fuel_type: v.fuelType,
      engine_cc: v.engineCc,
      colour: v.colour,
      mileage: v.mileage,
      year: yearOf(v.firstRegisteredOn),
      co2_gkm: v.co2Gkm,
      price_gbp: pounds(priceOf(v, o)),
      headline: o.headline ?? v.headline,
      description: describe(v, o),
      features: o.features ?? v.features,
      images: photos(v, o),
    }),
    (p) => required(p, [['registration', 'Registration'], ['price_gbp', 'Price']]),
  );

export const ADAPTERS: Record<ChannelKey, ChannelAdapter> = {
  auto_trader: autoTraderAdapter,
  ebay_motors_group: ebayMotorsAdapter,
  cargurus: carGurusAdapter,
  carwow: carwowAdapter,
  meta_catalogue: metaCatalogueAdapter,
  google_vehicle_ads: googleVehicleAdsAdapter,
  generic_xml: genericAdapter('generic_xml'),
  generic_csv: genericAdapter('generic_csv'),
};

export const adapterFor = (channel: ChannelKey): ChannelAdapter => ADAPTERS[channel];

// ------------------------------------------------------- publish preview

export interface PublishPreview {
  channel: ChannelKey;
  channelLabel: string;
  adapterVersion: number;
  payload: ChannelPayload | null;
  problems: readonly FieldProblem[];
  blockers: readonly PublishBlocker[];
  hash: string | null;
  /** Everything that must be fixed before this car can go to this channel. */
  ready: boolean;
  /** Refused outright — a compliance failure, not a missing field. */
  refused: string | null;
}

/**
 * §10.2's publish preview: exactly what a channel will receive, before it is
 * pushed anywhere.
 *
 * Returns the refusal rather than throwing when the finance guard fires, so a
 * preview screen can SHOW a dealer why their description cannot be sent. The
 * guard still throws on the publish path — this is the one place a refusal is
 * information rather than a failure.
 */
export function previewFor(input: {
  vehicle: CanonicalVehicle;
  channel: ChannelKey;
  override?: ChannelOverride;
  rule?: Parameters<typeof publishBlockers>[1];
}): PublishPreview {
  const adapterImpl = adapterFor(input.channel);
  const blockers = publishBlockers(input.vehicle, input.rule, input.override);

  let payload: ChannelPayload | null = null;
  let refused: string | null = null;
  try {
    payload = adapterImpl.map(input.vehicle, input.override ?? {});
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }

  const problems = payload ? adapterImpl.validate(payload) : [];

  return {
    channel: input.channel,
    channelLabel: CHANNEL_LABELS[input.channel],
    adapterVersion: adapterImpl.version,
    payload,
    problems,
    blockers,
    hash: payload ? payloadHash(payload) : null,
    ready: refused === null && blockers.length === 0
      && problems.every((p) => !p.blocking),
    refused,
  };
}

// ------------------------------------------------------- feed health

export interface ListingState {
  channel: ChannelKey;
  vehicleId: string;
  status: ListingStatus;
  lastPublishedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  errorCount: number;
  delistDueAt: Date | null;
}

export interface ChannelHealth {
  channel: ChannelKey;
  channelLabel: string;
  published: number;
  failed: number;
  queued: number;
  /** Sold or withdrawn cars still advertised past their deadline. */
  overdueDelistings: number;
  lastSuccessAt: Date | null;
  hoursSinceSuccess: number | null;
  /** True when the whole channel appears to have stopped, not one car. */
  stalled: boolean;
  summary: string;
}

/**
 * A feed that quietly stops is the failure that actually happens.
 *
 * Nobody notices for three weeks that the whole forecourt is missing from a
 * portal, because nothing is on fire — there is simply an absence. `stalled`
 * is therefore about the CHANNEL, not a car: several failures and no success
 * in a day is a broken integration, and one car failing is a bad record.
 */
export const STALL_HOURS = 24;

export function channelHealth(input: {
  channel: ChannelKey;
  listings: readonly ListingState[];
  asAt: Date;
  stallAfterHours?: number;
}): ChannelHealth {
  const stallAfter = input.stallAfterHours ?? STALL_HOURS;
  const mine = input.listings.filter((l) => l.channel === input.channel);

  const published = mine.filter((l) => l.status === 'published').length;
  const failed = mine.filter((l) => l.status === 'failed').length;
  const queued = mine.filter((l) => l.status === 'queued' || l.status === 'delist_queued').length;
  const overdue = mine.filter(
    (l) => l.delistDueAt !== null
      && l.delistDueAt.getTime() <= input.asAt.getTime()
      && (l.status === 'published' || l.status === 'delist_queued'),
  ).length;

  const lastSuccessAt = mine
    .map((l) => l.lastPublishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const hoursSince = lastSuccessAt === null
    ? null
    : Math.floor((input.asAt.getTime() - lastSuccessAt.getTime()) / 3_600_000);

  const stalled = failed > 0 && (hoursSince === null || hoursSince >= stallAfter);

  const label = CHANNEL_LABELS[input.channel];
  let summary: string;
  if (stalled) {
    summary = `${label} has not accepted anything for ${hoursSince === null ? 'as long as we have records' : `${hoursSince} hours`} and ${failed} listing${failed === 1 ? ' is' : 's are'} failing. Check the credentials and the error list.`;
  } else if (overdue > 0) {
    summary = `${label}: ${overdue} sold or withdrawn car${overdue === 1 ? '' : 's'} still advertised past the takedown deadline.`;
  } else if (failed > 0) {
    summary = `${label}: ${published} live, ${failed} failing. The rest of the feed is working.`;
  } else {
    summary = `${label}: ${published} live${queued > 0 ? `, ${queued} queued` : ''}.`;
  }

  return {
    channel: input.channel,
    channelLabel: label,
    published, failed, queued,
    overdueDelistings: overdue,
    lastSuccessAt,
    hoursSinceSuccess: hoursSince,
    stalled,
    summary,
  };
}

// ------------------------------------------------------------- retries

/**
 * Whether a failed listing should be retried automatically.
 *
 * A REJECTED payload is not retried: the portal has told us the mileage is
 * invalid, and sending the identical bytes again will get the identical
 * answer while burning the dealer's rate limit. A transport error is retried
 * with exponential backoff, because that is a different claim entirely.
 */
export const MAX_AUTO_RETRIES = 5;

export function retryAfter(input: {
  outcome: 'rejected' | 'transport_error';
  errorCount: number;
  lastAttemptAt: Date;
}): Date | null {
  if (input.outcome === 'rejected') return null;
  if (input.errorCount >= MAX_AUTO_RETRIES) return null;

  // 1, 2, 4, 8, 16 minutes.
  const minutes = 2 ** Math.max(0, input.errorCount - 1);
  return new Date(input.lastAttemptAt.getTime() + minutes * 60_000);
}

export const describeRetry = (input: Parameters<typeof retryAfter>[0]): string =>
  input.outcome === 'rejected'
    ? 'This was rejected, not dropped. Retrying the same payload gets the same answer — fix what the channel objected to, then retry by hand.'
    : input.errorCount >= MAX_AUTO_RETRIES
      ? `Given up after ${MAX_AUTO_RETRIES} attempts. Something is wrong beyond one request; retry by hand once it is fixed.`
      : 'Will retry automatically.';

/** Fees the buyer must pay on top, for channels that render them. §8.3. */
export const totalMandatoryFees = (
  vehicle: CanonicalVehicle,
  currency: 'GBP' | 'EUR' = 'GBP',
): Money =>
  vehicle.mandatoryFees.reduce(
    (total, fee) => money(total.amount + fee.amount.amount, currency),
    money(0n, currency),
  );
