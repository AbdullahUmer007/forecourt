import Link from 'next/link';
import { requireOperator } from '@/auth/session';
import { loadPlatform, type TenantRow } from '@/data/platform';
import { Card, Figure, StatusBadge, Empty, Amount, type Tone } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The tenant directory.
 *
 * Counts, never contents. This application can say how many cars a dealership
 * has and never what any of them is; `app_platform` has no grant on
 * `contacts`, `leads`, `deals`, `invoices` or `deal_evidence`, so that is the
 * database's rule rather than this page's good intentions.
 *
 * A stock band is RECOMMENDED and never applied. A dealer who buys ten cars
 * for a bank holiday weekend should not discover their direct debit has gone
 * up; a price rise is a conversation, and one that happens silently ends up on
 * a forum.
 */

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default async function Directory() {
  await requireOperator();
  const view = await loadPlatform();

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Dealerships</h1>
        <p className="text-ink-muted">
          {view.summary.tenants} on the platform
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card><Figure label="Live" value={String(view.summary.live)} /></Card>
        <Card><Figure label="On trial" value={String(view.summary.trialing)} /></Card>
        <Card>
          <Figure
            label="Past due"
            value={String(view.summary.pastDue)}
            {...(view.summary.pastDue > 0
              ? { hint: 'Dunning never withholds the stock book or the VAT records' }
              : {})}
          />
        </Card>
        <Card>
          <Figure
            label="Monthly recurring"
            value={new Intl.NumberFormat('en-GB', {
              style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
            }).format(Number(view.summary.monthlyRecurring.amount) / 100)}
            hint="Active subscriptions only"
          />
        </Card>
      </div>

      {view.tenants.length === 0 ? (
        <Empty title="No dealerships yet">
          A tenant appears here the moment it is provisioned. This directory shows counts and
          billing state — never a dealership&rsquo;s own records.
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {view.tenants.map((t) => <TenantView key={t.id} tenant={t} />)}
        </ul>
      )}
    </>
  );
}

function TenantView({ tenant }: { tenant: TenantRow }) {
  const dunningTone: Tone = tenant.dunning?.restricted
    ? 'critical'
    : tenant.subscriptionStatus === 'past_due' ? 'warning' : 'good';

  return (
    <li>
      <Link
        href={`/tenants/${tenant.id}`}
        className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface-1 p-3 hover:border-edge-strong hover:bg-surface-3"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">{tenant.name}</div>
          <div className="text-[13px] leading-[18px] text-ink-subtle">
            {tenant.liveStock} live · {tenant.totalStock} in stock · {tenant.staff} staff
            {tenant.unitsThisMonth > 0 && ` · ${tenant.unitsThisMonth} sold this month`}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="neutral" icon="·" label={label(tenant.status)} />
          {tenant.plan && (
            <StatusBadge tone="info" icon="◆" label={label(tenant.plan)} />
          )}
          {tenant.subscriptionStatus && (
            <StatusBadge
              tone={dunningTone}
              icon={tenant.subscriptionStatus === 'past_due' ? '!' : '✓'}
              label={label(tenant.subscriptionStatus)}
            />
          )}
          {/* Recommended, never applied. */}
          {/* `changed`, and the band's own name — a recommendation the
              operator can act on in a conversation, never applied here. */}
          {tenant.band?.changed && (
            <StatusBadge
              tone="warning" icon="↕"
              label={`Suggest ${tenant.band.recommended.plan} band`}
            />
          )}
          {tenant.supportGranted && (
            <StatusBadge
              tone="warning" icon="◉"
              label={`Support access to ${date(tenant.supportGrantExpiresAt)}`}
            />
          )}
        </div>

        <div className="w-28 text-right">
          {tenant.monthlyPrice
            ? <span className="font-semibold"><Amount value={tenant.monthlyPrice} /></span>
            : <span className="text-ink-subtle">No plan</span>}
        </div>
      </Link>
    </li>
  );
}
