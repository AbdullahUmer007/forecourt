/**
 * Channel listings for the demo tenant.
 *
 * Chosen so every state the status screen renders actually appears:
 *
 *  - Auto Trader: enabled, most stock published
 *  - eBay Motors Group: enabled, one listing REJECTED with what the portal
 *    actually said — the whole point of storing the raw message
 *  - CarGurus: switched off, so its listings sit unsent
 *  - one SOLD car still published past its delist deadline, which is the
 *    finding that costs a dealer more than a wasted phone call
 *
 * Idempotent: fixed ids and guarded inserts throughout.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';

const CH = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const LS = (n) => `aaaaaaaa-0000-4000-8000-0000000001${n < 10 ? '0' + n : n}`;

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  process.stdout.write('done\n');
};

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run the demo and CRM seeds first.');
    process.exit(1);
  }

  await step('channels', async () => {
    const rows = [
      [CH(1), 'auto_trader', 'Auto Trader', true, 189_000, 0],
      [CH(2), 'ebay_motors_group', 'eBay Motors Group', true, 85_000, 0],
      // A delist delay a dealer might genuinely configure: keep a sold car up
      // for a day to catch "have you got another one like it" enquiries.
      [CH(3), 'cargurus', 'CarGurus', false, 45_000, 1440],
    ];
    for (const [id, key, name, enabled, cost, delay] of rows) {
      await sql`
        INSERT INTO channels (id, tenant_id, channel, display_name, enabled,
                              monthly_cost_pence, delist_delay_minutes, created_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${key}::channel_key, ${name}, ${enabled},
                ${cost}, ${delay}, ${OWNER}::uuid)
        ON CONFLICT (id) DO NOTHING`;
    }
  });

  await step('listings', async () => {
    const cars = await sql`
      SELECT id, registration, state::text AS state FROM vehicles
      WHERE tenant_id = ${TENANT}::uuid ORDER BY created_at LIMIT 6`;

    let n = 0;
    for (const car of cars) {
      n += 1;
      const published = car.state === 'live';
      await sql`
        INSERT INTO channel_listings (id, tenant_id, channel_id, vehicle_id, status,
                                      external_id, external_url, last_published_at,
                                      last_attempt_at)
        VALUES (${LS(n)}::uuid, ${TENANT}::uuid, ${CH(1)}::uuid, ${car.id}::uuid,
                ${published ? 'published' : 'not_published'}::listing_status,
                ${published ? 'AT-' + car.registration : null},
                ${published
    ? 'https://www.autotrader.co.uk/car-details/' + car.registration
    : null},
                ${published ? sql`now() - interval '2 hours'` : null},
                now() - interval '2 hours')
        ON CONFLICT (id) DO NOTHING`;
    }

    // eBay rejected one, and the message is what the portal said rather than
    // "sync error" — one is actionable and the other is ignored.
    const [first] = cars;
    if (first) {
      await sql`
        INSERT INTO channel_listings (id, tenant_id, channel_id, vehicle_id, status,
                                      last_attempt_at, last_error, error_count)
        VALUES (${LS(20)}::uuid, ${TENANT}::uuid, ${CH(2)}::uuid, ${first.id}::uuid,
                'failed'::listing_status, now() - interval '35 minutes',
                ${'eBay rejected the listing — mileage must be a whole number '
                  + '(received "58,420"). Fix the mileage and it will retry.'},
                3)
        ON CONFLICT (id) DO NOTHING`;
    }
  });

  await step('a sold car still advertised', async () => {
    // Takes a LIVE car and sells it, rather than looking for one already sold
    // and quietly returning when there is none — which is what the first
    // version did, so this step did nothing at all and the screen reported
    // zero overdue delists while claiming to demonstrate one.
    const [target] = await sql`
      SELECT id FROM vehicles
      WHERE tenant_id = ${TENANT}::uuid AND state IN ('live', 'sold', 'delivered')
      ORDER BY created_at DESC LIMIT 1`;
    if (!target) {
      process.stdout.write('no vehicles — skipped ');
      return;
    }

    // Sold three days ago, still published on Auto Trader whose delist delay
    // is zero. Past the deadline by three days.
    await sql`
      UPDATE vehicles SET state = 'sold',
        sold_at = coalesce(sold_at, now() - interval '3 days')
      WHERE id = ${target.id}::uuid`;
    await sql`
      INSERT INTO channel_listings (id, tenant_id, channel_id, vehicle_id, status,
                                    external_id, external_url, last_published_at,
                                    last_attempt_at)
      VALUES (${LS(21)}::uuid, ${TENANT}::uuid, ${CH(1)}::uuid, ${target.id}::uuid,
              'published'::listing_status, 'AT-STALE',
              'https://www.autotrader.co.uk/car-details/stale',
              now() - interval '9 days', now() - interval '9 days')
      -- On the NATURAL key. The listings step above may already have created
      -- an Auto Trader row for this car, and ON CONFLICT (id) does not see
      -- that collision — one listing per channel per car is the real rule.
      ON CONFLICT (tenant_id, channel_id, vehicle_id) DO UPDATE
        SET status = 'published',
            last_published_at = now() - interval '9 days',
            last_attempt_at = now() - interval '9 days'`;
  });

  await step('sync events', async () => {
    const [existing] = await sql`
      SELECT 1 FROM channel_sync_events WHERE tenant_id = ${TENANT}::uuid LIMIT 1`;
    if (existing) return;

    const cars = await sql`
      SELECT id FROM vehicles WHERE tenant_id = ${TENANT}::uuid ORDER BY created_at LIMIT 3`;

    const rows = [
      [CH(1), cars[0]?.id, 'publish', 'success', 200, 'Listing created.', 412],
      [CH(1), cars[1]?.id, 'update', 'success', 200, 'Price updated.', 288],
      [CH(2), cars[0]?.id, 'publish', 'rejected', 422,
        'eBay rejected the listing — mileage must be a whole number (received "58,420").', 631],
      [CH(2), cars[2]?.id, 'publish', 'transport_error', 504,
        'eBay did not answer within 30 seconds. Nothing was sent; it will retry.', 30_000],
      [CH(3), cars[0]?.id, 'publish', 'skipped', null,
        'CarGurus is switched off, so nothing was sent.', 2],
    ];

    for (const [channel, vehicle, action, outcome, status, message, ms] of rows) {
      await sql`
        INSERT INTO channel_sync_events (tenant_id, channel_id, vehicle_id, action, outcome,
                                         idempotency_key, adapter_version, http_status,
                                         message, duration_ms, occurred_at)
        VALUES (${TENANT}::uuid, ${channel}::uuid, ${vehicle ?? null},
                ${action}::sync_action, ${outcome}::sync_outcome,
                ${'seed-' + action + '-' + outcome + '-' + (vehicle ?? 'none')},
                1, ${status}, ${message}, ${ms}, now() - interval '35 minutes')
        ON CONFLICT DO NOTHING`;
    }
  });

  console.log('\nChannels seeded. Open /channels.');
} finally {
  await sql.end();
}
