import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadChannelPnl, loadChannelLabels } from '@/data/dashboard';
import { Card, Figure, StatusBadge, Empty, Amount, Problem } from '@/components/ui';
import { SpendForm } from '@/components/spend-form';
import {
  holds, format, channelDisplayName, UNATTRIBUTED, MIN_SALES_FOR_ROI,
  type ChannelPnlRow,
} from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Channel P&L' };

/**
 * The Channel P&L — the table a dealer takes into a renewal negotiation.
 *
 * Its whole value is being believable in a room with somebody from Auto
 * Trader, so the design follows from that:
 *
 *  - Every row drills through to the leads and the deals behind it. A figure
 *    that cannot be opened is a figure the other side can wave away.
 *  - A channel with too few sales reports NO ROI rather than a flattering one.
 *    A dealer who cancels on the strength of four sales will not blame their
 *    own sample size, and we will have handed them the number.
 *  - Estimated spend is marked on the row.
 *  - Unattributed sales are a named row, never dropped. A dealer whose walk-in
 *    trade is a third of their business needs to see that, and excluding it
 *    overstates every other channel's share.
 *
 * A table, not a chart. The artefact here is a page a dealer prints or exports
 * and puts on a desk; a bar chart of six channels is decoration next to that,
 * and the design system requires a table view beside every chart anyway.
 */

/**
 * Channel names come from the domain, not from a copy here.
 *
 * The CSV is generated from the same rows, and the first version of this had
 * its own map — so the screen said "Website test drive" and the exported file
 * said `website_test_drive`. The file is the artefact that ends up on somebody
 * else's desk, so it is the one that must not look unfinished.
 */
const label = channelDisplayName;

const day = (d: Date): string => d.toISOString().slice(0, 10);

export default async function ChannelPnlPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const session = await requireSession();
  const params = await searchParams;

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'report.read')) notFound();

  // Gross and ROI are cost data. The rest of the table — spend, leads, cost
  // per lead, sales — reveals nothing about what a car cost, so it stays.
  // Blanking the whole report would be easier and would take a working tool
  // away from the person who actually books the advertising.
  const canSeeCost = holds(principal, 'vehicle.cost.read');
  const canRecordSpend = holds(principal, 'report.financial.read');

  const [view, channels] = await Promise.all([
    loadChannelPnl(session, { from: params['from'], to: params['to'] }, canSeeCost),
    loadChannelLabels(session),
  ]);
  const { pnl } = view;

  const thisMonth = new Date();
  const defaultMonth = day(new Date(Date.UTC(
    thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 1)));

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Channel P&amp;L</h1>
        <p className="text-ink-muted">
          {day(pnl.from)} to {day(pnl.to)}
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
          {' · '}
          <Link href="/" className="text-link hover:underline">Dashboard</Link>
        </p>
      </div>

      <form method="GET" className="mb-4 grid gap-2 rounded-md border border-edge bg-surface-1 p-3 sm:grid-cols-[auto_auto_auto_1fr]">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            From
          </span>
          <input
            type="date" name="from" defaultValue={params['from'] ?? day(pnl.from)}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            To
          </span>
          <input
            type="date" name="to" defaultValue={params['to'] ?? day(pnl.to)}
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
          <a
            href={`/reports/channels/export?from=${day(pnl.from)}&to=${day(pnl.to)}`}
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
          >
            Download CSV
          </a>
        </div>
      </form>

      {/* What the table is not telling you, before the table rather than
          after it. A caveat under a number has already been ignored. */}
      {pnl.caveats.length > 0 && (
        <Card title="Read this first" className="mb-4">
          <ul className="grid gap-2">
            {pnl.caveats.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-ink-subtle">·</span>
                <span className="text-ink-muted">{c}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pnl.silentChannels.length > 0 && (
        <Problem title={`${pnl.silentChannels.length} channel${pnl.silentChannels.length === 1 ? '' : 's'} you are paying for and getting nothing from`}>
          <p>
            Spend recorded, not one lead in this period:{' '}
            <strong>{pnl.silentChannels.map(label).join(', ')}</strong>. Either the listing is not
            live, the leads are arriving under another source, or it genuinely is not working —
            worth ten minutes before the next renewal.
          </p>
        </Problem>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card><Figure label="Spend" value={format(pnl.totals.spend, { pence: false })} /></Card>
        <Card><Figure label="Leads" value={String(pnl.totals.leads)} /></Card>
        <Card><Figure label="Sales" value={String(pnl.totals.sales)} /></Card>
        <Card>
          {canSeeCost ? (
            <Figure
              label="Gross profit"
              value={format(pnl.totals.grossProfit, { pence: false })}
              hint={pnl.totals.roi === null
                ? 'No spend recorded to compare against'
                : `${pnl.totals.roi}× on advertising spend`}
            />
          ) : (
            <Figure label="Gross profit" value="—" hint="Not shown on your role" />
          )}
        </Card>
      </div>

      {pnl.rows.length === 0 ? (
        <Empty title="Nothing to report for that period">
          The P&amp;L needs two things: spend recorded against a channel, and leads or sales in the
          window. Record what a channel cost below and the rest fills itself in.
        </Empty>
      ) : (
        <Card title="By channel">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] leading-[18px]">
              <thead>
                <tr className="border-b border-edge text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Channel</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Spend</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Leads</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Per lead</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Sales</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Per sale</th>
                  {canSeeCost && (
                    <>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Gross</th>
                      <th scope="col" className="py-2 text-right font-medium">ROI</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {pnl.rows.map((row) => (
                  <PnlRowView key={row.channel} row={row} canSeeCost={canSeeCost} />
                ))}
              </tbody>
            </table>
          </div>

          {/* The reasons, under the table. A "—" the reader cannot explain is
              a "—" they assume is a bug.
              The summary already opens with the channel's display name, so it
              is not repeated here — printing it twice is what produced the
              "Auto Trader — autotrader:" line this replaces. */}
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] leading-[18px] text-link">
              Why some figures are dashes
            </summary>
            <ul className="mt-1 grid gap-1 text-[12px] leading-4 text-ink-subtle">
              {pnl.rows.filter((r) => r.summary).map((r) => (
                <li key={r.channel}>{r.summary}</li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {view.unattributedSales > 0 && (
        <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
          {view.unattributedSales} sale{view.unattributedSales === 1 ? '' : 's'} could not be traced
          to a channel and {view.unattributedSales === 1 ? 'is' : 'are'} counted under
          “{UNATTRIBUTED}”. That is a real answer, not a gap — a walk-in is a walk-in.
        </p>
      )}

      {canRecordSpend && (
        <Card title="Record what a channel cost" className="mt-4">
          <p className="mb-3 text-ink-muted">
            One figure per channel per month. Entering it again for the same month replaces it —
            which is what happens when the invoice arrives and confirms an estimate.
          </p>
          <SpendForm channels={channels} defaultMonth={defaultMonth} />
        </Card>
      )}
    </>
  );
}

function PnlRowView({ row, canSeeCost }: { row: ChannelPnlRow; canSeeCost: boolean }) {
  const from = day(row.drillThrough.from);
  const to = day(row.drillThrough.to);
  const isUnattributed = row.channel === UNATTRIBUTED;

  return (
    <tr className="border-b border-edge last:border-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        {/* Design rule 5: every number opens its source records. An
            unattributed row has no channel to filter by, so it links to the
            deals rather than pretending to a lead filter it cannot honour. */}
        <Link
          href={isUnattributed
            ? '/deals?state=delivered'
            : `/leads?source=${encodeURIComponent(row.channel)}&from=${from}&to=${to}&closed=1`}
          className="text-link hover:underline"
        >
          {label(row.channel)}
        </Link>
        <span className="ml-2 inline-flex gap-1.5">
          {row.spendEstimated && (
            <StatusBadge tone="warning" icon="~" label="Estimated" />
          )}
          {row.lowConfidence && row.sales > 0 && (
            <StatusBadge tone="neutral" icon="?" label={`Under ${MIN_SALES_FOR_ROI} sales`} />
          )}
        </span>
      </th>
      <td className="py-2 pr-3 text-right tnum">
        {row.spend ? <Amount value={row.spend} pence={false} /> : <span className="text-ink-subtle">—</span>}
      </td>
      <td className="py-2 pr-3 text-right tnum">{row.leads}</td>
      <td className="py-2 pr-3 text-right tnum">
        {/* A blank, never £0.00. "£0.00 cost per lead" reads as free; the
            truth is there were no leads to divide by. */}
        {row.costPerLead
          ? <Amount value={row.costPerLead} pence={false} />
          : <span className="text-ink-subtle">—</span>}
      </td>
      <td className="py-2 pr-3 text-right tnum">{row.sales}</td>
      <td className="py-2 pr-3 text-right tnum">
        {row.costPerSale
          ? <Amount value={row.costPerSale} pence={false} />
          : <span className="text-ink-subtle">—</span>}
      </td>
      {canSeeCost && (
        <>
          <td className="py-2 pr-3 text-right tnum">
            <Amount value={row.grossProfit} pence={false} />
          </td>
          <td className="py-2 text-right tnum">
            {row.roi === null
              ? <span className="text-ink-subtle">—</span>
              : <span className={row.roi < 1 ? 'text-critical' : ''}>{row.roi}×</span>}
          </td>
        </>
      )}
    </tr>
  );
}
