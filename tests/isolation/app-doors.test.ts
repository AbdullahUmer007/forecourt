import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession } from '@/data/db';
import { loadStock } from '@/data/stock';
import { loadInbox } from '@/data/leads';
import { loadDeals } from '@/data/deals';
import { loadInvoices, loadStockBook } from '@/data/invoices';
import { ensureFixtures, session } from '../integration/fixtures';

/**
 * The APPLICATION'S OWN DOOR refuses cross-tenant reads.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `cross-tenant.test.ts` proves the POLICIES are right. It does that by doing
 * `SET LOCAL ROLE app_user` itself and then asserting. Which is correct, and
 * it has caught real leaks — but it proves nothing about whether the running
 * application ever arrives at those policies.
 *
 * It did not. `withSession` set the tenant context and relied on RLS, and RLS
 * is not consulted at all for a role with BYPASSRLS. Local development
 * connects as `postgres`, which has it. So every CRM screen read across every
 * tenant in the database, and almost none of the loaders carry a `tenant_id`
 * predicate of their own because they were written to rely on RLS.
 *
 * It surfaced by accident: the VAT stock book rendered nine entries for a
 * dealership that has six, and the extra three belonged to two other tenants.
 * 1,576 tests were green at the time.
 *
 * So this file goes through the real doors — `withSession`, and the actual
 * loaders the screens call — while connected as a superuser, which is the
 * worst case. If the door stops setting its role, every test here fails.
 */

const RIVAL = 'dddddddd-0000-4000-8000-000000000001';
const RIVAL_SITE = 'dddddddd-0000-4000-8000-000000000002';
const RIVAL_VEHICLE = 'dddddddd-0000-4000-8000-000000000003';
const RIVAL_CONTACT = 'dddddddd-0000-4000-8000-000000000004';
const RIVAL_LEAD = 'dddddddd-0000-4000-8000-000000000005';
const RIVAL_DEAL = 'dddddddd-0000-4000-8000-000000000006';
const RIVAL_INVOICE = 'dddddddd-0000-4000-8000-000000000007';

let ready = false;
let reason = '';

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO tenants (id, name, legal_name, status)
      VALUES (${RIVAL}::uuid, 'Rival Motors', 'Rival Motors Ltd', 'live')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO sites (id, tenant_id, name)
      VALUES (${RIVAL_SITE}::uuid, ${RIVAL}::uuid, 'Rival forecourt')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence)
      VALUES (${RIVAL_VEHICLE}::uuid, ${RIVAL}::uuid, ${RIVAL_SITE}::uuid,
              'RIVAL-1', 970001, 'RV70RIV', 'Porsche', 'Cayenne', 'live', 'margin',
              5_500_000, 4_400_000)
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${RIVAL_CONTACT}::uuid, ${RIVAL}::uuid, 'individual',
              'Rival', 'Customer', 'rival.customer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO leads (id, tenant_id, site_id, contact_id, vehicle_id, source, stage, message)
      VALUES (${RIVAL_LEAD}::uuid, ${RIVAL}::uuid, ${RIVAL_SITE}::uuid,
              ${RIVAL_CONTACT}::uuid, ${RIVAL_VEHICLE}::uuid, 'autotrader', 'new',
              'Rival enquiry that must never appear in another dealer''s inbox')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, state,
                         contract_formation, vehicle_price_pence, contracted_at)
      VALUES (${RIVAL_DEAL}::uuid, ${RIVAL}::uuid, ${RIVAL_SITE}::uuid,
              ${RIVAL_CONTACT}::uuid, ${RIVAL_VEHICLE}::uuid, 'contracted',
              'on_premises', 5_500_000, now())
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO invoices (id, tenant_id, site_id, kind, status, series,
                            contact_id, vehicle_id, buyer_name, vat_scheme,
                            net_total_pence, vat_total_pence, gross_total_pence)
      VALUES (${RIVAL_INVOICE}::uuid, ${RIVAL}::uuid, ${RIVAL_SITE}::uuid,
              'sale', 'draft', 'rival', ${RIVAL_CONTACT}::uuid, ${RIVAL_VEHICLE}::uuid,
              'Rival Buyer', 'margin', 5_500_000, 0, 5_500_000)
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      INSERT INTO stock_book_entries (tenant_id, vehicle_id, entry_number,
                                      purchase_price_pence, registration,
                                      vehicle_description)
      SELECT ${RIVAL}::uuid, ${RIVAL_VEHICLE}::uuid, 1, 4_400_000,
             'RV70RIV', 'Porsche Cayenne'
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_book_entries WHERE vehicle_id = ${RIVAL_VEHICLE}::uuid)`;

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the rival tenant fixtures build', () => {
  expect(ready, `Could not seed the rival tenant: ${reason}`).toBe(true);
});

it('the test connection CAN bypass RLS — otherwise this file proves nothing', async () => {
  // The point of the whole file. If the connecting role were already
  // NOBYPASSRLS, every assertion below would pass without the door doing
  // anything, and the leak this file exists to catch would be invisible again.
  const [role] = await sql<{ bypass: boolean }[]>`
    SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  const [rows] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM vehicles WHERE tenant_id = ${RIVAL}::uuid`;

  // Either the connection bypasses RLS (so the door is what protects us), or
  // it does not and it can still see the rival rows because no context is set.
  // Both are fine; what matters is that the raw connection is NOT already
  // filtered, so the assertions below are testing the door.
  expect(role?.bypass === true || (rows?.n ?? 0) > 0).toBe(true);
  expect(rows?.n).toBeGreaterThan(0);
});

describe.runIf(process.env['DATABASE_URL'])('withSession refuses another tenant', () => {
  it('a raw SELECT through the door sees nothing belonging to the rival', async () => {
    const leaked = await withSession(session, (tx) => tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM vehicles WHERE tenant_id = ${RIVAL}::uuid`);
    expect(Number(leaked[0]?.n ?? 0), 'vehicles leaked through withSession').toBe(0);
  });

  it('refuses across every table the CRM screens read', async () => {
    for (const table of [
      'vehicles', 'contacts', 'leads', 'deals', 'invoices', 'stock_book_entries', 'sites',
    ]) {
      const rows = await withSession(session, (tx) =>
        tx.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1::uuid`, [RIVAL]));
      expect(Number(rows[0]?.['n'] ?? 0), `${table} leaked through withSession`).toBe(0);
    }
  });

  it('cannot WRITE into another tenant through the door either', async () => {
    // RLS is a WITH CHECK as well as a USING. An insert naming another tenant
    // must be refused, not silently accepted.
    await expect(withSession(session, (tx) => tx`
      INSERT INTO contacts (tenant_id, kind, first_name, email)
      VALUES (${RIVAL}::uuid, 'individual', 'Trojan', 'trojan@example.co.uk')`))
      .rejects.toThrow();
  });
});

describe.runIf(process.env['DATABASE_URL'])('the loaders the screens actually call', () => {
  it('the stock list never returns the rival’s car', async () => {
    const page = await loadStock(session, { limit: 200 }, true);
    expect(page.rows.some((r) => r.registration === 'RV70RIV')).toBe(false);
  });

  it('the lead inbox never returns the rival’s enquiry', async () => {
    const page = await loadInbox(session, { limit: 200 });
    expect(page.rows.some((r) => r.id === RIVAL_LEAD)).toBe(false);
    // And the unfiltered counts strip must not count it either — a headline
    // that includes another dealer's leads is the same leak wearing a number.
    const bySearch = await loadInbox(session, { q: 'Rival enquiry', limit: 50 });
    expect(bySearch.rows).toEqual([]);
  });

  it('the deals list never returns the rival’s deal', async () => {
    const page = await loadDeals(session, { limit: 200 }, true);
    expect(page.rows.some((r) => r.id === RIVAL_DEAL)).toBe(false);
  });

  it('the invoice list never returns the rival’s invoice', async () => {
    const page = await loadInvoices(session, { limit: 200 });
    expect(page.rows.some((r) => r.id === RIVAL_INVOICE)).toBe(false);
    // The number-gap report walks every issued number in the book. If it saw
    // another tenant's series it would invent gaps out of their numbering.
    expect(page.summary.numberGaps.some((g) => g.startsWith('rival'))).toBe(false);
  });

  it('the VAT stock book never returns the rival’s entry', async () => {
    // This is the screen that surfaced the leak: it showed nine entries for a
    // dealership with six.
    const book = await loadStockBook(session, { limit: 500 });
    expect(book.rows.some((r) => r.registration === 'RV70RIV')).toBe(false);
    // And the period totals — margin and VAT due — must not include theirs.
    // A VAT figure containing another dealer's margin is a filing error.
    const ours = book.rows.reduce(
      (acc, r) => acc + (r.margin?.amount ?? 0n), 0n);
    expect(book.period.marginTotal.amount).toBe(ours);
  });
});
