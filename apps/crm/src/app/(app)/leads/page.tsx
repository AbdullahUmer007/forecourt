import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadInbox, loadLossAnalysis, type LeadRow } from '@/data/leads';
import { StatusBadge, Empty, Reg, Card, Figure, type Tone } from '@/components/ui';
import { LOSS_REASON_LABELS, type LeadStage, type LeadSource } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The lead inbox.
 *
 * Ordered by who is closest to being lost, not by who arrived last. A
 * marketplace buyer has enquired on four cars and is waiting for whoever
 * answers first; newest-first ordering buries the ninety-minute-old enquiry
 * under the ninety-second-old one, which is exactly backwards.
 *
 * Every SLA figure is shown as a clock time as well as a countdown. A rendered
 * "12 min to respond" is only true at the moment it rendered, and a tab left
 * open for an hour would otherwise be quietly lying; "Due 14:32" stays true.
 */

const STAGE_PRESENTATION: Record<LeadStage, { tone: Tone; icon: string }> = {
  new: { tone: 'info', icon: '●' },
  contacted: { tone: 'info', icon: '☎' },
  qualified: { tone: 'info', icon: '✓' },
  appointment: { tone: 'info', icon: '⌚' },
  test_drive: { tone: 'info', icon: '⇢' },
  negotiating: { tone: 'warning', icon: '⇄' },
  won: { tone: 'good', icon: '£' },
  lost: { tone: 'neutral', icon: '✕' },
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  website_enquiry: 'Website enquiry',
  website_callback: 'Callback request',
  website_test_drive: 'Test drive request',
  website_part_ex: 'Part-exchange enquiry',
  website_reserve: 'Reserve online',
  saved_search: 'Saved search alert',
  phone: 'Phone',
  walk_in: 'Walk-in',
  autotrader: 'Auto Trader',
  ebay: 'eBay',
  cargurus: 'CarGurus',
  facebook: 'Facebook',
  other_marketplace: 'Marketplace',
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const clock = (d: Date): string =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const when = (d: Date): string => {
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? clock(d)
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + clock(d);
};

export default async function LeadsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const closed = params['closed'] === '1';
  const page = await loadInbox(session, {
    q: params['q'],
    stage: params['stage'],
    source: params['source'],
    assigned: params['assigned'],
    overdueOnly: params['overdue'] === '1',
    includeClosed: closed,
    // Carried from the Channel P&L's drill-through, so the list a dealer opens
    // is exactly the leads the number counted.
    receivedFrom: params['from'],
    receivedTo: params['to'],
    limit: 50,
    offset: Number(params['offset'] ?? 0) || 0,
  });

  const losses = closed ? await loadLossAnalysis(session, 90) : [];
  const filtered = Boolean(
    params['q'] || params['stage'] || params['source'] || params['assigned']
    || params['overdue'] || params['from'] || params['to']);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Leads</h1>
        <p className="text-ink-muted">
          {page.total.toLocaleString('en-GB')} {closed ? 'lead' : 'open lead'}
          {page.total === 1 ? '' : 's'}
          {filtered && ' matching'}
          {params['from'] && params['to'] && ` · ${params['from']} to ${params['to']}`}
          {' · '}
          <span className={page.queryMs > 400 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {page.queryMs}ms
          </span>
        </p>
      </div>

      {/* The strip counts the whole open book, never the filtered page. "You
          have six overdue" must not change when somebody filters to one
          salesperson — that is the number they came here for. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card>
          <Figure label="Waiting for a reply" value={String(page.summary.unanswered)} />
        </Card>
        <Card>
          <Figure
            label="Past the response target"
            value={String(page.summary.breachedSla)}
            {...(page.summary.breachedSla > 0
              ? { hint: 'A marketplace buyer is ringing the next dealer on their list.' }
              : {})}
          />
          {page.summary.breachedSla > 0 && (
            <div className="mt-2">
              <Link
                href="/leads?overdue=1"
                className="text-[13px] leading-[18px] text-brand-700 hover:underline"
              >
                Show them →
              </Link>
            </div>
          )}
        </Card>
        <Card>
          <Figure label="Open" value={String(page.summary.open)} />
        </Card>
        <Card>
          <Figure
            label="Converted"
            /* Null, not 0%, when nothing has closed: 0% reads as failure
               where the truth is that there is no data yet. */
            value={page.summary.conversionRate === null
              ? '—'
              : `${Math.round(page.summary.conversionRate * 100)}%`}
            hint={page.summary.conversionRate === null
              ? 'No leads closed yet'
              : `${page.summary.byStage.won} won of ${page.summary.byStage.won + page.summary.byStage.lost} closed`}
          />
        </Card>
      </div>

      <form method="GET" className="mb-4 grid gap-2 rounded-md border border-edge bg-surface-1 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Search
          </span>
          <input
            name="q"
            defaultValue={params['q'] ?? ''}
            placeholder="Name, email, phone, reg, what they said…"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Stage
          </span>
          <select
            name="stage"
            defaultValue={params['stage'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {(Object.keys(STAGE_PRESENTATION) as LeadStage[]).map((s) => (
              <option key={s} value={s}>
                {label(s)} ({page.summary.byStage[s]})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Source
          </span>
          <select
            name="source"
            defaultValue={params['source'] ?? ''}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">All</option>
            {page.sources.map((s) => (
              <option key={s.source} value={s.source}>
                {SOURCE_LABELS[s.source]} ({s.count})
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
              href="/leads"
              className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
            >
              Clear
            </Link>
          )}
        </div>

        {/* Carried through the form so filtering does not silently widen a
            drill-through back to all time. */}
        {params['from'] && <input type="hidden" name="from" value={params['from']} />}
        {params['to'] && <input type="hidden" name="to" value={params['to']} />}

        <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox" name="overdue" value="1"
              defaultChecked={params['overdue'] === '1'}
              className="h-5 w-5"
            />
            <span className="text-ink-muted">Past the response target</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox" name="assigned" value="me"
              defaultChecked={params['assigned'] === 'me'}
              className="h-5 w-5"
            />
            <span className="text-ink-muted">Mine only</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox" name="closed" value="1"
              defaultChecked={closed}
              className="h-5 w-5"
            />
            <span className="text-ink-muted">Include closed</span>
          </label>
        </div>
      </form>

      {/* The report the mandatory loss reason exists to produce. Shown beside
          the closed leads rather than buried in a reporting section, because
          "eleven lost on part-exchange valuations" is a buying instruction. */}
      {closed && losses.length > 0 && (
        <Card title="Why leads were lost — last 90 days" className="mb-4">
          <ul className="grid gap-1">
            {losses.map((l) => (
              <li key={l.reason} className="flex items-baseline justify-between gap-4">
                <span>{LOSS_REASON_LABELS[l.reason]}</span>
                <span className="mono font-semibold tabular-nums">{l.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {page.rows.length === 0 ? (
        <Empty title={filtered ? 'Nothing matches that' : 'No open leads'}>
          {filtered
            ? 'Try clearing a filter. The counts beside each option show what is actually there.'
            : 'Enquiries from the website, Auto Trader and saved-search alerts land here the '
              + 'moment they arrive, with a response clock running on each one.'}
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {page.rows.map((row) => <LeadRowView key={row.id} row={row} />)}
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

function LeadRowView({ row }: { row: LeadRow }) {
  const stage = STAGE_PRESENTATION[row.stage];
  const open = row.closedAt === null;
  // Answered, unanswered-and-late, unanswered-and-in-time: three genuinely
  // different situations, and only one of them is urgent.
  const late = open && row.firstResponseAt === null && row.sla.breached;

  return (
    <li>
      <Link
        href={`/leads/${row.id}`}
        className={`flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-surface-1 p-3 hover:bg-surface-3 ${
          late ? 'border-critical' : 'border-edge hover:border-edge-strong'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{row.contactName}</span>
            <span className="text-[13px] leading-[18px] text-ink-subtle">
              {SOURCE_LABELS[row.source]} · {when(row.receivedAt)}
            </span>
          </div>
          <div className="truncate text-[13px] leading-[18px] text-ink-muted">
            {row.vehicleDescription ?? 'General enquiry — no particular car'}
            {row.assignedToName ? ` · ${row.assignedToName}` : ' · Nobody assigned'}
          </div>
          {row.message && (
            <div className="mt-1 truncate text-[13px] leading-[18px] text-ink-subtle">
              “{row.message}”
            </div>
          )}
        </div>

        {row.vehicleRegistration && <Reg value={row.vehicleRegistration} />}

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={stage.tone} icon={stage.icon} label={label(row.stage)} />

          {open && row.firstResponseAt === null && (
            <StatusBadge
              tone={late ? 'critical' : row.sla.minutesRemaining <= 5 ? 'warning' : 'info'}
              icon={late ? '!' : '⏱'}
              /* The countdown AND the clock time: the countdown is only true
                 at the moment it rendered. */
              label={row.dueAt
                ? `${row.sla.label} · due ${clock(row.dueAt)}`
                : row.sla.label}
            />
          )}

          {row.firstResponseAt !== null && (
            <StatusBadge
              tone={row.sla.breached ? 'warning' : 'good'}
              icon={row.sla.breached ? '!' : '✓'}
              label={row.sla.label}
            />
          )}

          {row.stage === 'lost' && row.lossReason && (
            <StatusBadge tone="neutral" icon="✕" label={LOSS_REASON_LABELS[row.lossReason]} />
          )}
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
    return `/leads${search.toString() ? `?${search}` : ''}`;
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
