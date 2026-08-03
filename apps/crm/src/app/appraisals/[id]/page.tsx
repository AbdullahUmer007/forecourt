import { notFound } from 'next/navigation';
import { requireSession } from '../../../session';
import { loadAppraisal } from '../../../data/appraisals';
import { Card, StatusBadge, Figure, Amount, Reg, Row, Empty, Problem } from '../../../components/ui';
import { DamageMap } from '../../../components/damage-map';
import {
  estimateRecon, valuationPanel, settlementPosition, equityPosition,
  currentOffer, offerExpired, conversionBlockers,
  assessTyres, vatSchemeForSeller,
  holds, format, money,
} from '@forecourt/domain';

export default async function AppraisalDetail(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  const detail = await loadAppraisal(session, id);

  // A missing row and another dealer's row are indistinguishable here by
  // design — RLS returned nothing either way, and so does this.
  if (!detail) notFound();

  const { appraisal, contactName, marks, standards, valuations, offers, settlements } = detail;
  const now = new Date();

  // Nothing below is computed here. Every figure comes from the domain layer,
  // which is where it is tested — including the property tests that assert an
  // allowance is never negative and a settlement never nets off.
  const recon = estimateRecon({ marks, standards, asAt: now });
  const valuation = valuationPanel({ valuations, mileage: appraisal.mileage, asAt: now });
  const settlement = settlementPosition(settlements, now);
  const offer = currentOffer(offers);
  const blockers = conversionBlockers({ appraisal, offer, settlement, asAt: now });
  const tyres = assessTyres(detail.tyreDepths);

  // Field-level permission is decided SERVER-SIDE. A sales executive without
  // vehicle.cost.read never receives the market value, the recon estimate or
  // the target margin — they are not hidden with CSS, they are not sent.
  const canSeeCost = holds(
    { userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
      permissions: session.permissions, scope: session.scope, siteIds: session.siteIds },
    'vehicle.cost.read',
  );

  const description = [appraisal.make, appraisal.model, appraisal.derivative]
    .filter(Boolean).join(' ');

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="grid gap-4">
        {/* ------------------------------------------------- the vehicle */}
        <Card>
          <div className="flex flex-wrap items-start gap-3">
            <Reg value={appraisal.registration} />
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] leading-7 font-semibold">
                {description || 'Vehicle not identified'}
              </h1>
              <p className="text-ink-subtle">
                {contactName ?? 'No contact linked'}
                {appraisal.mileage !== null &&
                  ` · ${appraisal.mileage.toLocaleString('en-GB')} miles`}
              </p>
            </div>
          </div>

          {!appraisal.derivativeConfirmed && (
            <div className="mt-3 rounded-md border border-warning/50 bg-surface-1 p-3">
              <StatusBadge tone="warning" icon="!" label="Derivative not confirmed" />
              <p className="mt-2 text-ink-muted">
                Several trims share one DVLA record. Confirm which one this is before it becomes
                stock — a guessed derivative is a wrong price and a mis-described vehicle.
              </p>
            </div>
          )}

          {tyres.some((t) => t.illegal) && (
            <div className="mt-3">
              <StatusBadge
                tone="critical"
                icon="!"
                label={`${tyres.filter((t) => t.illegal).length} tyre(s) below 1.6mm`}
              />
            </div>
          )}
        </Card>

        {/* ---------------------------------------------- the damage map */}
        <Card title="Condition" action={<span className="text-ink-subtle">{marks.length} marked</span>}>
          <DamageMap marks={marks} />
        </Card>

        {/* -------------------------------------------- the recon estimate */}
        <Card title="Recon estimate">
          {recon.lines.length === 0 && recon.unpriced.length === 0 ? (
            <Empty title="Nothing marked yet">
              Tap the panels above to record what is wrong with the car. Each mark prices itself
              against your standard costs, and the total comes off the offer.
            </Empty>
          ) : (
            <>
              <dl className="mb-3">
                {recon.lines.map((line) => (
                  <Row key={line.markId} label={line.description}>
                    <Amount value={line.estimate} />
                  </Row>
                ))}
              </dl>

              {/* THE behaviour this module exists to get right: a mark we
                  cannot price is reported, never silently costed at zero. */}
              {recon.incomplete && (
                <Problem title={`${recon.unpriced.length} mark(s) not priced`}>
                  <p>
                    These are <strong>not</strong> in the total below, so the offer is currently
                    too high by whatever they cost to put right. Price them before offering.
                  </p>
                  <ul className="mt-2 list-disc pl-5">
                    {recon.unpriced.map((u) => (
                      <li key={u.markId}>{u.reason}</li>
                    ))}
                  </ul>
                </Problem>
              )}

              <div className="mt-3 flex items-baseline justify-between border-t border-edge pt-3">
                <span className="font-medium">Total</span>
                <span className="text-[20px] leading-7 font-semibold">
                  <Amount value={recon.total} />
                </span>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ================================================== right column */}
      <div className="grid content-start gap-4">
        {/* ------------------------------------------------- the offer */}
        <Card title="Offer">
          {!offer ? (
            <Empty title="No offer yet">
              Price the recon, check the valuation, then make the customer a figure.
            </Empty>
          ) : (
            <>
              <Figure
                label="Allowance"
                value={format(offer.breakdown.allowance)}
                size="xl"
                hint={
                  offer.expiresAt
                    ? offerExpired(offer, now)
                      ? `Lapsed ${offer.expiresAt.toLocaleDateString('en-GB')}`
                      : `Valid to ${offer.expiresAt.toLocaleDateString('en-GB')}`
                    : 'No expiry set'
                }
              />

              {offer.revision > 1 && (
                <p className="mt-2 text-[12px] leading-4 text-ink-subtle">
                  Revision {offer.revision}. Earlier offers are kept — they were said to the
                  customer.
                </p>
              )}

              {canSeeCost ? (
                <dl className="mt-4 border-t border-edge pt-3">
                  <Row label="Market value"><Amount value={offer.breakdown.marketValue} /></Row>
                  <Row label="Recon"><Amount value={offer.breakdown.reconEstimate} /></Row>
                  <Row label="Target margin"><Amount value={offer.breakdown.targetMargin} /></Row>
                  <Row label="Ceiling"><Amount value={offer.breakdown.ceiling} /></Row>
                  {offer.breakdown.overAllowance.amount > 0n && (
                    <Row label="Over-allowance">
                      <span className="text-warning-ink">
                        <Amount value={offer.breakdown.overAllowance} />
                      </span>
                    </Row>
                  )}
                </dl>
              ) : (
                <p className="mt-4 border-t border-edge pt-3 text-[13px] leading-[18px] text-ink-subtle">
                  The breakdown behind this figure is cost data and is not shown on your role.
                </p>
              )}

              {offer.breakdown.overAllowance.amount > 0n && canSeeCost && (
                <p className="mt-2 text-[12px] leading-4 text-ink-subtle">
                  Allowed above what the car is worth to us. That is a discount on the car being
                  sold, not part-exchange profit.
                </p>
              )}
            </>
          )}
        </Card>

        {/* --------------------------------------------- the valuation */}
        <Card title="Valuation">
          {valuation.basis === 'none' ? (
            <>
              <StatusBadge tone="neutral" icon="?" label="No valuation on file" />
              <p className="mt-2 text-ink-muted">{valuation.warnings[0]}</p>
            </>
          ) : (
            <>
              <dl>
                {/* The trade figure IS the market value under another label —
                    it is what the car is worth to us, which is precisely the
                    number `vehicle.cost.read` withholds. Gating the offer
                    breakdown but printing the trade value here would have
                    handed it back on the same screen. Retail is a
                    market-facing figure and stays. */}
                {canSeeCost && valuation.trade && (
                  <Row label="Trade"><Amount value={valuation.trade} /></Row>
                )}
                {valuation.retail && <Row label="Retail"><Amount value={valuation.retail} /></Row>}
                {valuation.forecastDaysToSell !== null && (
                  <Row label="Forecast days to sell">{valuation.forecastDaysToSell}</Row>
                )}
              </dl>
              {valuation.warnings.map((w) => (
                <p key={w} className="mt-2 flex gap-2 text-[13px] leading-[18px] text-warning-ink">
                  <span aria-hidden="true">!</span>
                  {w}
                </p>
              ))}
            </>
          )}
        </Card>

        {/* ------------------------------------------- outstanding finance */}
        <Card title="Outstanding finance">
          {!settlement.present ? (
            <p className="text-ink-muted">
              None recorded. Ask — a settlement found at the handover desk comes out of the
              deal, not the customer&rsquo;s pocket.
            </p>
          ) : (
            <>
              <dl>
                <Row label="Lender">{settlement.lenderName}</Row>
                <Row label="Settlement">
                  <Amount value={settlement.settlement ?? money(0n)} />
                </Row>
                {settlement.projected &&
                  settlement.settlement &&
                  settlement.projected.amount !== settlement.settlement.amount && (
                    <Row label="With accrual today">
                      <Amount value={settlement.projected} />
                    </Row>
                  )}
              </dl>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge
                  tone={settlement.verified ? 'good' : 'warning'}
                  icon={settlement.verified ? '✓' : '!'}
                  label={settlement.verified ? 'Verified with lender' : 'Not verified'}
                />
                {settlement.expired && (
                  <StatusBadge tone="warning" icon="⏱" label="Quote lapsed" />
                )}
              </div>

              {settlement.warnings.map((w) => (
                <p key={w} className="mt-2 text-[13px] leading-[18px] text-ink-muted">{w}</p>
              ))}

              {/* Negative equity, said in pounds, weeks before the handover
                  desk finds it. */}
              {offer && settlement.settlement && (
                <p className="mt-3 border-t border-edge pt-3 text-[13px] leading-[18px]">
                  {equityPosition(offer.breakdown.allowance, settlement.settlement).summary}
                </p>
              )}
            </>
          )}
        </Card>

        {/* -------------------------------------------- taking it into stock */}
        <Card title="Take into stock">
          {appraisal.convertedVehicleId ? (
            <StatusBadge tone="good" icon="⇥" label="Already in stock" />
          ) : blockers.length === 0 ? (
            <>
              <StatusBadge tone="good" icon="✓" label="Ready" />
              <p className="mt-2 text-ink-muted">
                Everything needed for the stock record and the VAT stock book is captured. The
                purchase price will be the allowance
                {offer && <> — <Amount value={offer.breakdown.allowance} /></>}
                {appraisal.sellerType && (
                  <>, on the{' '}
                  {vatSchemeForSeller(appraisal.sellerType, appraisal.vatInvoiceReceived).scheme}
                  {' '}scheme</>
                )}.
              </p>
            </>
          ) : (
            <ul className="grid gap-3">
              {blockers.map((b) => (
                <li key={b.code} className="grid gap-1">
                  <StatusBadge
                    tone={b.overridable ? 'warning' : 'critical'}
                    icon={b.overridable ? '!' : '✕'}
                    label={b.overridable ? 'Needs a reason' : 'Must fix'}
                  />
                  <p className="text-[13px] leading-[18px] text-ink-muted">{b.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
