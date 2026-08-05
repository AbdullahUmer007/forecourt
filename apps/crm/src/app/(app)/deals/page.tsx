import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadDeals, type DealRow } from '@/data/deals';
import { Card, Figure, StatusBadge, Empty, Amount, Reg, type Tone } from '@/components/ui';
import { holds, type DealState } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The deals list.
 *
 * Two things are surfaced here that no other CRM shows on a list: whether a
 * delivered deal is still inside a statutory clock, and whether its evidence
 * is complete. Both are invisible until somebody asks for them — a customer
 * exercising a right to reject, or a lender auditing an introduction — and by
 * then it is far too late to fix.
 *
 * No cost-of-credit figure appears anywhere on this page. Rule 5 allows one
 * code path for a monthly payment or an APR, and it is not this one.
 */

const STATE_PRESENTATION: Record<DealState, { tone: Tone; icon: string }> = {
  building: { tone: 'neutral', icon: '✎' },
  quoted: { tone: 'info', icon: '£' },
  agreed: { tone: 'info', icon: '✓' },
  contracted: { tone: 'info', icon: '✍' },
  delivered: { tone: 'good', icon: '⇢' },
  completed: { tone: 'good', icon: '●' },
  cancelled: { tone: 'neutral', icon: '✕' },
  unwound: { tone: 'critical', icon: '↩' },
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const date = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function DealsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');

  const page = await loadDeals(session, {
    q: params['q'],
    state: params['state'],
    clocksRunningOnly: params['clocks'] === '1',
    limit: 50,
    offset: Number(params['offset'] ?? 0) || 0,
  }, canSeeCost);

  const filtered = Boolean(params['q'] || params['state'] || params['clocks']);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Deals</h1>
        <p className="text-ink-muted">
          {page.total.toLocaleString('en-GB')} deal{page.total === 1 ? '' : 's'}
          {filtered && ' matching'}
          {' · '}
          <span className={page.queryMs > 400 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {page.queryMs}ms
          </span>
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card>
          <Figure label="Open" value={String(page.summary.open)} />
        </Card>
        <Card>
          <Figure label="Units this month" value={String(page.summary.unitsMonthToDate)} />
        </Card>
        <Card>
          {/* Gross is cost data. Withheld entirely rather than shown as zero:
              a zero would read as a bad month rather than as no permission. */}
          {page.summary.grossMonthToDate ? (
            <Figure
              label="Gross this month"
              value={page.summary.grossMonthToDate.amount === 0n
                ? '—'
                : new Intl.NumberFormat('en-GB', {
                  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
                }).format(Number(page.summary.grossMonthToDate.amount) / 100)}
              hint={page.summary.grossMonthToDate.amount === 0n
                ? 'No costed deals delivered yet this month'
                : 'Vehicle gross on delivered deals'}
            />
          ) : (
            <Figure label="Gross this month" value="—" hint="Not shown on your role" />
          )}
        </Card>
        <Card>
          <Figure
            label="Statutory clocks running"
            value={String(page.summary.clocksRunning)}
            {...(page.summary.evidenceGaps > 0
              ? { hint: `${page.summary.evidenceGaps} deal${page.summary.evidenceGaps === 1 ? '' : 's'} with an evidence gap` }
              : {})}
          />
          {page.summary.clocksRunning > 0 && (
            <div className="mt-2">
              <Link
                href="/deals?clocks=1"
                className="text-[13px] leading-[18px] text-brand-700 hover:underline"
              >
                Show them →
              </Link>
            </div>
          )}
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
            placeholder="Customer, reg, deal reference…"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Status
          </span>
          <select
            name="state"
            defaultValue={params['state'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {(Object.keys(STATE_PRESENTATION) as DealState[]).map((s) => (
              <option key={s} value={s}>{label(s)} ({page.summary.byState[s]})</option>
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
              href="/deals"
              className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
            >
              Clear
            </Link>
          )}
        </div>

        <label className="flex items-center gap-2 sm:col-span-3">
          <input
            type="checkbox" name="clocks" value="1"
            defaultChecked={params['clocks'] === '1'}
            className="h-5 w-5"
          />
          <span className="text-ink-muted">Delivered — statutory clocks still running</span>
        </label>
      </form>

      {page.rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches that' : 'No deals yet'}>
          {filtered
            ? 'Try clearing a filter. The counts beside each status show what is actually there.'
            : 'A deal appears here as soon as somebody starts building one against a car, and '
              + 'carries its own evidence ledger from that moment.'}
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {page.rows.map((row) => <DealRowView key={row.id} row={row} />)}
        </ul>
      )}

      {page.total > page.rows.length && (
        <Pager
          total={page.total}
          shown={page.rows.length}
          offset={Number(params['offset'] ?? 0) || 0}
          params={params}
        />
      )}
    </>
  );
}

function DealRowView({ row }: { row: DealRow }) {
  const state = STATE_PRESENTATION[row.state];
  const now = new Date();

  const rejectOpen = row.clocks !== null
    && (row.clocks.rejectWindowPaused
      || (row.clocks.rejectWindowEndsAt !== null && row.clocks.rejectWindowEndsAt > now));
  const cancelOpen = row.clocks?.cancellationDeadline != null
    && row.clocks.cancellationDeadline > now;

  // An evidence gap only matters once the deal is real. Flagging a half-built
  // quote for missing a commission disclosure trains people to ignore the flag.
  const gapMatters = !row.evidence.complete
    && !['building', 'quoted', 'cancelled'].includes(row.state);

  return (
    <li>
      <Link
        href={`/deals/${row.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface-1 p-3 hover:border-edge-strong hover:bg-surface-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{row.contactName}</span>
            {row.reference && (
              <span className="mono text-[13px] leading-[18px] text-ink-subtle">
                {row.reference}
              </span>
            )}
          </div>
          <div className="truncate text-[13px] leading-[18px] text-ink-subtle">
            {row.vehicleDescription ?? 'No car linked'}
            {row.siteName && ` · ${row.siteName}`}
            {row.deliveredAt
              ? ` · delivered ${date(row.deliveredAt)}`
              : ` · started ${date(row.createdAt)}`}
          </div>
        </div>

        {row.registration && <Reg value={row.registration} />}

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={state.tone} icon={state.icon} label={label(row.state)} />

          {row.financed && <StatusBadge tone="neutral" icon="₤" label="Financed" />}

          {row.clocks?.rejectWindowPaused && (
            <StatusBadge tone="warning" icon="⏸" label="Reject clock paused — repair open" />
          )}
          {rejectOpen && !row.clocks?.rejectWindowPaused && row.clocks?.rejectWindowEndsAt && (
            <StatusBadge
              tone="info" icon="⏱"
              label={`Reject until ${date(row.clocks.rejectWindowEndsAt)}`}
            />
          )}
          {cancelOpen && row.clocks?.cancellationDeadline && (
            <StatusBadge
              tone="warning" icon="↩"
              label={`Cancel until ${date(row.clocks.cancellationDeadline)}`}
            />
          )}

          {gapMatters && (
            <StatusBadge
              tone="critical" icon="!"
              label={`${row.evidence.missing.length} evidence gap${row.evidence.missing.length === 1 ? '' : 's'}`}
            />
          )}
        </div>

        <div className="w-28 text-right">
          <div className="font-semibold"><Amount value={row.totalPrice} /></div>
          {row.dealGross ? (
            <div className={`text-[12px] leading-4 ${row.dealGross.amount < 0n ? 'text-critical' : 'text-ink-subtle'}`}>
              <Amount value={row.dealGross} /> gross
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function Pager(
  { total, shown, offset, params }: {
    total: number; shown: number; offset: number;
    params: Record<string, string | undefined>;
  },
) {
  const query = (next: number): string => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== 'offset') search.set(k, v);
    }
    if (next > 0) search.set('offset', String(next));
    return `/deals${search.toString() ? `?${search}` : ''}`;
  };

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
      <span className="text-ink-subtle">
        {offset + 1}–{offset + shown} of {total.toLocaleString('en-GB')}
      </span>
      <div className="flex gap-2">
        {offset > 0 && (
          <Link
            href={query(Math.max(0, offset - 50))}
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
          >
            Previous
          </Link>
        )}
        {offset + shown < total && (
          <Link
            href={query(offset + 50)}
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
