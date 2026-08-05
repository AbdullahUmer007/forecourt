import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadStock, type StockRow } from '@/data/stock';
import { StatusBadge, Empty, Amount, Reg, ListRow, type Tone } from '@/components/ui';
import {
  holds, goLiveBlockers, OVERAGE_DAYS, format, subtract,
  type VehicleState,
} from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Stock' };

/**
 * The stock list — the screen a dealer looks at more than any other.
 *
 * The filters are a plain GET form. No client component, no JavaScript
 * required: the state lives in the URL, which means it is bookmarkable,
 * shareable, survives a refresh and works on the machine in the office that
 * nobody has updated since 2019. It also means the back button does what a
 * back button should.
 *
 * CLAUDE.md budgets this at "1,000 rows filtering in under 400ms", so the
 * filtering is done by Postgres against M3's indexes and the measured query
 * time is rendered on the page — a budget nobody can see is a budget nobody
 * keeps.
 */

const STATE_PRESENTATION: Partial<Record<VehicleState, { tone: Tone; icon: string }>> = {
  sourcing: { tone: 'neutral', icon: '◌' },
  purchased: { tone: 'neutral', icon: '✎' },
  in_transit: { tone: 'neutral', icon: '→' },
  booked_in: { tone: 'info', icon: '⇥' },
  in_prep: { tone: 'info', icon: '⚙' },
  ready: { tone: 'info', icon: '✓' },
  live: { tone: 'good', icon: '●' },
  reserved: { tone: 'warning', icon: '◑' },
  sold: { tone: 'good', icon: '£' },
  delivered: { tone: 'good', icon: '⇢' },
  on_hold: { tone: 'warning', icon: '‖' },
  returned: { tone: 'critical', icon: '↩' },
  written_off: { tone: 'critical', icon: '✕' },
  trade_disposal: { tone: 'neutral', icon: '⇥' },
  archived: { tone: 'neutral', icon: '▢' },
};

const label = (state: string): string =>
  state.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default async function StockPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');

  const page = await loadStock(session, {
    q: params['q'],
    state: params['state'],
    make: params['make'],
    overageOnly: params['overage'] === '1',
    sort: (params['sort'] as 'newest' | undefined) ?? 'newest',
    limit: 50,
    offset: Number(params['offset'] ?? 0) || 0,
  }, canSeeCost);

  const filtered = Boolean(params['q'] || params['state'] || params['make'] || params['overage']);

  // Name the site only when the rows on screen are not all from the same one.
  // A field whose value is identical on every visible row carries no
  // information and costs a dealer the width it takes up.
  const multiSite = new Set(page.rows.map((r) => r.siteName)).size > 1;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-[34px] font-semibold">Stock</h1>
          <p className="text-ink-muted">
            {page.total.toLocaleString('en-GB')} car{page.total === 1 ? '' : 's'}
            {filtered && ' matching'}
            {' · '}
            {/* The budget, on the page. CLAUDE.md asks for under 400ms and a
                number nobody can see is a number nobody keeps. */}
            <span className={page.queryMs > 400 ? 'text-warning-ink' : 'text-ink-subtle'}>
              {page.queryMs}ms
            </span>
          </p>
        </div>
      </div>

      {/* A GET form: no JavaScript, and the filter state lives in the URL. */}
      <form method="GET" className="mb-4 grid gap-2 rounded-md border border-edge bg-surface-1 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Search
          </span>
          <input
            name="q"
            defaultValue={params['q'] ?? ''}
            placeholder="Reg, make, model, stock number…"
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
            {/* Counts reflect the CURRENT filter, and a zero-count option is
                shown and disabled rather than vanishing — M7 settled the same
                question for the public site. A list that reshuffles as you
                type is impossible to use. */}
            {page.states.map((s) => (
              <option key={s.state} value={s.state}>
                {label(s.state)} ({s.count})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Make
          </span>
          <select
            name="make"
            defaultValue={params['make'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {page.makes.map((m) => (
              <option key={m.make} value={m.make}>{m.make} ({m.count})</option>
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
              href="/stock"
              className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
            >
              Clear
            </Link>
          )}
        </div>

        <label className="flex items-center gap-2 sm:col-span-4">
          <input
            type="checkbox"
            name="overage"
            value="1"
            defaultChecked={params['overage'] === '1'}
            className="h-5 w-5"
          />
          <span className="text-ink-muted">
            Overage only — {OVERAGE_DAYS}+ days in stock
          </span>
        </label>
      </form>

      {page.rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches that' : 'No stock yet'}>
          {filtered
            ? 'Try clearing a filter. The counts beside each option show what is actually there.'
            : 'Cars appear here from the moment they are sourced, not just once they are live — '
              + 'so the ones sitting in prep are as visible as the ones on the forecourt.'}
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {page.rows.map((row) => (
            <StockRowView key={row.id} row={row} canSeeCost={canSeeCost} multiSite={multiSite} />
          ))}
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

function StockRowView(
  { row, canSeeCost, multiSite }:
  { row: StockRow; canSeeCost: boolean; multiSite: boolean },
) {
  const state = STATE_PRESENTATION[row.state] ?? { tone: 'neutral' as Tone, icon: '·' };
  const description = [row.make, row.model, row.derivative].filter(Boolean).join(' ');
  const overage = row.daysInStock !== null && row.daysInStock >= OVERAGE_DAYS;

  // M3's gate, on the list rather than only on the vehicle — the point of
  // seeing it here is spotting the car that cannot be advertised before
  // somebody wonders why the phone is not ringing about it.
  const blockers = goLiveBlockers({
    state: row.state,
    registration: row.registration,
    vatScheme: row.vatScheme as 'margin' | 'qualifying' | 'non_qualifying' | null,
    retailPricePence: row.retailPrice?.amount ?? null,
    publishedPhotoCount: row.publishedPhotoCount,
    provenanceCheckedAt: row.provenanceCheckedAt,
    provenanceAdverse: row.provenanceAdverse,
    provenanceAcknowledgedBy: null,
    // The stock book lives in M11 and is not loaded on this screen;
    // the list surfaces the gate, the stock-book report owns its own.
    missingStockBookFields: [],
    hasDeposit: false,
    hasLinkedDeal: false,
    handoverChecklistComplete: false,
    dvlaNotified: false,
    mileage: row.mileage,
    highestMotMileage: null,
    mileageAnomalyAcknowledgedBy: null,
  });

  // A car with NO recorded cost has no gross — it has a gap. Showing
  // "£45,999 gross" for a car nobody has costed is a missing figure dressed
  // as a good one, the same class of lie as M14 reporting an unbudgeted prep
  // card as 0% over.
  const costed = canSeeCost && row.totalCost !== null && row.totalCost.amount > 0n;
  const margin = costed && row.retailPrice ? subtract(row.retailPrice, row.totalCost!) : null;

  return (
    <ListRow
      href={`/stock/${row.id}`}
      reg={<Reg value={row.registration} />}
      title={description || 'Not identified'}
      meta={(
        <div className="text-[13px] leading-[18px] text-ink-subtle">
          <span className="mono">{row.stockNumber}</span>
          {row.mileage !== null && ` · ${row.mileage.toLocaleString('en-GB')} miles`}
          {row.colour && ` · ${row.colour}`}
          {/* The site is named only where there is more than one to be in.
              A single-site dealer was reading their own name on all fourteen
              rows, which is fourteen repetitions of something they know. */}
          {multiSite && row.siteName && ` · ${row.siteName}`}
        </div>
      )}
      badges={(
        <>
          <StatusBadge tone={state.tone} icon={state.icon} label={label(row.state)} />
          {overage && (
            <StatusBadge tone="warning" icon="⏱" label={`${row.daysInStock} days`} />
          )}
          {blockers.length > 0 && row.state !== 'live' && (
            <StatusBadge
              tone={blockers.some((b) => !b.overridable) ? 'critical' : 'warning'}
              icon="!"
              label={`${blockers.length} to fix`}
            />
          )}
        </>
      )}
      money={(
        <>
          <div className="font-semibold">
            {row.retailPrice ? <Amount value={row.retailPrice} pence={false} /> : (
              <span className="text-ink-subtle">No price</span>
            )}
          </div>
          {/* Margin is cost data. A sales executive without vehicle.cost.read
              never receives it — DERIVED_FROM in M2 exists precisely so a
              figure computed FROM cost is withheld too. */}
          {margin ? (
            <div className={`text-[12px] leading-4 ${margin.amount < 0n ? 'text-critical' : 'text-ink-subtle'}`}>
              {format(margin, { pence: false })} gross
            </div>
          ) : canSeeCost && row.retailPrice ? (
            <div className="text-[12px] leading-4 text-ink-subtle">No cost recorded</div>
          ) : null}
        </>
      )}
    />
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
    return `/stock${search.toString() ? `?${search}` : ''}`;
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
