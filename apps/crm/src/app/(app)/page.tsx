import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadOwnerDashboard } from '@/data/dashboard';
import { Card, Figure, StatusBadge, Empty } from '@/components/ui';
import { holds, format, OVERAGE_DAYS, MIN_SALES_FOR_AVERAGE, type Money } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The owner dashboard.
 *
 * §26.1's twenty-second, one-handed view: what is my money doing, what did I
 * sell, what is stuck, and who is waiting for an answer. A dealer principal
 * looks at this on a phone on a Monday morning and acts on whatever it says,
 * which is the whole argument for it saying "not yet" when that is the truth
 * rather than an average built from two cars.
 *
 * Every tile links through to the records behind it. Design rule 5 — a figure
 * that cannot be opened is a figure nobody can check, and one unverifiable
 * number costs the screen its credibility on every other number too.
 *
 * This page used to `redirect('/appraisals')` because the dashboard did not
 * exist. That was the honest thing to do at the time.
 */

/** Whole pounds. A dashboard reads at a glance; pence do not help at a glance. */
const pounds = (m: Money): string =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: m.currency, maximumFractionDigits: 0,
  }).format(Number(m.amount) / 100);

export default async function Dashboard() {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');
  const canSeeReports = holds(principal, 'report.read');

  const view = await loadOwnerDashboard(session, canSeeCost);
  const d = view.dashboard;

  const targetProgress = d.unitsTarget !== null && d.unitsTarget > 0
    ? Math.round((d.unitsSoldMtd / d.unitsTarget) * 100)
    : null;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">
          {session.displayName.split(' ')[0]}
        </h1>
        <p className="text-ink-muted">
          {view.monthLabel}
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1. What the money is doing. */}
        <Card>
          {canSeeCost ? (
            <Link href="/stock" className="block">
              <Figure
                label="Stock at cost"
                value={pounds(d.stockValueAtCost)}
                size="lg"
                hint="Every car held, at what it cost to put on the forecourt"
              />
            </Link>
          ) : (
            <Figure label="Stock at cost" value="—" hint="Not shown on your role" />
          )}
        </Card>

        {/* 2. Units, against the target if one is set. */}
        <Card>
          <Link href="/deals?state=delivered" className="block">
            <Figure
              label="Units this month"
              value={String(d.unitsSoldMtd)}
              size="lg"
              hint={d.unitsTarget !== null
                ? `${d.unitsSoldMtd} of ${d.unitsTarget} — ${targetProgress}% of target`
                : 'No monthly target set'}
            />
          </Link>
          {d.unitsTarget !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              {/* A proportion, capped so 130% does not overflow the track. The
                  number above is the truth; this is only its shape. */}
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${Math.min(100, targetProgress ?? 0)}%` }}
              />
            </div>
          )}
        </Card>

        {/* 3. Average gross — null below the floor, never a figure from two cars. */}
        <Card>
          {!canSeeCost ? (
            <Figure label="Average gross per unit" value="—" hint="Not shown on your role" />
          ) : d.averageGrossPerUnit ? (
            <Link href="/deals?state=delivered" className="block">
              <Figure
                label="Average gross per unit"
                value={format(d.averageGrossPerUnit)}
                size="lg"
                hint={`Across ${d.unitsSoldMtd} units delivered this month`}
              />
            </Link>
          ) : (
            <Figure
              label="Average gross per unit"
              value="Not yet"
              hint={`Fewer than the ${MIN_SALES_FOR_AVERAGE} units an average needs to mean anything`}
            />
          )}
        </Card>

        {/* 4. Days to sell, with the trend. A FALLING number is good news — the
               one place on this screen where down is up. */}
        <Card>
          {d.averageDaysToSell !== null ? (
            <>
              <Figure
                label="Average days to sell"
                value={String(d.averageDaysToSell)}
                size="lg"
              />
              <div className="mt-2">
                {d.daysToSellTrend === 'improving' && (
                  <StatusBadge tone="good" icon="↓" label="Faster than last month" />
                )}
                {d.daysToSellTrend === 'worsening' && (
                  <StatusBadge tone="warning" icon="↑" label="Slower than last month" />
                )}
                {d.daysToSellTrend === 'flat' && (
                  <StatusBadge tone="neutral" icon="→" label="Same as last month" />
                )}
                {d.daysToSellTrend === 'unknown' && (
                  <span className="text-[12px] leading-4 text-ink-subtle">
                    No comparable month yet
                  </span>
                )}
              </div>
            </>
          ) : (
            <Figure label="Average days to sell" value="Not yet" hint="Too few sales this month" />
          )}
        </Card>

        {/* 5. Overage — the capital a dealer cannot get at. */}
        <Card>
          <Link href="/stock?overage=1" className="block">
            <Figure
              label={`Over ${OVERAGE_DAYS} days`}
              value={String(d.overageUnits)}
              size="lg"
              hint={d.overageUnits === 0
                ? 'Nothing stuck'
                : canSeeCost
                  ? `${pounds(d.overageCapital)} of capital tied up`
                  : 'Cars a buyer should be looking at'}
            />
          </Link>
        </Card>

        {/* 6. Who is waiting. The only tile that is about the next hour. */}
        <Card>
          <Link href="/leads" className="block">
            <Figure
              label="Leads today"
              value={String(d.leadsToday)}
              size="lg"
              hint={d.leadsAwaitingFirstResponse > 0
                ? `${d.leadsAwaitingFirstResponse} still waiting for a first reply`
                : 'Everyone has had an answer'}
            />
          </Link>
          {d.leadsAwaitingFirstResponse > 0 && (
            <div className="mt-2">
              <Link
                href="/leads?overdue=1"
                className="text-[13px] leading-[18px] text-brand-700 hover:underline"
              >
                Show the ones past their target →
              </Link>
            </div>
          )}
        </Card>
      </div>

      {/* What the tiles above are NOT telling you. Placed under them rather
          than as footnotes on each, so a caveat cannot be missed by somebody
          reading only the big numbers. */}
      {d.caveats.length > 0 && (
        <Card title="Worth knowing" className="mb-4">
          <ul className="grid gap-2">
            {d.caveats.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-ink-subtle">·</span>
                <span className="text-ink-muted">{c}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canSeeReports ? (
        <Card
          title="Where the sales came from"
          action={(
            <Link href="/reports/channels" className="text-[13px] leading-[18px] text-brand-700 hover:underline">
              Open the Channel P&amp;L →
            </Link>
          )}
        >
          <p className="text-ink-muted">
            What each advertising channel costs, what it brought in, and what it made — the table
            to take into the next renewal conversation. Sales are credited to one channel each,
            never split, and a channel with too few sales to be sure of reports no ROI rather than
            a flattering one.
          </p>
        </Card>
      ) : (
        <Empty title="Reports are not on your role">
          The Channel P&amp;L shows advertising spend against the sales it produced. Ask an owner
          or a manager for report access.
        </Empty>
      )}
    </>
  );
}
