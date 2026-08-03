/**
 * Demo data for the CRM.
 *
 * `seed-demo.mjs` builds the public site's world — a tenant, sites, brands,
 * domains and stock. It creates no users, no roles and no memberships, because
 * nothing needed them until the CRM existed: the public site never asks who
 * you are.
 *
 * This adds the office side — two staff with genuinely different permissions,
 * so the cost-price redaction on the offer panel can actually be seen working
 * rather than taken on trust — plus two part-exchange appraisals with the
 * damage, standard costs, valuation, offer and settlement that M13 reads.
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING or guarded, so running it
 * twice is safe. The migrations deliberately are not idempotent; a seed
 * deliberately is.
 */

import postgres from 'postgres';
import { hash as argonHash, Algorithm } from '@node-rs/argon2';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

/** Long enough to satisfy the password policy, and obviously a demo value. */
const DEMO_PASSWORD = 'kennington demo forecourt access';

const TENANT = '11111111-1111-4111-8111-111111111111'; // Kennington, from seed-demo
const OWNER = '22222222-0000-4000-8000-000000000001';
const EXEC = '22222222-0000-4000-8000-000000000002';
const ROLE_OWNER = '33333333-0000-4000-8000-000000000001';
const ROLE_EXEC = '33333333-0000-4000-8000-000000000002';
const CONTACT_A = '44444444-0000-4000-8000-00000000000a';
const CONTACT_B = '44444444-0000-4000-8000-00000000000b';
const APPRAISAL_A = '55555555-0000-4000-8000-00000000000a';
const APPRAISAL_B = '55555555-0000-4000-8000-00000000000b';

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  console.log('ok');
};

/**
 * A sales executive's permission list, straight from the M2 role definitions.
 * Deliberately WITHOUT `vehicle.cost.read` — that omission is the point: it is
 * what makes the offer panel hide the market value, the recon and the target
 * margin, and it is checked server-side rather than with CSS.
 */
const EXEC_PERMISSIONS = [
  'vehicle.read', 'vehicle.update', 'contact.read', 'contact.update',
  'lead.read', 'lead.update', 'deal.read', 'deal.update', 'appraisal.read',
  'appraisal.update',
];

async function seed() {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    throw new Error(
      'Kennington is not seeded. Run `pnpm db:seed` first — this script adds the office ' +
      'side to the tenant that one creates.',
    );
  }

  const [site] = await sql`SELECT id FROM sites WHERE tenant_id = ${TENANT}::uuid LIMIT 1`;

  await step('roles', async () => {
    await sql`
      INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites) VALUES
        (${ROLE_OWNER}::uuid, ${TENANT}::uuid, 'owner', 'Owner', true, ${sql.json(['*'])}, true),
        (${ROLE_EXEC}::uuid, ${TENANT}::uuid, 'sales_executive', 'Sales Executive', true,
         ${sql.json(EXEC_PERMISSIONS)}, false)
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('users', async () => {
    // A real Argon2id hash, generated here rather than pasted in, so the demo
    // exercises the same verification path production does. The password is
    // printed at the end — it is a local demo database, and a seed that hides
    // the credential it just created is a seed nobody can use.
    const passwordHash = await argonHash(DEMO_PASSWORD, {
      algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1,
    });

    await sql`
      INSERT INTO users (id, email, name, password_hash) VALUES
        (${OWNER}::uuid, 'owner@kenningtoncarsales.co.uk', 'Dealer Principal', ${passwordHash}),
        (${EXEC}::uuid, 'sales@kenningtoncarsales.co.uk', 'Sales Executive', ${passwordHash})
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`;
  });

  await step('memberships', async () => {
    await sql`
      INSERT INTO tenant_memberships (tenant_id, user_id, role_id, scope_all_sites, status) VALUES
        (${TENANT}::uuid, ${OWNER}::uuid, ${ROLE_OWNER}::uuid, true, 'active'),
        (${TENANT}::uuid, ${EXEC}::uuid, ${ROLE_EXEC}::uuid, false, 'active')
      ON CONFLICT DO NOTHING`;
    if (site) {
      // user_sites hangs off the MEMBERSHIP, not the user — one person can
      // work for two dealers and their site access differs per dealer.
      await sql`
        INSERT INTO user_sites (tenant_id, membership_id, site_id)
        SELECT ${TENANT}::uuid, m.id, ${site.id}::uuid
        FROM tenant_memberships m
        WHERE m.user_id = ${EXEC}::uuid AND m.tenant_id = ${TENANT}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM user_sites us
            WHERE us.membership_id = m.id AND us.site_id = ${site.id}::uuid)`;
    }
  });

  await step('contacts', async () => {
    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email, phone, postcode) VALUES
        (${CONTACT_A}::uuid, ${TENANT}::uuid, 'individual', 'Marie', 'Whitfield',
         'm.whitfield@example.co.uk', '+447700900101', 'MK2 2QD'),
        (${CONTACT_B}::uuid, ${TENANT}::uuid, 'individual', 'Owen', 'Brackley',
         'o.brackley@example.co.uk', '+447700900102', 'MK1 1AA')
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('recon standard costs', async () => {
    // A small, believable book of standard costs. The gap is deliberate:
    // there is NO standard for heavy corrosion, so appraisal B has a mark the
    // estimate cannot price — which is the behaviour worth seeing on screen.
    const rows = [
      ['scuff', 'light', 'bumper', 8_500], ['scuff', 'moderate', 'bumper', 14_000],
      ['scuff', 'heavy', 'bumper', 26_000],
      ['scratch', 'light', 'body_panel', 9_500], ['scratch', 'moderate', 'body_panel', 18_000],
      ['scratch', 'heavy', 'body_panel', 32_000],
      ['dent', 'light', 'body_panel', 7_500], ['dent', 'moderate', 'body_panel', 14_500],
      ['dent', 'heavy', 'body_panel', 38_000],
      ['kerbing', 'light', 'wheel', 6_500], ['kerbing', 'moderate', 'wheel', 9_000],
      ['kerbing', 'heavy', 'wheel', 13_500],
      ['chip', 'light', 'glass', 6_000], ['crack', 'heavy', 'glass', 28_000],
      ['tear', 'moderate', 'interior', 12_000], ['stain', 'light', 'interior', 4_500],
      ['wear', 'moderate', 'tyre', 11_000], ['wear', 'heavy', 'tyre', 22_000],
    ];
    for (const [type, severity, group, pence] of rows) {
      await sql`
        INSERT INTO recon_cost_standards (tenant_id, damage_type, severity, panel_group, cost_pence, source)
        SELECT ${TENANT}::uuid, ${type}::damage_type, ${severity}::damage_severity,
               ${group}::panel_group, ${pence}::bigint, 'tenant_default'::recon_standard_source
        WHERE NOT EXISTS (
          SELECT 1 FROM recon_cost_standards
          WHERE tenant_id = ${TENANT}::uuid AND damage_type = ${type}::damage_type
            AND severity = ${severity}::damage_severity AND panel_group = ${group}::panel_group)`;
    }
  });

  await step('appraisal A — clean, ready to convert', async () => {
    await sql`
      INSERT INTO appraisals (id, tenant_id, site_id, contact_id, state, seller_type,
        registration, vin, make, model, derivative, derivative_confirmed, body_style, doors,
        transmission, fuel_type, colour, engine_cc, first_registered_on, mileage,
        mot_expires_on, former_keepers, service_history_type, key_count, v5c_present,
        tyre_depths_tenths_mm, condition_notes, appraised_at, expires_at)
      VALUES (${APPRAISAL_A}::uuid, ${TENANT}::uuid, ${site?.id ?? null}, ${CONTACT_A}::uuid,
        'accepted', 'private_individual',
        'WK19ZRT', 'WVWZZZAUZKW123456', 'Volkswagen', 'Golf', '1.5 TSI EVO Match 5dr', true,
        'Hatchback', 5, 'Manual', 'Petrol', 'Reflex Silver', 1498, '2019-05-14', 48200,
        '2027-01-22', 2, 'full_franchise', 2, true,
        ${sql.json({ nsf: 42, osf: 45, nsr: 58, osr: 55 })},
        'Tidy example. Kerbed nearside front alloy and a light scratch on the tailgate.',
        now() - interval '2 days', now() + interval '5 days')
      ON CONFLICT (id) DO NOTHING`;

    await sql`
      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group, damage_type, severity, size_mm, notes)
      SELECT * FROM (VALUES
        (${TENANT}::uuid, ${APPRAISAL_A}::uuid, 'nsf_alloy', 'wheel'::panel_group, 'kerbing'::damage_type, 'moderate'::damage_severity, 60, 'Outer rim, refurbishable'),
        (${TENANT}::uuid, ${APPRAISAL_A}::uuid, 'tailgate', 'body_panel'::panel_group, 'scratch'::damage_type, 'light'::damage_severity, 90, 'Through lacquer only'),
        (${TENANT}::uuid, ${APPRAISAL_A}::uuid, 'front_bumper', 'bumper'::panel_group, 'scuff'::damage_type, 'light'::damage_severity, 40, null)
      ) v WHERE NOT EXISTS (SELECT 1 FROM appraisal_damage WHERE appraisal_id = ${APPRAISAL_A}::uuid)`;

    await sql`
      INSERT INTO appraisal_valuations (tenant_id, appraisal_id, source, trade_pence, retail_pence,
        private_pence, valued_at_mileage, forecast_days_to_sell, captured_at)
      SELECT ${TENANT}::uuid, ${APPRAISAL_A}::uuid, 'manual'::valuation_source,
             1_015_000::bigint, 1_249_500::bigint, 1_130_000::bigint, 48000, 34, now() - interval '2 days'
      WHERE NOT EXISTS (SELECT 1 FROM appraisal_valuations WHERE appraisal_id = ${APPRAISAL_A}::uuid)`;

    // market 10,150 − recon 290 − margin 850 = ceiling 9,010, offered at 9,010.
    await sql`
      INSERT INTO appraisal_offers (tenant_id, appraisal_id, revision, allowance_pence,
        market_value_pence, recon_estimate_pence, target_margin_pence, fees_pence,
        over_allowance_pence, disposal_route, offered_at, expires_at, accepted_at)
      SELECT ${TENANT}::uuid, ${APPRAISAL_A}::uuid, 1, 901_000::bigint,
             1_015_000::bigint, 29_000::bigint, 85_000::bigint, 0::bigint, 0::bigint,
             'retail'::disposal_route, now() - interval '2 days', now() + interval '5 days',
             now() - interval '2 days'
      WHERE NOT EXISTS (SELECT 1 FROM appraisal_offers WHERE appraisal_id = ${APPRAISAL_A}::uuid)`;

    await sql`
      INSERT INTO appraisal_settlements (tenant_id, appraisal_id, lender_name, agreement_reference,
        settlement_pence, daily_accrual_pence, source, verified, quoted_at, valid_until)
      SELECT ${TENANT}::uuid, ${APPRAISAL_A}::uuid, 'Black Horse', 'BH-7741902',
             612_450::bigint, 214::bigint, 'lender_portal'::settlement_source, true,
             now() - interval '1 day', now() + interval '13 days'
      WHERE NOT EXISTS (SELECT 1 FROM appraisal_settlements WHERE appraisal_id = ${APPRAISAL_A}::uuid)`;
  });

  await step('appraisal B — every warning firing', async () => {
    // The instructive one. Unconfirmed derivative, an unpriceable mark, a
    // stale valuation, an illegal tyre, and a settlement the customer stated
    // from memory that has already lapsed.
    await sql`
      INSERT INTO appraisals (id, tenant_id, site_id, contact_id, state, seller_type,
        registration, make, model, derivative, derivative_confirmed, body_style, doors,
        transmission, fuel_type, colour, engine_cc, first_registered_on, mileage,
        mot_expires_on, former_keepers, service_history_type, key_count, v5c_present,
        tyre_depths_tenths_mm, condition_notes, appraised_at, expires_at)
      VALUES (${APPRAISAL_B}::uuid, ${TENANT}::uuid, ${site?.id ?? null}, ${CONTACT_B}::uuid,
        'offered', 'private_individual',
        'MV14OTP', 'Ford', 'Focus', null, false,
        'Estate', 5, 'Manual', 'Diesel', 'Panther Black', 1997, '2014-03-02', 118400,
        '2026-09-30', 4, 'part', 1, true,
        ${sql.json({ nsf: 14, osf: 22, nsr: 31, osr: 29 })},
        'High mileage. Corrosion starting on the nearside sill — needs a proper look.',
        now() - interval '12 days', now() + interval '2 days')
      ON CONFLICT (id) DO NOTHING`;

    await sql`
      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group, damage_type, severity, size_mm, notes)
      SELECT * FROM (VALUES
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'nsf_sill', 'body_panel'::panel_group, 'corrosion'::damage_type, 'heavy'::damage_severity, 220, 'Blistering along the seam'),
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'osf_door', 'body_panel'::panel_group, 'dent'::damage_type, 'moderate'::damage_severity, 70, null),
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'nsf_tyre', 'tyre'::panel_group, 'wear'::damage_type, 'heavy'::damage_severity, null, 'Below the legal limit'),
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'driver_seat', 'interior'::panel_group, 'tear'::damage_type, 'moderate'::damage_severity, 30, 'Bolster')
      ) v WHERE NOT EXISTS (SELECT 1 FROM appraisal_damage WHERE appraisal_id = ${APPRAISAL_B}::uuid)`;

    await sql`
      INSERT INTO appraisal_valuations (tenant_id, appraisal_id, source, trade_pence, retail_pence,
        valued_at_mileage, forecast_days_to_sell, captured_at)
      SELECT ${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'manual'::valuation_source,
             242_000::bigint, 379_500::bigint, 112000, 61, now() - interval '12 days'
      WHERE NOT EXISTS (SELECT 1 FROM appraisal_valuations WHERE appraisal_id = ${APPRAISAL_B}::uuid)`;

    await sql`
      INSERT INTO appraisal_offers (tenant_id, appraisal_id, revision, allowance_pence,
        market_value_pence, recon_estimate_pence, target_margin_pence, fees_pence,
        over_allowance_pence, disposal_route, offered_at, expires_at)
      SELECT * FROM (VALUES
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 1, 118_000::bigint, 242_000::bigint,
         69_000::bigint, 55_000::bigint, 0::bigint, 0::bigint, 'trade'::disposal_route,
         now() - interval '12 days', now() - interval '5 days'),
        -- Revision 2: allowed above the ceiling to hold the deal together. The
        -- over-allowance is recorded rather than absorbed.
        (${TENANT}::uuid, ${APPRAISAL_B}::uuid, 2, 145_000::bigint, 242_000::bigint,
         69_000::bigint, 55_000::bigint, 0::bigint, 27_000::bigint, 'trade'::disposal_route,
         now() - interval '4 days', now() + interval '2 days')
      ) v WHERE NOT EXISTS (SELECT 1 FROM appraisal_offers WHERE appraisal_id = ${APPRAISAL_B}::uuid)`;

    await sql`
      INSERT INTO appraisal_settlements (tenant_id, appraisal_id, lender_name,
        settlement_pence, source, verified, quoted_at, valid_until)
      SELECT ${TENANT}::uuid, ${APPRAISAL_B}::uuid, 'Moneybarn',
             318_000::bigint, 'customer_stated'::settlement_source, false,
             now() - interval '12 days', now() - interval '2 days'
      WHERE NOT EXISTS (SELECT 1 FROM appraisal_settlements WHERE appraisal_id = ${APPRAISAL_B}::uuid)`;
  });

  console.log('\n✓ CRM demo data seeded.');
  console.log(`  Password for both accounts: ${DEMO_PASSWORD}`);
  console.log('    owner@kenningtoncarsales.co.uk   sees cost prices, can record damage');
  console.log('    sales@kenningtoncarsales.co.uk   sees neither the breakdown nor the trade value');
  console.log('  Then: pnpm dev:crm → http://localhost:3002');
}

try {
  await seed();
} catch (err) {
  console.log('FAILED');
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
