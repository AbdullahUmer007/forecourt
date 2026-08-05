/**
 * Channel feed status — what is live where, and what is not.
 *
 * The question this screen exists to answer is the one a dealer asks when the
 * phone is quiet: "is my stock actually ON Auto Trader?" Every portal has its
 * own schema and its own idea of a valid mileage, so the honest answer is
 * per-car and per-channel, and it is frequently no.
 *
 * Three things are surfaced that nothing else in the product shows:
 *
 *  - a car that CANNOT be published, with the reason, before anybody wonders
 *    why it is getting no enquiries
 *  - a listing that FAILED, with what the portal actually said — "their API
 *    rejected the mileage (must be a whole number)" rather than "sync error"
 *  - a sold car still ADVERTISED past its delist deadline, which is the one
 *    that gets a dealer a complaint and possibly a CRA problem
 *
 * `publishBlockers` and `delistDecision` come from the domain. Nothing here
 * re-derives either: the feed gate is M3's go-live gate, and a car that cannot
 * appear on the dealer's own site must not appear on a portal they are paying
 * for — holding our shopfront to a higher standard than Auto Trader's would be
 * exactly backwards.
 */

import { withSession, toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import {
  money,
  publishBlockers, delistDecision, CHANNEL_LABELS,
  type ChannelKey, type ListingStatus, type PublishBlocker,
  type DelistDecision, type DelistTrigger, type Money, type CanonicalVehicle,
} from '@forecourt/domain';

export interface ChannelRow {
  id: string;
  channel: ChannelKey;
  displayName: string;
  enabled: boolean;
  monthlyCost: Money | null;
  delistDelayMinutes: number;
  /** Counts across this channel's listings. */
  published: number;
  failed: number;
  queued: number;
  /** Live cars that this channel is NOT carrying, for whatever reason. */
  notPublished: number;
  lastSyncAt: Date | null;
  lastError: string | null;
}

export interface ListingRow {
  id: string;
  channelId: string;
  channelName: string;
  vehicleId: string;
  registration: string;
  description: string;
  status: ListingStatus;
  externalUrl: string | null;
  lastPublishedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  errorCount: number;
  /** Recomputed on read, never stored — a stored answer is wrong the moment
   *  a photograph is added or a price is set. */
  blockers: PublishBlocker[];
  delist: DelistDecision;
}

export interface SyncEventRow {
  id: string;
  channelName: string;
  registration: string | null;
  action: string;
  outcome: string;
  httpStatus: number | null;
  message: string | null;
  durationMs: number | null;
  occurredAt: Date;
}

export interface ChannelsView {
  channels: ChannelRow[];
  /** Cars that cannot go to a channel, with the reason. */
  blocked: ListingRow[];
  /** Listings the portal rejected, with what it said. */
  failed: ListingRow[];
  /** Sold or withdrawn, still advertised past the deadline. */
  overdueDelists: ListingRow[];
  recentEvents: SyncEventRow[];
  summary: {
    liveVehicles: number;
    channelsEnabled: number;
    /** Live cars carried by NO enabled channel at all. */
    onNoChannel: number;
    failedCount: number;
    overdueCount: number;
  };
  queryMs: number;
}

const currencyOf = (v: unknown): 'GBP' | 'EUR' => (v === 'EUR' ? 'EUR' : 'GBP');

/**
 * The canonical vehicle, as the adapters see it.
 *
 * Built once here and handed to `publishBlockers`, rather than each screen
 * inventing its own idea of what a vehicle is. Every adapter maps FROM this
 * shape and nothing maps between channels.
 */
const canonicalFrom = (r: Record<string, unknown>): CanonicalVehicle => ({
  id: String(r['vehicle_id'] ?? r['id']),
  registration: String(r['registration'] ?? ''),
  vin: (r['vin'] as string | null) ?? null,
  make: (r['make'] as string | null) ?? null,
  model: (r['model'] as string | null) ?? null,
  derivative: (r['derivative'] as string | null) ?? null,
  bodyStyle: (r['body_style'] as string | null) ?? null,
  doors: r['doors'] === null ? null : Number(r['doors']),
  seats: r['seats'] === null || r['seats'] === undefined ? null : Number(r['seats']),
  transmission: (r['transmission'] as string | null) ?? null,
  fuelType: (r['fuel_type'] as string | null) ?? null,
  engineCc: r['engine_cc'] === null || r['engine_cc'] === undefined
    ? null : Number(r['engine_cc']),
  colour: (r['colour'] as string | null) ?? null,
  mileage: r['mileage'] === null ? null : Number(r['mileage']),
  firstRegisteredOn: toDate(r['first_registered_on'] as Date | null),
  co2Gkm: r['co2_gkm'] === null || r['co2_gkm'] === undefined ? null : Number(r['co2_gkm']),
  price: r['retail_price_pence'] === null || r['retail_price_pence'] === undefined
    ? null : money(toPence(r['retail_price_pence'] as string), 'GBP'),
  vatScheme: (r['vat_scheme'] as CanonicalVehicle['vatScheme']) ?? null,
  headline: (r['advert_headline'] as string | null) ?? null,
  description: (r['advert_description'] as string | null) ?? null,
  features: (r['features'] as string[] | null) ?? [],
  photoUrls: [],
  publishedPhotoCount: Number(r['published_photo_count'] ?? 0),
  state: String(r['state'] ?? ''),
  provenanceCheckedAt: toDate(r['provenance_checked_at'] as Date | null),
  // Mandatory fees are a per-channel concern the publish job assembles; the
  // status screen does not need them to answer "can this car be published",
  // and inventing an empty list here is honest rather than convenient —
  // `publishBlockers` does not read it.
  mandatoryFees: [],
});

export async function loadChannels(session: Session): Promise<ChannelsView> {
  const started = Date.now();
  const now = new Date();

  const data = await withSession(session, async (tx) => {
    const [channels, listings, events, live] = await Promise.all([
      tx`SELECT c.*,
                (SELECT max(e.occurred_at) FROM channel_sync_events e
                  WHERE e.channel_id = c.id) AS last_sync_at,
                -- Rejections and transport errors only. A 'skipped' outcome
                -- means the channel is switched off, which is a setting rather
                -- than a problem — reporting "CarGurus is switched off" as the
                -- last problem tells a dealer something is wrong with a thing
                -- they deliberately turned off.
                (SELECT e.message FROM channel_sync_events e
                  WHERE e.channel_id = c.id
                    AND e.outcome IN ('rejected', 'transport_error')
                  ORDER BY e.occurred_at DESC LIMIT 1) AS last_error
         FROM channels c ORDER BY c.display_name`,

      tx`SELECT l.*, c.display_name AS channel_name, c.channel::text AS channel_key,
                c.delist_delay_minutes,
                v.registration, v.make, v.model, v.derivative, v.vin, v.state::text AS state,
                v.retail_price_pence, v.mileage, v.first_registered_on, v.colour,
                v.fuel_type, v.transmission, v.body_style, v.doors,
                v.published_photo_count, v.provenance_checked_at, v.vat_scheme::text AS vat_scheme,
                v.advert_headline, v.advert_description,
                -- state_changed_at, not an archived_at — there is no such
                -- column. When a car entered its current state is the right
                -- trigger time for a withdrawal anyway; sold_at is the more
                -- specific answer where there is one.
                v.sold_at, v.state_changed_at
         FROM channel_listings l
         JOIN channels c ON c.id = l.channel_id
         JOIN vehicles v ON v.id = l.vehicle_id
         ORDER BY l.last_attempt_at DESC NULLS LAST`,

      tx`SELECT e.*, c.display_name AS channel_name, v.registration
         FROM channel_sync_events e
         JOIN channels c ON c.id = e.channel_id
         LEFT JOIN vehicles v ON v.id = e.vehicle_id
         ORDER BY e.occurred_at DESC LIMIT 50`,

      tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM vehicles WHERE state IN ('live', 'reserved')`,
    ]);

    // Live cars carried by no enabled channel at all — the question a dealer
    // is really asking when they ask whether their stock is "on Auto Trader".
    const [orphans] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM vehicles v
      WHERE v.state IN ('live', 'reserved')
        AND NOT EXISTS (
          SELECT 1 FROM channel_listings l
          JOIN channels c ON c.id = l.channel_id
          WHERE l.vehicle_id = v.id AND c.enabled AND l.status = 'published')`;

    return { channels, listings, events, live, orphans };
  });

  const listings: ListingRow[] = (data.listings as Record<string, unknown>[]).map((l) => {
    const vehicle = canonicalFrom(l);
    const soldAt = toDate(l['sold_at'] as Date | null);
    const stateChangedAt = toDate(l['state_changed_at'] as Date | null);
    const state = String(l['state']);

    // The trigger, derived from the vehicle rather than stored on the listing:
    // a car that sold yesterday needs delisting whether or not anything wrote
    // that fact onto its adverts.
    const trigger: DelistTrigger | null =
      state === 'sold' || state === 'delivered' ? 'sold'
        : state === 'archived' ? 'archived'
          : state === 'reserved' ? 'reserved'
            : null;

    return {
      id: String(l['id']),
      channelId: String(l['channel_id']),
      channelName: String(l['channel_name']),
      vehicleId: String(l['vehicle_id']),
      registration: String(l['registration']),
      description: [l['make'], l['model'], l['derivative']].filter(Boolean).join(' '),
      status: l['status'] as ListingStatus,
      externalUrl: (l['external_url'] as string | null) ?? null,
      lastPublishedAt: toDate(l['last_published_at'] as Date | null),
      lastAttemptAt: toDate(l['last_attempt_at'] as Date | null),
      lastError: (l['last_error'] as string | null) ?? null,
      errorCount: Number(l['error_count'] ?? 0),
      // Recomputed, never read from a column. A stored answer is wrong the
      // moment somebody adds a photograph or sets a price.
      blockers: publishBlockers(vehicle),
      delist: delistDecision({
        trigger,
        triggeredAt: soldAt ?? stateChangedAt,
        delayMinutes: Number(l['delist_delay_minutes'] ?? 0),
        status: l['status'] as ListingStatus,
        asAt: now,
      }),
    };
  });

  const byChannel = new Map<string, ListingRow[]>();
  for (const l of listings) {
    const list = byChannel.get(l.channelId) ?? [];
    list.push(l);
    byChannel.set(l.channelId, list);
  }

  const channels: ChannelRow[] = (data.channels as Record<string, unknown>[]).map((c) => {
    const id = String(c['id']);
    const mine = byChannel.get(id) ?? [];
    return {
      id,
      channel: c['channel'] as ChannelKey,
      displayName: String(c['display_name']),
      enabled: Boolean(c['enabled']),
      monthlyCost: c['monthly_cost_pence'] === null
        ? null : money(toPence(c['monthly_cost_pence'] as string), currencyOf(c['currency'])),
      delistDelayMinutes: Number(c['delist_delay_minutes'] ?? 0),
      published: mine.filter((l) => l.status === 'published').length,
      failed: mine.filter((l) => l.status === 'failed').length,
      queued: mine.filter((l) => l.status === 'queued' || l.status === 'delist_queued').length,
      notPublished: mine.filter((l) => l.status === 'not_published').length,
      lastSyncAt: toDate(c['last_sync_at'] as Date | null),
      lastError: (c['last_error'] as string | null) ?? null,
    };
  });

  return {
    channels,
    blocked: listings.filter((l) => l.blockers.length > 0 && l.status !== 'published'),
    failed: listings.filter((l) => l.status === 'failed'),
    // Sold and still advertised past the deadline. The one that costs a
    // dealer a complaint rather than an enquiry.
    overdueDelists: listings.filter((l) => l.delist.overdue),
    recentEvents: (data.events as Record<string, unknown>[]).map((e) => ({
      id: String(e['id']),
      channelName: String(e['channel_name']),
      registration: (e['registration'] as string | null) ?? null,
      action: String(e['action']),
      outcome: String(e['outcome']),
      httpStatus: e['http_status'] === null ? null : Number(e['http_status']),
      message: (e['message'] as string | null) ?? null,
      durationMs: e['duration_ms'] === null ? null : Number(e['duration_ms']),
      occurredAt: toDate(e['occurred_at'] as Date) as Date,
    })),
    summary: {
      liveVehicles: data.live[0]?.n ?? 0,
      channelsEnabled: channels.filter((c) => c.enabled).length,
      onNoChannel: data.orphans?.n ?? 0,
      failedCount: listings.filter((l) => l.status === 'failed').length,
      overdueCount: listings.filter((l) => l.delist.overdue).length,
    },
    queryMs: Date.now() - started,
  };
}

export { CHANNEL_LABELS };
