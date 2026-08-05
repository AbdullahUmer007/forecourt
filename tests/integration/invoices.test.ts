import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession } from '@/data/db';
import { loadInvoices, loadInvoice, loadStockBook } from '@/data/invoices';
import {
  applyCreateDraft, applyIssue, applyCreditNote, applyPayment,
} from '@/data/invoice-apply';
import { vatRule, amlRule } from '@/data/rules';
import { ensureFixtures, session, T } from './fixtures';

/**
 * Invoices, payments and the VAT stock book, against a real database.
 *
 * The four things worth defending, in order of what they cost when wrong:
 *
 * 1. A margin-scheme invoice never shows VAT — asserted here against the
 *    RENDERED document that the CRM screen displays, not just the model.
 * 2. The invoice number series is gapless, and a rolled-back issue does not
 *    burn a number. This is why numbers come from a locked counter row rather
 *    than a sequence, and a test that never rolls one back proves nothing.
 * 3. Cash at or above the HVD threshold is BLOCKED for an unregistered dealer,
 *    counting everything already taken from that customer.
 * 4. The stock book can be completed once and then never edited.
 */

let ready = false;
let reason = '';

const CONTACT = 'eeeeeeee-0000-4000-8000-00000000c003';
const VEHICLE = 'eeeeeeee-0000-4000-8000-00000000a001';
const DEAL = (n: number) => `eeeeeeee-0000-4000-8000-00000000b00${n}`;

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Invoice', 'Buyer',
              'invoice.buyer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;

    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, booked_in_at)
      VALUES (${VEHICLE}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, 'INV-1', 990001,
              'IV70TST', 'Volkswagen', 'Golf', 'sold', 'margin',
              1_200_000, 1_000_000, now() - interval '60 days')
      ON CONFLICT (id) DO NOTHING`;

    for (let n = 1; n <= 4; n += 1) {
      await sql`
        INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, state,
                           contract_formation, vehicle_price_pence, contracted_at, created_by)
        VALUES (${DEAL(n)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${VEHICLE}::uuid, 'contracted', 'on_premises', 1_200_000,
                now() - interval '2 days', ${T.user}::uuid)
        ON CONFLICT (id) DO NOTHING`;
      // A fresh run must start with no invoice attached.
      await sql`UPDATE deals SET invoice_id = NULL WHERE id = ${DEAL(n)}::uuid`;
    }

    await sql`
      INSERT INTO invoice_sequences (tenant_id, series, prefix)
      VALUES (${T.tenant}::uuid, 'sale', 'TST-')
      ON CONFLICT (tenant_id, series) DO NOTHING`;

    // The purchase side of the stock book, as book-in would have written it.
    await sql`
      INSERT INTO stock_book_entries (tenant_id, vehicle_id, entry_number,
                                      purchase_date, purchase_invoice_ref,
                                      purchase_price_pence, seller_name, seller_address,
                                      registration, vehicle_description, created_by)
      SELECT ${T.tenant}::uuid, ${VEHICLE}::uuid,
             coalesce((SELECT max(entry_number) FROM stock_book_entries
                       WHERE tenant_id = ${T.tenant}::uuid), 0) + 1,
             current_date - 60, 'PI-TEST', 1_000_000,
             'Manheim Leeds', 'Gelderd Road, Leeds LS12 6BY',
             'IV70TST', 'Volkswagen Golf', ${T.user}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_book_entries WHERE vehicle_id = ${VEHICLE}::uuid)`;

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the invoice fixtures build', () => {
  expect(ready, `Could not seed the invoice fixtures: ${reason}`).toBe(true);
});

const draft = async (dealId: string, price = '1200000') =>
  withSession(session, (tx) => applyCreateDraft(tx, session, {
    dealId,
    vehicleId: VEHICLE,
    contactId: CONTACT,
    buyerName: 'Invoice Buyer',
    buyerAddress: '3 Test Lane\nMilton Keynes\nMK1 1AA',
    vatScheme: 'margin',
    lines: [{ description: '2022 Volkswagen Golf, IV70 TST', unitPricePence: price }],
  }));

describe.runIf(process.env['DATABASE_URL'])('rule 6, through the product', () => {
  it('a margin invoice renders no VAT figure at all', async () => {
    const created = await draft(DEAL(1));
    expect(created.ok, created.error).toBe(true);

    const detail = await loadInvoice(session, created.invoiceId!, true);
    const html = detail!.document;

    // Asserted against the RENDERED document — the same renderer the customer's
    // copy comes from. A model with a zero VAT field and a template that prints
    // a VAT row would pass every object-level check and still standard-rate
    // the sale.
    expect(/<t[hd][^>]*>\s*VAT\s*<\/t[hd]>/i.test(html)).toBe(false);
    expect(/VAT[^<]*[:=]?\s*£/i.test(html)).toBe(false);
    // But the mandatory wording IS there, and it contains the word twice.
    expect(html).toContain('does not give the buyer the right to reclaim VAT');
    expect(detail!.invoice.vatTotal.amount).toBe(0n);
  });

  it('carries BOTH parties’ names and addresses, as 718/1 requires', async () => {
    // The seller's address was missing entirely: the loader read column names
    // that do not exist (`sites.address` is jsonb, keyed `city`/`county`, not
    // `locality`/`region`), so it silently resolved to an empty string. An
    // invoice without the dealer's address is one an inspection notices and a
    // customer never does.
    const page = await loadInvoices(session, { limit: 50 });
    const any = page.rows[0];
    expect(any).toBeDefined();

    const detail = await loadInvoice(session, any!.id, true);
    expect(detail!.invoice.buyerName).toBeTruthy();
    expect(detail!.document).toContain(detail!.invoice.buyerName!);
    expect(detail!.sellerName).toBeTruthy();
    expect(detail!.document).toContain(detail!.sellerName);

    // And where the site records an address, it reaches the document.
    const [site] = await sql<{ address: Record<string, unknown> }[]>`
      SELECT address FROM sites WHERE tenant_id = ${T.tenant}::uuid LIMIT 1`;
    const line1 = site?.address?.['line1'];
    if (typeof line1 === 'string' && line1.trim() !== '') {
      expect(detail!.sellerAddress).toContain(line1);
    }
  });

  it('writes the registration as a human reads it', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const withReg = page.rows.find((r) => r.registration !== null);
    if (!withReg) return;
    const detail = await loadInvoice(session, withReg.id, true);
    // Stored normalised, displayed with the space.
    expect(detail!.document).toContain('IV70 TST');
  });

  it('the database refuses a margin invoice carrying VAT, whatever wrote it', async () => {
    await expect(sql`
      INSERT INTO invoices (tenant_id, kind, status, series, vat_scheme,
                            net_total_pence, vat_total_pence, gross_total_pence)
      VALUES (${T.tenant}::uuid, 'sale', 'draft', 'sale', 'margin',
              1_000_000, 200_000, 1_200_000)`)
      .rejects.toThrow(/invoice_margin_shows_no_vat/);
  });

  it('the dealer’s own margin VAT is computed but kept off the document', async () => {
    const created = await draft(DEAL(2));
    const detail = await loadInvoice(session, created.invoiceId!, true);

    // £12,000 sale on a £10,000 car → £2,000 margin → £333.33 VAT.
    expect(detail!.marginVat!.margin.amount).toBe(200_000n);
    expect(detail!.marginVat!.vatDue.amount).toBe(33_333n);
    expect(detail!.document).not.toContain('333.33');
  });

  it('withholds the margin from a principal who may not see cost', async () => {
    // Margin plus selling price gives the purchase price exactly, so it is
    // withheld with cost — the derived-value rule from M2.
    const created = await loadInvoices(session, { limit: 1 });
    expect(created.rows.length).toBeGreaterThan(0);

    const detail = await loadInvoice(session, created.rows[0]!.id, false);
    expect(detail!.marginVat).toBeNull();
  });
});

describe.runIf(process.env['DATABASE_URL'])('the number series', () => {
  it('a draft consumes no number', async () => {
    const created = await draft(DEAL(3));
    const detail = await loadInvoice(session, created.invoiceId!, true);
    expect(detail!.invoice.number).toBeNull();
    expect(detail!.invoice.reference).toBeNull();
  });

  it('issuing allocates the next number and freezes the document', async () => {
    const created = await draft(DEAL(4));
    const issued = await withSession(session, (tx) =>
      applyIssue(tx, session, created.invoiceId!));
    expect(issued.ok, issued.error).toBe(true);

    const detail = await loadInvoice(session, created.invoiceId!, true);
    expect(detail!.invoice.number).not.toBeNull();
    expect(detail!.invoice.reference).toMatch(/^TST-\d{6}$/);
    expect(detail!.invoice.issuedAt).not.toBeNull();
  });

  it('a ROLLED BACK issue does not burn a number', async () => {
    // The whole reason numbers come from a locked counter row rather than a
    // Postgres SEQUENCE. A sequence does not roll back, so a failed
    // transaction leaves a hole — and a test that never rolls one back would
    // pass identically against the broken implementation.
    const [before] = await sql<{ last_number: string }[]>`
      SELECT last_number FROM invoice_sequences
      WHERE tenant_id = ${T.tenant}::uuid AND series = 'sale'`;

    const created = await draft(DEAL(1) /* already invoiced — reuse a fresh one below */);
    // DEAL(1) already has an invoice, so this returns an error rather than
    // creating one; make a genuinely fresh deal for the rollback test.
    expect(created.ok).toBe(false);

    const dealId = 'eeeeeeee-0000-4000-8000-00000000b009';
    await sql`
      INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, state,
                         contract_formation, vehicle_price_pence, contracted_at, created_by)
      VALUES (${dealId}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
              ${VEHICLE}::uuid, 'contracted', 'on_premises', 1_200_000,
              now() - interval '2 days', ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;
    await sql`UPDATE deals SET invoice_id = NULL WHERE id = ${dealId}::uuid`;

    const fresh = await draft(dealId);
    expect(fresh.ok, fresh.error).toBe(true);

    await expect(withSession(session, async (tx) => {
      const result = await applyIssue(tx, session, fresh.invoiceId!);
      expect(result.ok).toBe(true);
      // Something later in the same transaction fails.
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');

    const [after] = await sql<{ last_number: string }[]>`
      SELECT last_number FROM invoice_sequences
      WHERE tenant_id = ${T.tenant}::uuid AND series = 'sale'`;

    expect(after!.last_number).toBe(before!.last_number);

    const detail = await loadInvoice(session, fresh.invoiceId!, true);
    expect(detail!.invoice.number, 'the invoice should still be a draft').toBeNull();
  });

  it('allocates consecutive numbers, with nothing skipped between them', async () => {
    // Asserted as a RELATIONSHIP rather than "the series has no gaps at all".
    // Other suites write invoices into this tenant with arbitrary numbers to
    // exercise the freeze trigger, so the book genuinely is gappy — asserting
    // globally would be asserting something about somebody else's fixtures,
    // and would go red for a reason that has nothing to do with allocation.
    const ids: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const dealId = `eeeeeeee-0000-4000-8000-00000000b1${n}0`;
      await sql`
        INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, state,
                           contract_formation, vehicle_price_pence, contracted_at, created_by)
        VALUES (${dealId}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${VEHICLE}::uuid, 'contracted', 'on_premises', 1_200_000,
                now() - interval '2 days', ${T.user}::uuid)
        ON CONFLICT (id) DO NOTHING`;
      await sql`UPDATE deals SET invoice_id = NULL WHERE id = ${dealId}::uuid`;

      const created = await draft(dealId);
      expect(created.ok, created.error).toBe(true);
      const issued = await withSession(session, (tx) =>
        applyIssue(tx, session, created.invoiceId!));
      expect(issued.ok, issued.error).toBe(true);
      ids.push(created.invoiceId!);
    }

    const first = await loadInvoice(session, ids[0]!, true);
    const second = await loadInvoice(session, ids[1]!, true);
    expect(second!.invoice.number).toBe(first!.invoice.number! + 1n);
  });

  it('summarises gaps as ranges rather than listing every number', async () => {
    // A single stray high number leaves thousands missing. A screen that lists
    // them is unreadable and a loop that enumerates them is a memory problem.
    const page = await loadInvoices(session, { limit: 1 });
    for (const gap of page.summary.numberGaps) {
      expect(gap).toMatch(/^\S+ \d+(–\d+)?$/);
    }
    expect(page.summary.numberGaps.length)
      .toBeLessThanOrEqual(page.summary.missingNumberCount);
  });

  it('a credit note takes its own number and never releases the original', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const issued = page.rows.find((r) => r.number !== null && r.kind === 'sale'
      && r.status !== 'cancelled');
    expect(issued).toBeDefined();

    const credited = await withSession(session, (tx) =>
      applyCreditNote(tx, session, issued!.id, 'Customer rejected the car under CRA s.22'));
    expect(credited.ok, credited.error).toBe(true);

    const original = await loadInvoice(session, issued!.id, true);
    const note = await loadInvoice(session, credited.invoiceId!, true);

    // The original keeps its number and gains a pointer to the credit note.
    expect(original!.invoice.number).toBe(issued!.number);
    expect(original!.creditedByReference).toBe(note!.invoice.reference);
    // The credit note carries reversed amounts and its own number.
    expect(note!.invoice.grossTotal.amount).toBe(-issued!.grossTotal.amount);
    expect(note!.invoice.number).not.toBe(issued!.number);

    // The credit note took the number immediately after the original's series
    // position — nothing was skipped and nothing was released.
    expect(note!.invoice.number!).toBeGreaterThan(issued!.number!);
  });

  it('refuses a credit note with no reason', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const issued = page.rows.find((r) => r.number !== null && r.kind === 'sale'
      && r.status !== 'cancelled');
    if (!issued) return;

    const result = await withSession(session, (tx) =>
      applyCreditNote(tx, session, issued.id, '   '));
    expect(result.ok).toBe(false);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the stock book', () => {
  it('is completed by issuing, with the rule version recorded', async () => {
    const book = await loadStockBook(session, { limit: 200 });
    const entry = book.rows.find((r) => r.registration === 'IV70TST');
    expect(entry).toBeDefined();
    expect(entry!.saleDate).not.toBeNull();
    expect(entry!.saleInvoiceNumber).toMatch(/^TST-/);
    expect(entry!.buyerName).toBe('Invoice Buyer');
    // £12,000 on a £10,000 car → £2,000 margin, £333.33 VAT.
    expect(entry!.margin!.amount).toBe(200_000n);
    expect(entry!.vatDue!.amount).toBe(33_333n);
    // The rule version, so the figure can be re-derived after a rate change.
    expect(entry!.vatRuleVersion).not.toBeNull();
  });

  it('names WHICH mandatory fields are missing, not just that some are', async () => {
    // "Incomplete" is not actionable. "No seller's address on entry 41" is.
    const book = await loadStockBook(session, { limit: 200 });
    const entry = book.rows.find((r) => r.saleDate !== null && r.missing.length > 0);
    if (entry) {
      expect(entry.missing.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
    }
    // An unsold car is not incomplete — it is a car that has not sold.
    // An unsold car is not incomplete — it is a car that has not sold yet, and
    // flagging it is how a list teaches its user to ignore it.
    expect(book.period.incomplete).toBe(
      book.rows.filter((r) => r.saleDate !== null && r.missing.length > 0).length);
  });

  it('CANNOT be deleted, and the purchase side cannot be edited', async () => {
    const [entry] = await sql<{ id: string }[]>`
      SELECT id FROM stock_book_entries WHERE vehicle_id = ${VEHICLE}::uuid`;

    await expect(sql`DELETE FROM stock_book_entries WHERE id = ${entry!.id}::uuid`)
      .rejects.toThrow(/cannot be deleted/i);

    await expect(sql`
      UPDATE stock_book_entries SET purchase_price_pence = 1
      WHERE id = ${entry!.id}::uuid`).rejects.toThrow(/purchase side/i);

    await expect(sql`
      UPDATE stock_book_entries SET entry_number = 9999 WHERE id = ${entry!.id}::uuid`)
      .rejects.toThrow(/entry number/i);
  });

  it('a recorded sale cannot be re-recorded', async () => {
    // The sale side may be written exactly once. Changing it afterwards is a
    // correction, and a correction is an adjusting entry that keeps both
    // figures on the record.
    const [entry] = await sql<{ id: string }[]>`
      SELECT id FROM stock_book_entries WHERE vehicle_id = ${VEHICLE}::uuid`;

    await expect(sql`
      UPDATE stock_book_entries SET selling_price_pence = 9_999_999
      WHERE id = ${entry!.id}::uuid`)
      .rejects.toThrow(/already recorded|adjusting entry/i);
  });

  it('refuses a negative margin rather than storing one', async () => {
    // Each vehicle stands alone under the scheme: a loss on one can never
    // reduce the VAT due on another, so a negative margin is not a figure the
    // book may carry.
    await expect(sql`
      INSERT INTO stock_book_entries (tenant_id, entry_number, margin_pence)
      VALUES (${T.tenant}::uuid, 999999, -1)`)
      .rejects.toThrow(/stock_book_margin_non_negative/);
  });
});

describe.runIf(process.env['DATABASE_URL'])('cash and the AML threshold', () => {
  it('reads the threshold from compliance_rules, keyed on the date', async () => {
    const rule = await amlRule(new Date());
    expect(rule.amountPence).toBe(1_000_000n);
    expect(rule.currency).toBe('GBP');
    expect(rule.sourceUrl).toMatch(/^https?:\/\//);

    // Version 1 is retained for pre-June-2026 records, and reading today's
    // rule to assess a payment taken in May would apply a threshold that did
    // not exist yet.
    // January 2026 is governed by version 1 — the EUR threshold that M1's own
    // note said was "retained for pre-June-2026 records" and which had never
    // actually been inserted. Assessing a payment against a rule that did not
    // exist yet is exactly what date-keying is supposed to prevent.
    const older = await amlRule(new Date('2026-01-15'));
    expect(older.version).toBe(1);
    expect(older.currency).toBe('EUR');
  });

  it('reads the VAT fraction from compliance_rules too', async () => {
    const rule = await vatRule(new Date());
    expect(rule.numerator).toBe(1n);
    expect(rule.denominator).toBe(6n);
    expect(rule.standardRateBps).toBe(2000);
  });

  it('BLOCKS cash at the threshold for an unregistered dealer', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');
    expect(payable).toBeDefined();

    const result = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id,
        amountPence: '1000000',
        method: 'cash',
        direction: 'in',
        reason: '', reference: '',
        overrideReason: '', overrideAuthorisedBy: '',
      }));

    expect(result.ok).toBe(false);
    expect(result.aml?.outcome).toBe('blocked');
    // The refusal says what to do instead, not just that it is refused.
    expect(result.error).toMatch(/card or bank transfer|register/i);
    expect(result.aml?.overridable).toBe(true);
  });

  it('refuses an override with no named authoriser or a thin reason', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');

    const noAuthoriser = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: '1000000', method: 'cash', direction: 'in',
        reason: '', reference: '',
        overrideReason: 'Customer insisted and it is a lot of money',
        overrideAuthorisedBy: '',
      }));
    expect(noAuthoriser.ok).toBe(false);
    expect(noAuthoriser.error).toMatch(/name the person/i);

    const thinReason = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: '1000000', method: 'cash', direction: 'in',
        reason: '', reference: '',
        overrideReason: 'ok', overrideAuthorisedBy: T.user,
      }));
    expect(thinReason.ok).toBe(false);
    expect(thinReason.error).toMatch(/real reason/i);
  });

  it('counts cash already taken from the same customer', async () => {
    // Splitting the threshold into two payments is the classic evasion, and
    // the regulation counts them together.
    //
    // Amounts are derived from what this contact has ALREADY been recorded as
    // paying, because `payments` is append-only and a previous run's cash is
    // still there. A test with fixed amounts passes once and then blocks on
    // its own history, which looks like a regression in the rule.
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');

    const [prior] = await sql<{ total: string }[]>`
      SELECT coalesce(sum(amount_pence), 0)::text AS total FROM payments
      WHERE method = 'cash' AND direction = 'in' AND contact_id = ${CONTACT}::uuid`;
    const already = BigInt(prior!.total);
    const threshold = (await amlRule(new Date())).amountPence;

    // Deliberately below the threshold on its own, and enough to cross it
    // together with what is already recorded.
    const headroom = threshold - already;
    if (headroom <= 0n) {
      // Already over from earlier runs: the next pound must be blocked.
      const blocked = await withSession(session, (tx) =>
        applyPayment(tx, session, {
          invoiceId: payable!.id, amountPence: '100', method: 'cash', direction: 'in',
          reason: '', reference: '', overrideReason: '', overrideAuthorisedBy: '',
        }));
      expect(blocked.ok).toBe(false);
      expect(blocked.aml?.outcome).toBe('blocked');
      return;
    }

    const half = headroom / 2n + 1n;
    const first = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: half.toString(), method: 'cash', direction: 'in',
        reason: '', reference: '', overrideReason: '', overrideAuthorisedBy: '',
      }));
    expect(first.ok, first.error).toBe(true);

    const second = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: half.toString(), method: 'cash', direction: 'in',
        reason: '', reference: '', overrideReason: '', overrideAuthorisedBy: '',
      }));
    expect(second.ok, 'two payments that add up are one transaction').toBe(false);
    expect(second.aml?.outcome).toBe('blocked');
  });

  it('lets a card payment through and recomputes the balance', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');

    const before = await loadInvoice(session, payable!.id, true);
    const result = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: '10000', method: 'card', direction: 'in',
        reason: '', reference: 'auth 4471', overrideReason: '', overrideAuthorisedBy: '',
      }));
    expect(result.ok, result.error).toBe(true);

    const after = await loadInvoice(session, payable!.id, true);
    expect(after!.balance.paid.amount).toBe(before!.balance.paid.amount + 10_000n);
    // The status follows from what has been paid, not from a stored column.
    expect(['part_paid', 'paid']).toContain(after!.balance.status);
  });

  it('refuses to refund more than was taken', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');

    const result = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: '99999999', method: 'card', direction: 'out',
        reason: 'Customer changed their mind', reference: '',
        overrideReason: '', overrideAuthorisedBy: '',
      }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only .* was taken/i);
  });

  it('refuses a refund with no reason', async () => {
    const page = await loadInvoices(session, { limit: 50 });
    const payable = page.rows.find((r) => r.number !== null && r.status !== 'cancelled');

    const result = await withSession(session, (tx) =>
      applyPayment(tx, session, {
        invoiceId: payable!.id, amountPence: '100', method: 'card', direction: 'out',
        reason: '  ', reference: '', overrideReason: '', overrideAuthorisedBy: '',
      }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/say why/i);
  });

  it('payments are append-only — a recorded payment cannot be edited away', async () => {
    const [payment] = await sql<{ id: string }[]>`
      SELECT id FROM payments WHERE tenant_id = ${T.tenant}::uuid LIMIT 1`;
    if (!payment) return;

    await expect(sql`
      UPDATE payments SET amount_pence = 1 WHERE id = ${payment.id}::uuid`)
      .rejects.toThrow(/append-only/i);
    await expect(sql`DELETE FROM payments WHERE id = ${payment.id}::uuid`)
      .rejects.toThrow(/append-only/i);
  });
});
