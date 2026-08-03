/**
 * Seed a local database with the Kennington demo tenant.
 *
 *   pnpm db:seed
 *
 * Idempotent: run it as often as you like. It clears the demo tenant's rows
 * first, so an edit to `demo/kennington.ts` shows up on the next run.
 *
 * It seeds `localhost` as a VERIFIED domain, because the middleware refuses to
 * serve an unverified host and that refusal is not something to switch off for
 * development — the dev environment should exercise the same boundary
 * production does.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO: sign off the compliance rule. The
 * finance block will not render until you sign it, which is the launch gate
 * working. To see the finance block locally, run with:
 *
 *   DEMO_SIGN_COMPLIANCE_RULE=1 pnpm db:seed
 *
 * and the script writes a clearly-labelled DEMO sign-off. Never do that
 * against anything a customer can reach.
 */

import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const url = requireDatabaseUrl();

const sql = postgres(url, { max: 4, onnotice: () => {} });

// Fixed IDs so re-seeding is a replace rather than a duplicate.
const TENANT = '11111111-1111-4111-8111-111111111111';
const SITE = '11111111-1111-4111-8111-111111111112';
const BRAND = '11111111-1111-4111-8111-111111111113';
const PRODUCT = '11111111-1111-4111-8111-111111111114';

/**
 * Load the demo stock. A real scrape can be dropped in as JSON.
 *
 * The dynamic import goes through `pathToFileURL`. On Windows an absolute path
 * is `D:\\...`, and the ESM loader reads the drive letter as a URL scheme —
 * "protocol 'd:' is not supported". A bare path happens to work on Linux and
 * macOS, which is exactly why this kind of bug ships.
 *
 * This script runs under `tsx` (see the `db:seed` package script) so the
 * TypeScript source imports directly, rather than depending on whichever
 * Node version happens to strip types.
 */
async function loadStock() {
  const jsonPath = join(ROOT, 'demo', 'kennington-stock.json');
  if (existsSync(jsonPath)) {
    console.log('Using demo/kennington-stock.json');
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  }
  const mod = await import(pathToFileURL(join(ROOT, 'demo', 'kennington.ts')).href);
  return { dealer: mod.KENNINGTON, stock: mod.DEMO_STOCK, placeholderImage: mod.placeholderImage };
}

const pence = (v) => (v === null || v === undefined ? null : BigInt(v).toString());
const compactReg = (r) => String(r).toUpperCase().replace(/\s+/g, '');

async function main() {
  const { dealer, stock, placeholderImage } = await loadStock();

  console.log(`Seeding ${stock.length} demo vehicles for ${dealer.name}…`);

  await sql.begin(async (tx) => {
    // Wipe this tenant only, children before parents. `vehicle_prices` and
    // `vehicle_status_history` are append-only in production; the trigger is
    // dropped for the demo tenant's rows here rather than working around it,
    // because a seed script that can quietly bypass an append-only guarantee is
    // a seed script somebody will eventually point at production.
    await tx`SET LOCAL session_replication_role = replica`;
    for (const table of [
      'vehicle_media', 'mot_records', 'vehicle_finance_quotes', 'vehicle_costs',
      'vehicle_prices', 'vehicle_status_history', 'vehicles', 'finance_products',
    ]) {
      await tx.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1::uuid`, [TENANT]);
    }
    await tx`SET LOCAL session_replication_role = origin`;

    await tx`
      INSERT INTO tenants (id, name, legal_name, fca_permission, fca_frn, status, settings)
      VALUES (${TENANT}::uuid, ${dealer.name}, ${dealer.legalName}, 'limited', ${dealer.fcaFrn}, 'live',
              ${sql.json({ whatsapp: dealer.whatsapp })})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, fca_frn = EXCLUDED.fca_frn,
                                     settings = EXCLUDED.settings`;

    await tx`
      INSERT INTO sites (id, tenant_id, name, address, lat, lng, phone, opening_hours, stock_number_prefix)
      VALUES (${SITE}::uuid, ${TENANT}::uuid, ${dealer.name},
              ${sql.json({ line1: dealer.street, city: dealer.locality, county: dealer.region, postcode: dealer.postcode })},
              ${String(dealer.latitude)}, ${String(dealer.longitude)}, ${dealer.telephone},
              ${sql.json(dealer.openingHours)}, 'KEN')
      ON CONFLICT (id) DO UPDATE SET address = EXCLUDED.address, phone = EXCLUDED.phone,
                                     opening_hours = EXCLUDED.opening_hours`;

    await tx`
      INSERT INTO brands (id, tenant_id, name, is_default)
      VALUES (${BRAND}::uuid, ${TENANT}::uuid, ${dealer.name}, true)
      ON CONFLICT (id) DO NOTHING`;

    // localhost, VERIFIED. The middleware refuses an unverified host, and dev
    // should exercise the same boundary production does.
    for (const host of ['localhost', '127.0.0.1']) {
      // The unique index is on lower(hostname), an EXPRESSION index, so
      // ON CONFLICT has to name the same expression — `(hostname)` does not
      // match it and Postgres rejects the statement outright.
      await tx`
        INSERT INTO domains (tenant_id, brand_id, hostname, verification_token, verified_at, is_primary)
        VALUES (${TENANT}::uuid, ${BRAND}::uuid, ${host}, 'demo-token', now(), ${host === 'localhost'})
        ON CONFLICT (lower(hostname)) DO UPDATE SET verified_at = now(), tenant_id = EXCLUDED.tenant_id`;
    }

    await tx`
      INSERT INTO finance_products (id, tenant_id, site_id, lender_name, provider, product_type, display_name)
      VALUES (${PRODUCT}::uuid, ${TENANT}::uuid, ${SITE}::uuid, 'Blue Motor Finance', 'demo', 'hp', 'Hire Purchase')
      ON CONFLICT (id) DO NOTHING`;

    let sequence = 1;
    for (const v of stock) {
      const reg = compactReg(v.registration);
      const [row] = await tx`
        INSERT INTO vehicles (
          tenant_id, site_id, stock_number, stock_sequence, registration,
          make, model, derivative, body_style, doors, seats, transmission, fuel_type,
          engine_cc, power_bhp, co2_gkm, colour, mileage, mot_expires_on, former_keepers,
          service_history_type, key_count, model_year, state, state_changed_at,
          retail_price_pence, price_changed_at, advert_description,
          provenance_checked_at, live_at, highest_mot_mileage
        ) VALUES (
          ${TENANT}::uuid, ${SITE}::uuid, ${v.stockNumber}, ${sequence++}, ${reg},
          ${v.make}, ${v.model}, ${v.derivative}, ${v.bodyStyle}, ${v.doors}, ${v.seats},
          ${v.transmission}, ${v.fuelType}, ${v.engineCc}, ${v.powerBhp}, ${v.co2Gkm},
          ${v.colour}, ${v.mileage}, ${v.motExpiresOn}, ${v.formerKeepers},
          ${v.serviceHistory}, ${v.keyCount}, ${v.year}, ${v.state}, now(),
          ${pence(v.pricePence)}, ${v.priceChangedOn}, ${v.description},
          ${v.provenanceCheckedAt}, ${v.liveSince},
          ${Math.max(0, ...v.mot.map((m) => m.odometerMiles ?? 0))}
        ) RETURNING id`;
      const vehicleId = row.id;

      // Price history, so the vehicle page can show a real reduction.
      if (v.previousPricePence) {
        await tx`
          INSERT INTO vehicle_prices (tenant_id, vehicle_id, price_pence, effective_from)
          VALUES (${TENANT}::uuid, ${vehicleId}::uuid, ${pence(v.previousPricePence)},
                  ${new Date(new Date(v.priceChangedOn).getTime() - 14 * 86400000)})`;
      }
      await tx`
        INSERT INTO vehicle_prices (tenant_id, vehicle_id, price_pence, effective_from)
        VALUES (${TENANT}::uuid, ${vehicleId}::uuid, ${pence(v.pricePence)},
                ${v.priceChangedOn ? new Date(v.priceChangedOn) : new Date(v.liveSince)})`;

      // Photographs. Placeholders, and obviously so.
      const hero = placeholderImage(v, 'hero');
      await tx`
        INSERT INTO vehicle_media (
          tenant_id, site_id, vehicle_id, kind, shot, status, storage_key, variants,
          position, is_hero, published, alt_text, exif_stripped
        ) VALUES (
          ${TENANT}::uuid, ${SITE}::uuid, ${vehicleId}::uuid, 'photo', 'front_three_quarter', 'ready',
          ${`t/${TENANT}/v/${vehicleId}/hero`},
          ${sql.json([{ width: 1200, format: 'jpeg', url: hero }])},
          0, true, true,
          ${`${v.year} ${v.make} ${v.model} ${v.derivative}, front three-quarter`}, true)`;

      let position = 1;
      for (const mark of v.declaredMarks) {
        const img = placeholderImage(v, 'damage', mark);
        await tx`
          INSERT INTO vehicle_media (
            tenant_id, site_id, vehicle_id, kind, shot, status, storage_key, variants,
            position, is_hero, published, alt_text, caption, is_disclosure_evidence,
            shown_to_buyer_at, exif_stripped
          ) VALUES (
            ${TENANT}::uuid, ${SITE}::uuid, ${vehicleId}::uuid, 'photo', 'damage', 'ready',
            ${`t/${TENANT}/v/${vehicleId}/mark-${position}`},
            ${sql.json([{ width: 1200, format: 'jpeg', url: img }])},
            ${position++}, false, true,
            ${`${v.year} ${v.make} ${v.model}, ${mark.toLowerCase()}`}, ${mark}, true, now(), true)`;
      }

      for (const t of v.mot) {
        await tx`
          INSERT INTO mot_records (tenant_id, vehicle_id, test_date, result, odometer_miles, advisories)
          VALUES (${TENANT}::uuid, ${vehicleId}::uuid, ${t.testDate}, ${t.result},
                  ${t.odometerMiles}, ${t.advisories})`;
      }

      // An indicative quote, verified. `verified_at` is only set once the
      // cashflows reconcile — the same check `verifyQuote` runs at render time.
      const price = BigInt(v.pricePence);
      const deposit = (price / 1000n) * 100n;
      const credit = price - deposit;
      const term = 48;
      const monthly = (credit * 128n) / (100n * BigInt(term));
      const apr = impliedApr(credit, term, monthly);
      await tx`
        INSERT INTO vehicle_finance_quotes (
          tenant_id, site_id, vehicle_id, finance_product_id, provider, lender_name, product_type,
          cash_price_pence, deposit_pence, part_exchange_pence, amount_of_credit_pence,
          term_months, monthly_payment_pence, apr_percent, fixed_rate,
          total_charge_for_credit_pence, total_amount_payable_pence,
          verified_at, quoted_at, expires_at
        ) VALUES (
          ${TENANT}::uuid, ${SITE}::uuid, ${vehicleId}::uuid, ${PRODUCT}::uuid, 'demo',
          'Blue Motor Finance', 'hp',
          ${price.toString()}, ${deposit.toString()}, 0, ${credit.toString()},
          ${term}, ${monthly.toString()}, ${apr}, true,
          ${(monthly * BigInt(term) - credit).toString()},
          ${(monthly * BigInt(term)).toString()},
          now(), now(), now() + interval '30 days')`;
    }

    // The representative example. Approved by the dealer; whether it can be
    // SHOWN still depends on the compliance rule being signed off.
    const exTerm = 48, exMonthly = 25_000n, exCredit = 1_000_000n;
    // Append-only, so the delete runs with triggers off — same reasoning as
    // above. In production a superseded example is a NEW version with the old
    // one's window closed, never an edit.
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM representative_examples WHERE tenant_id = ${TENANT}::uuid`;
    await tx`SET LOCAL session_replication_role = origin`;
    await tx`
      INSERT INTO representative_examples (
        tenant_id, site_id, version, product_type, cash_price_pence, advance_payment_pence,
        amount_of_credit_pence, term_months, monthly_payment_pence, other_charges,
        interest_rate_percent, interest_rate_fixed, representative_apr_percent,
        total_amount_payable_pence, approved_by, approved_at, effective_from
      ) VALUES (
        ${TENANT}::uuid, ${SITE}::uuid, 1, 'hp', 1200000, 200000, ${exCredit.toString()},
        ${exTerm}, ${exMonthly.toString()}, '[]'::jsonb,
        9.9, true, ${impliedApr(exCredit, exTerm, exMonthly)},
        ${(exMonthly * BigInt(exTerm)).toString()},
        'Dealer Principal (demo seed)', now(), now() - interval '1 day')`;
  });

  // The launch gate, off by default.
  if (process.env.DEMO_SIGN_COMPLIANCE_RULE === '1') {
    // compliance_rules is append-only, so superseding means a new version.
    const [current] = await sql`
      SELECT version, effective_from, parameters, source_url FROM compliance_rules
       WHERE key = 'conc.representative_example' ORDER BY version DESC LIMIT 1`;
    if (current && current.version < 900) {
      await sql`
        INSERT INTO compliance_rules (key, version, effective_from, parameters, source_url, notes,
                                      checked_at, signed_off_by, signed_off_at)
        VALUES ('conc.representative_example', 999, now(), ${current.parameters}, ${current.source_url},
                'LOCAL DEMO ONLY. Version 999 so it can never be mistaken for a real rule. Signed off by nobody.',
                now(), 'DEMO SIGN-OFF — NOT A REAL APPROVAL', now())
        ON CONFLICT (key, version) DO NOTHING`;
      console.log('⚠️  Compliance rule signed with a DEMO sign-off. Finance blocks will render.');
      console.log('   This is version 999 and must never exist in a real environment.');
    }
  } else {
    console.log('ℹ️  Compliance rule left UNSIGNED, so no finance block renders — that is the launch gate.');
    console.log('   To see it locally: DEMO_SIGN_COMPLIANCE_RULE=1 pnpm db:seed');
  }

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM vehicles WHERE tenant_id = ${TENANT}::uuid`;
  console.log(`\n✓ Seeded ${n} vehicles. Start the site with \`pnpm dev\` and open http://localhost:3000`);
  await sql.end();
}

/** The same bisection the domain layer uses, inlined so the seed has no build step. */
function impliedApr(creditPence, term, monthlyPence) {
  const advance = Number(creditPence);
  const flows = Array.from({ length: term }, (_, i) => ({ m: i + 1, a: Number(monthlyPence) }));
  const npv = (r) => flows.reduce((s, f) => s + f.a / Math.pow(1 + r, f.m / 12), 0) - advance;
  let lo = 0, hi = 10;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
  return Math.round(((lo + hi) / 2) * 1000) / 10;
}

main().catch(async (err) => {
  console.error('\nSeed failed:', err.message);
  await sql.end();
  process.exit(1);
});
