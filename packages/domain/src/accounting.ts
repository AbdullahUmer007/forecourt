/**
 * M17 — accounting sync.
 *
 * The functional spec states the constraint this module lives under, and it is
 * worth quoting rather than paraphrasing:
 *
 *   "We are not the ledger. We are the source of accurate, VAT-correct
 *    transactional data. Never invent journal entries the accountant did not
 *    agree to; always allow the accountant read-only access to check us."
 *
 * Two rules carry almost all of the risk:
 *
 *   1. A MARGIN-SCHEME SALE POSTS NO OUTPUT VAT ON THE INVOICE, AND A SEPARATE
 *      JOURNAL FOR THE VAT ON THE MARGIN. Both halves are mandatory and each
 *      is wrong without the other. Put VAT on the invoice and the sale becomes
 *      standard-rated — M11 enforces that at four layers. Omit the journal and
 *      the dealer underpays VAT on every margin car they sell, which they find
 *      out about at an inspection. `postingsFor` cannot produce one without
 *      the other, because it returns both or refuses.
 *
 *   2. NOTHING POSTS TO AN ACCOUNT NOBODY MAPPED. Not a sensible default, not
 *      "Sales" because it sounded right. A wrong account is worse than a
 *      missing one: a missing one gets noticed at month end, a wrong one gets
 *      reconciled and forgotten.
 */

import { type Money, subtract, sum, zero, isNegative, format } from './money.js';
import type { VatScheme, VatCalculation } from './vat.js';

// ------------------------------------------------------------------ types

export type AccountingProvider = 'xero' | 'quickbooks' | 'sage' | 'csv_export';

/**
 * Our chart, as a closed set.
 *
 * Closed on purpose: a key added here with no mapping shows up as a blocked
 * posting the next time anyone syncs, rather than posting nowhere quietly. The
 * accountant maps ours onto theirs; we never guess at theirs.
 */
export const ACCOUNT_KEYS = [
  'sales_vehicle_margin',
  'sales_vehicle_qualifying',
  'sales_addon',
  'sales_delivery',
  'debtors',
  'bank',
  'vat_control',
  'margin_vat_expense',
  'cost_of_sales_vehicle',
  'prep_costs',
  'purchase_vehicle',
  'deposits_held',
] as const;

export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  sales_vehicle_margin: 'Vehicle sales — margin scheme',
  sales_vehicle_qualifying: 'Vehicle sales — VAT qualifying',
  sales_addon: 'Add-on product sales',
  sales_delivery: 'Delivery and admin charges',
  debtors: 'Trade debtors',
  bank: 'Bank',
  vat_control: 'VAT control',
  margin_vat_expense: 'VAT on margin (cost of sale)',
  cost_of_sales_vehicle: 'Cost of sales — vehicles',
  prep_costs: 'Preparation costs',
  purchase_vehicle: 'Vehicle purchases',
  deposits_held: 'Customer deposits held',
};

export interface PostingLine {
  account: AccountKey;
  description: string;
  debit: Money;
  credit: Money;
  /** Their tax rate identifier, where the mapping supplies one. */
  taxRateCode?: string | null;
}

export type PostingSource =
  | 'sales_invoice' | 'credit_note' | 'purchase_invoice' | 'payment' | 'margin_vat_journal';

export interface Posting {
  source: PostingSource;
  sourceId: string;
  narrative: string;
  date: Date;
  lines: readonly PostingLine[];
  totalDebit: Money;
  totalCredit: Money;
  idempotencyKey: string;
}

export type AccountMapping = Readonly<Partial<Record<AccountKey, {
  code: string;
  name?: string;
  taxRateCode?: string | null;
}>>>;

// -------------------------------------------------------- double entry

/**
 * Every posting must balance. Not "should" — an unbalanced journal is refused
 * by the ledger at the far end anyway, and finding out then means a failed
 * batch and a confused bookkeeper instead of a caught bug.
 */
export function assertBalanced(lines: readonly PostingLine[], narrative: string): void {
  const currency = lines[0]?.debit.currency ?? 'GBP';
  const debit = sum(lines.map((l) => l.debit), currency);
  const credit = sum(lines.map((l) => l.credit), currency);

  if (debit.amount !== credit.amount) {
    throw new Error(
      `"${narrative}" does not balance: ${format(debit)} debit against ${format(credit)} credit. ` +
      'A journal that does not balance is refused by the ledger, so it is refused here where ' +
      'the cause is still visible.',
    );
  }

  if (lines.some((l) => isNegative(l.debit) || isNegative(l.credit))) {
    throw new Error(
      `"${narrative}" contains a negative amount. A reversal is a line on the other side, ` +
      'not a negative debit — the two look identical in a total and completely different in a ledger.',
    );
  }
}

const balance = (lines: readonly PostingLine[], currency: 'GBP' | 'EUR' = 'GBP') => ({
  totalDebit: sum(lines.map((l) => l.debit), currency),
  totalCredit: sum(lines.map((l) => l.credit), currency),
});

const debit = (account: AccountKey, description: string, amount: Money): PostingLine =>
  ({ account, description, debit: amount, credit: zero(amount.currency) });

const credit = (account: AccountKey, description: string, amount: Money): PostingLine =>
  ({ account, description, debit: zero(amount.currency), credit: amount });

// -------------------------------------------------------------- invoices

export interface InvoiceForPosting {
  id: string;
  kind: 'sale' | 'credit_note' | 'proforma' | 'deposit';
  number: bigint | null;
  series: string;
  vatScheme: VatScheme;
  netTotal: Money;
  vatTotal: Money;
  grossTotal: Money;
  /** M11's margin figure. Never a line on the invoice; always its own journal. */
  vatCalculation: VatCalculation | null;
  buyerName: string | null;
  issuedAt: Date | null;
  /** Split out so add-ons and delivery reach their own accounts. */
  addonTotal?: Money;
  deliveryTotal?: Money;
}

export const invoiceReference = (invoice: InvoiceForPosting): string =>
  invoice.number === null ? invoice.series : `${invoice.series}${invoice.number}`;

/**
 * The postings for a sales invoice.
 *
 * A margin-scheme invoice produces NO VAT line here. That is not an omission —
 * it is the scheme, and M11 refuses to render one. The VAT the dealer owes on
 * the margin comes from `marginVatJournal`, which `postingsFor` always emits
 * alongside so the pair cannot come apart.
 */
export function invoicePostings(invoice: InvoiceForPosting): Posting {
  if (invoice.issuedAt === null) {
    throw new Error(
      `Invoice ${invoiceReference(invoice)} has not been issued. A draft has no number and no ` +
      'date, and posting one would put a document in the ledger that does not exist yet.',
    );
  }

  const currency = invoice.grossTotal.currency;
  const isCredit = invoice.kind === 'credit_note';
  const reference = invoiceReference(invoice);
  const narrative = `${isCredit ? 'Credit note' : 'Invoice'} ${reference}` +
    (invoice.buyerName ? ` — ${invoice.buyerName}` : '');

  const addon = invoice.addonTotal ?? zero(currency);
  const delivery = invoice.deliveryTotal ?? zero(currency);
  const vehicleNet = subtract(subtract(invoice.netTotal, addon), delivery);

  const salesAccount: AccountKey = invoice.vatScheme === 'margin'
    ? 'sales_vehicle_margin'
    : 'sales_vehicle_qualifying';

  // On a credit note every side reverses. Expressed by swapping which builder
  // is used rather than by negating amounts: a negative debit and a credit
  // look identical in a total and completely different in a ledger.
  const dr = isCredit ? credit : debit;
  const cr = isCredit ? debit : credit;

  const lines: PostingLine[] = [
    dr('debtors', narrative, invoice.grossTotal),
    cr(salesAccount, `Vehicle — ${reference}`, vehicleNet),
  ];

  if (addon.amount > 0n) lines.push(cr('sales_addon', `Add-ons — ${reference}`, addon));
  if (delivery.amount > 0n) lines.push(cr('sales_delivery', `Delivery — ${reference}`, delivery));

  // ONLY on a qualifying sale. A margin invoice has no output VAT to post,
  // and inventing one here would contradict the document M11 rendered.
  if (invoice.vatScheme !== 'margin' && invoice.vatTotal.amount !== 0n) {
    lines.push(cr('vat_control', `VAT — ${reference}`, invoice.vatTotal));
  }

  assertBalanced(lines, narrative);

  return {
    source: isCredit ? 'credit_note' : 'sales_invoice',
    sourceId: invoice.id,
    narrative,
    date: invoice.issuedAt,
    lines,
    ...balance(lines, currency),
    idempotencyKey: `${isCredit ? 'cn' : 'inv'}:${invoice.id}`,
  };
}

/**
 * The VAT the dealer owes on a margin sale, as its own journal.
 *
 * This is the half everybody forgets. The invoice showed no VAT, correctly —
 * so without this the VAT control account never learns about the sale and the
 * dealer underpays on every margin car they sell. They find out at an
 * inspection, by which point it is years of them.
 *
 * Dr VAT on margin (a cost of sale, because it genuinely is one under the
 * scheme), Cr VAT control.
 */
export function marginVatJournal(invoice: InvoiceForPosting): Posting | null {
  if (invoice.vatScheme !== 'margin') return null;
  if (invoice.issuedAt === null) return null;

  const vat = invoice.vatCalculation?.vatDue;
  // A loss-making margin car owes no VAT, and each vehicle stands alone — a
  // negative margin is never offset against another car's positive one. So
  // there is genuinely nothing to post, which is different from forgetting to.
  if (!vat || vat.amount === 0n) return null;

  const reference = invoiceReference(invoice);
  const narrative = `Margin scheme VAT — ${reference}`;
  const isCredit = invoice.kind === 'credit_note';

  const dr = isCredit ? credit : debit;
  const cr = isCredit ? debit : credit;

  const lines: PostingLine[] = [
    dr('margin_vat_expense', narrative, vat),
    cr('vat_control', narrative, vat),
  ];

  assertBalanced(lines, narrative);

  return {
    source: 'margin_vat_journal',
    sourceId: invoice.id,
    narrative,
    date: invoice.issuedAt,
    lines,
    ...balance(lines, vat.currency),
    idempotencyKey: `mvat:${invoice.id}`,
  };
}

/**
 * Everything an invoice produces.
 *
 * Returns BOTH halves together, so the margin VAT journal cannot be dropped by
 * a caller who only wanted the invoice. The pair is the correct treatment;
 * either alone is a different kind of wrong.
 */
export function postingsFor(invoice: InvoiceForPosting): Posting[] {
  const postings = [invoicePostings(invoice)];
  const marginVat = marginVatJournal(invoice);
  if (marginVat) postings.push(marginVat);
  return postings;
}

// -------------------------------------------------------------- payments

export interface PaymentForPosting {
  id: string;
  amount: Money;
  receivedAt: Date;
  method: string;
  reference: string | null;
  /** A deposit taken before an invoice exists is a liability, not income. */
  isDeposit?: boolean;
}

export function paymentPostings(payment: PaymentForPosting): Posting {
  const narrative = `${payment.isDeposit ? 'Deposit' : 'Payment'} received` +
    (payment.reference ? ` — ${payment.reference}` : '');

  // A deposit taken before there is an invoice is money the dealer owes back
  // if the deal falls through. Posting it to debtors would show a customer
  // owing us when they have paid us.
  const lines: PostingLine[] = [
    debit('bank', narrative, payment.amount),
    credit(payment.isDeposit ? 'deposits_held' : 'debtors', narrative, payment.amount),
  ];

  assertBalanced(lines, narrative);

  return {
    source: 'payment',
    sourceId: payment.id,
    narrative,
    date: payment.receivedAt,
    lines,
    ...balance(lines, payment.amount.currency),
    idempotencyKey: `pay:${payment.id}`,
  };
}

// -------------------------------------------------------------- mapping

export interface UnmappedAccount {
  account: AccountKey;
  label: string;
  message: string;
}

/**
 * Which accounts a posting needs that nobody has mapped.
 *
 * Reports EVERY one rather than the first: a bookkeeper setting up the
 * connection wants the whole list to work through once, not to discover them
 * one failed sync at a time.
 */
export function unmappedAccounts(
  postings: readonly Posting[],
  mapping: AccountMapping,
): UnmappedAccount[] {
  const needed = new Set<AccountKey>();
  for (const posting of postings) {
    for (const line of posting.lines) needed.add(line.account);
  }

  return [...needed]
    .filter((account) => !mapping[account]?.code)
    .map((account) => ({
      account,
      label: ACCOUNT_LABELS[account],
      message:
        `“${ACCOUNT_LABELS[account]}” is not mapped to an account in your accounting package. ` +
        'Nothing will post to it until it is — we do not guess at an account, because a wrong ' +
        'one gets reconciled and forgotten while a missing one gets noticed.',
    }));
}

export interface MappedLine extends PostingLine {
  accountCode: string;
  accountName: string | null;
}

/**
 * Resolve a posting's lines against the mapping. Throws on anything unmapped —
 * `unmappedAccounts` is how a caller asks politely first.
 */
export function applyMapping(
  posting: Posting,
  mapping: AccountMapping,
): readonly MappedLine[] {
  return posting.lines.map((line) => {
    const mapped = mapping[line.account];
    if (!mapped?.code) {
      throw new Error(
        `Refusing to post "${posting.narrative}": ${ACCOUNT_LABELS[line.account]} is not mapped.`,
      );
    }
    return {
      ...line,
      accountCode: mapped.code,
      accountName: mapped.name ?? null,
      taxRateCode: mapped.taxRateCode ?? null,
    };
  });
}

// -------------------------------------------------------------- dry run

export interface DryRunEntry {
  posting: Posting;
  ready: boolean;
  unmapped: readonly UnmappedAccount[];
}

export interface DryRun {
  entries: readonly DryRunEntry[];
  totalDebit: Money;
  totalCredit: Money;
  balanced: boolean;
  readyCount: number;
  blockedCount: number;
  /** Every distinct account that needs mapping before this batch can run. */
  outstandingMappings: readonly UnmappedAccount[];
  summary: string;
}

/**
 * §23's dry run: exactly what would be created, before anything is.
 *
 * Not a mode somebody has to remember to pick — a connection starts with no
 * `live_from`, so this is the only thing it can do until an accountant has
 * looked at the output and said yes.
 */
export function dryRun(
  postings: readonly Posting[],
  mapping: AccountMapping,
  currency: 'GBP' | 'EUR' = 'GBP',
): DryRun {
  const entries: DryRunEntry[] = postings.map((posting) => {
    const unmapped = unmappedAccounts([posting], mapping);
    return { posting, ready: unmapped.length === 0, unmapped };
  });

  const totalDebit = sum(postings.map((p) => p.totalDebit), currency);
  const totalCredit = sum(postings.map((p) => p.totalCredit), currency);

  const outstanding = new Map<AccountKey, UnmappedAccount>();
  for (const entry of entries) {
    for (const u of entry.unmapped) outstanding.set(u.account, u);
  }

  const readyCount = entries.filter((e) => e.ready).length;
  const blockedCount = entries.length - readyCount;

  return {
    entries,
    totalDebit,
    totalCredit,
    balanced: totalDebit.amount === totalCredit.amount,
    readyCount,
    blockedCount,
    outstandingMappings: [...outstanding.values()],
    summary: blockedCount === 0
      ? `${readyCount} entr${readyCount === 1 ? 'y' : 'ies'} ready, ${format(totalDebit)} each side.`
      : `${readyCount} ready, ${blockedCount} blocked on ${outstanding.size} unmapped ` +
        `account${outstanding.size === 1 ? '' : 's'}.`,
  };
}

// ------------------------------------------------------------ CSV export

const csvCell = (value: string | null | undefined): string => {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const asPounds = (m: Money): string =>
  m.amount === 0n ? '' : (Number(m.amount) / 100).toFixed(2);

export const CSV_COLUMNS = [
  'Date', 'Reference', 'Narrative', 'Account code', 'Account name',
  'Description', 'Debit', 'Credit', 'Tax rate',
] as const;

/**
 * The fallback for a dealer with no supported package — §23's last bullet, and
 * the only part of this module that works with no integration at all.
 *
 * One row per LINE rather than per document, because that is what an
 * accountant imports and what they can check. Amounts are pounds with two
 * decimals: this file is read by a human and by a spreadsheet, neither of
 * which wants pence as an integer.
 *
 * Unmapped accounts fall back to our own key rather than a blank cell — an
 * accountant can see `sales_vehicle_margin` and know what to do with it, and a
 * blank column is how a row gets silently dropped on import.
 */
export function toCsv(
  postings: readonly Posting[],
  mapping: AccountMapping = {},
): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];

  for (const posting of postings) {
    for (const line of posting.lines) {
      const mapped = mapping[line.account];
      rows.push([
        posting.date.toISOString().slice(0, 10),
        csvCell(posting.idempotencyKey),
        csvCell(posting.narrative),
        csvCell(mapped?.code ?? line.account),
        csvCell(mapped?.name ?? ACCOUNT_LABELS[line.account]),
        csvCell(line.description),
        asPounds(line.debit),
        asPounds(line.credit),
        csvCell(mapped?.taxRateCode ?? line.taxRateCode ?? null),
      ].join(','));
    }
  }

  return rows.join('\n');
}

// ------------------------------------------------------------ the queue

export type PostingOutcome = 'posted' | 'rejected' | 'transport_error';

export interface RetryPlan {
  retryable: boolean;
  message: string;
}

export const MAX_POSTING_ATTEMPTS = 5;

/**
 * Whether a failed posting should be retried.
 *
 * A REJECTED posting is not retried automatically: the ledger has told us the
 * account is archived or the date is in a locked period, and sending the same
 * journal again gets the same answer. A transport error is a different claim
 * entirely. Same distinction as M16's feed retries, for the same reason.
 */
export function retryPlan(input: {
  outcome: PostingOutcome;
  attempts: number;
}): RetryPlan {
  if (input.outcome === 'posted') {
    return { retryable: false, message: 'Posted.' };
  }
  if (input.outcome === 'rejected') {
    return {
      retryable: false,
      message:
        'Your accounting package rejected this. Retrying the same entry gets the same answer — ' +
        'fix what it objected to (often a locked period or an archived account), then retry it here.',
    };
  }
  if (input.attempts >= MAX_POSTING_ATTEMPTS) {
    return {
      retryable: false,
      message: `Given up after ${MAX_POSTING_ATTEMPTS} attempts. Something is wrong beyond one ` +
        'request; retry by hand once it is fixed.',
    };
  }
  return { retryable: true, message: 'Will retry automatically.' };
}

/** Rule 8: an idempotency key on every external call. */
export const postingIdempotencyKey = (
  provider: AccountingProvider,
  posting: Pick<Posting, 'idempotencyKey'>,
): string => `${provider}:${posting.idempotencyKey}`;

/** Everything the batch owes, for the header of a sync screen. */
export const batchTotals = (
  postings: readonly Posting[],
  currency: 'GBP' | 'EUR' = 'GBP',
): { debit: Money; credit: Money; balanced: boolean } => {
  const debitTotal = sum(postings.map((p) => p.totalDebit), currency);
  const creditTotal = sum(postings.map((p) => p.totalCredit), currency);
  return {
    debit: debitTotal,
    credit: creditTotal,
    balanced: debitTotal.amount === creditTotal.amount,
  };
};
