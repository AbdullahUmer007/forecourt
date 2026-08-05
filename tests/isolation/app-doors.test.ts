import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession, type Tx } from '@/data/db';
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

/**
 * The PUBLIC SITE's door — the other half, and the half that was missing.
 *
 * Everything above goes through `withSession` and the CRM's loaders. Nothing
 * went through `withTenant` and `app_public`, and the cost of that gap was
 * immediate: the same change that closed the CRM leak by adding
 * `SET LOCAL ROLE` to both doors ALSO broke the public site outright, because
 * `app_public` had never been granted SELECT on `tenants` — the table is
 * handled outside the loop that grants as it goes, since it has no
 * `tenant_id`. Every page the site served returned 500, and it took building a
 * container and curling it to find out.
 *
 * A door has two failure modes and both matter: letting through what it should
 * refuse, and refusing what it must let through. These test the second as
 * carefully as the block above tests the first.
 */
describe.runIf(process.env['DATABASE_URL'])('the public site’s door', () => {
  const KENNINGTON = '11111111-1111-4111-8111-111111111111';

  /**
   * The site's own door, copied rather than imported: `@/` is the CRM.
   *
   * `Tx` is the NAMED type, not `Parameters<Parameters<typeof sql.begin>[0]>[0]`.
   * `sql.begin` is overloaded, so deriving it picks the wrong signature and
   * every `tx` silently becomes `never` — which type-checks perfectly until
   * something calls a method on it. The comment in `apps/site/src/data/db.ts`
   * warns about this exact trap; writing it out here reproduced it first try.
   */
  const withPublicTenant = async <T>(
    tenantId: string, fn: (tx: Tx) => Promise<T>,
  ): Promise<T> => sql.begin(async (tx: Tx) => {
    await tx`SET LOCAL ROLE app_public`;
    await tx`SELECT set_tenant_context(${tenantId}::uuid, NULL, '{}'::uuid[], true)`;
    return fn(tx);
  }) as Promise<T>;

  it('can read the dealership it is rendering', async () => {
    // Not a formality. Every page names the dealer — the masthead, the FCA
    // disclosure in the footer, the AutoDealer JSON-LD — so a site that cannot
    // read `tenants` cannot render anything at all.
    const rows = await withPublicTenant(KENNINGTON, async (tx) =>
      tx`SELECT id, name FROM tenants`);
    expect(rows.length, 'app_public cannot read tenants — the whole site 500s')
      .toBeGreaterThan(0);
    expect(rows.every((r) => r['id'] === KENNINGTON)).toBe(true);
  });

  it('can read the tables a shopfront is made of', async () => {
    for (const table of [
      'brands', 'domains', 'sites', 'vehicles', 'vehicle_media', 'vehicle_prices',
      'mot_records', 'representative_examples', 'search_events',
    ]) {
      await expect(
        withPublicTenant(KENNINGTON, async (tx) => tx.unsafe(`SELECT 1 FROM ${table} LIMIT 1`)),
        `app_public cannot read ${table}`,
      ).resolves.toBeDefined();
    }
  });

  it('sees only its own tenant, on a connection that could see everything', async () => {
    const [all] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tenants`;
    expect(all?.n, 'the fixtures should have created several tenants').toBeGreaterThan(1);

    const rows = await withPublicTenant(KENNINGTON, async (tx) => tx`SELECT id FROM tenants`);
    expect(rows.length).toBe(1);

    const cars = await withPublicTenant(KENNINGTON, async (tx) =>
      tx`SELECT tenant_id FROM vehicles`);
    expect(cars.every((c) => c['tenant_id'] === KENNINGTON)).toBe(true);
  });

  it('is READ-ONLY as a privilege, not as a convention', async () => {
    // The door's comment claims the public site cannot write. That has to be
    // something the database refuses, not something the code happens not to do
    // — an injected UPDATE does not care what the code intended.
    await expect(
      withPublicTenant(KENNINGTON, async (tx) =>
        tx`UPDATE tenants SET name = 'owned' WHERE id = ${KENNINGTON}::uuid`),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withPublicTenant(KENNINGTON, async (tx) =>
        tx`UPDATE vehicles SET retail_price_pence = 1 WHERE tenant_id = ${KENNINGTON}::uuid`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot read the CRM’s side of the business', async () => {
    // A shopfront renders stock. It has no reason to reach a customer record,
    // a lead, a deal, an invoice, a payment or the evidence ledger — and until
    // this was written it held SELECT on all of them, plus the CRM's own
    // `sessions` table, because `apply_tenant_policies` granted `app_public`
    // every tenant-scoped table it looped over.
    //
    // Row-level security still confined it to one dealership, so this was
    // never a cross-tenant leak. It was worse in a different direction: the
    // role behind the page a stranger loads could read everything that dealer
    // holds, and only the absence of a bug stood between the two.
    for (const table of [
      'users', 'sessions', 'auth_attempts', 'platform_operators',
      'contacts', 'contact_consents', 'leads', 'messages',
      'deals', 'deal_evidence', 'invoices', 'payments', 'stock_book_entries',
      'audit_events',
    ]) {
      const [row] = await sql<{ granted: boolean }[]>`
        SELECT has_table_privilege('app_public', ${table}, 'SELECT') AS granted`;
      expect(row?.granted, `app_public should not be able to read ${table}`).toBe(false);
    }
  });

  it('cannot write anywhere except the demand signal', async () => {
    // One exception, and it is INSERT only: `search_events` records what
    // buyers looked for and did not find. Append-only evidence of demand.
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_public' AND privilege_type <> 'SELECT'`;

    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort())
      .toEqual(['search_events:INSERT']);
  });
});
