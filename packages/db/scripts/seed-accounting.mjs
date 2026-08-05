/**
 * An accounting connection for the demo tenant.
 *
 * Deliberately NOT live, and deliberately not fully mapped:
 *
 *  - the connection has no `live_from`, so it can only dry-run. That is the
 *    correct state for a connection nobody qualified has approved, and the
 *    screen exists to make that state legible rather than to look broken.
 *  - most accounts are mapped, TWO are not. A fully-mapped demo would never
 *    show the list a bookkeeper actually works through on day one.
 *  - one mapping has nobody's name against it, so "who agreed this?" has a
 *    visible answer of "nobody" somewhere on the screen.
 *
 * Idempotent: fixed ids and guarded inserts throughout.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';
const CONNECTION = 'bbbbbbbb-0000-4000-8000-000000000001';

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

  await step('the connection (dry run only)', async () => {
    await sql`
      INSERT INTO accounting_connections (id, tenant_id, provider, organisation_name,
                                          enabled, live_from, created_by)
      VALUES (${CONNECTION}::uuid, ${TENANT}::uuid, 'xero', 'Kennington Car Sales Ltd',
              true, NULL, ${OWNER}::uuid)
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('account mappings, two left blank', async () => {
    // Xero-ish codes. `prep_costs` and `deposits_held` are left unmapped so
    // the screen shows the list a bookkeeper works through, and
    // `sales_delivery` is mapped but unsigned so "nobody has signed this off"
    // appears somewhere.
    const rows = [
      ['sales_vehicle_margin', '200', 'Vehicle sales — margin', 'NONE', true],
      ['sales_vehicle_qualifying', '201', 'Vehicle sales — VAT qualifying', 'OUTPUT2', true],
      ['sales_addon', '210', 'Add-on products', 'OUTPUT2', true],
      ['sales_delivery', '215', 'Delivery and admin', 'OUTPUT2', false],
      ['debtors', '610', 'Trade debtors', null, true],
      ['bank', '090', 'Business current account', null, true],
      ['vat_control', '820', 'VAT', null, true],
      ['margin_vat_expense', '505', 'VAT on margin', null, true],
      ['cost_of_sales_vehicle', '310', 'Cost of sales — vehicles', 'NONE', true],
      ['purchase_vehicle', '630', 'Vehicle stock', 'NONE', true],
    ];

    for (const [key, code, name, tax, agreed] of rows) {
      await sql`
        INSERT INTO account_mappings (tenant_id, connection_id, account_key, account_code,
                                      account_name, tax_rate_code, agreed_by, agreed_at)
        VALUES (${TENANT}::uuid, ${CONNECTION}::uuid, ${key}, ${code}, ${name}, ${tax},
                ${agreed ? OWNER : null}, ${agreed ? sql`now() - interval '20 days'` : null})
        ON CONFLICT DO NOTHING`;
    }
  });

  await step('a dry run that has already happened', async () => {
    const [existing] = await sql`
      SELECT 1 FROM posting_batches WHERE tenant_id = ${TENANT}::uuid LIMIT 1`;
    if (existing) return;

    await sql`
      INSERT INTO posting_batches (tenant_id, connection_id, status, dry_run,
                                   period_start, period_end,
                                   total_count, posted_count, failed_count, blocked_count,
                                   started_at, finished_at)
      VALUES (${TENANT}::uuid, ${CONNECTION}::uuid, 'complete', true,
              date_trunc('month', now())::date, current_date,
              6, 0, 0, 2,
              now() - interval '2 days', now() - interval '2 days' + interval '11 seconds')`;
  });

  console.log('\nAccounting seeded. Open /accounting.');
} finally {
  await sql.end();
}
