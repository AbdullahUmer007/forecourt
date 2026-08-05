/**
 * Advertising spend for the demo tenant, so the Channel P&L has a table.
 *
 * Three months, four channels, and deliberately uneven:
 *
 *  - Auto Trader expensive and productive
 *  - eBay expensive and SILENT — spend recorded, no leads at all, which is the
 *    finding the report exists to surface before a renewal
 *  - Facebook cheap with a handful of leads, too few sales to state an ROI
 *  - the current month's Auto Trader figure marked ESTIMATED, because the
 *    invoice has not landed yet and the table must say so
 *
 * Idempotent: the unique index is (tenant, label, month, site) and this
 * upserts, which is what the app does.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  process.stdout.write('done\n');
};

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run `pnpm db:seed` and `pnpm db:seed:crm` first.');
    process.exit(1);
  }

  await step('a monthly units target', async () => {
    // The dashboard's units tile shows progress against this. Without one it
    // says "no monthly target set", which is honest but less interesting.
    await sql`
      UPDATE tenants
      SET settings = settings || '{"monthly_units_target": 14}'::jsonb
      WHERE id = ${TENANT}::uuid AND settings->>'monthly_units_target' IS NULL`;
  });

  await step('channel spend, three months', async () => {
    const rows = [
      // [label, months back, pence, estimated]
      ['autotrader', 2, 189_000, false],
      ['autotrader', 1, 189_000, false],
      ['autotrader', 0, 195_000, true],
      ['ebay',       2,  85_000, false],
      ['ebay',       1,  85_000, false],
      ['facebook',   2,  22_000, false],
      ['facebook',   1,  24_500, false],
      ['facebook',   0,  24_500, true],
    ];

    for (const [label, back, pence, estimated] of rows) {
      await sql`
        INSERT INTO channel_costs (tenant_id, channel_label, period_month,
                                   amount_pence, estimated, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${label},
                (date_trunc('month', now()) - (${back} || ' months')::interval)::date,
                ${pence}, ${estimated}, ${OWNER}::uuid, ${OWNER}::uuid)
        ON CONFLICT (tenant_id, channel_label, period_month,
                     coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO NOTHING`;
    }
  });

  await step('link a delivered deal to its lead', async () => {
    // Attribution credits `deals.lead_id`. Without it every sale is
    // "Unattributed / walk-in", which is a real answer but makes the demo
    // table say nothing about channels.
    const deals = await sql`
      SELECT d.id, d.contact_id FROM deals d
      WHERE d.tenant_id = ${TENANT}::uuid
        AND d.state IN ('delivered','completed') AND d.lead_id IS NULL`;
    for (const d of deals) {
      const [lead] = await sql`
        SELECT id FROM leads
        WHERE tenant_id = ${TENANT}::uuid AND contact_id = ${d.contact_id}
        ORDER BY received_at LIMIT 1`;
      if (lead) {
        await sql`UPDATE deals SET lead_id = ${lead.id} WHERE id = ${d.id}`;
      }
    }
  });

  console.log('\nSpend seeded. Open / and /reports/channels.');
} finally {
  await sql.end();
}
