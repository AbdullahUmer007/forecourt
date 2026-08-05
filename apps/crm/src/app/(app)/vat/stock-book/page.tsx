import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadStockBook, type StockBookRow } from '@/data/invoices';
import { Card, Figure, StatusBadge, Empty, Amount, Problem } from '@/components/ui';
import { holds, STOCK_BOOK_REQUIRED_FIELDS } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The VAT margin stock book — the record HMRC asks to see on an inspection.
 *
 * Twelve mandatory fields, retained at least six years, immutable once the
 * sale is invoiced. The screen's job is to make an incomplete entry visible
 * BEFORE an inspection rather than during one, so a row states exactly WHICH
 * fields are missing rather than showing a tick or a cross. "Incomplete" is
 * not actionable; "no seller's address on entry 41" is.
 *
 * An unsold car is not incomplete. It is a car that has not sold yet, and
 * flagging it is how a list teaches its user to ignore it.
 */

const FIELD_LABELS: Record<string, string> = {
  entryNumber: 'Stock book number',
  purchaseDate: 'Date of purchase',
  purchaseInvoiceRef: 'Purchase invoice number',
  purchasePrice: 'Purchase price',
  sellerName: 'Seller’s name and address',
  registration: 'Registration',
  vehicleDescription: 'Vehicle description',
  saleDate: 'Date of sale',
  saleInvoiceNumber: 'Sales invoice number',
  buyerName: 'Buyer’s name and address',
  sellingPrice: 'Selling price',
  marginAndVat: 'Margin and VAT due',
};

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function StockBookPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  // The stock book contains every purchase price the dealership has paid.
  // It is its own permission for that reason.
  if (!holds(principal, 'stockbook.read')) notFound();

  const page = await loadStockBook(session, {
    from: params['from'],
    to: params['to'],
    incompleteOnly: params['incomplete'] === '1',
    limit: 200,
  });

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">VAT stock book</h1>
        <p className="text-ink-muted">
          The margin-scheme record HMRC asks to see. {page.period.entries.toLocaleString('en-GB')}
          {' '}entr{page.period.entries === 1 ? 'y' : 'ies'}
          {' · '}
          <span className={page.queryMs > 400 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {page.queryMs}ms
          </span>
          {' · '}
          <Link href="/invoices" className="text-brand-700 hover:underline">Invoices</Link>
        </p>
      </div>

      {page.period.incomplete > 0 && (
        <Problem title={`${page.period.incomplete} sold ${page.period.incomplete === 1 ? 'car is' : 'cars are'} missing a mandatory field`}>
          <p>
            Every sold entry needs all twelve fields. An entry that is short of one is what an
            inspection finds, and the moment to fix it is now rather than then — the information is
            still to hand.
          </p>
          <p className="mt-2">
            <Link href="/vat/stock-book?incomplete=1" className="text-brand-700 hover:underline">
              Show only those →
            </Link>
          </p>
        </Problem>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card><Figure label="Entries" value={String(page.period.entries)} /></Card>
        <Card><Figure label="Sold" value={String(page.period.sold)} /></Card>
        <Card>
          <Figure
            label="Total margin"
            value={new Intl.NumberFormat('en-GB', {
              style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
            }).format(Number(page.period.marginTotal.amount) / 100)}
            hint="Each car stands alone — a loss on one never reduces another’s VAT"
          />
        </Card>
        <Card>
          <Figure
            label="VAT due"
            value={new Intl.NumberFormat('en-GB', {
              style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
            }).format(Number(page.period.vatDueTotal.amount) / 100)}
            hint="On the margin, at the fraction in force on each sale date"
          />
        </Card>
      </div>

      <form method="GET" className="mb-4 grid gap-2 rounded-md border border-edge bg-surface-1 p-3 sm:grid-cols-[auto_auto_auto_1fr]">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Sold from
          </span>
          <input
            type="date" name="from" defaultValue={params['from'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Sold to
          </span>
          <input
            type="date" name="to" defaultValue={params['to'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
          >
            Apply
          </button>
          {(params['from'] || params['to'] || params['incomplete']) && (
            <Link
              href="/vat/stock-book"
              className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
            >
              Clear
            </Link>
          )}
        </div>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox" name="incomplete" value="1"
            defaultChecked={params['incomplete'] === '1'}
            className="h-5 w-5"
          />
          <span className="text-ink-muted">Missing a mandatory field</span>
        </label>
      </form>

      {page.rows.length === 0 ? (
        <Empty title={params['incomplete'] === '1' ? 'Every sold entry is complete' : 'No entries yet'}>
          {params['incomplete'] === '1'
            ? 'All twelve mandatory fields are present on every car that has sold. That is what an '
              + 'inspection is looking for.'
            : 'An entry is created when a car is booked in under the margin scheme, and its sale '
              + 'side is completed automatically when the invoice is issued.'}
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {page.rows.map((row) => <EntryView key={row.id} row={row} />)}
        </ul>
      )}

      <p className="mt-4 text-[12px] leading-4 text-ink-subtle">
        The twelve mandatory fields are {STOCK_BOOK_REQUIRED_FIELDS.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.
        Entries are kept for at least six years and are never edited — a correction is an adjusting
        entry that references the one it corrects, so both figures stay on the record.
      </p>
    </>
  );
}

function EntryView({ row }: { row: StockBookRow }) {
  const sold = row.saleDate !== null;
  const incomplete = sold && row.missing.length > 0;

  return (
    <li
      className={`rounded-md border bg-surface-1 p-3 ${
        incomplete ? 'border-critical' : 'border-edge'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="mono font-semibold">#{row.entryNumber.toString()}</span>
          <span className="mono">{row.registration ?? '—'}</span>
          <span className="text-ink-muted">{row.vehicleDescription ?? 'Not described'}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {row.correctsEntryId && (
            <StatusBadge tone="warning" icon="✎" label="Adjusting entry" />
          )}
          {sold
            ? <StatusBadge tone={incomplete ? 'critical' : 'good'} icon={incomplete ? '!' : '✓'}
                label={incomplete ? `${row.missing.length} field${row.missing.length === 1 ? '' : 's'} missing` : 'Complete'} />
            : <StatusBadge tone="neutral" icon="◌" label="Not sold yet" />}
        </span>
      </div>

      <dl className="mt-2 grid gap-x-6 text-[13px] leading-[18px] sm:grid-cols-2">
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Purchased</dt>
          <dd>{date(row.purchaseDate)}{row.purchaseInvoiceRef && ` · ${row.purchaseInvoiceRef}`}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Purchase price</dt>
          <dd>{row.purchasePrice ? <Amount value={row.purchasePrice} /> : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Seller</dt>
          <dd className="truncate">{row.sellerName ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Sold</dt>
          <dd>{date(row.saleDate)}{row.saleInvoiceNumber && ` · ${row.saleInvoiceNumber}`}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Buyer</dt>
          <dd className="truncate">{row.buyerName ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Selling price</dt>
          <dd>{row.sellingPrice ? <Amount value={row.sellingPrice} /> : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">Margin</dt>
          <dd>{row.margin ? <Amount value={row.margin} /> : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-edge py-1">
          <dt className="text-ink-subtle">VAT due</dt>
          <dd>
            {row.vatDue ? <Amount value={row.vatDue} /> : '—'}
            {row.vatRuleVersion !== null && (
              <span className="ml-1 text-ink-subtle">(rule v{row.vatRuleVersion})</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Named, not counted. "Incomplete" is not actionable. */}
      {incomplete && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {row.missing.map((f) => (
            <li key={f}>
              <StatusBadge tone="critical" icon="✕" label={FIELD_LABELS[f] ?? f} />
            </li>
          ))}
        </ul>
      )}

      {row.correctionReason && (
        <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
          Correcting an earlier entry — {row.correctionReason}
        </p>
      )}
    </li>
  );
}
