/**
 * Invoice, payment and stock-book mutations.
 *
 * Out of the `'use server'` file for the reason recorded in `prep-move.ts`.
 *
 * The number allocation is the delicate part. Numbers come from a counter ROW
 * locked with `SELECT ... FOR UPDATE`, not from a Postgres SEQUENCE: a
 * sequence does not roll back, so a failed transaction burns a number and
 * leaves a gap in a VAT invoice series — the first thing an inspection asks
 * about. Locking the row serialises issue within a tenant, which is exactly
 * what "gapless" costs.
 */

import type { Tx } from './db';
import { toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import { vatRule, amlRule } from './rules';
import {
  money, zero, add, format,
  buildInvoice, issueInvoice, creditNoteFor, invoiceBalance,
  calculateVat, assessCashPayment, validateRefund, validateOverride,
  type Invoice, type InvoiceLine, type InvoiceSequence, type InvoiceStatus,
  type InvoiceKind, type VatScheme, type Money, type Currency,
  type PaymentMethod, type Payment, type AmlAssessment, type CashPayment,
} from '@forecourt/domain';

export interface InvoiceOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  /** Set when a cash payment is refused or is close to the threshold. */
  aml?: { outcome: string; reason: string; overridable: boolean };
  invoiceId?: string;
}

const currencyOf = (v: unknown): Currency => (v === 'EUR' ? 'EUR' : 'GBP');

/** A `SELECT *` row is `unknown` per column; the query builder wants a value
 *  it can bind. Narrowed rather than cast so a stray object becomes null
 *  instead of being stringified into a uuid column as "[object Object]". */
const id = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'card', 'bank_transfer', 'finance', 'part_exchange', 'cheque', 'other',
];
const isMethod = (v: string): v is PaymentMethod =>
  (PAYMENT_METHODS as readonly string[]).includes(v);

/**
 * Take the next number for a series, holding the counter row.
 *
 * `FOR UPDATE` on the counter, allocation by the domain, and the incremented
 * counter written back in the SAME transaction as the invoice. If anything
 * after this throws, the whole thing rolls back and the number is not
 * consumed — which is the entire reason this is a row rather than a sequence.
 */
async function takeNumber(
  tx: Tx,
  session: Session,
  series: string,
): Promise<InvoiceSequence> {
  await tx`
    INSERT INTO invoice_sequences (tenant_id, series, prefix)
    VALUES (${session.tenantId}::uuid, ${series}, '')
    ON CONFLICT (tenant_id, series) DO NOTHING`;

  const [row] = await tx<{ prefix: string; last_number: string }[]>`
    SELECT prefix, last_number FROM invoice_sequences
    WHERE tenant_id = ${session.tenantId}::uuid AND series = ${series}
    FOR UPDATE`;

  if (!row) throw new Error(`No invoice sequence for series "${series}".`);

  return {
    tenantId: session.tenantId,
    series,
    prefix: row.prefix,
    lastNumber: BigInt(row.last_number),
  };
}

async function saveSequence(tx: Tx, session: Session, seq: InvoiceSequence): Promise<void> {
  await tx`
    UPDATE invoice_sequences SET last_number = ${seq.lastNumber.toString()}, updated_at = now()
    WHERE tenant_id = ${session.tenantId}::uuid AND series = ${seq.series}`;
}

async function readInvoice(tx: Tx, id: string): Promise<
  { invoice: Invoice; row: Record<string, unknown>; payments: Payment[] } | null
> {
  const [row] = await tx`SELECT * FROM invoices WHERE id = ${id}::uuid`;
  if (!row) return null;

  const currency = currencyOf(row['currency']);
  const [lineRows, paymentRows] = await Promise.all([
    tx`SELECT * FROM invoice_lines WHERE invoice_id = ${id}::uuid ORDER BY position`,
    tx`SELECT * FROM payments WHERE invoice_id = ${id}::uuid`,
  ]);

  const lines: InvoiceLine[] = lineRows.map((l) => ({
    position: Number(l['position']),
    description: String(l['description']),
    quantity: Number(l['quantity']),
    unitPrice: money(toPence(l['unit_price_pence'] as string), currency),
    net: money(toPence(l['net_pence'] as string), currency),
    vatAmount: money(toPence(l['vat_amount_pence'] as string), currency),
    vatRateBps: Number(l['vat_rate_bps']),
    gross: money(toPence(l['gross_pence'] as string), currency),
  }));

  return {
    row: row as Record<string, unknown>,
    invoice: {
      kind: row['kind'] as InvoiceKind,
      status: row['status'] as InvoiceStatus,
      series: String(row['series']),
      number: row['number'] === null ? null : BigInt(row['number'] as string),
      reference: (row['reference'] as string | null) ?? null,
      vatScheme: (row['vat_scheme'] as VatScheme | null) ?? 'margin',
      buyerName: (row['buyer_name'] as string | null) ?? null,
      buyerAddress: (row['buyer_address'] as string | null) ?? null,
      lines,
      netTotal: money(toPence(row['net_total_pence'] as string), currency),
      vatTotal: money(toPence(row['vat_total_pence'] as string), currency),
      grossTotal: money(toPence(row['gross_total_pence'] as string), currency),
      vatCalculation: null,
      issuedAt: toDate(row['issued_at'] as Date | null),
    },
    payments: paymentRows.map((p) => ({
      amount: money(toPence(p['amount_pence'] as string), currencyOf(p['currency'])),
      method: p['method'] as PaymentMethod,
      direction: p['direction'] as 'in' | 'out',
      receivedAt: toDate(p['received_at'] as Date) as Date,
    })),
  };
}

async function writeLines(
  tx: Tx,
  session: Session,
  invoiceId: string,
  lines: readonly InvoiceLine[],
): Promise<void> {
  for (const l of lines) {
    await tx`
      INSERT INTO invoice_lines (tenant_id, invoice_id, position, description, quantity,
                                 unit_price_pence, net_pence, vat_amount_pence,
                                 vat_rate_bps, gross_pence)
      VALUES (${session.tenantId}::uuid, ${invoiceId}::uuid, ${l.position}, ${l.description},
              ${l.quantity}, ${l.unitPrice.amount.toString()}, ${l.net.amount.toString()},
              ${l.vatAmount.amount.toString()}, ${l.vatRateBps}, ${l.gross.amount.toString()})`;
  }
}

export interface DraftInput {
  dealId: string;
  vehicleId: string;
  contactId: string;
  buyerName: string;
  buyerAddress: string;
  vatScheme: string;
  lines: { description: string; unitPricePence: string; quantity?: number }[];
}

/**
 * Raise a draft invoice for a deal.
 *
 * The draft consumes NO number: a draft that never gets issued must not leave
 * a hole in the series. `buildInvoice` is what constructs the lines, so a
 * margin-scheme sale cannot carry VAT on any of them whatever this caller
 * passes — rule 6 is construction, not validation.
 */
export async function applyCreateDraft(
  tx: Tx,
  session: Session,
  input: DraftInput,
): Promise<InvoiceOutcome> {
  if (input.lines.length === 0) {
    return { ok: false, error: 'An invoice needs at least one line.' };
  }
  if (!input.buyerName.trim()) {
    return {
      ok: false,
      error: 'The buyer’s name has to be on the invoice — VAT Notice 718/1 requires it.',
    };
  }

  const [deal] = await tx`SELECT * FROM deals WHERE id = ${input.dealId}::uuid`;
  if (!deal) return { ok: false, error: 'That deal no longer exists.' };

  const [existing] = await tx`
    SELECT id FROM invoices WHERE id = ${deal['invoice_id']}::uuid`;
  if (existing) {
    return { ok: false, error: 'This deal already has an invoice. Credit it to raise another.' };
  }

  const rule = await vatRule(new Date());
  const scheme = input.vatScheme as VatScheme;

  // The purchase price, for the dealer's own margin VAT. Read here rather
  // than passed in, so a caller cannot influence the VAT the dealer owes.
  const [vehicle] = await tx`
    SELECT total_cost_pence FROM vehicles WHERE id = ${input.vehicleId}::uuid`;
  const purchasePrice = vehicle && vehicle['total_cost_pence'] !== null
    ? money(toPence(vehicle['total_cost_pence'] as string), 'GBP')
    : undefined;

  const invoice = buildInvoice({
    vatScheme: scheme,
    buyerName: input.buyerName.trim(),
    buyerAddress: input.buyerAddress.trim() || null,
    lines: input.lines.map((l) => ({
      description: l.description,
      unitPrice: money(BigInt(l.unitPricePence), 'GBP'),
      ...(l.quantity ? { quantity: l.quantity } : {}),
    })),
    vatRule: rule,
    ...(purchasePrice ? { purchasePrice } : {}),
  });

  const [created] = await tx<{ id: string }[]>`
    INSERT INTO invoices (tenant_id, site_id, kind, status, series,
                          contact_id, vehicle_id, buyer_name, buyer_address,
                          vat_scheme, net_total_pence, vat_total_pence,
                          gross_total_pence, created_by)
    VALUES (${session.tenantId}::uuid, ${deal['site_id']}, 'sale', 'draft', 'sale',
            ${input.contactId}::uuid, ${input.vehicleId}::uuid,
            ${invoice.buyerName}, ${invoice.buyerAddress},
            ${scheme}::vat_scheme,
            ${invoice.netTotal.amount.toString()},
            ${invoice.vatTotal.amount.toString()},
            ${invoice.grossTotal.amount.toString()},
            ${session.userId}::uuid)
    RETURNING id`;

  const invoiceId = created!.id;
  await writeLines(tx, session, invoiceId, invoice.lines);
  await tx`UPDATE deals SET invoice_id = ${invoiceId}::uuid WHERE id = ${input.dealId}::uuid`;

  await writeAudit({
    tx, session, resourceType: 'invoice', resourceId: invoiceId, action: 'drafted',
    after: { grossTotal: invoice.grossTotal.amount, vatScheme: scheme },
  });

  return { ok: true, message: 'Draft invoice created.', invoiceId };
}

/**
 * Issue a draft: allocate its number, freeze it, and complete the stock book.
 *
 * The stock-book sale side is written in the SAME transaction. A sale
 * invoiced without its stock book entry completed is precisely the state an
 * inspection finds and fines for, and leaving it to a later screen means it
 * happens when somebody remembers rather than when the sale happens.
 */
export async function applyIssue(
  tx: Tx,
  session: Session,
  invoiceId: string,
): Promise<InvoiceOutcome> {
  const loaded = await readInvoice(tx, invoiceId);
  if (!loaded) return { ok: false, error: 'That invoice no longer exists.' };
  if (loaded.invoice.status !== 'draft') {
    return { ok: false, error: `Invoice ${loaded.invoice.reference} has already been issued.` };
  }

  const at = new Date();
  const sequence = await takeNumber(tx, session, loaded.invoice.series);
  const issued = issueInvoice(loaded.invoice, sequence, at);

  await tx`
    UPDATE invoices SET status = 'issued', number = ${issued.invoice.number!.toString()},
      reference = ${issued.invoice.reference}, issued_at = ${at},
      due_at = ${at}
    WHERE id = ${invoiceId}::uuid`;
  await saveSequence(tx, session, issued.sequence);

  const vehicleId = loaded.row['vehicle_id'];
  if (vehicleId !== null && loaded.invoice.vatScheme === 'margin') {
    await completeStockBookSale(tx, session, {
      vehicleId: String(vehicleId),
      saleDate: at,
      saleInvoiceNumber: issued.invoice.reference!,
      buyerName: issued.invoice.buyerName,
      buyerAddress: issued.invoice.buyerAddress,
      sellingPrice: issued.invoice.grossTotal,
    });
  }

  await writeAudit({
    tx, session, resourceType: 'invoice', resourceId: invoiceId, action: 'issued',
    before: { status: 'draft', number: null },
    after: { status: 'issued', number: issued.invoice.number?.toString() },
  });

  return { ok: true, message: `Issued as ${issued.invoice.reference}.`, invoiceId };
}

/**
 * Complete the sale side of the stock book — fields 8 to 12.
 *
 * The margin and the VAT are computed from the rule in force on the SALE
 * date, and the rule VERSION is stored on the entry so a historic figure can
 * be re-derived exactly after the rate changes. Nothing is edited: if the
 * entry already has a sale recorded, an adjusting entry is the only lawful
 * route and this refuses rather than overwriting.
 */
async function completeStockBookSale(
  tx: Tx,
  session: Session,
  input: {
    vehicleId: string;
    saleDate: Date;
    saleInvoiceNumber: string;
    buyerName: string | null;
    buyerAddress: string | null;
    sellingPrice: Money;
  },
): Promise<void> {
  const [entry] = await tx`
    SELECT * FROM stock_book_entries
    WHERE vehicle_id = ${input.vehicleId}::uuid AND corrects_entry_id IS NULL
    ORDER BY entry_number LIMIT 1`;
  if (!entry || entry['sale_date'] !== null) return;

  const purchasePence = entry['purchase_price_pence'] === null
    ? 0n : toPence(entry['purchase_price_pence'] as string);
  const rule = await vatRule(input.saleDate);

  const calc = calculateVat('margin', {
    purchasePrice: money(purchasePence, 'GBP'),
    sellingPrice: input.sellingPrice,
  }, rule);
  if (calc.scheme !== 'margin') return;

  await tx`
    UPDATE stock_book_entries SET
      sale_date = ${input.saleDate},
      sale_invoice_number = ${input.saleInvoiceNumber},
      buyer_name = ${input.buyerName},
      buyer_address = ${input.buyerAddress},
      selling_price_pence = ${input.sellingPrice.amount.toString()},
      -- A negative margin yields NO VAT and is never offset against another
      -- vehicle. The column refuses a negative, so a loss is recorded as zero
      -- margin and zero VAT, which is the correct liability.
      margin_pence = ${(calc.margin.amount < 0n ? 0n : calc.margin.amount).toString()},
      vat_due_pence = ${calc.vatDue.amount.toString()},
      vat_rule_version = ${rule.version}
    WHERE id = ${entry['id']}`;

  await writeAudit({
    tx, session, resourceType: 'stock_book_entry', resourceId: String(entry['id']),
    action: 'sale_recorded',
    after: {
      saleInvoiceNumber: input.saleInvoiceNumber,
      sellingPrice: input.sellingPrice.amount,
      vatDue: calc.vatDue.amount,
      vatRuleVersion: rule.version,
    },
  });
}

/**
 * Cancel an issued invoice by raising a credit note.
 *
 * Never a deleted row, never a released number. The credit note is its own
 * document with its own number carrying reversed amounts, so the series stays
 * gapless and the trail shows what happened rather than what is missing.
 */
export async function applyCreditNote(
  tx: Tx,
  session: Session,
  invoiceId: string,
  reason: string,
): Promise<InvoiceOutcome> {
  const loaded = await readInvoice(tx, invoiceId);
  if (!loaded) return { ok: false, error: 'That invoice no longer exists.' };
  if (loaded.invoice.status === 'draft') {
    return { ok: false, error: 'A draft has no number to credit — discard it instead.' };
  }
  if (loaded.row['credited_by_id'] !== null) {
    return { ok: false, error: 'This invoice has already been credited.' };
  }
  if (!reason.trim()) {
    return { ok: false, error: 'Say why the invoice is being cancelled. It goes on the credit note.' };
  }

  const at = new Date();
  const sequence = await takeNumber(tx, session, loaded.invoice.series);
  const credit = creditNoteFor(loaded.invoice, sequence, reason.trim(), at);

  const [created] = await tx<{ id: string }[]>`
    INSERT INTO invoices (tenant_id, site_id, kind, status, series, number, reference,
                          contact_id, vehicle_id, buyer_name, buyer_address, vat_scheme,
                          net_total_pence, vat_total_pence, gross_total_pence,
                          issued_at, credits_id, notes, created_by)
    VALUES (${session.tenantId}::uuid, ${id(loaded.row['site_id'])}, 'credit_note', 'issued',
            ${credit.invoice.series}, ${credit.invoice.number!.toString()},
            ${credit.invoice.reference},
            ${id(loaded.row['contact_id'])}, ${id(loaded.row['vehicle_id'])},
            ${credit.invoice.buyerName}, ${credit.invoice.buyerAddress},
            ${id(loaded.row['vat_scheme'])}::vat_scheme,
            ${credit.invoice.netTotal.amount.toString()},
            ${credit.invoice.vatTotal.amount.toString()},
            ${credit.invoice.grossTotal.amount.toString()},
            ${at}, ${invoiceId}::uuid, ${reason.trim()}, ${session.userId}::uuid)
    RETURNING id`;

  const creditId = created!.id;
  await writeLines(tx, session, creditId, credit.invoice.lines);
  await saveSequence(tx, session, credit.sequence);

  // The original is content-frozen, but these two pointers are the lawful
  // update: they are how the pair stays findable from either side.
  await tx`
    UPDATE invoices SET status = 'cancelled', credited_by_id = ${creditId}::uuid
    WHERE id = ${invoiceId}::uuid`;

  await writeAudit({
    tx, session, resourceType: 'invoice', resourceId: invoiceId, action: 'credited',
    before: { status: loaded.invoice.status },
    after: { status: 'cancelled', creditNote: credit.invoice.reference, reason: reason.trim() },
  });

  return { ok: true, message: `Credited by ${credit.invoice.reference}.`, invoiceId: creditId };
}

export interface PaymentInput {
  invoiceId: string;
  amountPence: string;
  method: string;
  direction: string;
  reason: string;
  reference: string;
  /** A named authoriser and a reason, when overriding an AML block. */
  overrideReason: string;
  overrideAuthorisedBy: string;
}

/**
 * Record a payment or a refund.
 *
 * Cash is assessed against the High Value Dealer threshold in force on the
 * day it was RECEIVED, counting linked payments together — splitting £12,000
 * into two £6,000 cash payments is the classic evasion and the regulation
 * counts them as one. An unregistered dealer is BLOCKED rather than warned:
 * taking the cash is an offence and registration cannot be backdated.
 *
 * The block is overridable, with a named authoriser and a reason, and the
 * override is append-only evidence. A block that cannot be overridden gets
 * worked around outside the system, where nothing is recorded at all.
 */
export async function applyPayment(
  tx: Tx,
  session: Session,
  input: PaymentInput,
): Promise<InvoiceOutcome> {
  const loaded = await readInvoice(tx, input.invoiceId);
  if (!loaded) return { ok: false, error: 'That invoice no longer exists.' };
  if (loaded.invoice.status === 'draft') {
    return { ok: false, error: 'Issue the invoice before recording a payment against it.' };
  }

  if (!isMethod(input.method)) {
    return { ok: false, error: 'Choose how the money was taken.' };
  }
  const direction = input.direction === 'out' ? 'out' : 'in';

  let amount: Money;
  try {
    amount = money(BigInt(input.amountPence), loaded.invoice.grossTotal.currency);
  } catch {
    return { ok: false, error: 'Enter an amount in pounds and pence, for example 250.00.' };
  }
  if (amount.amount <= 0n) {
    return { ok: false, error: 'A payment has to be a positive amount.' };
  }

  if (direction === 'out') {
    if (!input.reason.trim()) {
      return { ok: false, error: 'A refund has to say why. An unexplained outbound payment is a finding.' };
    }
    const check = validateRefund(amount, loaded.payments);
    if (!check.ok) return { ok: false, error: check.error ?? 'That refund is not valid.' };
  }

  const at = new Date();
  const contactId = id(loaded.row['contact_id']);
  let assessment: AmlAssessment | null = null;

  if (input.method === 'cash' && direction === 'in') {
    const rule = await amlRule(at);

    // `tenants.hvd_registered` — a real column, not a settings key. The first
    // draft of this read `settings->>'hmrc_hvd_registered'`, which is absent
    // on every tenant and so coalesced to false. That fails SAFE (an
    // unregistered dealer is blocked) but it is still wrong: a registered
    // dealer would have been blocked from lawful business and told to go and
    // register, which they already had.
    const [tenant] = await tx<{ hvd: boolean }[]>`
      SELECT hvd_registered AS hvd FROM tenants WHERE id = ${session.tenantId}::uuid`;

    // Prior cash against this customer, whatever invoice it landed on — the
    // threshold is per customer, not per document.
    const prior = await tx`
      SELECT amount_pence, currency, received_at, contact_id, linked_group_id
      FROM payments
      WHERE method = 'cash' AND direction = 'in' AND contact_id = ${contactId}`;

    const payment: CashPayment = { amount, receivedAt: at, contactId };
    assessment = assessCashPayment(
      payment,
      (prior as Record<string, unknown>[]).map((p) => ({
        amount: money(toPence(p['amount_pence'] as string), currencyOf(p['currency'])),
        receivedAt: toDate(p['received_at'] as Date) as Date,
        contactId: p['contact_id'] === null ? null : String(p['contact_id']),
        linkedGroupId: p['linked_group_id'] === null ? null : String(p['linked_group_id']),
      })),
      rule,
      { isRegisteredHvd: tenant?.hvd ?? false },
    );

    if (!assessment.accept) {
      // No override attempted: report the THRESHOLD refusal, not a complaint
      // about the override fields. Answering "an override must name the person
      // authorising it" to somebody who never asked to override tells them
      // nothing about why the payment was refused, and quietly advertises the
      // override to somebody who had not thought of it.
      if (!input.overrideReason.trim() && !input.overrideAuthorisedBy.trim()) {
        return {
          ok: false,
          error: assessment.reason,
          aml: {
            outcome: assessment.outcome,
            reason: assessment.reason,
            overridable: assessment.overridable,
          },
        };
      }

      // `authorised_by` is a USER id, not a typed-in name: "authorised by the
      // manager" is not an authorisation, and a foreign key is what makes the
      // override answerable to a person.
      const authoriser = input.overrideAuthorisedBy.trim();
      const [member] = authoriser
        ? await tx`SELECT 1 FROM tenant_memberships
                   WHERE user_id = ${authoriser}::uuid AND status = 'active'`
        : [null];

      const check = validateOverride(assessment, {
        reason: input.overrideReason.trim(),
        authorisedBy: member ? authoriser : null,
      });

      if (!check.ok) {
        return {
          ok: false,
          error: check.error ?? assessment.reason,
          aml: {
            outcome: assessment.outcome,
            reason: assessment.reason,
            overridable: assessment.overridable,
          },
        };
      }

      await tx`
        INSERT INTO aml_overrides (tenant_id, contact_id, reason, authorised_by,
                                   running_total_pence, threshold_pence)
        VALUES (${session.tenantId}::uuid, ${contactId},
                ${input.overrideReason.trim()}, ${authoriser}::uuid,
                ${assessment.runningTotal.amount.toString()},
                ${assessment.threshold.amount.toString()})`;
    }
  }

  const [created] = await tx<{ id: string }[]>`
    INSERT INTO payments (tenant_id, site_id, invoice_id, contact_id, vehicle_id,
                          direction, method, amount_pence, currency,
                          reason, reference, received_at, created_by)
    VALUES (${session.tenantId}::uuid, ${id(loaded.row['site_id'])}, ${input.invoiceId}::uuid,
            ${contactId}, ${id(loaded.row['vehicle_id'])},
            ${direction}::payment_direction, ${input.method}::payment_method,
            ${amount.amount.toString()}, ${amount.currency},
            ${input.reason.trim() || null}, ${input.reference.trim() || null},
            ${at}, ${session.userId}::uuid)
    RETURNING id`;

  // The status follows from what has been paid, recomputed rather than
  // incremented — an increment drifts the first time a refund is recorded.
  const after = await readInvoice(tx, input.invoiceId);
  const balance = invoiceBalance(after!.invoice, after!.payments);
  if (after!.invoice.status !== 'cancelled') {
    await tx`
      UPDATE invoices SET status = ${balance.status}::invoice_status
      WHERE id = ${input.invoiceId}::uuid`;
  }

  await writeAudit({
    tx, session, resourceType: 'payment', resourceId: created?.id ?? null,
    action: direction === 'in' ? 'received' : 'refunded',
    after: {
      amount: amount.amount, method: input.method,
      ...(assessment ? { amlOutcome: assessment.outcome } : {}),
    },
  });

  return {
    ok: true,
    message: direction === 'in'
      ? `${format(amount)} recorded. ${format(balance.outstanding)} outstanding.`
      : `${format(amount)} refunded.`,
    ...(assessment && assessment.outcome !== 'ok'
      ? { aml: { outcome: assessment.outcome, reason: assessment.reason, overridable: assessment.overridable } }
      : {}),
  };
}

export { zero, add };
