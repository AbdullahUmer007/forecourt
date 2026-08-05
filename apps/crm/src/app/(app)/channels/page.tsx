import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadChannels, type ChannelRow, type ListingRow } from '@/data/channels';
import { Card, Figure, StatusBadge, Empty, Amount, Problem, type Tone } from '@/components/ui';
import { holds, formatRegistration, type ListingStatus } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * Channel feed status.
 *
 * The question this answers is the one a dealer asks when the phone is quiet:
 * is my stock actually ON Auto Trader? Every portal has its own schema and its
 * own idea of a valid mileage, so the honest answer is per-car and per-channel
 * and it is frequently no.
 *
 * Ordered by what costs money. A sold car still advertised is a complaint and
 * possibly a Consumer Rights Act problem; a rejected listing is a car nobody
 * can see; a blocked one is a car nobody can see for a reason the dealer can
 * fix in two minutes. Everything else is reassurance.
 *
 * Errors say what the portal actually said. "Their API rejected the mileage
 * (must be a whole number)" is a thing somebody can act on; "sync error" is
 * a thing somebody ignores.
 */

const STATUS_PRESENTATION: Record<ListingStatus, { tone: Tone; icon: string }> = {
  not_published: { tone: 'neutral', icon: '◌' },
  queued: { tone: 'info', icon: '⇢' },
  published: { tone: 'good', icon: '✓' },
  failed: { tone: 'critical', icon: '✕' },
  delist_queued: { tone: 'warning', icon: '⇠' },
  delisted: { tone: 'neutral', icon: '—' },
};

const OUTCOME_PRESENTATION: Record<string, { tone: Tone; icon: string }> = {
  success: { tone: 'good', icon: '✓' },
  rejected: { tone: 'critical', icon: '✕' },
  transport_error: { tone: 'warning', icon: '!' },
  skipped: { tone: 'neutral', icon: '·' },
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const stamp = (d: Date | null): string =>
  d === null ? 'never' : d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export default async function ChannelsPage() {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'channel.read')) notFound();

  const view = await loadChannels(session);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Channels</h1>
        <p className="text-ink-muted">
          Where your stock actually is
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
        </p>
      </div>

      {/* First, because it is the one that costs more than an enquiry. */}
      {view.overdueDelists.length > 0 && (
        <Problem title={`${view.overdueDelists.length} sold car${view.overdueDelists.length === 1 ? '' : 's'} still advertised`}>
          <p>
            These are past their delist deadline and still on a portal. A buyer who enquires about
            a car that sold last week gets a bad first impression, and a car advertised at a price
            it is no longer available at is a problem beyond a wasted phone call.
          </p>
          <ul className="mt-2 grid gap-2">
            {view.overdueDelists.map((l) => (
              <li key={l.id} className="text-[13px] leading-[18px]">
                <span className="mono">{formatRegistration(l.registration)}</span>{' on '}
                <strong>{l.channelName}</strong>
                {' — '}{l.delist.reason}
              </li>
            ))}
          </ul>
        </Problem>
      )}

      <div className="my-4 grid gap-2 sm:grid-cols-4">
        <Card>
          <Figure
            label="Live stock"
            value={String(view.summary.liveVehicles)}
            hint={`${view.summary.channelsEnabled} channel${view.summary.channelsEnabled === 1 ? '' : 's'} switched on`}
          />
        </Card>
        <Card>
          <Figure
            label="On no channel"
            value={String(view.summary.onNoChannel)}
            hint={view.summary.onNoChannel === 0
              ? 'Every live car is somewhere'
              : 'Live cars no enabled channel is carrying'}
          />
        </Card>
        <Card>
          <Figure
            label="Rejected"
            value={String(view.summary.failedCount)}
            hint={view.summary.failedCount === 0
              ? 'Nothing was refused'
              : 'A portal refused these — the reason is below'}
          />
        </Card>
        <Card>
          <Figure
            label="Overdue delists"
            value={String(view.summary.overdueCount)}
            hint={view.summary.overdueCount === 0 ? 'Nothing lingering' : 'Sold and still up'}
          />
        </Card>
      </div>

      <Card title="Channels" className="mb-4">
        {view.channels.length === 0 ? (
          <Empty title="No channels set up">
            A channel is a portal your stock is published to — Auto Trader, eBay Motors Group,
            CarGurus — or a plain XML or CSV export for one we do not integrate with. Connecting
            one needs a contract with them and credentials from them.
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {view.channels.map((c) => <ChannelView key={c.id} channel={c} />)}
          </ul>
        )}
      </Card>

      {view.failed.length > 0 && (
        <Card title="Rejected by the portal" className="mb-4">
          <p className="mb-3 text-ink-muted">
            What the portal actually said, not a generic failure. Most of these are one field.
          </p>
          <ul className="grid gap-3">
            {view.failed.map((l) => <ListingView key={l.id} listing={l} showError />)}
          </ul>
        </Card>
      )}

      {view.blocked.length > 0 && (
        <Card title="Cannot be published yet" className="mb-4">
          <p className="mb-3 text-ink-muted">
            These fail the same gate as the dealer&rsquo;s own website. A car that cannot appear on
            your shopfront must not appear on a portal you are paying for — holding your own site
            to a higher standard than Auto Trader would be backwards.
          </p>
          <ul className="grid gap-3">
            {view.blocked.map((l) => <ListingView key={l.id} listing={l} />)}
          </ul>
        </Card>
      )}

      <Card title="Recent activity">
        {view.recentEvents.length === 0 ? (
          <Empty title="Nothing has been sent yet">
            Every publish, update and delist is recorded here with what came back — including the
            responses that were refused. Editing that record would destroy the only evidence of a
            feed that stopped working.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] leading-[18px]">
              <thead>
                <tr className="border-b border-edge text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">When</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Channel</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Car</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Action</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Outcome</th>
                  <th scope="col" className="py-2 font-medium">What came back</th>
                </tr>
              </thead>
              <tbody>
                {view.recentEvents.map((e) => {
                  const o = OUTCOME_PRESENTATION[e.outcome]
                    ?? { tone: 'neutral' as Tone, icon: '·' };
                  return (
                    <tr key={e.id} className="border-b border-edge last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{stamp(e.occurredAt)}</td>
                      <td className="py-2 pr-3">{e.channelName}</td>
                      <td className="py-2 pr-3 mono">
                        {e.registration ? formatRegistration(e.registration) : '—'}
                      </td>
                      <td className="py-2 pr-3">{label(e.action)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge tone={o.tone} icon={o.icon} label={label(e.outcome)} />
                      </td>
                      <td className="py-2 text-ink-muted">
                        {e.message ?? '—'}
                        {e.httpStatus !== null && (
                          <span className="ml-1 text-ink-subtle">HTTP {e.httpStatus}</span>
                        )}
                        {e.durationMs !== null && (
                          <span className="ml-1 text-ink-subtle">· {e.durationMs}ms</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ChannelView({ channel }: { channel: ChannelRow }) {
  return (
    <li className="rounded-md border border-edge bg-surface-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{channel.displayName}</span>
          {channel.enabled
            ? <StatusBadge tone="good" icon="●" label="On" />
            : <StatusBadge tone="neutral" icon="○" label="Off" />}
          {channel.monthlyCost && (
            <span className="text-[13px] leading-[18px] text-ink-subtle">
              <Amount value={channel.monthlyCost} /> a month
            </span>
          )}
        </span>
        <span className="text-[13px] leading-[18px] text-ink-subtle">
          Last sync {stamp(channel.lastSyncAt)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusBadge tone="good" icon="✓" label={`${channel.published} published`} />
        {channel.queued > 0 && (
          <StatusBadge tone="info" icon="⇢" label={`${channel.queued} queued`} />
        )}
        {channel.failed > 0 && (
          <StatusBadge tone="critical" icon="✕" label={`${channel.failed} rejected`} />
        )}
        {channel.notPublished > 0 && (
          <StatusBadge tone="neutral" icon="◌" label={`${channel.notPublished} not sent`} />
        )}
      </div>

      {/* The most recent thing that went wrong, in the portal's words. */}
      {channel.lastError && (
        <p className="mt-2 text-[13px] leading-[18px] text-warning-ink">
          Last problem: {channel.lastError}
        </p>
      )}
    </li>
  );
}

function ListingView({ listing, showError = false }: { listing: ListingRow; showError?: boolean }) {
  const s = STATUS_PRESENTATION[listing.status];
  return (
    <li className="border-b border-edge pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <Link
            href={`/stock/${listing.vehicleId}`}
            className="mono font-medium text-brand-700 hover:underline"
          >
            {formatRegistration(listing.registration)}
          </Link>
          <span className="text-ink-muted">{listing.description}</span>
          <span className="text-[13px] leading-[18px] text-ink-subtle">
            on {listing.channelName}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone={s.tone} icon={s.icon} label={label(listing.status)} />
          {listing.errorCount > 1 && (
            <StatusBadge tone="warning" icon="↻" label={`${listing.errorCount} attempts`} />
          )}
        </span>
      </div>

      {showError && listing.lastError && (
        <p className="mt-1 text-[13px] leading-[18px] text-critical">{listing.lastError}</p>
      )}

      {listing.blockers.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {listing.blockers.map((b) => (
            <li key={b.code} className="text-[13px] leading-[18px] text-ink-muted">
              <span aria-hidden="true" className="text-ink-subtle">·</span> {b.message}
            </li>
          ))}
        </ul>
      )}

      {listing.externalUrl && (
        <a
          href={listing.externalUrl}
          className="mt-1 inline-block text-[13px] leading-[18px] text-brand-700 hover:underline"
          rel="noreferrer noopener"
          target="_blank"
        >
          See the live advert →
        </a>
      )}
    </li>
  );
}
