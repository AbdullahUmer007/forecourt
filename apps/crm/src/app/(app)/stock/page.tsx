import Link from 'next/link';
import { StockPhoto } from '@/components/stock-photo';
import { requireSession } from '@/auth/session';
import { loadStock, loadStockOverview, type StockRow } from '@/data/stock';
import {
  StatusBadge, Empty, Amount, Reg, PageHeader, ButtonLink,  type Tone,
} from '@/components/ui';
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

  const requestedOffset = Number(params['offset'] ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const page = await loadStock(session, {
    q: params['q'],
    state: params['state'],
    make: params['make'],
    overageOnly: params['overage'] === '1',
    sort: (params['sort'] as 'newest' | undefined) ?? 'newest',
    limit: 50,
    offset,
  }, canSeeCost);

  const overview = await loadStockOverview(session);
  const list = params['view'] === 'list';
  const viewQuery = (view: string) => { const p = new URLSearchParams(); for (const [k,v] of Object.entries(params)) if (v) p.set(k,v); p.set('view',view); return `/stock?${p}`; };
  const filtered = Boolean(params['q'] || params['state'] || params['make'] || params['overage']);

  // Name the site only when the rows on screen are not all from the same one.
  // A field whose value is identical on every visible row carries no
  // information and costs a dealer the width it takes up.
  const multiSite = new Set(page.rows.map((r) => r.siteName)).size > 1;

  return (
    <>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-ink-subtle">INVENTORY MANAGEMENT</p>
      {params['archived'] === '1' && <p role="status" className="mb-4 rounded-md border border-edge bg-surface-1 p-4">Vehicle archived. It has been removed from active stock and the public website.</p>}
      <PageHeader
        title="Your stock"
        meta={(
          <>
            {page.total.toLocaleString('en-GB')} car{page.total === 1 ? '' : 's'}
            {filtered && ' matching'}
             · Manage listings, pricing and presentation.
          </>
        )}
        // The one primary action on this screen.
        action={holds(principal, 'vehicle.create')
          ? <ButtonLink href="/stock/new" variant="primary">+ Add a vehicle</ButtonLink>
          : undefined}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { title: 'Total stock', count: overview.total, hint: 'Across all stages', href: '/stock' },
          { title: 'Live on website', count: overview.live, hint: 'Ready for your next buyer', href: '/stock?state=live' },
          { title: 'In preparation', count: overview.prep, hint: 'Keep the workshop moving', href: '/stock?state=in_prep' },
          { title: 'Reserved', count: overview.reserved, hint: 'On the way to a handover', href: '/stock?state=reserved' },
        ].map(m => <Link key={m.title} href={m.href} className="stock-metric"><div className="flex items-center justify-between gap-2 text-[13px] font-medium">{m.title}<span aria-hidden="true">↗</span></div><div className="my-3 text-[34px] leading-10 font-semibold tracking-tight tabular-nums">{m.count}</div><p className="text-[12px] opacity-80">{m.hint}</p></Link>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[19px] font-semibold">Vehicle inventory</h2><nav aria-label="Inventory view" className="flex rounded-md border border-edge bg-surface-1 p-1">{['grid','list'].map(v => <Link key={v} href={viewQuery(v)} aria-current={(list ? v === 'list' : v === 'grid') ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-sm px-4 text-[13px] font-medium ${(list ? v === 'list' : v === 'grid') ? 'bg-brand-50 text-link' : 'text-ink-muted'}`}>{label(v)} view</Link>)}</nav></div>
      {/* A GET form: no JavaScript, and the filter state lives in the URL. */}
      <form method="GET" className="mb-5 grid gap-3 rounded-lg border border-edge bg-surface-1 p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <input type="hidden" name="view" value={list ? 'list' : 'grid'} />
        <label className="grid min-w-0 gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Search
          </span>
          <input
            name="q"
            defaultValue={params['q'] ?? ''}
            placeholder="Reg, make, model, stock number…"
            className="min-h-11 min-w-0 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Status
          </span>
          <select
            name="state"
            defaultValue={params['state'] ?? ''}
            className="min-h-11 min-w-0 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {params['state'] && !page.states.some(s => s.state === params['state']) && <option value={params['state']}>{label(params['state'])} (0)</option>}
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
            className="min-h-11 min-w-0 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {page.makes.map((m) => (
              <option key={m.make} value={m.make}>{m.make} ({m.count})</option>
            ))}
          </select>
        </label>

        <label className="grid min-w-0 gap-1"><span className="text-[12px] font-medium text-ink-subtle">Sort by</span><select name="sort" defaultValue={params['sort'] ?? 'newest'} className="min-h-11 min-w-0 rounded-md border border-edge-strong bg-surface-1 px-3"><option value="newest">Newest stock</option><option value="oldest">Oldest stock</option><option value="price_low">Price: low to high</option><option value="price_high">Price: high to low</option></select></label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="min-h-11 min-w-0 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
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

        <label className="flex items-center gap-2 sm:col-span-2 xl:col-span-5">
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

      {/* Set by a screen that turned the dealer away — say which permission,
          and who can grant it, rather than only that they cannot. */}
      {params['denied'] && (
        <p role="alert" className="mb-4 rounded-md border border-critical/40 bg-surface-1 p-3 text-ink-muted">
          <span aria-hidden="true">✕</span> You do not have permission to do that
          (<span className="mono">{params['denied']}</span>). Whoever manages your
          dealership account can grant it.
        </p>
      )}

      {page.rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches that' : 'No stock yet'}>
          {filtered
            ? 'Try clearing a filter. The counts beside each option show what is actually there.'
            : 'Cars appear here from the moment they are sourced, not just once they are live — '
              + 'so the ones sitting in prep are as visible as the ones on the forecourt.'}
          {!filtered && holds(principal, 'vehicle.create') && (
            <Link
              href="/stock/new"
              className="mt-3 inline-flex min-h-11 items-center rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
            >
              Book the first car in
            </Link>
          )}
        </Empty>
      ) : (
        <ul className={list ? 'stock-list grid gap-4' : 'grid gap-5 md:grid-cols-2 2xl:grid-cols-3'}>
          {page.rows.map((row) => (
            <StockRowView key={row.id} row={row} canSeeCost={canSeeCost} multiSite={multiSite} />
          ))}
        </ul>
      )}

      {page.total > page.rows.length && (
        <Pager
          total={page.total}
          shown={page.rows.length}
          offset={offset}
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

  return <li className="stock-card"><Link href={`/stock/${row.id}`} className="h-full">
    <div className="relative"><StockPhoto url={row.photoUrl ?? null} description={`${description}, ${row.registration}`} /><div className="absolute left-3 top-3 rounded-md bg-surface-1 p-1"><StatusBadge tone={state.tone} icon={state.icon} label={label(row.state)} /></div></div>
    <div className="flex min-w-0 flex-col p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Reg value={row.registration} /><span className="text-[11px] text-ink-subtle">{row.stockNumber}</span></div>
      <h3 className="text-[19px] font-semibold tracking-tight">{[row.make,row.model].filter(Boolean).join(' ') || 'Vehicle details needed'}</h3><p className="mt-1 min-h-5 truncate text-[13px] text-ink-muted">{row.derivative || 'Complete the vehicle specification'}</p>
      <p className="mt-3 text-[12px] text-ink-subtle">{[row.mileage === null ? 'Mileage needed' : `${row.mileage.toLocaleString('en-GB')} miles`, row.colour, `${row.publishedPhotoCount} published photos`, multiSite ? row.siteName : null].filter(Boolean).join(' · ')}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-edge pt-4"><div><p className="text-[11px] text-ink-subtle">Retail price</p><div className="mt-1 text-[23px] font-semibold tracking-tight">{row.retailPrice ? <Amount value={row.retailPrice} pence={false} /> : <span className="text-[16px] text-ink-muted">Set a price</span>}</div>{margin && <p className="mt-1 text-[12px] text-ink-subtle">{format(margin, { pence: false })} gross</p>}</div><span className={`text-[12px] ${overage ? 'text-warning-ink' : 'text-ink-subtle'}`}>{row.daysInStock === null ? 'Not booked in' : `${row.daysInStock} days in stock`}</span></div>
      {blockers.length > 0 && !['live','reserved','sold','delivered','archived'].includes(row.state) && <p className="mt-3 text-[12px] text-warning-ink">{blockers.length} publishing checks need attention →</p>}
    </div>
  </Link></li>;
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
