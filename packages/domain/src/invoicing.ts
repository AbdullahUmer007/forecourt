/**
 * M11 — invoicing: gapless numbering, scheme-driven VAT presentation, and
 * credit notes.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED VAT SPECIALIST'S SIGN-OFF.
 *
 * The rule that costs real money (`forecourt-domain` §3): a margin-scheme
 * invoice must NOT show VAT separately. Showing it makes the whole sale
 * standard-rated — on a £12,000 car that is £2,000 of VAT the dealer never
 * collected and now owes. `buildInvoice` cannot produce a margin invoice with
 * a VAT line, `assertInvoiceVatPresentation` refuses one, a CHECK constraint
 * refuses the row, and a golden-file test asserts the rendered document. Four
 * layers, because one of them will eventually be edited by someone who does
 * not know why it is there.
 *
 * The second rule is quieter and just as awkward in an inspection: invoice
 * numbers are GAPLESS. A missing number is a question about the invoice that
 * is not there, and "a transaction rolled back" is not an answer anyone wants
 * to give an HMRC officer.
 */

import {
  type Money, money, add, subtract, sum, zero, isNegative, format,
} from './money.js';
import {
  calculateVat, assertInvoiceVatPresentation,
  type VatScheme, type VatRule, type VatCalculation,
} from './vat.js';

// ------------------------------------------------------------- numbering

export interface InvoiceSequence {
  tenantId: string;
  series: string;
  prefix: string;
  lastNumber: bigint;
}

export interface AllocatedNumber {
  number: bigint;
  reference: string;
  /** The sequence as it must be persisted, in the SAME transaction. */
  sequence: InvoiceSequence;
}

/**
 * Allocate the next invoice number.
 *
 * Pure, so the allocation rule is testable. The caller must hold a row lock on
 * the sequence and persist both the invoice and the updated counter in ONE
 * transaction — that is what makes it gapless.
 *
 * A Postgres SEQUENCE would be the obvious choice and is the wrong one:
 * sequences deliberately do not roll back, so an aborted transaction burns a
 * number and leaves exactly the gap this function exists to prevent.
 */
export function allocateNumber(seq: InvoiceSequence, width = 6): AllocatedNumber {
  const number = seq.lastNumber + 1n;
  const padded = number.toString().padStart(width, '0');
  return {
    number,
    reference: `${seq.prefix}${padded}`,
    sequence: { ...seq, lastNumber: number },
  };
}

/**
 * Find gaps in an issued-number series.
 *
 * Runs as a health check rather than only in tests: if a gap ever appears in
 * production the dealer needs to know before HMRC does, and needs to know
 * which number is missing so they can explain it.
 */
export function findNumberGaps(issued: readonly bigint[]): bigint[] {
  if (issued.length === 0) return [];
  const sorted = [...issued].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const gaps: bigint[] = [];
  for (let n = sorted[0]!; n <= sorted[sorted.length - 1]!; n++) {
    if (!sorted.includes(n)) gaps.push(n);
  }
  return gaps;
}

// -------------------------------------------------------------- invoices

export type InvoiceKind = 'sale' | 'credit_note' | 'proforma' | 'deposit';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'part_paid' | 'cancelled';

export interface InvoiceLineInput {
  description: string;
  quantity?: number;
  unitPrice: Money;
  /**
   * The VAT rate for THIS line, in basis points. Ignored entirely on a
   * margin-scheme invoice — see `buildInvoice`.
   */
  vatRateBps?: number;
}

export interface InvoiceLine {
  position: number;
  description: string;
  quantity: number;
  unitPrice: Money;
  net: Money;
  vatAmount: Money;
  vatRateBps: number;
  gross: Money;
}

export interface Invoice {
  kind: InvoiceKind;
  status: InvoiceStatus;
  series: string;
  number: bigint | null;
  reference: string | null;
  vatScheme: VatScheme;
  buyerName: string | null;
  buyerAddress: string | null;
  lines: readonly InvoiceLine[];
  netTotal: Money;
  vatTotal: Money;
  grossTotal: Money;
  /** The margin-scheme calculation, where one applies. Never rendered as a line. */
  vatCalculation: VatCalculation | null;
  issuedAt: Date | null;
}

export interface BuildInvoiceInput {
  kind?: InvoiceKind;
  vatScheme: VatScheme;
  lines: readonly InvoiceLineInput[];
  buyerName?: string | null;
  buyerAddress?: string | null;
  series?: string;
  /** Required for a margin-scheme sale: the VAT is on the margin, not the price. */
  purchasePrice?: Money;
  /** The rule effective on the SALE date, resolved from `compliance_rules`. */
  vatRule: VatRule;
}

/**
 * Build an invoice.
 *
 * On a margin-scheme sale every line carries ZERO VAT, whatever the caller
 * passed. That is not a validation that rejects bad input — it is a
 * construction that cannot produce it, which is a stronger guarantee: the
 * dealer's VAT liability is computed separately on the margin and never
 * appears on the document the buyer receives.
 */
export function buildInvoice(input: BuildInvoiceInput): Invoice {
  const isMargin = input.vatScheme === 'margin';
  const currency = input.lines[0]?.unitPrice.currency ?? 'GBP';

  const lines: InvoiceLine[] = input.lines.map((l, i) => {
    const quantity = l.quantity ?? 1;
    const net = money(l.unitPrice.amount * BigInt(quantity), l.unitPrice.currency);

    // The margin-scheme rule, as construction rather than validation.
    const vatRateBps = isMargin ? 0 : (l.vatRateBps ?? input.vatRule.standardRateBps);
    const vatAmount = isMargin
      ? zero(net.currency)
      : money((net.amount * BigInt(vatRateBps) + 5000n) / 10000n, net.currency);

    return {
      position: i + 1,
      description: l.description,
      quantity,
      unitPrice: l.unitPrice,
      net,
      vatAmount,
      vatRateBps,
      gross: add(net, vatAmount),
    };
  });

  const netTotal = sum(lines.map((l) => l.net), currency);
  const vatTotal = sum(lines.map((l) => l.vatAmount), currency);
  const grossTotal = add(netTotal, vatTotal);

  // The dealer's own VAT position on a margin sale, computed from the margin
  // and deliberately NOT part of the document totals.
  const vatCalculation = isMargin && input.purchasePrice
    ? calculateVat('margin',
        { purchasePrice: input.purchasePrice, sellingPrice: grossTotal },
        input.vatRule)
    : null;

  const invoice: Invoice = {
    kind: input.kind ?? 'sale',
    status: 'draft',
    series: input.series ?? 'sale',
    number: null,
    reference: null,
    vatScheme: input.vatScheme,
    buyerName: input.buyerName ?? null,
    buyerAddress: input.buyerAddress ?? null,
    lines,
    netTotal,
    vatTotal,
    grossTotal,
    vatCalculation,
    issuedAt: null,
  };

  // Belt and braces: the construction above cannot produce a VAT line on a
  // margin invoice, and this asserts it anyway. If someone later "optimises"
  // the branch away, this throws rather than shipping a standard-rated sale.
  if (vatCalculation) assertInvoiceVatPresentation(vatCalculation, lines);

  return invoice;
}

export interface IssueResult {
  invoice: Invoice;
  sequence: InvoiceSequence;
}

/**
 * Issue a draft: allocate its number and freeze it.
 *
 * The returned sequence MUST be persisted in the same transaction as the
 * invoice. Returning it rather than mutating makes that impossible to forget
 * silently — the caller has a value it has to do something with.
 */
export function issueInvoice(
  invoice: Invoice,
  sequence: InvoiceSequence,
  issuedAt: Date,
): IssueResult {
  if (invoice.status !== 'draft') {
    throw new Error(`Invoice ${invoice.reference ?? '(draft)'} has already been issued.`);
  }
  if (invoice.lines.length === 0) {
    throw new Error('An invoice needs at least one line before it can be issued.');
  }
  const allocated = allocateNumber(sequence);
  return {
    invoice: {
      ...invoice,
      status: 'issued',
      number: allocated.number,
      reference: allocated.reference,
      issuedAt,
    },
    sequence: allocated.sequence,
  };
}

/**
 * Cancel an issued invoice by raising a credit note.
 *
 * Never a deleted row and never a released number. The credit note is a new
 * document with its own number, carrying the reversed amounts, so the series
 * stays gapless and the audit trail shows what happened rather than what is
 * missing.
 */
export function creditNoteFor(
  original: Invoice,
  sequence: InvoiceSequence,
  reason: string,
  issuedAt: Date,
): IssueResult {
  if (original.status === 'draft') {
    throw new Error('A draft invoice has no number to credit — discard it instead.');
  }
  if (!reason.trim()) {
    throw new Error('A credit note must say why the invoice was cancelled.');
  }

  const reversed = original.lines.map((l) => ({
    ...l,
    unitPrice: money(-l.unitPrice.amount, l.unitPrice.currency),
    net: money(-l.net.amount, l.net.currency),
    vatAmount: money(-l.vatAmount.amount, l.vatAmount.currency),
    gross: money(-l.gross.amount, l.gross.currency),
  }));

  const allocated = allocateNumber(sequence);
  return {
    invoice: {
      ...original,
      kind: 'credit_note',
      status: 'issued',
      number: allocated.number,
      reference: allocated.reference,
      lines: reversed,
      netTotal: money(-original.netTotal.amount, original.netTotal.currency),
      vatTotal: money(-original.vatTotal.amount, original.vatTotal.currency),
      grossTotal: money(-original.grossTotal.amount, original.grossTotal.currency),
      issuedAt,
    },
    sequence: allocated.sequence,
  };
}

// -------------------------------------------------------------- payments

export type PaymentMethod =
  | 'cash' | 'card' | 'bank_transfer' | 'finance' | 'part_exchange' | 'cheque' | 'other';

export interface Payment {
  method: PaymentMethod;
  amount: Money;
  direction: 'in' | 'out';
  receivedAt: Date;
  linkedGroupId?: string | null;
}

export interface Balance {
  invoiced: Money;
  paid: Money;
  outstanding: Money;
  status: InvoiceStatus;
}

/** What is still owed, and the status that follows from it. */
export function invoiceBalance(invoice: Invoice, payments: readonly Payment[]): Balance {
  const currency = invoice.grossTotal.currency;
  const paid = payments.reduce(
    (acc, p) => (p.direction === 'in' ? add(acc, p.amount) : subtract(acc, p.amount)),
    zero(currency),
  );
  const outstanding = subtract(invoice.grossTotal, paid);

  const status: InvoiceStatus =
    invoice.status === 'cancelled' ? 'cancelled'
    : outstanding.amount <= 0n ? 'paid'
    : paid.amount > 0n ? 'part_paid'
    : invoice.status;

  return { invoiced: invoice.grossTotal, paid, outstanding, status };
}

/**
 * A refund cannot exceed what was actually taken.
 *
 * Refunding more than was received is either a mistake or a fraud, and both
 * are worth stopping at the boundary rather than discovering in a bank
 * reconciliation weeks later.
 */
export function validateRefund(
  refund: Money,
  payments: readonly Payment[],
): { ok: boolean; error: string | null } {
  if (isNegative(refund) || refund.amount === 0n) {
    return { ok: false, error: 'A refund must be a positive amount.' };
  }
  const currency = refund.currency;
  const received = payments.filter((p) => p.direction === 'in')
    .reduce((a, p) => add(a, p.amount), zero(currency));
  const alreadyRefunded = payments.filter((p) => p.direction === 'out')
    .reduce((a, p) => add(a, p.amount), zero(currency));
  const refundable = subtract(received, alreadyRefunded);

  if (refund.amount > refundable.amount) {
    return {
      ok: false,
      error: `Cannot refund ${format(refund)} — only ${format(refundable)} was taken and not yet refunded.`,
    };
  }
  return { ok: true, error: null };
}
