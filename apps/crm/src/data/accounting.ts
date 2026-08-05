/**
 * Accounting sync — the mapping, the dry run, and what has actually posted.
 *
 * §23's dry run is not a mode somebody has to remember to pick. A connection
 * starts with no `live_from`, so a dry run is the only thing it CAN do until
 * an accountant has read the output and said yes. That ordering is the whole
 * safety story: postings that reach a real ledger cannot be unposted, and a
 * wrong account gets reconciled and forgotten while a missing one gets noticed.
 *
 * The screen's job is to make the difference between "ready" and "would post
 * to the wrong place" visible before anything runs. So:
 *
 *  - every unmapped account is listed, not just the first one a sync hits
 *  - the dry run shows exactly what would be created, per invoice
 *  - a margin-scheme sale shows NO VAT line and its own margin-VAT journal
 *    beside it, because that pair coming apart is the expensive mistake
 *
 * Nothing here computes a posting. `invoicePostings`, `marginVatJournal` and
 * `dryRun` are the domain's, and they are tested against worked examples.
 */

import { withSession, toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import {
  money, calculateVat,
  postingsFor, paymentPostings, dryRun, unmappedAccounts,
  ACCOUNT_KEYS, ACCOUNT_LABELS,
  type AccountKey, type AccountMapping, type Posting, type DryRun,
  type UnmappedAccount, type Money, type VatScheme, type Currency,
  type InvoiceForPosting,
} from '@forecourt/domain';
import { vatRule } from './rules';

const currencyOf = (v: unknown): Currency => (v === 'EUR' ? 'EUR' : 'GBP');

export interface ConnectionRow {
  id: string;
  provider: string;
  organisationName: string | null;
  enabled: boolean;
  /** Null until an accountant has approved the dry run. */
  liveFrom: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}

export interface MappingRow {
  accountKey: AccountKey;
  label: string;
  accountCode: string | null;
  accountName: string | null;
  taxRateCode: string | null;
  agreedAt: Date | null;
  agreedByName: string | null;
}

export interface BatchRow {
  id: string;
  status: string;
  dryRun: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  totalCount: number;
  postedCount: number;
  failedCount: number;
  blockedCount: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface AccountingView {
  connection: ConnectionRow | null;
  mappings: MappingRow[];
  /** Accounts the pending work needs and nobody has mapped. */
  unmapped: UnmappedAccount[];
  /** What WOULD be created, per source document. */
  preview: DryRun | null;
  batches: BatchRow[];
  recentPostings: {
    id: string; source: string; status: string; message: string | null;
    totalDebit: Money; externalId: string | null; attempts: number;
    createdAt: Date;
  }[];
  /** True once an accountant has signed off and the connection went live. */
  isLive: boolean;
  /** Refunds in the pending work that are NOT in the preview, because the
   *  domain has no refund posting yet and guessing at one would misstate the
   *  bank. Surfaced rather than silently dropped. */
  refundsExcluded: number;
  queryMs: number;
}

export async function loadAccounting(session: Session): Promise<AccountingView> {
  const started = Date.now();

  const data = await withSession(session, async (tx) => {
    const [connection] = await tx`
      SELECT * FROM accounting_connections ORDER BY created_at LIMIT 1`;

    if (!connection) {
      return { connection: null, mappings: [], invoices: [], payments: [], batches: [], postings: [] };
    }

    const connectionId = String(connection['id']);

    const [mappings, invoices, payments, batches, postings] = await Promise.all([
      tx`SELECT m.*, u.name AS agreed_by_name
         FROM account_mappings m
         LEFT JOIN users u ON u.id = m.agreed_by
         WHERE m.connection_id = ${connectionId}::uuid`,

      // Issued invoices with no posting yet. The dry run is over what would
      // go NEXT, not over history — a preview of work already done is not a
      // preview of anything.
      tx`SELECT i.*, v.total_cost_pence
         FROM invoices i
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
         WHERE i.status <> 'draft'
           AND NOT EXISTS (
             SELECT 1 FROM postings p
             WHERE p.source_id = i.id AND p.status = 'posted')
         ORDER BY i.issued_at DESC NULLS LAST
         LIMIT 25`,

      tx`SELECT p.* FROM payments p
         WHERE NOT EXISTS (
           SELECT 1 FROM postings po
           WHERE po.source_id = p.id AND po.status = 'posted')
         ORDER BY p.received_at DESC LIMIT 25`,

      tx`SELECT * FROM posting_batches ORDER BY started_at DESC LIMIT 10`,

      tx`SELECT * FROM postings ORDER BY created_at DESC LIMIT 25`,
    ]);

    return { connection, mappings, invoices, payments, batches, postings };
  });

  if (!data.connection) {
    return {
      connection: null, mappings: [], unmapped: [], preview: null,
      batches: [], recentPostings: [], isLive: false, refundsExcluded: 0,
      queryMs: Date.now() - started,
    };
  }

  const c = data.connection as Record<string, unknown>;

  // The mapping, as the domain wants it.
  const mapping: Record<string, { code: string; name?: string; taxRateCode?: string | null }> = {};
  const mappingRows = new Map<string, Record<string, unknown>>();
  for (const m of data.mappings as Record<string, unknown>[]) {
    const key = String(m['account_key']);
    mappingRows.set(key, m);
    const name = (m['account_name'] as string | null) ?? null;
    mapping[key] = {
      code: String(m['account_code']),
      // Spread rather than `name: undefined` — under exactOptionalPropertyTypes
      // an explicit undefined is not the same as an absent property.
      ...(name === null ? {} : { name }),
      taxRateCode: (m['tax_rate_code'] as string | null) ?? null,
    };
  }

  // The postings that WOULD be created. Built through the domain so the
  // preview and the eventual sync cannot disagree about what a sale posts.
  const postings: Posting[] = [];

  for (const raw of data.invoices as Record<string, unknown>[]) {
    const issuedAt = toDate(raw['issued_at'] as Date | null);
    if (issuedAt === null) continue;

    const currency = currencyOf(raw['currency']);
    const scheme = (raw['vat_scheme'] as VatScheme | null) ?? 'margin';
    const cost = raw['total_cost_pence'];

    /**
     * ABSOLUTE amounts, always.
     *
     * M11 stores a credit note with negative totals — it is the reversal of an
     * invoice and that is a reasonable way to hold it. `invoicePostings`
     * expects positive figures and derives which side each line falls on from
     * `kind`, precisely because "a negative debit and a credit look identical
     * in a total and completely different in a ledger". Handing it the stored
     * negatives makes it refuse the posting outright, which is the domain
     * being right and this mapping being wrong.
     */
    const abs = (v: unknown): Money => {
      const pence = toPence(v as string);
      return money(pence < 0n ? -pence : pence, currency);
    };

    const gross = abs(raw['gross_total_pence']);

    // The margin VAT, recomputed from the rule in force on the SALE date.
    // Never read from a column, and never re-derived with a different fraction
    // from the one M11 used.
    const vatCalculation = scheme === 'margin' && cost !== null && toPence(cost as string) > 0n
      ? calculateVat('margin', {
        purchasePrice: money(toPence(cost as string), currency),
        sellingPrice: gross,
      }, await vatRule(issuedAt))
      : null;

    const invoice: InvoiceForPosting = {
      id: String(raw['id']),
      kind: raw['kind'] as InvoiceForPosting['kind'],
      number: raw['number'] === null ? null : BigInt(raw['number'] as string),
      series: String(raw['series']),
      // The reference the CUSTOMER has, so a bookkeeper reconciling the ledger
      // against a piece of paper finds the same string on both.
      reference: (raw['reference'] as string | null) ?? null,
      vatScheme: scheme,
      netTotal: abs(raw['net_total_pence']),
      vatTotal: abs(raw['vat_total_pence']),
      grossTotal: gross,
      vatCalculation,
      buyerName: (raw['buyer_name'] as string | null) ?? null,
      issuedAt,
    };

    // `postingsFor` emits the sale AND its margin-VAT journal together, so
    // the pair cannot come apart — which is the expensive mistake here.
    postings.push(...postingsFor(invoice));
  }

  // REFUNDS ARE EXCLUDED, deliberately.
  //
  // `paymentPostings` models a receipt: debit bank, credit debtors. A refund
  // is the reverse, and running one through this would credit the bank for
  // money that left it — overstating both cash and income, in a ledger a
  // dealer files accounts from.
  //
  // Reversing the lines is probably the right treatment, but "probably" is not
  // good enough for somebody else's books. So refunds are counted and named on
  // the screen rather than posted, and the domain gets a proper `refund`
  // posting once a bookkeeper has confirmed the entries.
  const refundsExcluded = (data.payments as Record<string, unknown>[])
    .filter((p) => p['direction'] === 'out').length;

  for (const raw of data.payments as Record<string, unknown>[]) {
    if (raw['direction'] === 'out') continue;
    postings.push(paymentPostings({
      id: String(raw['id']),
      amount: money(toPence(raw['amount_pence'] as string), currencyOf(raw['currency'])),
      method: String(raw['method']),
      receivedAt: toDate(raw['received_at'] as Date) as Date,
      reference: (raw['reference'] as string | null) ?? null,
    }));
  }

  const preview = postings.length > 0
    ? dryRun(postings, mapping as AccountMapping)
    : null;

  return {
    connection: {
      id: String(c['id']),
      provider: String(c['provider']),
      organisationName: (c['organisation_name'] as string | null) ?? null,
      enabled: Boolean(c['enabled']),
      liveFrom: toDate(c['live_from'] as Date | null),
      lastSyncAt: toDate(c['last_sync_at'] as Date | null),
      lastError: (c['last_error'] as string | null) ?? null,
    },
    // Every account the product can post to, mapped or not — a bookkeeper
    // setting this up wants the whole list to work through once, not to
    // discover them one failed sync at a time.
    mappings: ACCOUNT_KEYS.map((key) => {
      const row = mappingRows.get(key);
      return {
        accountKey: key,
        label: ACCOUNT_LABELS[key],
        accountCode: row ? String(row['account_code']) : null,
        accountName: row ? (row['account_name'] as string | null) ?? null : null,
        taxRateCode: row ? (row['tax_rate_code'] as string | null) ?? null : null,
        agreedAt: row ? toDate(row['agreed_at'] as Date | null) : null,
        agreedByName: row ? (row['agreed_by_name'] as string | null) ?? null : null,
      };
    }),
    unmapped: unmappedAccounts(postings, mapping as AccountMapping),
    preview,
    batches: (data.batches as Record<string, unknown>[]).map((b) => ({
      id: String(b['id']),
      status: String(b['status']),
      dryRun: Boolean(b['dry_run']),
      periodStart: toDate(b['period_start'] as Date | null),
      periodEnd: toDate(b['period_end'] as Date | null),
      totalCount: Number(b['total_count'] ?? 0),
      postedCount: Number(b['posted_count'] ?? 0),
      failedCount: Number(b['failed_count'] ?? 0),
      blockedCount: Number(b['blocked_count'] ?? 0),
      startedAt: toDate(b['started_at'] as Date) as Date,
      finishedAt: toDate(b['finished_at'] as Date | null),
    })),
    recentPostings: (data.postings as Record<string, unknown>[]).map((p) => ({
      id: String(p['id']),
      source: String(p['source']),
      status: String(p['status']),
      message: (p['message'] as string | null) ?? null,
      totalDebit: money(toPence(p['total_debit_pence'] as string), currencyOf(p['currency'])),
      externalId: (p['external_id'] as string | null) ?? null,
      attempts: Number(p['attempts'] ?? 0),
      createdAt: toDate(p['created_at'] as Date) as Date,
    })),
    // Live means an accountant has looked at a dry run and said yes. Nothing
    // else sets this, and it is the only thing that lets a posting leave.
    isLive: toDate(c['live_from'] as Date | null) !== null && Boolean(c['enabled']),
    refundsExcluded,
    queryMs: Date.now() - started,
  };
}

export { ACCOUNT_KEYS, ACCOUNT_LABELS };
