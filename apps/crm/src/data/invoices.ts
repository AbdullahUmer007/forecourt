/**
 * Invoices, payments and the VAT margin stock book.
 *
 * The two rules this file exists to keep:
 *
 * **Rule 6.** A margin-scheme invoice never shows VAT separately. That is
 * enforced four times over — by `buildInvoice`, which cannot construct a
 * VAT-bearing margin line; by `renderInvoice`, which refuses to print one; by
 * a CHECK constraint on `invoices`; and by the golden-file test that now
 * points at the product's own renderer rather than a copy of it. Nothing here
 * re-implements any of that.
 *
 * **Rule 4.** Invoices are content-frozen on issue and the stock book is
 * append-only. A cancellation raises a credit note with its own number; a
 * correction appends an adjusting entry that references what it corrects.
 * Nothing is ever edited or deleted, and no number is ever released — a gap in
 * a VAT invoice series is the first thing an inspection asks about.
 */

import { withSession, toDate, toPence } from './db';
import { vatRule } from './rules';
import type { Session } from '@/auth/session';
import {
  money, zero, add, subtract, format,
  buildInvoice, invoiceBalance, calculateVat, missingStockBookFields,
  renderInvoice, MARGIN_SCHEME_NOTICE,
  type Invoice, type InvoiceLine, type InvoiceStatus, type InvoiceKind,
  type Money, type VatScheme, type Balance, type Payment, type PaymentMethod,
  type StockBookField, type Currency, type MarginCalculation,
} from '@forecourt/domain';

const currencyOf = (v: unknown): Currency => {
  if (v === 'GBP' || v === 'EUR') return v;
  throw new Error(`Invoice carries an unsupported currency ${JSON.stringify(v)}.`);
};

export interface InvoiceRow {
  id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  reference: string | null;
  number: bigint | null;
  vatScheme: VatScheme | null;
  buyerName: string | null;
  registration: string | null;
  grossTotal: Money;
  /** Computed from payments, never read from a column. */
  balance: Balance;
  issuedAt: Date | null;
  dueAt: Date | null;
  creditedById: string | null;
  creditsId: string | null;
}

export interface InvoiceFilters {
  q?: string | undefined;
  status?: string | undefined;
  /** Issued, unpaid and past its due date. */
  overdueOnly?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface InvoicesPage {
  rows: InvoiceRow[];
  total: number;
  summary: {
    byStatus: Record<string, number>;
    outstanding: Money;
    overdue: Money;
    /** Gaps in the issued number series, as RANGES. Should always be empty; if
     *  it is not, that is the finding, not a rendering detail. */
    numberGaps: string[];
    /** How many numbers are missing in total. A single stray high number
     *  produces one range and thousands of missing numbers, and the second
     *  figure is the one that says how bad it is. */
    missingNumberCount: number;
  };
  queryMs: number;
}

const linesFrom = (rows: readonly Record<string, unknown>[], currency: Currency): InvoiceLine[] =>
  rows.map((l) => ({
    position: Number(l['position']),
    description: String(l['description']),
    quantity: Number(l['quantity']),
    unitPrice: money(toPence(l['unit_price_pence'] as string), currency),
    net: money(toPence(l['net_pence'] as string), currency),
    vatAmount: money(toPence(l['vat_amount_pence'] as string), currency),
    vatRateBps: Number(l['vat_rate_bps']),
    gross: money(toPence(l['gross_pence'] as string), currency),
  }));

const paymentsFrom = (rows: readonly Record<string, unknown>[]): Payment[] =>
  rows.map((p) => ({
    amount: money(toPence(p['amount_pence'] as string), currencyOf(p['currency'] ?? 'GBP')),
    method: p['method'] as PaymentMethod,
    direction: p['direction'] as 'in' | 'out',
    receivedAt: toDate(p['received_at'] as Date) as Date,
  }));

const invoiceFrom = (
  r: Record<string, unknown>,
  lines: readonly InvoiceLine[],
  vatCalculation: MarginCalculation | null = null,
): Invoice => {
  const currency = currencyOf(r['currency'] ?? 'GBP');
  return {
    kind: r['kind'] as InvoiceKind,
    status: r['status'] as InvoiceStatus,
    series: String(r['series']),
    number: r['number'] === null ? null : BigInt(r['number'] as string),
    reference: (r['reference'] as string | null) ?? null,
    vatScheme: (r['vat_scheme'] as VatScheme | null) ?? 'margin',
    buyerName: (r['buyer_name'] as string | null) ?? null,
    buyerAddress: (r['buyer_address'] as string | null) ?? null,
    lines,
    netTotal: money(toPence(r['net_total_pence'] as string), currency),
    vatTotal: money(toPence(r['vat_total_pence'] as string), currency),
    grossTotal: money(toPence(r['gross_total_pence'] as string), currency),
    vatCalculation,
    issuedAt: toDate(r['issued_at'] as Date | null),
  };
};

export async function loadInvoices(
  session: Session,
  filters: InvoiceFilters,
): Promise<InvoicesPage> {
  const started = Date.now();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const page = await withSession(session, async (tx) => {
    const wStatus = filters.status ? tx`AND i.status = ${filters.status}::invoice_status` : tx``;
    const wOverdue = filters.overdueOnly
      ? tx`AND i.status IN ('issued','part_paid') AND i.due_at IS NOT NULL AND i.due_at < now()`
      : tx``;
    const wSearch = filters.q
      ? tx`AND (
          i.reference ILIKE ${'%' + filters.q + '%'}
          OR i.buyer_name ILIKE ${'%' + filters.q + '%'}
          OR v.registration ILIKE ${'%' + filters.q.replace(/\s+/g, '') + '%'}
        )`
      : tx``;

    const rows = await tx`
      SELECT i.*, v.registration
      FROM invoices i
      LEFT JOIN vehicles v ON v.id = i.vehicle_id
      WHERE TRUE ${wStatus} ${wOverdue} ${wSearch}
      ORDER BY i.issued_at DESC NULLS FIRST, i.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const [counted] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM invoices i
      LEFT JOIN vehicles v ON v.id = i.vehicle_id
      WHERE TRUE ${wStatus} ${wOverdue} ${wSearch}`;

    const ids = rows.map((r) => String(r['id']));
    const payments = ids.length === 0 ? [] : await tx`
      SELECT * FROM payments WHERE invoice_id = ANY(${ids}::uuid[])`;

    const statuses = await tx<{ status: string; n: number }[]>`
      SELECT status::text AS status, count(*)::int AS n FROM invoices GROUP BY status`;

    // Outstanding is invoiced minus received, computed in SQL over ALL
    // invoices rather than the page — it is a book figure, not a page figure.
    const [totals] = await tx<{ outstanding: string | null; overdue: string | null }[]>`
      SELECT
        sum(i.gross_total_pence - coalesce(p.paid, 0))
          FILTER (WHERE i.status IN ('issued','part_paid')) AS outstanding,
        sum(i.gross_total_pence - coalesce(p.paid, 0))
          FILTER (WHERE i.status IN ('issued','part_paid')
                  AND i.due_at IS NOT NULL AND i.due_at < now()) AS overdue
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id,
               sum(CASE WHEN direction = 'in' THEN amount_pence ELSE -amount_pence END) AS paid
        FROM payments WHERE invoice_id IS NOT NULL GROUP BY invoice_id
      ) p ON p.invoice_id = i.id`;

    // Every issued number in every series, to look for gaps.
    const issued = await tx<{ series: string; number: string }[]>`
      SELECT series, number::text FROM invoices
      WHERE number IS NOT NULL ORDER BY series, number`;

    return { rows, counted, payments, statuses, totals, issued };
  });

  const paymentsByInvoice = new Map<string, Record<string, unknown>[]>();
  for (const p of page.payments as Record<string, unknown>[]) {
    const key = String(p['invoice_id']);
    const list = paymentsByInvoice.get(key);
    if (list) list.push(p); else paymentsByInvoice.set(key, [p]);
  }

  const rows: InvoiceRow[] = (page.rows as Record<string, unknown>[]).map((r) => {
    const id = String(r['id']);
    const invoice = invoiceFrom(r, []);
    const balance = invoiceBalance(
      invoice, paymentsFrom(paymentsByInvoice.get(id) ?? []));

    return {
      id,
      kind: invoice.kind,
      // The STATUS a dealer should see is derived from what has been paid, not
      // the stored column — a column drifts the moment a payment is recorded
      // by a job rather than by this screen.
      status: balance.status,
      reference: invoice.reference,
      number: invoice.number,
      vatScheme: (r['vat_scheme'] as VatScheme | null) ?? null,
      buyerName: invoice.buyerName,
      registration: (r['registration'] as string | null) ?? null,
      grossTotal: invoice.grossTotal,
      balance,
      issuedAt: invoice.issuedAt,
      dueAt: toDate(r['due_at'] as Date | null),
      creditedById: r['credited_by_id'] === null ? null : String(r['credited_by_id']),
      creditsId: r['credits_id'] === null ? null : String(r['credits_id']),
    };
  });

  const byStatus: Record<string, number> = {};
  for (const s of page.statuses) byStatus[s.status] = s.n;

  // Gaps, per series. A missing number in a VAT invoice series is the first
  // thing an inspection asks about, so it is surfaced rather than computed on
  // request — the whole point of a gapless counter is being able to say so.
  const bySeries = new Map<string, bigint[]>();
  for (const row of page.issued) {
    const list = bySeries.get(row.series) ?? [];
    list.push(BigInt(row.number));
    bySeries.set(row.series, list);
  }
  // Reported as RANGES, not as individual numbers. One stray high number —
  // a bad import, a test fixture, a fat finger — leaves thousands of missing
  // numbers, and a screen that lists all of them is unreadable and a loop
  // that enumerates them is a memory problem. "sale 2–9000 (8,999 missing)"
  // says the same thing and can actually be acted on.
  const numberGaps: string[] = [];
  let missingNumberCount = 0;
  for (const [series, numbers] of bySeries) {
    for (let i = 1; i < numbers.length; i += 1) {
      const previous = numbers[i - 1]!;
      const current = numbers[i]!;
      if (current <= previous + 1n) continue;
      const from = previous + 1n;
      const to = current - 1n;
      missingNumberCount += Number(to - from + 1n);
      numberGaps.push(from === to ? `${series} ${from}` : `${series} ${from}–${to}`);
    }
  }

  return {
    rows,
    total: page.counted?.n ?? 0,
    summary: {
      byStatus,
      outstanding: money(BigInt(page.totals?.outstanding ?? '0'), 'GBP'),
      overdue: money(BigInt(page.totals?.overdue ?? '0'), 'GBP'),
      numberGaps,
      missingNumberCount,
    },
    queryMs: Date.now() - started,
  };
}

// ------------------------------------------------------------- one invoice

export interface InvoiceDetail {
  id: string;
  invoice: Invoice;
  balance: Balance;
  payments: {
    id: string; amount: Money; method: PaymentMethod;
    direction: 'in' | 'out'; receivedAt: Date; reason: string | null; reference: string | null;
  }[];
  registration: string | null;
  vehicleDescription: string | null;
  vin: string | null;
  sellerName: string;
  sellerAddress: string;
  sellerVatNumber: string | null;
  stockBookNumber: string | null;
  /** The rendered document, through the product's ONE renderer. */
  document: string;
  /** The dealer's own margin VAT. Cost data — withheld without the permission,
   *  because purchase price is directly recoverable from margin and price. */
  marginVat: { margin: Money; vatDue: Money; sourceUrl: string } | null;
  creditsReference: string | null;
  creditedByReference: string | null;
  notes: string | null;
}

export async function loadInvoice(
  session: Session,
  id: string,
  canSeeCost: boolean,
): Promise<InvoiceDetail | null> {
  const loaded = await withSession(session, async (tx) => {
    const [row] = await tx`
      SELECT i.*,
             v.registration, v.make, v.model, v.derivative, v.vin,
             ${canSeeCost ? tx`v.total_cost_pence` : tx`NULL::bigint`} AS total_cost_pence,
             t.name AS tenant_name,
             -- sites.address is jsonb, not columns. Assembled below, so a site
             -- with a partial address renders the lines it has rather than the
             -- word "null". (No backticks in SQL comments here — this is
             -- inside a JS template literal and they terminate it.)
             s.name AS site_name, s.address AS site_address,
             sb.entry_number AS stock_book_number,
             credits.reference AS credits_reference,
             credited.reference AS credited_by_reference
      FROM invoices i
      LEFT JOIN vehicles v ON v.id = i.vehicle_id
      LEFT JOIN sites s ON s.id = i.site_id
      LEFT JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN stock_book_entries sb ON sb.vehicle_id = i.vehicle_id
        AND sb.corrects_entry_id IS NULL
      LEFT JOIN invoices credits ON credits.id = i.credits_id
      LEFT JOIN invoices credited ON credited.id = i.credited_by_id
      WHERE i.id = ${id}::uuid`;

    if (!row) return null;

    const [lines, payments] = await Promise.all([
      tx`SELECT * FROM invoice_lines WHERE invoice_id = ${id}::uuid ORDER BY position`,
      tx`SELECT * FROM payments WHERE invoice_id = ${id}::uuid ORDER BY received_at`,
    ]);

    return { row, lines, payments };
  });

  if (!loaded) return null;

  const r = loaded.row as Record<string, unknown>;
  const currency = currencyOf(r['currency'] ?? 'GBP');
  const lines = linesFrom(loaded.lines as Record<string, unknown>[], currency);

  // The dealer's margin VAT, recomputed from the rule in force on the SALE
  // date rather than read from a column — and only for a principal who may
  // see cost, because margin plus selling price gives away the purchase price
  // exactly. That is the derived-value rule from M2.
  const cost = r['total_cost_pence'];
  const scheme = (r['vat_scheme'] as VatScheme | null) ?? null;
  const issuedAt = toDate(r['issued_at'] as Date | null);
  let marginVat: InvoiceDetail['marginVat'] = null;
  let calculation: MarginCalculation | null = null;

  if (scheme === 'margin' && canSeeCost && cost !== null && toPence(cost as string) > 0n) {
    const rule = await vatRule(issuedAt ?? new Date());
    const calc = calculateVat('margin', {
      purchasePrice: money(toPence(cost as string), currency),
      sellingPrice: money(toPence(r['gross_total_pence'] as string), currency),
    }, rule);
    if (calc.scheme === 'margin') {
      calculation = calc;
      marginVat = { margin: calc.margin, vatDue: calc.vatDue, sourceUrl: rule.sourceUrl };
    }
  }

  const invoice = invoiceFrom(r, lines, calculation);
  const payments = paymentsFrom(loaded.payments as Record<string, unknown>[]);

  // VAT Notice 718/1 requires BOTH parties' names and addresses on the
  // invoice. The seller's came out empty because this read column names that
  // do not exist — `sites.address` is a jsonb blob, and its keys are `city`
  // and `county`, not `locality` and `region`. The document went out with the
  // dealer's address missing entirely, which is the kind of omission an
  // inspection notices and a customer never does.
  const siteAddress = (r['site_address'] ?? {}) as Record<string, unknown>;
  const sellerAddress = ['line1', 'line2', 'city', 'locality', 'county', 'region', 'postcode']
    .map((k) => siteAddress[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    // A record carrying both `city` and `locality` should not print it twice.
    .filter((v, i, all) => all.indexOf(v) === i)
    .join('\n');
  const stockBookNumber = r['stock_book_number'] === null
    ? null : String(r['stock_book_number']);

  return {
    id: String(r['id']),
    invoice,
    balance: invoiceBalance(invoice, payments),
    payments: (loaded.payments as Record<string, unknown>[]).map((p) => ({
      id: String(p['id']),
      amount: money(toPence(p['amount_pence'] as string), currencyOf(p['currency'] ?? 'GBP')),
      method: p['method'] as PaymentMethod,
      direction: p['direction'] as 'in' | 'out',
      receivedAt: toDate(p['received_at'] as Date) as Date,
      reason: (p['reason'] as string | null) ?? null,
      reference: (p['reference'] as string | null) ?? null,
    })),
    registration: (r['registration'] as string | null) ?? null,
    vehicleDescription: [r['make'], r['model'], r['derivative']].filter(Boolean).join(' ') || null,
    vin: (r['vin'] as string | null) ?? null,
    sellerName: String(r['tenant_name'] ?? 'This dealership'),
    sellerAddress,
    sellerVatNumber: null,
    stockBookNumber,
    // The ONE renderer. The screen shows what the customer gets, not a
    // second rendering of the same data that could disagree with it.
    document: renderInvoice({
      invoice,
      seller: { name: String(r['tenant_name'] ?? ''), address: sellerAddress },
      buyer: {
        name: invoice.buyerName ?? '',
        address: invoice.buyerAddress ?? '',
      },
      issuedOn: issuedAt
        ? issuedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Not yet issued',
      vehicleDescription: [r['make'], r['model'], r['derivative']].filter(Boolean).join(' ') || null,
      registration: (r['registration'] as string | null) ?? null,
      vin: (r['vin'] as string | null) ?? null,
      stockBookNumber,
      notes: (r['notes'] as string | null) ?? null,
    }),
    marginVat,
    creditsReference: (r['credits_reference'] as string | null) ?? null,
    creditedByReference: (r['credited_by_reference'] as string | null) ?? null,
    notes: (r['notes'] as string | null) ?? null,
  };
}

// --------------------------------------------------------- the stock book

export interface StockBookRow {
  id: string;
  entryNumber: bigint;
  purchaseDate: Date | null;
  purchaseInvoiceRef: string | null;
  purchasePrice: Money | null;
  sellerName: string | null;
  registration: string | null;
  vehicleDescription: string | null;
  saleDate: Date | null;
  saleInvoiceNumber: string | null;
  buyerName: string | null;
  sellingPrice: Money | null;
  margin: Money | null;
  vatDue: Money | null;
  vatRuleVersion: number | null;
  correctsEntryId: string | null;
  correctionReason: string | null;
  /** Which of the twelve mandatory fields are absent. */
  missing: StockBookField[];
}

export interface StockBookPage {
  rows: StockBookRow[];
  total: number;
  /** Totals over the whole filtered period, not the page. */
  period: {
    from: Date | null;
    to: Date | null;
    entries: number;
    sold: number;
    marginTotal: Money;
    vatDueTotal: Money;
    /** Entries missing at least one mandatory field. */
    incomplete: number;
  };
  queryMs: number;
}

export interface StockBookFilters {
  from?: string | undefined;
  to?: string | undefined;
  /** Only entries missing a mandatory field. */
  incompleteOnly?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * The VAT margin stock book — the record HMRC asks to see on an inspection.
 *
 * Twelve mandatory fields, retained at least six years, immutable once the
 * sale is invoiced. The screen's job is to make an incomplete entry visible
 * BEFORE the inspection rather than during it, so every row states exactly
 * which fields are missing rather than a tick or a cross.
 *
 * Negative margins are not summed away. Each vehicle stands alone under the
 * scheme: a loss on one car cannot reduce the VAT due on another, and a total
 * that netted them would understate the liability by exactly that amount.
 */
export async function loadStockBook(
  session: Session,
  filters: StockBookFilters,
): Promise<StockBookPage> {
  const started = Date.now();
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;

  const page = await withSession(session, async (tx) => {
    const wFrom = from ? tx`AND (e.sale_date IS NULL OR e.sale_date >= ${from})` : tx``;
    const wTo = to ? tx`AND (e.sale_date IS NULL OR e.sale_date <= ${to})` : tx``;

    const rows = await tx`
      SELECT e.* FROM stock_book_entries e
      WHERE TRUE ${wFrom} ${wTo}
      ORDER BY e.entry_number
      LIMIT ${limit} OFFSET ${offset}`;

    const [counted] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stock_book_entries e
      WHERE TRUE ${wFrom} ${wTo}`;

    // Summed in SQL over the whole period. Only SOLD entries carry a margin,
    // and only non-negative ones — the CHECK constraint already refuses a
    // negative margin, so a null here means "not sold yet", not "made a loss".
    const [totals] = await tx<{ sold: number; margin: string | null; vat: string | null }[]>`
      SELECT count(*) FILTER (WHERE e.sale_date IS NOT NULL)::int AS sold,
             coalesce(sum(e.margin_pence), 0)::text AS margin,
             coalesce(sum(e.vat_due_pence), 0)::text AS vat
      FROM stock_book_entries e
      WHERE TRUE ${wFrom} ${wTo}`;

    return { rows, counted, totals };
  });

  const rows: StockBookRow[] = (page.rows as Record<string, unknown>[]).map((e) => {
    const purchasePrice = e['purchase_price_pence'] === null
      ? null : money(toPence(e['purchase_price_pence'] as string), 'GBP');
    const sellingPrice = e['selling_price_pence'] === null
      ? null : money(toPence(e['selling_price_pence'] as string), 'GBP');
    const marginPence = e['margin_pence'] === null
      ? null : money(toPence(e['margin_pence'] as string), 'GBP');
    const vatDue = e['vat_due_pence'] === null
      ? null : money(toPence(e['vat_due_pence'] as string), 'GBP');

    // Named by the domain's own list, so "which of the twelve?" has one
    // answer and adding a thirteenth is one edit.
    const missing = missingStockBookFields({
      entryNumber: e['entry_number'],
      purchaseDate: e['purchase_date'],
      purchaseInvoiceRef: e['purchase_invoice_ref'],
      purchasePrice: e['purchase_price_pence'],
      sellerName: e['seller_name'],
      registration: e['registration'],
      vehicleDescription: e['vehicle_description'],
      saleDate: e['sale_date'],
      saleInvoiceNumber: e['sale_invoice_number'],
      buyerName: e['buyer_name'],
      sellingPrice: e['selling_price_pence'],
      marginAndVat: e['vat_due_pence'],
    });

    return {
      id: String(e['id']),
      entryNumber: BigInt(e['entry_number'] as string),
      purchaseDate: toDate(e['purchase_date'] as Date | null),
      purchaseInvoiceRef: (e['purchase_invoice_ref'] as string | null) ?? null,
      purchasePrice,
      sellerName: (e['seller_name'] as string | null) ?? null,
      registration: (e['registration'] as string | null) ?? null,
      vehicleDescription: (e['vehicle_description'] as string | null) ?? null,
      saleDate: toDate(e['sale_date'] as Date | null),
      saleInvoiceNumber: (e['sale_invoice_number'] as string | null) ?? null,
      buyerName: (e['buyer_name'] as string | null) ?? null,
      sellingPrice,
      margin: marginPence,
      vatDue,
      vatRuleVersion: e['vat_rule_version'] === null ? null : Number(e['vat_rule_version']),
      correctsEntryId: e['corrects_entry_id'] === null ? null : String(e['corrects_entry_id']),
      correctionReason: (e['correction_reason'] as string | null) ?? null,
      missing,
    };
  });

  const visible = filters.incompleteOnly
    // An entry with no sale date is not incomplete — it is a car that has not
    // sold yet, and flagging it trains the dealer to ignore the list.
    ? rows.filter((r) => r.saleDate !== null && r.missing.length > 0)
    : rows;

  return {
    rows: visible,
    total: page.counted?.n ?? 0,
    period: {
      from, to,
      entries: page.counted?.n ?? 0,
      sold: page.totals?.sold ?? 0,
      marginTotal: money(BigInt(page.totals?.margin ?? '0'), 'GBP'),
      vatDueTotal: money(BigInt(page.totals?.vat ?? '0'), 'GBP'),
      incomplete: rows.filter((r) => r.saleDate !== null && r.missing.length > 0).length,
    },
    queryMs: Date.now() - started,
  };
}

export { format, buildInvoice, add, subtract, zero, MARGIN_SCHEME_NOTICE };
