import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  assertBalanced, invoicePostings, marginVatJournal, postingsFor, paymentPostings,
  unmappedAccounts, applyMapping, dryRun, toCsv, CSV_COLUMNS,
  retryPlan, MAX_POSTING_ATTEMPTS, postingIdempotencyKey, batchTotals,
  invoiceReference, ACCOUNT_KEYS, ACCOUNT_LABELS,
  type InvoiceForPosting, type AccountMapping, type PostingLine, type AccountKey,
} from './accounting.js';
import { money, zero } from './money.js';

const AUG = (d: number): Date => new Date(Date.UTC(2026, 7, d, 12));

/** A margin sale: £12,000 gross, bought for £9,000, so £3,000 margin. */
const marginInvoice = (over: Partial<InvoiceForPosting> = {}): InvoiceForPosting => ({
  id: 'inv-margin',
  kind: 'sale',
  number: 1042n,
  series: 'INV',
  vatScheme: 'margin',
  netTotal: money(1_200_000n),
  vatTotal: zero(),          // never anything else on a margin sale
  grossTotal: money(1_200_000n),
  vatCalculation: {
    scheme: 'margin',
    purchasePrice: money(900_000n),
    sellingPrice: money(1_200_000n),
    margin: money(300_000n),
    vatDue: money(50_000n),  // £3,000 × 1/6
  } as InvoiceForPosting['vatCalculation'],
  buyerName: 'M Whitfield',
  issuedAt: AUG(4),
  ...over,
});

/** A qualifying sale: £12,000 net + £2,400 VAT. */
const qualifyingInvoice = (over: Partial<InvoiceForPosting> = {}): InvoiceForPosting => ({
  id: 'inv-qual',
  kind: 'sale',
  number: 1043n,
  series: 'INV',
  vatScheme: 'qualifying',
  netTotal: money(1_200_000n),
  vatTotal: money(240_000n),
  grossTotal: money(1_440_000n),
  vatCalculation: null,
  buyerName: 'Fleet Ltd',
  issuedAt: AUG(4),
  ...over,
});

const FULL_MAPPING: AccountMapping = Object.fromEntries(
  ACCOUNT_KEYS.map((k, i) => [k, { code: `${4000 + i}`, name: ACCOUNT_LABELS[k] }]),
) as AccountMapping;

const lineFor = (posting: { lines: readonly PostingLine[] }, account: AccountKey) =>
  posting.lines.find((l) => l.account === account);

// ================================================== THE margin rule

describe('the reference a bookkeeper reconciles against', () => {
  it('uses the reference printed on the document, not series plus number', () => {
    // M11 stores "KEN-000142" because changing a series prefix must not
    // renumber history. Built from series and number the narrative read
    // "sale1", which is not a string anybody can find a document by.
    const withReference = invoiceReference({
      id: 'x', kind: 'sale', number: 1n, series: 'sale', reference: 'KEN-000001',
      vatScheme: 'margin', netTotal: money(0n), vatTotal: money(0n), grossTotal: money(0n),
      vatCalculation: null, buyerName: null, issuedAt: new Date(),
    });
    expect(withReference).toBe('KEN-000001');
  });

  it('falls back to series and number where no reference was stored', () => {
    const without = invoiceReference({
      id: 'x', kind: 'sale', number: 42n, series: 'KEN-',
      vatScheme: 'margin', netTotal: money(0n), vatTotal: money(0n), grossTotal: money(0n),
      vatCalculation: null, buyerName: null, issuedAt: new Date(),
    });
    expect(without).toBe('KEN-42');
  });
});

describe('a margin-scheme sale', () => {
  // M11 enforces at four layers that a margin INVOICE shows no VAT. This is
  // the other half of the same rule, in the ledger.

  it('posts NO output VAT line on the invoice', () => {
    const posting = invoicePostings(marginInvoice());
    expect(lineFor(posting, 'vat_control')).toBeUndefined();
  });

  it('posts the sale to the MARGIN sales account, not the qualifying one', () => {
    const posting = invoicePostings(marginInvoice());
    expect(lineFor(posting, 'sales_vehicle_margin')?.credit).toEqual(money(1_200_000n));
    expect(lineFor(posting, 'sales_vehicle_qualifying')).toBeUndefined();
  });

  it('ALWAYS produces the margin VAT journal alongside', () => {
    // Omit this and the dealer underpays VAT on every margin car they sell.
    // They find out at an inspection, by which point it is years of them.
    const postings = postingsFor(marginInvoice());
    expect(postings).toHaveLength(2);
    expect(postings[1]!.source).toBe('margin_vat_journal');
  });

  it('the journal moves the margin VAT to the VAT control account', () => {
    const journal = marginVatJournal(marginInvoice())!;
    expect(lineFor(journal, 'margin_vat_expense')?.debit).toEqual(money(50_000n));
    expect(lineFor(journal, 'vat_control')?.credit).toEqual(money(50_000n));
  });

  it('`postingsFor` returns BOTH halves, so a caller cannot take just one', () => {
    // The pair is the correct treatment. Either alone is a different kind of
    // wrong, so they are not offered separately on the happy path.
    const sources = postingsFor(marginInvoice()).map((p) => p.source);
    expect(sources).toEqual(['sales_invoice', 'margin_vat_journal']);
  });

  it('posts NO journal for a loss-making car — which is not the same as forgetting', () => {
    // Each vehicle stands alone under the scheme; a negative margin owes no
    // VAT and is never offset against another car's positive margin.
    const lossMaking = marginInvoice({
      vatCalculation: {
        scheme: 'margin',
        purchasePrice: money(1_300_000n),
        sellingPrice: money(1_200_000n),
        margin: money(-100_000n),
        vatDue: zero(),
      } as InvoiceForPosting['vatCalculation'],
    });
    expect(marginVatJournal(lossMaking)).toBeNull();
    expect(postingsFor(lossMaking)).toHaveLength(1);
  });

  it('a QUALIFYING sale posts VAT on the invoice and no margin journal', () => {
    const postings = postingsFor(qualifyingInvoice());
    expect(postings).toHaveLength(1);
    expect(lineFor(postings[0]!, 'vat_control')?.credit).toEqual(money(240_000n));
    expect(lineFor(postings[0]!, 'sales_vehicle_qualifying')?.credit).toEqual(money(1_200_000n));
  });
});

// ================================================== double entry

describe('double entry', () => {
  it('every posting balances', () => {
    for (const posting of [
      ...postingsFor(marginInvoice()),
      ...postingsFor(qualifyingInvoice()),
      paymentPostings({ id: 'p1', amount: money(500_000n), receivedAt: AUG(5),
        method: 'card', reference: 'REF' }),
    ]) {
      expect(posting.totalDebit, posting.narrative).toEqual(posting.totalCredit);
    }
  });

  it('refuses an unbalanced set with the amounts in the message', () => {
    expect(() => assertBalanced([
      { account: 'debtors', description: 'x', debit: money(100n), credit: zero() },
      { account: 'bank', description: 'y', debit: zero(), credit: money(90n) },
    ], 'Wonky')).toThrow(/does not balance: £1\.00 debit against £0\.90 credit/);
  });

  it('refuses a NEGATIVE amount rather than accepting it as a reversal', () => {
    // A negative debit and a credit look identical in a total and completely
    // different in a ledger.
    expect(() => assertBalanced([
      { account: 'debtors', description: 'x', debit: money(-100n), credit: zero() },
      { account: 'bank', description: 'y', debit: zero(), credit: money(-100n) },
    ], 'Negative')).toThrow(/contains a negative amount/);
  });

  it('property: an invoice of ANY size balances, and never posts a negative', () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1n, max: 50_000_000n }),
      fc.bigInt({ min: 0n, max: 10_000_000n }),
      fc.boolean(),
      (gross, vat, isMargin) => {
        const net = isMargin ? gross : gross - vat;
        if (net < 0n) return;

        const invoice = isMargin
          ? marginInvoice({ netTotal: money(net), grossTotal: money(gross), vatTotal: zero() })
          : qualifyingInvoice({
              netTotal: money(net), vatTotal: money(vat), grossTotal: money(net + vat),
            });

        for (const posting of postingsFor(invoice)) {
          expect(posting.totalDebit).toEqual(posting.totalCredit);
          for (const line of posting.lines) {
            expect(line.debit.amount >= 0n).toBe(true);
            expect(line.credit.amount >= 0n).toBe(true);
          }
        }
      },
    ));
  });
});

// ================================================== credit notes

describe('a credit note', () => {
  const creditNote = () => marginInvoice({
    id: 'cn-1', kind: 'credit_note', number: 7n, series: 'CN',
  });

  it('reverses every side without using a negative', () => {
    const posting = invoicePostings(creditNote());
    // Debtors is credited on a credit note where it was debited on the sale.
    expect(lineFor(posting, 'debtors')?.credit).toEqual(money(1_200_000n));
    expect(lineFor(posting, 'debtors')?.debit).toEqual(zero());
    for (const line of posting.lines) {
      expect(line.debit.amount >= 0n).toBe(true);
      expect(line.credit.amount >= 0n).toBe(true);
    }
  });

  it('reverses the margin VAT journal too', () => {
    const journal = marginVatJournal(creditNote())!;
    expect(lineFor(journal, 'vat_control')?.debit).toEqual(money(50_000n));
    expect(lineFor(journal, 'margin_vat_expense')?.credit).toEqual(money(50_000n));
  });

  it('is labelled a credit note in the narrative and the source', () => {
    const posting = invoicePostings(creditNote());
    expect(posting.source).toBe('credit_note');
    expect(posting.narrative).toMatch(/^Credit note CN7/);
  });
});

// ================================================== drafts

describe('an unissued invoice', () => {
  it('cannot be posted', () => {
    // A draft has no number and no date. Posting one puts a document in the
    // ledger that does not exist yet.
    expect(() => invoicePostings(marginInvoice({ issuedAt: null })))
      .toThrow(/has not been issued/);
  });

  it('produces no margin journal either', () => {
    expect(marginVatJournal(marginInvoice({ issuedAt: null }))).toBeNull();
  });
});

// ================================================== payments

describe('payments', () => {
  it('a payment against an invoice clears the debtor', () => {
    const posting = paymentPostings({
      id: 'p1', amount: money(1_200_000n), receivedAt: AUG(5),
      method: 'bank_transfer', reference: 'INV1042',
    });
    expect(lineFor(posting, 'bank')?.debit).toEqual(money(1_200_000n));
    expect(lineFor(posting, 'debtors')?.credit).toEqual(money(1_200_000n));
  });

  it('a DEPOSIT is a liability, not a debtor clearing', () => {
    // Money the dealer owes back if the deal falls through. Posting it to
    // debtors shows a customer owing us when they have paid us.
    const posting = paymentPostings({
      id: 'p2', amount: money(50_000n), receivedAt: AUG(5),
      method: 'card', reference: null, isDeposit: true,
    });
    expect(lineFor(posting, 'deposits_held')?.credit).toEqual(money(50_000n));
    expect(lineFor(posting, 'debtors')).toBeUndefined();
  });
});

// ================================================== mapping

describe('account mapping', () => {
  it('a fully mapped batch has nothing outstanding', () => {
    expect(unmappedAccounts(postingsFor(marginInvoice()), FULL_MAPPING)).toHaveLength(0);
  });

  it('reports EVERY unmapped account, not the first', () => {
    // A bookkeeper setting up wants the whole list to work through once, not
    // to discover them one failed sync at a time.
    const unmapped = unmappedAccounts(postingsFor(marginInvoice()), {});
    expect(unmapped.length).toBeGreaterThanOrEqual(4);
    expect(unmapped.map((u) => u.account)).toContain('debtors');
    expect(unmapped.map((u) => u.account)).toContain('vat_control');
  });

  it('explains why we do not simply guess', () => {
    const [first] = unmappedAccounts(postingsFor(marginInvoice()), {});
    expect(first!.message).toMatch(/we do not guess at an account/);
    expect(first!.message).toMatch(/wrong one gets reconciled and forgotten/);
  });

  it('REFUSES to post through an incomplete mapping', () => {
    const partial: AccountMapping = { debtors: { code: '1100' } };
    expect(() => applyMapping(invoicePostings(marginInvoice()), partial))
      .toThrow(/is not mapped/);
  });

  it('resolves codes, names and tax rates when it is complete', () => {
    const mapped = applyMapping(invoicePostings(qualifyingInvoice()), {
      ...FULL_MAPPING,
      vat_control: { code: '2200', name: 'VAT', taxRateCode: 'OUTPUT2' },
    });
    const vat = mapped.find((l) => l.account === 'vat_control')!;
    expect(vat.accountCode).toBe('2200');
    expect(vat.taxRateCode).toBe('OUTPUT2');
  });
});

// ================================================== dry run

describe('the dry run', () => {
  it('shows what would be created, and that it balances', () => {
    const run = dryRun(postingsFor(marginInvoice()), FULL_MAPPING);
    expect(run.balanced).toBe(true);
    expect(run.readyCount).toBe(2);
    expect(run.blockedCount).toBe(0);
    expect(run.summary).toMatch(/2 entries ready/);
  });

  it('blocks on unmapped accounts and lists them once each', () => {
    const run = dryRun(postingsFor(marginInvoice()), {});
    expect(run.readyCount).toBe(0);
    expect(run.blockedCount).toBe(2);
    // Deduplicated across entries — `vat_control` appears in both postings.
    const accounts = run.outstandingMappings.map((u) => u.account);
    expect(new Set(accounts).size).toBe(accounts.length);
    expect(run.summary).toMatch(/blocked on \d+ unmapped account/);
  });

  it('still totals correctly while blocked', () => {
    // The point of a dry run is reading it. A blocked entry still has to show
    // its numbers, or there is nothing to approve.
    const run = dryRun(postingsFor(marginInvoice()), {});
    expect(run.totalDebit).toEqual(run.totalCredit);
    expect(run.entries.every((e) => e.posting.lines.length > 0)).toBe(true);
  });
});

// ================================================== CSV fallback

describe('the CSV fallback', () => {
  it('is one row per LINE, which is what an accountant imports', () => {
    const csv = toCsv(postingsFor(marginInvoice()), FULL_MAPPING);
    const rows = csv.split('\n');
    expect(rows[0]).toBe(CSV_COLUMNS.join(','));
    // 3 invoice lines (debtors, sales, no VAT) + 2 journal lines.
    expect(rows).toHaveLength(1 + 4);
  });

  it('writes pounds with two decimals, not pence', () => {
    // Read by a human and by a spreadsheet, neither of which wants an integer
    // number of pence.
    const csv = toCsv(postingsFor(marginInvoice()), FULL_MAPPING);
    expect(csv).toMatch(/12000\.00/);
    expect(csv).toMatch(/500\.00/);
  });

  it('leaves the unused side of each line BLANK rather than zero', () => {
    const csv = toCsv([paymentPostings({
      id: 'p1', amount: money(10_000n), receivedAt: AUG(5), method: 'card', reference: null,
    })], FULL_MAPPING);
    const [, bankRow] = csv.split('\n');
    // Debit 100.00, credit empty — a column of 0.00s is unreadable.
    expect(bankRow).toMatch(/100\.00,,/);
  });

  it('works with NO mapping at all, falling back to our own key', () => {
    // The only part of this module that works with no integration. An
    // accountant can read `sales_vehicle_margin` and know what to do; a blank
    // column is how a row gets silently dropped on import.
    const csv = toCsv(postingsFor(marginInvoice()));
    expect(csv).toMatch(/sales_vehicle_margin/);
    expect(csv).toMatch(/Vehicle sales — margin scheme/);
  });

  it('escapes a narrative containing a comma or a quote', () => {
    const csv = toCsv(postingsFor(marginInvoice({ buyerName: 'Whitfield, M "Bud"' })));
    expect(csv).toMatch(/"Invoice INV1042 — Whitfield, M ""Bud"""/);
  });
});

// ================================================== the error queue

describe('retrying a posting', () => {
  it('NEVER auto-retries a rejection', () => {
    // The ledger has told us the period is locked. The same journal gets the
    // same answer.
    const plan = retryPlan({ outcome: 'rejected', attempts: 1 });
    expect(plan.retryable).toBe(false);
    expect(plan.message).toMatch(/locked period or an archived account/);
  });

  it('retries a transport error', () => {
    expect(retryPlan({ outcome: 'transport_error', attempts: 1 }).retryable).toBe(true);
  });

  it('gives up after a stated number of attempts', () => {
    const plan = retryPlan({ outcome: 'transport_error', attempts: MAX_POSTING_ATTEMPTS });
    expect(plan.retryable).toBe(false);
    expect(plan.message).toMatch(/Given up after 5 attempts/);
  });
});

describe('idempotency', () => {
  it('a document produces the same key every time', () => {
    const a = postingsFor(marginInvoice())[0]!;
    const b = postingsFor(marginInvoice())[0]!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it('the invoice and its margin journal have DIFFERENT keys', () => {
    // Otherwise the second would deduplicate against the first and the VAT
    // journal would silently never post.
    const [invoice, journal] = postingsFor(marginInvoice());
    expect(invoice!.idempotencyKey).not.toBe(journal!.idempotencyKey);
  });

  it('the provider is part of the key, so two connections do not collide', () => {
    const posting = postingsFor(marginInvoice())[0]!;
    expect(postingIdempotencyKey('xero', posting))
      .not.toBe(postingIdempotencyKey('sage', posting));
  });
});

describe('batch totals', () => {
  it('sums both sides and reports whether they agree', () => {
    const totals = batchTotals([
      ...postingsFor(marginInvoice()),
      ...postingsFor(qualifyingInvoice()),
    ]);
    expect(totals.balanced).toBe(true);
    expect(totals.debit).toEqual(totals.credit);
  });

  it('an empty batch is balanced at zero', () => {
    expect(batchTotals([])).toEqual({ debit: zero(), credit: zero(), balanced: true });
  });
});

describe('references', () => {
  it('joins the series and number', () => {
    expect(invoiceReference(marginInvoice())).toBe('INV1042');
  });

  it('falls back to the series when there is no number', () => {
    expect(invoiceReference(marginInvoice({ number: null }))).toBe('INV');
  });

  it('every account key has a human label', () => {
    for (const key of ACCOUNT_KEYS) {
      expect(ACCOUNT_LABELS[key].length).toBeGreaterThan(3);
    }
  });
});
