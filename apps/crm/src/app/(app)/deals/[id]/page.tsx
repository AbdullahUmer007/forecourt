import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadDeal } from '@/data/deals';
import { Card, StatusBadge, Row, Figure, Amount, Reg, Problem, Empty, type Tone } from '@/components/ui';
import { DealStateControl, AddonControl, RepairControl } from '@/components/deal-controls';
import { holds, format, type DealState } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Deal' };

/**
 * One deal.
 *
 * The screen has three jobs, in this order of importance:
 *
 *  - say what the customer owes and what we make (server-computed, cost-gated)
 *  - say what statutory clocks are running and until when
 *  - say what evidence is missing, and prove the ledger has not been altered
 *
 * The third is the one that makes this product defensible. The evidence chain
 * is verified on every read rather than trusted: an append-only promise is
 * about our own code, but the hash chain is a property of the data, and a
 * property nobody checks is a claim.
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

const FORMATION_LABELS: Record<string, string> = {
  on_premises: 'On the forecourt',
  distance: 'At a distance',
  off_premises: 'Away from the forecourt',
};

const EVIDENCE_LABELS: Record<string, string> = {
  initial_disclosure: 'Initial disclosure',
  quote_presented: 'Quote presented',
  quote_selected: 'Quote selected',
  commission_disclosure: 'Commission disclosure',
  demands_and_needs: 'Demands and needs',
  affordability: 'Affordability',
  adequate_explanation: 'Adequate explanation',
  vulnerability_screen: 'Vulnerability screen',
  fair_value_confirmation: 'Fair value confirmed',
  addon_offered: 'Add-on offered',
  addon_accepted: 'Add-on accepted',
  addon_declined: 'Add-on declined',
  document_shown: 'Document shown',
  document_signed: 'Document signed',
  contract_formed: 'Contract formed',
  delivery: 'Delivered',
  cancellation_requested: 'Cancellation requested',
  rejection_requested: 'Rejection requested',
  repair_attempt: 'Repair attempt',
  note: 'Note',
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Evidence payload keys are camelCase, so `label` alone renders "QuotesShown". */
const fieldLabel = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase()).toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const stamp = (d: Date): string =>
  d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default async function DealPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');
  const canUpdate = holds(principal, 'deal.update');

  const detail = await loadDeal(session, id, canSeeCost);
  if (!detail) notFound();

  const { deal, margin, clocks } = detail;
  const state = STATE_PRESENTATION[deal.state];
  const now = new Date();
  const openRepair = detail.repairs.find((r) => r.completedAt === null) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <Card>
          <Link href="/deals" className="text-[13px] leading-[18px] text-link hover:underline">
            ← Deals
          </Link>

          <div className="mt-2 flex flex-wrap items-start gap-3">
            {detail.registration && <Reg value={detail.registration} />}
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] leading-7 font-semibold">{detail.contactName}</h1>
              <p className="text-ink-subtle">
                {detail.vehicleDescription ?? 'No car linked'}
                {detail.reference && <> · <span className="mono">{detail.reference}</span></>}
                {detail.siteName && ` · ${detail.siteName}`}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge tone={state.tone} icon={state.icon} label={label(deal.state)} />
            {deal.contractFormation && (
              <StatusBadge
                tone="neutral" icon="✍"
                label={FORMATION_LABELS[deal.contractFormation] ?? deal.contractFormation}
              />
            )}
            {detail.financed && <StatusBadge tone="neutral" icon="₤" label="Financed" />}
            {detail.lossMaking && (
              <StatusBadge tone="critical" icon="!" label="Loss-making" />
            )}
          </div>

          {deal.cancellationReason && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              Cancelled {date(deal.cancelledAt)} — {deal.cancellationReason}
            </p>
          )}
        </Card>

        {/* THE tamper check. Shown before anything else it could undermine. */}
        {!detail.chain.valid && (
          <Problem title="This deal's evidence ledger does not verify">
            <p>
              The hash chain was checked when this page loaded and it does not hold. That means an
              entry was altered, removed or inserted after it was written. Do not rely on this
              ledger — export it, and tell us immediately.
            </p>
            <ul className="mt-2 grid gap-1">
              {detail.chain.problems.map((p) => (
                <li key={`${p.sequence}-${p.problem}`} className="text-[13px] leading-[18px]">
                  Entry {p.sequence}: {p.problem}
                </li>
              ))}
            </ul>
          </Problem>
        )}

        {/* The evidence gaps, in words a dealer can act on. */}
        {!detail.completeness.complete && deal.state !== 'building' && deal.state !== 'quoted' && (
          <Problem title={`${detail.completeness.missing.length} record${detail.completeness.missing.length === 1 ? '' : 's'} missing from this deal`}>
            <p>{detail.completeness.summary}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {detail.completeness.missing.map((k) => (
                <li key={k}>
                  <StatusBadge tone="critical" icon="✕" label={EVIDENCE_LABELS[k] ?? k} />
                </li>
              ))}
            </ul>
          </Problem>
        )}

        {clocks && (
          <Card title="Statutory clocks">
            <p className="mb-3 text-ink-muted">{clocks.summary}</p>
            <dl>
              <Row label="Delivered">{date(clocks.deliveredAt)}</Row>
              <Row label="Contract formed">
                {FORMATION_LABELS[clocks.contractFormation] ?? clocks.contractFormation}
              </Row>
              <Row label="Short-term right to reject">
                {clocks.rejectWindowPaused
                  ? <span className="text-warning-ink">Paused — a repair is open</span>
                  : clocks.rejectWindowEndsAt
                    ? <>
                        {date(clocks.rejectWindowEndsAt)}
                        {clocks.rejectWindowEndsAt < now && (
                          <span className="text-ink-subtle"> — closed</span>
                        )}
                      </>
                    : '—'}
              </Row>
              <Row label="Reversed burden of proof">
                {date(clocks.burdenOfProofEndsAt)}
              </Row>
              <Row label="Right to cancel">
                {clocks.cancellationRightApplies && clocks.cancellationDeadline
                  ? <>
                      {date(clocks.cancellationDeadline)}
                      {clocks.cancellationDeadline < now && (
                        <span className="text-ink-subtle"> — closed</span>
                      )}
                    </>
                  : <span className="text-ink-subtle">None — formed on the forecourt</span>}
              </Row>
            </dl>
            {/* Every window above came from `compliance_rules` keyed on the
                delivery date, not from a number in the code. Saying where it
                came from is what lets a dealer's own adviser check it. */}
            {detail.clocksSource && (
              <p className="mt-3 text-[12px] leading-4 text-ink-subtle">
                Windows taken from the Consumer Rights Act rule in force on the delivery date.{' '}
                <a
                  href={detail.clocksSource}
                  className="text-link hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Source
                </a>
              </p>
            )}
          </Card>
        )}

        <Card title="Add-ons">
          {detail.addonRows.length === 0 ? (
            <Empty title="No add-ons offered">
              Each product is its own sale with its own demands-and-needs statement. Nothing is
              ever pre-ticked — an acceptance dated before its offer is refused by the database.
            </Empty>
          ) : (
            <ul className="grid gap-3">
              {detail.addonRows.map((a) => (
                <li key={a.id} className="border-b border-edge pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{a.productName}</span>
                    <span className="tnum font-semibold">{format(a.price)}</span>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {a.acceptedAt
                      ? <StatusBadge tone="good" icon="✓" label={`Accepted ${date(a.acceptedAt)}`} />
                      : a.declinedAt
                        ? <StatusBadge tone="neutral" icon="✕" label={`Declined ${date(a.declinedAt)}`} />
                        : <StatusBadge tone="info" icon="◌" label={`Offered ${date(a.offeredAt)}`} />}
                    {a.acceptedAt && !a.demandsAndNeeds && (
                      <StatusBadge tone="critical" icon="!" label="No demands-and-needs statement" />
                    )}
                  </div>

                  {a.demandsAndNeeds && (
                    <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
                      {a.demandsAndNeeds}
                    </p>
                  )}

                  {canUpdate && (
                    <AddonControl
                      dealId={deal.id}
                      addonId={a.id}
                      productName={a.productName}
                      accepted={a.acceptedAt !== null}
                      declined={a.declinedAt !== null}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Evidence ledger">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={detail.chain.valid ? 'good' : 'critical'}
              icon={detail.chain.valid ? '✓' : '✕'}
              label={detail.chain.valid
                ? `Chain verified — ${detail.chain.entriesChecked} entr${detail.chain.entriesChecked === 1 ? 'y' : 'ies'}`
                : 'Chain does NOT verify'}
            />
          </div>

          {detail.evidence.length === 0 ? (
            <Empty title="Nothing recorded yet">
              Every disclosure, quote, statement and signature is appended here and hash-chained.
              Remove or edit one entry and every hash after it stops verifying.
            </Empty>
          ) : (
            <ol className="grid gap-2">
              {detail.evidence.map((e) => (
                <li key={e.sequence} className="grid gap-0.5 border-l-2 border-edge pl-3">
                  <div className="text-[12px] leading-4 text-ink-subtle">
                    #{e.sequence} · {stamp(e.occurredAt)}
                    {e.documentVersion && ` · ${e.documentVersion}`}
                  </div>
                  <div className="font-medium">{EVIDENCE_LABELS[e.kind] ?? label(e.kind)}</div>
                  {Object.keys(e.payload).length > 0 && (
                    <dl className="text-[13px] leading-[18px] text-ink-muted">
                      {Object.entries(e.payload).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="text-ink-subtle">{fieldLabel(k)}:</dt>
                          <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {detail.documents.length > 0 && (
          <Card title="Documents">
            <ul className="grid gap-2">
              {detail.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {label(d.code)} <span className="text-ink-subtle">v{d.version}</span>
                  </span>
                  {d.signedAt
                    ? <StatusBadge
                        tone="good" icon="✓"
                        label={`Signed ${date(d.signedAt)} by ${d.signerName ?? 'unknown'}`}
                      />
                    : <StatusBadge tone="info" icon="◌" label={d.shownAt ? `Shown ${date(d.shownAt)}` : 'Not shown'} />}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card title="What the customer pays">
          <Figure
            label="Balance to find"
            value={format(detail.balanceToFinance)}
            size="lg"
          />
          <dl className="mt-3 border-t border-edge pt-3">
            <Row label="Car">
              {deal.vehiclePrice
                ? <Amount value={deal.vehiclePrice} />
                : <span className="text-ink-subtle">Not priced</span>}
            </Row>
            {detail.addonsTotal.amount > 0n && (
              <Row label="Add-ons"><Amount value={detail.addonsTotal} /></Row>
            )}
            <Row label="Part-exchange"><Amount value={deal.partExchange} /></Row>
            {deal.partExchangeSettlement.amount > 0n && (
              /* Settlement ADDS to the balance: money still owed on the car
                 they are trading in has to go to their lender. Netting it off
                 silently understates what the customer owes by exactly this. */
              <Row label="Settlement owed on it">
                <Amount value={deal.partExchangeSettlement} />
              </Row>
            )}
            <Row label="Deposit"><Amount value={deal.deposit} /></Row>
            <Row label="On finance"><Amount value={deal.financeAmount} /></Row>
          </dl>

          {detail.financed && (
            /* Rule 5: a monthly payment or an APR renders through the M8 gate
               and through nothing else — including this screen. */
            <p className="mt-3 border-t border-edge pt-3 text-[12px] leading-4 text-ink-subtle">
              Monthly payment and APR are not shown here. A cost-of-credit figure reaches a screen
              only through an approved representative example.
            </p>
          )}
        </Card>

        {margin ? (
          <Card title="Margin">
            <Figure
              label="Deal gross"
              value={format(margin.dealGross)}
              size="lg"
              {...(margin.containsProjection
                ? { hint: 'Includes a PROJECTED part-exchange margin — not realised until that car sells.' }
                : {})}
            />
            <dl className="mt-3 border-t border-edge pt-3">
              <Row label="Vehicle gross">
                <span className={margin.vehicleGross.amount < 0n ? 'text-critical' : ''}>
                  <Amount value={margin.vehicleGross} />
                </span>
              </Row>
              <Row label="Vehicle cost"><Amount value={margin.vehicleCost} /></Row>
              {margin.addonsTotal.amount > 0n && (
                <Row label="Add-on gross"><Amount value={margin.addonGross} /></Row>
              )}
              {margin.financeCommission.amount > 0n && (
                <Row label="Finance commission"><Amount value={margin.financeCommission} /></Row>
              )}
              {margin.containsProjection && (
                <Row label="Part-exchange (projected)">
                  <Amount value={margin.partExchangeProjected} />
                </Row>
              )}
            </dl>
          </Card>
        ) : (
          <Card title="Margin">
            <p className="text-[13px] leading-[18px] text-ink-subtle">
              Cost, gross and margin are not shown on your role.
            </p>
          </Card>
        )}

        <Card title="Customer">
          <dl>
            <Row label="Name">{detail.contactName}</Row>
            <Row label="Phone">
              {detail.contactPhone
                ? <a href={`tel:${detail.contactPhone}`} className="text-link hover:underline">
                    {detail.contactPhone}
                  </a>
                : <span className="text-ink-subtle">Not given</span>}
            </Row>
            <Row label="Email">
              {detail.contactEmail
                ? <a href={`mailto:${detail.contactEmail}`} className="text-link hover:underline">
                    {detail.contactEmail}
                  </a>
                : <span className="text-ink-subtle">Not given</span>}
            </Row>
          </dl>
        </Card>

        {canUpdate && (
          <Card title="Move this deal on">
            <DealStateControl
              dealId={deal.id}
              state={deal.state}
              contractFormation={deal.contractFormation}
            />
          </Card>
        )}

        {canUpdate && deal.deliveredAt !== null && (
          <Card title={openRepair ? 'Repair in progress' : 'Repair attempt'}>
            {openRepair && (
              <p className="mb-2 text-[13px] leading-[18px] text-warning-ink">
                Open since {stamp(openRepair.startedAt)} — {openRepair.faultReported}. The 30-day
                right to reject is paused, and at least seven days must remain when it resumes.
              </p>
            )}
            <RepairControl dealId={deal.id} openRepairId={openRepair?.id ?? null} />
          </Card>
        )}

        {detail.repairs.length > 0 && (
          <Card title="Repair history">
            <ul className="grid gap-2">
              {detail.repairs.map((r) => (
                <li key={r.id} className="text-[13px] leading-[18px]">
                  <div className="font-medium">{r.faultReported}</div>
                  <div className="text-ink-subtle">
                    {stamp(r.startedAt)} → {r.completedAt ? stamp(r.completedAt) : 'still open'}
                    {r.outcome && ` · ${r.outcome}`}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
