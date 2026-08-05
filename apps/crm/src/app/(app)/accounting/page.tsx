import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { loadAccounting, type MappingRow } from '@/data/accounting';
import { Card, Figure, StatusBadge, Empty, Amount, Problem } from '@/components/ui';
import { holds, format, ACCOUNT_LABELS } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * Accounting sync.
 *
 * §23's dry run is not a mode somebody has to remember to pick. A connection
 * starts with no `live_from`, so a dry run is the only thing it CAN do until
 * an accountant has read the output and said yes.
 *
 * That ordering is the whole safety story. A posting that reaches a real
 * ledger cannot be unposted; a wrong account gets reconciled and forgotten
 * while a missing one gets noticed. So the product refuses to guess at an
 * account, lists every unmapped one at once rather than surfacing them a
 * failed sync at a time, and shows the exact entries before anything runs.
 */

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const stamp = (d: Date | null): string =>
  d === null ? 'never' : d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default async function AccountingPage() {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  // The chart of accounts and what posts to it is financial configuration.
  if (!holds(principal, 'report.financial.read')) notFound();

  const view = await loadAccounting(session);

  if (!view.connection) {
    return (
      <>
        <h1 className="mb-4 text-[28px] leading-[34px] font-semibold">Accounting</h1>
        <Empty title="No accounting package connected">
          Forecourt posts sales invoices, credit notes, payments and the VAT owed on margin-scheme
          sales into Xero, QuickBooks or Sage — or exports them as a file for one it does not
          integrate with. Connecting one needs credentials from them, and nothing posts anywhere
          until your accountant has read a dry run and agreed with it.
        </Empty>
      </>
    );
  }

  const c = view.connection;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[28px] leading-[34px] font-semibold">Accounting</h1>
        <p className="text-ink-muted">
          {label(c.provider)}
          {c.organisationName && ` · ${c.organisationName}`}
          {' · '}
          <span className={view.queryMs > 500 ? 'text-warning-ink' : 'text-ink-subtle'}>
            {view.queryMs}ms
          </span>
        </p>
      </div>

      {/* The state of the connection, stated plainly. "Dry run only" is not a
          failure — it is the correct state until somebody qualified says so. */}
      {!view.isLive && (
        <Card title="Nothing is posting yet" className="mb-4">
          <p className="text-ink-muted">
            This connection is in <strong>dry run</strong>. It shows exactly what would be created
            and creates none of it. That is not a setting somebody forgot to change — a connection
            goes live only when an accountant has read the entries below and agreed with them,
            because a posting that reaches a real ledger cannot be unposted.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge
              tone={c.enabled ? 'info' : 'neutral'}
              icon={c.enabled ? '●' : '○'}
              label={c.enabled ? 'Connected' : 'Not connected'}
            />
            <StatusBadge tone="warning" icon="◌" label="Dry run — nothing posts" />
          </div>
        </Card>
      )}

      {/* Every unmapped account at once. A bookkeeper wants the whole list to
          work through, not to find them one failed sync at a time. */}
      {view.unmapped.length > 0 && (
        <Problem title={`${view.unmapped.length} account${view.unmapped.length === 1 ? '' : 's'} still to map`}>
          <p>
            Nothing will post to these until they point at an account in {label(c.provider)}. We do
            not guess: a wrong account gets reconciled and forgotten, and a missing one gets
            noticed.
          </p>
          <ul className="mt-2 grid gap-2">
            {view.unmapped.map((u) => (
              <li key={u.account} className="text-[13px] leading-[18px]">
                <strong>{u.label}</strong> — {u.message}
              </li>
            ))}
          </ul>
        </Problem>
      )}

      <div className="my-4 grid gap-2 sm:grid-cols-4">
        <Card>
          <Figure
            label="Ready to post"
            value={String(view.preview?.readyCount ?? 0)}
            hint={view.isLive ? 'Would go on the next run' : 'Would go once this is live'}
          />
        </Card>
        <Card>
          <Figure
            label="Blocked"
            value={String(view.preview?.blockedCount ?? 0)}
            hint={view.preview?.blockedCount ? 'Waiting on an account mapping' : 'Nothing blocked'}
          />
        </Card>
        <Card>
          <Figure
            label="Mapped"
            value={`${view.mappings.filter((m) => m.accountCode).length} of ${view.mappings.length}`}
            hint="Accounts this product can post to"
          />
        </Card>
        <Card>
          <Figure
            label="Last sync"
            value={c.lastSyncAt === null ? 'Never' : stamp(c.lastSyncAt)}
            {...(c.lastError ? { hint: c.lastError } : {})}
          />
        </Card>
      </div>

      {/* Refunds are counted and named, never quietly dropped. */}
      {view.refundsExcluded > 0 && (
        <Card title="Refunds are not posted yet" className="mb-4">
          <p className="text-ink-muted">
            {view.refundsExcluded} refund{view.refundsExcluded === 1 ? '' : 's'} in the pending work
            {view.refundsExcluded === 1 ? ' is' : ' are'} not in the preview below. A refund is the
            reverse of a receipt, and posting one as a receipt would credit the bank for money that
            left it — overstating both cash and income in a ledger you file accounts from.
            Reversing the entries is probably right, and &ldquo;probably&rdquo; is not good enough
            for your books, so they wait for a bookkeeper to confirm the treatment.
          </p>
        </Card>
      )}

      <Card title="What would be created" className="mb-4">
        {!view.preview || view.preview.entries.length === 0 ? (
          <Empty title="Nothing waiting to post">
            Issue an invoice or record a payment and the entries it would create appear here,
            line by line, before anything is sent anywhere.
          </Empty>
        ) : (
          <>
            <p className="mb-3 text-ink-muted">{view.preview.summary}</p>

            <div className="mb-3 flex flex-wrap gap-1.5">
              <StatusBadge
                tone={view.preview.balanced ? 'good' : 'critical'}
                icon={view.preview.balanced ? '✓' : '✕'}
                label={view.preview.balanced
                  ? `Balanced — ${format(view.preview.totalDebit)} each side`
                  : 'DOES NOT BALANCE'}
              />
            </div>

            <ul className="grid gap-3">
              {view.preview.entries.map((entry) => (
                <li
                  key={entry.posting.idempotencyKey}
                  className="border-b border-edge pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{entry.posting.narrative}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge tone="neutral" icon="·" label={label(entry.posting.source)} />
                      {entry.ready
                        ? <StatusBadge tone="good" icon="✓" label="Ready" />
                        : <StatusBadge tone="warning" icon="!" label="Blocked" />}
                    </span>
                  </div>
                  <p className="text-[13px] leading-[18px] text-ink-subtle">
                    {date(entry.posting.date)}
                  </p>

                  {/* The actual double entry. This is the thing an accountant
                      reads before saying yes, so it is shown in full rather
                      than summarised into a total. */}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-[13px] leading-[18px]">
                      <thead>
                        <tr className="border-b border-edge text-left">
                          <th scope="col" className="py-1 pr-3 font-medium">Account</th>
                          <th scope="col" className="py-1 pr-3 font-medium">Description</th>
                          <th scope="col" className="py-1 pr-3 text-right font-medium">Debit</th>
                          <th scope="col" className="py-1 text-right font-medium">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.posting.lines.map((line, i) => (
                          <tr key={`${line.account}-${i}`} className="border-b border-edge last:border-0">
                            <td className="py-1 pr-3">{ACCOUNT_LABELS[line.account]}</td>
                            <td className="py-1 pr-3 text-ink-muted">{line.description}</td>
                            <td className="py-1 pr-3 text-right tnum">
                              {line.debit.amount === 0n
                                ? <span className="text-ink-subtle">—</span>
                                : <Amount value={line.debit} />}
                            </td>
                            <td className="py-1 text-right tnum">
                              {line.credit.amount === 0n
                                ? <span className="text-ink-subtle">—</span>
                                : <Amount value={line.credit} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {entry.unmapped.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {entry.unmapped.map((u) => (
                        <li key={u.account}>
                          <StatusBadge tone="warning" icon="!" label={`${u.label} not mapped`} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Account mapping" className="mb-4">
        <p className="mb-3 text-ink-muted">
          Every account this product can post to. An unmapped one is not an error until something
          needs it — but it is worth doing all of them once rather than one failed sync at a time.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] leading-[18px]">
            <thead>
              <tr className="border-b border-edge text-left">
                <th scope="col" className="py-2 pr-3 font-medium">Forecourt account</th>
                <th scope="col" className="py-2 pr-3 font-medium">Their code</th>
                <th scope="col" className="py-2 pr-3 font-medium">Tax rate</th>
                <th scope="col" className="py-2 font-medium">Agreed</th>
              </tr>
            </thead>
            <tbody>
              {view.mappings.map((m) => <MappingView key={m.accountKey} mapping={m} />)}
            </tbody>
          </table>
        </div>
      </Card>

      {view.batches.length > 0 && (
        <Card title="Runs">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] leading-[18px]">
              <thead>
                <tr className="border-b border-edge text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Started</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Posted</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Blocked</th>
                  <th scope="col" className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {view.batches.map((b) => (
                  <tr key={b.id} className="border-b border-edge last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{stamp(b.startedAt)}</td>
                    <td className="py-2 pr-3">
                      {b.dryRun
                        ? <StatusBadge tone="neutral" icon="◌" label="Dry run" />
                        : <StatusBadge tone="info" icon="→" label="Posted for real" />}
                    </td>
                    <td className="py-2 pr-3">{label(b.status)}</td>
                    <td className="py-2 pr-3 text-right tnum">{b.postedCount}</td>
                    <td className="py-2 pr-3 text-right tnum">{b.blockedCount}</td>
                    <td className="py-2 text-right tnum">
                      <span className={b.failedCount > 0 ? 'text-critical' : ''}>
                        {b.failedCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function MappingView({ mapping }: { mapping: MappingRow }) {
  return (
    <tr className="border-b border-edge last:border-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">{mapping.label}</th>
      <td className="py-2 pr-3">
        {mapping.accountCode
          ? (
            <span className="mono">
              {mapping.accountCode}
              {mapping.accountName && (
                <span className="ml-2 text-ink-subtle">{mapping.accountName}</span>
              )}
            </span>
          )
          : <StatusBadge tone="neutral" icon="◌" label="Not mapped" />}
      </td>
      <td className="py-2 pr-3">
        {mapping.taxRateCode
          ? <span className="mono">{mapping.taxRateCode}</span>
          : <span className="text-ink-subtle">—</span>}
      </td>
      <td className="py-2">
        {/* Who agreed this mapping, and when. A chart of accounts somebody
            set up and nobody checked is how a year's postings end up in the
            wrong place. */}
        {mapping.agreedAt
          ? (
            <StatusBadge
              tone="good" icon="✓"
              label={`${mapping.agreedByName ?? 'Someone'} · ${
                mapping.agreedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
            />
          )
          : mapping.accountCode
            ? <StatusBadge tone="warning" icon="?" label="Nobody has signed this off" />
            : <span className="text-ink-subtle">—</span>}
      </td>
    </tr>
  );
}
