import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadInvoices, type InvoiceRow } from '@/data/invoices';
import { Card, Figure, StatusBadge, Empty, Amount, Reg, Problem, type Tone } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Invoices' };

/**
 * Invoices.
 *
 * The one thing on this screen that no other CRM shows: whether the number
 * series has a GAP in it. A missing number in a VAT invoice series is the
 * first thing an inspection asks about, and the whole reason numbers come from
 * a locked counter row rather than a Postgres sequence is to be able to say
 * there are none. A guarantee nobody displays is a guarantee nobody trusts.
 */

const STATUS_PRESENTATION: Record<string, { tone: Tone; icon: string }> = {
  draft: { tone: 'neutral', icon: '✎' },
  issued: { tone: 'info', icon: '→' },
  part_paid: { tone: 'warning', icon: '◐' },
  paid: { tone: 'good', icon: '✓' },
  cancelled: { tone: 'neutral', icon: '✕' },
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function InvoicesPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const page = await loadInvoices(session, {
    q: params['q'],
    status: params['status'],
    overdueOnly: params['overdue'] === '1',
    limit: 50,
    offset: Number(params['offset'] ?? 0) || 0,
  });

  const filtered = Boolean(params['q'] || params['status'] || params['overdue']);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Invoices</h1>
        <p className="text-ink-muted">
          {page.total.toLocaleString('en-GB')} invoice{page.total === 1 ? '' : 's'}
          {filtered && ' matching'}
          {' · '}
          <span className={page.queryMs > 400 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {page.queryMs}ms
          </span>
          {' · '}
          <Link href="/vat/stock-book" className="text-link hover:underline">
            VAT stock book
          </Link>
        </p>
      </div>

      {/* Should always be empty. If it is not, that IS the finding. */}
      {page.summary.numberGaps.length > 0 && (
        <Problem title={`${page.summary.missingNumberCount.toLocaleString('en-GB')} missing invoice number${page.summary.missingNumberCount === 1 ? '' : 's'}`}>
          <p>
            An invoice number series must be gapless. These numbers were allocated and are not on
            any invoice, which is the first thing a VAT inspection asks about. Numbers come from a
            locked counter that rolls back with the transaction, so this should be impossible —
            tell us, do not try to renumber anything.
          </p>
          {/* Ranges, not every number: one stray high number leaves thousands
              missing, and a list of them is unreadable. */}
          <p className="mono mt-2 text-[13px] leading-[18px]">
            {page.summary.numberGaps.slice(0, 20).join(', ')}
            {page.summary.numberGaps.length > 20
              && ` and ${page.summary.numberGaps.length - 20} more ranges`}
          </p>
        </Problem>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Card>
          <Figure
            label="Outstanding"
            value={page.summary.outstanding.amount === 0n
              ? 'Nothing owed'
              : new Intl.NumberFormat('en-GB', {
                style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
              }).format(Number(page.summary.outstanding.amount) / 100)}
          />
        </Card>
        <Card>
          <Figure
            label="Overdue"
            value={page.summary.overdue.amount === 0n
              ? 'None'
              : new Intl.NumberFormat('en-GB', {
                style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
              }).format(Number(page.summary.overdue.amount) / 100)}
            {...(page.summary.overdue.amount > 0n
              ? { hint: 'Issued, unpaid and past the due date' }
              : {})}
          />
        </Card>
        <Card>
          <Figure
            label="Number series"
            value={page.summary.numberGaps.length === 0 ? 'Gapless' : 'Has gaps'}
            hint={page.summary.numberGaps.length === 0
              ? 'Every number allocated is on an invoice'
              : 'Investigate before the next VAT return'}
          />
        </Card>
      </div>

      <form method="GET" className="mb-4 grid gap-2 rounded-md border border-edge bg-surface-1 p-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Search
          </span>
          <input
            name="q"
            defaultValue={params['q'] ?? ''}
            placeholder="Reference, buyer, reg…"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Status
          </span>
          <select
            name="status"
            defaultValue={params['status'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {Object.keys(STATUS_PRESENTATION).map((s) => (
              <option key={s} value={s}>
                {label(s)} ({page.summary.byStatus[s] ?? 0})
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
          >
            Filter
          </button>
          {filtered && (
            <Link
              href="/invoices"
              className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
            >
              Clear
            </Link>
          )}
        </div>

        <label className="flex items-center gap-2 sm:col-span-3">
          <input
            type="checkbox" name="overdue" value="1"
            defaultChecked={params['overdue'] === '1'}
            className="h-5 w-5"
          />
          <span className="text-ink-muted">Overdue only</span>
        </label>
      </form>

      {page.rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches that' : 'No invoices yet'}>
          {filtered
            ? 'Try clearing a filter. The counts beside each status show what is actually there.'
            : 'An invoice is raised from a deal. A draft takes no number, so a draft that never '
              + 'gets issued leaves no hole in the series.'}
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {page.rows.map((row) => <InvoiceRowView key={row.id} row={row} />)}
        </ul>
      )}
    </>
  );
}

function InvoiceRowView({ row }: { row: InvoiceRow }) {
  const presentation = STATUS_PRESENTATION[row.status] ?? { tone: 'neutral' as Tone, icon: '·' };
  const overdue = row.dueAt !== null && row.dueAt < new Date()
    && (row.status === 'issued' || row.status === 'part_paid');

  return (
    <li>
      <Link
        href={`/invoices/${row.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface-1 p-3 hover:border-edge-strong hover:bg-surface-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="mono font-medium">{row.reference ?? 'Draft'}</span>
            <span className="truncate">{row.buyerName ?? 'No buyer recorded'}</span>
          </div>
          <div className="truncate text-[13px] leading-[18px] text-ink-subtle">
            {row.issuedAt ? `Issued ${date(row.issuedAt)}` : 'Not issued'}
            {row.kind === 'credit_note' && ' · credit note'}
          </div>
        </div>

        {row.registration && <Reg value={row.registration} />}

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={presentation.tone} icon={presentation.icon} label={label(row.status)} />
          {row.vatScheme === 'margin' && (
            <StatusBadge tone="neutral" icon="£" label="Margin scheme" />
          )}
          {overdue && <StatusBadge tone="critical" icon="!" label="Overdue" />}
        </div>

        <div className="w-32 text-right">
          <div className="font-semibold"><Amount value={row.grossTotal} /></div>
          {row.balance.outstanding.amount > 0n && row.status !== 'cancelled' && (
            <div className="text-[12px] leading-4 text-ink-subtle">
              <Amount value={row.balance.outstanding} /> outstanding
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
