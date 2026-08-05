import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/data/db';
import { loadAccounting } from '@/data/accounting';
import { ensureFixtures, session, T } from './fixtures';

/**
 * Accounting sync, against a real database.
 *
 * What is being defended:
 *
 * 1. A connection with no `live_from` can ONLY dry-run. That is the safety
 *    story: a posting that reaches a real ledger cannot be unposted.
 * 2. Every unmapped account is reported, not the first one a sync hits.
 * 3. A margin-scheme sale posts NO VAT on the invoice and its margin VAT as a
 *    separate journal — the pair coming apart is the expensive mistake.
 * 4. Every posting balances, and the preview says so before anything runs.
 * 5. Refunds are excluded and COUNTED, never silently dropped.
 */

let ready = false;
let reason = '';

const CONN = 'eeeeeeee-0000-4000-8000-0000000acc01';
const CONTACT = 'eeeeeeee-0000-4000-8000-0000000acc02';
const VEHICLE = 'eeeeeeee-0000-4000-8000-0000000acc03';
const INVOICE = 'eeeeeeee-0000-4000-8000-0000000acc04';

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO accounting_connections (id, tenant_id, provider, organisation_name,
                                          enabled, live_from, created_by)
      VALUES (${CONN}::uuid, ${T.tenant}::uuid, 'xero', 'Test Motors Ltd',
              true, NULL, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;
    // Not live, every run. The whole point of the fixture.
    await sql`UPDATE accounting_connections SET live_from = NULL WHERE id = ${CONN}::uuid`;

    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Ledger', 'Buyer',
              'ledger.buyer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;

    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, booked_in_at)
      VALUES (${VEHICLE}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'ACC-1', 940001,
              'AC70TST', 'Seat', 'Leon', 'sold', 'margin',
              1_200_000, 1_000_000, now() - interval '50 days')
      ON CONFLICT (id) DO NOTHING`;

    // An ISSUED margin-scheme invoice: no VAT on the document, £2,000 margin.
    await sql`
      INSERT INTO invoices (id, tenant_id, site_id, kind, status, series, number, reference,
                            contact_id, vehicle_id, buyer_name, vat_scheme,
                            net_total_pence, vat_total_pence, gross_total_pence,
                            issued_at, created_by)
      VALUES (${INVOICE}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'sale', 'issued',
              'acc-test', 1, 'ACC-000001', ${CONTACT}::uuid, ${VEHICLE}::uuid,
              'Ledger Buyer', 'margin', 1_200_000, 0, 1_200_000,
              now() - interval '2 days', ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // Most accounts mapped, two deliberately not.
    const mapped: [string, string][] = [
      ['sales_vehicle_margin', '200'],
      ['debtors', '610'],
      ['bank', '090'],
      ['vat_control', '820'],
      ['margin_vat_expense', '505'],
    ];
    for (const [key, code] of mapped) {
      await sql`
        INSERT INTO account_mappings (tenant_id, connection_id, account_key, account_code,
                                      agreed_by, agreed_at)
        VALUES (${T.tenant}::uuid, ${CONN}::uuid, ${key}, ${code},
                ${T.user}::uuid, now() - interval '10 days')
        ON CONFLICT DO NOTHING`;
    }

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the accounting fixtures build', () => {
  expect(ready, `Could not seed the accounting fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('the dry run is not optional', () => {
  it('a connection with no live_from is not live, however enabled it is', async () => {
    // Enabled and connected, and still posting nothing. A dry run is not a
    // mode somebody picks — it is the only thing an unapproved connection can
    // do, because a posting that reaches a ledger cannot be unposted.
    const view = await loadAccounting(session);
    expect(view.connection).not.toBeNull();
    expect(view.connection!.enabled).toBe(true);
    expect(view.connection!.liveFrom).toBeNull();
    expect(view.isLive).toBe(false);
  });

  it('shows the entries that would be created, in full', async () => {
    const view = await loadAccounting(session);
    expect(view.preview).not.toBeNull();
    expect(view.preview!.entries.length).toBeGreaterThan(0);

    for (const entry of view.preview!.entries) {
      // Double entry, not a summary. This is what an accountant reads.
      expect(entry.posting.lines.length).toBeGreaterThanOrEqual(2);
      expect(entry.posting.narrative.length).toBeGreaterThan(0);
      expect(entry.posting.idempotencyKey.length).toBeGreaterThan(0);
    }
  });

  it('every posting balances, and the run says so', async () => {
    const view = await loadAccounting(session);
    expect(view.preview!.balanced).toBe(true);
    expect(view.preview!.totalDebit.amount).toBe(view.preview!.totalCredit.amount);

    for (const entry of view.preview!.entries) {
      const debit = entry.posting.lines.reduce((t, l) => t + l.debit.amount, 0n);
      const credit = entry.posting.lines.reduce((t, l) => t + l.credit.amount, 0n);
      expect(debit, entry.posting.narrative).toBe(credit);
    }
  });
});

describe.runIf(process.env['DATABASE_URL'])('the margin scheme in the ledger', () => {
  it('posts no VAT on a margin sale, and its margin VAT as its own journal', async () => {
    // Rule 6 in the ledger. The invoice carries no VAT; the dealer's own
    // liability on the margin is a separate journal, and `postingsFor` emits
    // the pair together so they cannot come apart.
    // Asserted over every margin sale in the preview rather than over one
    // specific invoice: the preview is the next 25 unposted documents and
    // other suites write invoices into this tenant, so which ones appear is
    // not something this test should depend on.
    const view = await loadAccounting(session);
    const sales = view.preview!.entries.filter((e) => e.posting.source === 'sales_invoice');
    expect(sales.length).toBeGreaterThan(0);

    const marginSales = sales.filter((e) =>
      e.posting.lines.some((l) => l.account === 'sales_vehicle_margin'));
    expect(marginSales.length).toBeGreaterThan(0);

    for (const sale of marginSales) {
      // No VAT control line on the document itself — that is the scheme.
      expect(sale.posting.lines.some((l) => l.account === 'vat_control'), sale.posting.narrative)
        .toBe(false);

      // And its margin-VAT journal travels with it. `postingsFor` emits the
      // pair together so they cannot come apart, which is the expensive
      // mistake: without the journal the VAT control account never learns
      // about the sale and the dealer underpays on every margin car.
      const journal = view.preview!.entries.find(
        (e) => e.posting.source === 'margin_vat_journal'
          && e.posting.sourceId === sale.posting.sourceId);
      expect(journal, `no margin VAT journal for ${sale.posting.narrative}`).toBeDefined();

      const vatLine = journal!.posting.lines.find((l) => l.account === 'vat_control');
      expect(vatLine!.credit.amount).toBeGreaterThan(0n);
    }
  });
});

describe.runIf(process.env['DATABASE_URL'])('mapping', () => {
  it('lists EVERY unmapped account, not the first one a sync would hit', async () => {
    // A bookkeeper setting this up wants the whole list to work through once.
    // Provoked by REMOVING a mapping the pending work needs, rather than
    // relying on which accounts happen to be unmapped — otherwise this passes
    // vacuously the moment somebody finishes the mapping.
    await sql`
      DELETE FROM account_mappings
      WHERE connection_id = ${CONN}::uuid AND account_key = 'debtors'`;
    try {
      const view = await loadAccounting(session);
      expect(view.unmapped.length).toBeGreaterThan(0);
      expect(view.unmapped.map((u) => u.account)).toContain('debtors');

      // Each one names itself and says why nothing will post to it.
      for (const u of view.unmapped) {
        expect(u.label.length).toBeGreaterThan(0);
        expect(u.message).toMatch(/not mapped/i);
        // And says why we do not simply pick one.
        expect(u.message).toMatch(/do not guess|wrong one/i);
      }

      // Everything needing that account is blocked, not quietly posted.
      const blocked = view.preview!.entries.filter((e) => !e.ready);
      expect(blocked.length).toBeGreaterThan(0);
    } finally {
      await sql`
        INSERT INTO account_mappings (tenant_id, connection_id, account_key, account_code,
                                      agreed_by, agreed_at)
        VALUES (${T.tenant}::uuid, ${CONN}::uuid, 'debtors', '610',
                ${T.user}::uuid, now() - interval '10 days')
        ON CONFLICT DO NOTHING`;
    }
  });

  it('shows every account the product can post to, mapped or not', async () => {
    const view = await loadAccounting(session);
    // Twelve in the catalogue; the screen shows all of them so an unmapped
    // one is visible before something needs it.
    expect(view.mappings.length).toBe(12);
    expect(view.mappings.some((m) => m.accountCode === null)).toBe(true);
    expect(view.mappings.some((m) => m.accountCode !== null)).toBe(true);
  });

  it('records who agreed a mapping, so “nobody” is a visible answer', async () => {
    const view = await loadAccounting(session);
    const agreed = view.mappings.filter((m) => m.accountCode && m.agreedAt);
    expect(agreed.length).toBeGreaterThan(0);
    expect(agreed[0]!.agreedByName).toBeTruthy();
  });

  it('blocks an entry whose accounts are not all mapped', async () => {
    const view = await loadAccounting(session);
    const blocked = view.preview!.entries.filter((e) => !e.ready);
    for (const entry of blocked) {
      expect(entry.unmapped.length).toBeGreaterThan(0);
    }
    expect(view.preview!.readyCount + view.preview!.blockedCount)
      .toBe(view.preview!.entries.length);
  });
});

describe.runIf(process.env['DATABASE_URL'])('refunds', () => {
  it('are counted and excluded, never posted as a receipt', async () => {
    // `paymentPostings` models a receipt. Running a refund through it would
    // credit the bank for money that LEFT it, overstating cash and income in
    // a ledger a dealer files accounts from.
    const [invoice] = await sql<{ id: string }[]>`
      SELECT id FROM invoices WHERE tenant_id = ${T.tenant}::uuid
        AND status <> 'draft' LIMIT 1`;
    if (!invoice) return;

    await sql`
      INSERT INTO payments (tenant_id, invoice_id, contact_id, direction, method,
                            amount_pence, reason, received_at, created_by)
      VALUES (${T.tenant}::uuid, ${invoice.id}::uuid, ${CONTACT}::uuid, 'out', 'card',
              5_000, 'Goodwill refund for the test suite', now(), ${T.user}::uuid)`;

    const view = await loadAccounting(session);
    expect(view.refundsExcluded).toBeGreaterThan(0);

    // And no posting in the preview came from a refund.
    for (const entry of view.preview!.entries) {
      if (entry.posting.source !== 'payment') continue;
      // A receipt debits the bank. A refund would have credited it.
      const bank = entry.posting.lines.find((l) => l.account === 'bank');
      if (bank) expect(bank.debit.amount).toBeGreaterThan(0n);
    }
  });
});
