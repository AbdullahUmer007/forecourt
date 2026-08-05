/**
 * Stock book entries and invoices for the demo tenant.
 *
 * The purchase side of the stock book is what a dealer completes at book-in,
 * so it is seeded here for every demo car — without it, issuing an invoice has
 * nothing to complete and the VAT book screen is empty.
 *
 * One entry is deliberately left SHORT of a mandatory field (no seller's
 * address on the car sold to Owen Brackley), because the whole point of the
 * screen is naming exactly which of the twelve is missing, and a screen that
 * only ever renders the happy path has never been looked at properly.
 *
 * Idempotent: fixed ids and guarded inserts throughout.
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

const SELLERS = [
  ['Manheim Leeds', 'Leeds Auction Centre, Gelderd Road, Leeds LS12 6BY'],
  ['A private seller', '22 Fairfield Road, Northampton NN1 4LY'],
  ['BCA Blackbushe', 'Blackbushe Airport, Camberley GU17 9LG'],
  // No address. Deliberate: the VAT book must name this as a missing field.
  ['Aston Barclay Wakefield', null],
  ['A private seller', '7 Oakleigh Close, Bedford MK41 8QP'],
  ['Motability Operations', 'City Gate House, 22 Southwark Bridge Road, London SE1 9HB'],
];

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run `pnpm db:seed`, `pnpm db:seed:crm` and `pnpm db:seed:deals` first.');
    process.exit(1);
  }

  await step('the invoice number series', async () => {
    await sql`
      INSERT INTO invoice_sequences (tenant_id, series, prefix, last_number)
      VALUES (${TENANT}::uuid, 'sale', 'KEN-', 0)
      ON CONFLICT (tenant_id, series) DO NOTHING`;
    await sql`
      INSERT INTO stock_book_sequences (tenant_id, last_number)
      VALUES (${TENANT}::uuid, 0)
      ON CONFLICT (tenant_id) DO NOTHING`;
  });

  await step('stock book — the purchase side', async () => {
    const cars = await sql`
      SELECT id, registration, make, model, derivative, total_cost_pence, booked_in_at
      FROM vehicles WHERE tenant_id = ${TENANT}::uuid
      ORDER BY created_at LIMIT 6`;

    for (const [i, car] of cars.entries()) {
      const [seller, address] = SELLERS[i % SELLERS.length];
      const description = [car.make, car.model, car.derivative].filter(Boolean).join(' ');

      // Entry numbers come from the counter, exactly as the app takes them.
      const [seq] = await sql`
        SELECT last_number FROM stock_book_sequences
        WHERE tenant_id = ${TENANT}::uuid FOR UPDATE`;
      const next = BigInt(seq.last_number) + 1n;

      const inserted = await sql`
        INSERT INTO stock_book_entries (tenant_id, vehicle_id, entry_number,
                                        purchase_date, purchase_invoice_ref,
                                        purchase_price_pence, seller_name, seller_address,
                                        registration, vehicle_description, created_by)
        SELECT ${TENANT}::uuid, ${car.id}::uuid, ${next.toString()},
               coalesce(${car.booked_in_at}::date, current_date - 60),
               ${'PI-' + String(4000 + i)},
               ${car.total_cost_pence ?? 0}, ${seller}, ${address},
               ${car.registration}, ${description}, ${OWNER}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM stock_book_entries WHERE vehicle_id = ${car.id}::uuid)
        RETURNING id`;

      if (inserted.length > 0) {
        await sql`
          UPDATE stock_book_sequences SET last_number = ${next.toString()}, updated_at = now()
          WHERE tenant_id = ${TENANT}::uuid`;
      }
    }
  });

  console.log('\nStock book seeded. Issue an invoice from a deal to complete a sale side.');
  console.log('Open /vat/stock-book and /invoices.');
} finally {
  await sql.end();
}
