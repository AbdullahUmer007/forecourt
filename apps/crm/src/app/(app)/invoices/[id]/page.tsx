import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { loadInvoice } from '@/data/invoices';
import { loadAssignees } from '@/data/leads';
import { Card, StatusBadge, Row, Figure, Amount, Reg, Empty, type Tone } from '@/components/ui';
import { IssueControl, CreditControl, PaymentControl } from '@/components/invoice-controls';
import { holds, format } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * One invoice.
 *
 * The document shown here is rendered by `renderInvoice` in the domain — the
 * SAME function that produces what the customer receives, and the same one the
 * golden-file test asserts against. A second rendering of the same data for
 * the screen could disagree with the document, and the disagreement would be
 * invisible until a customer pointed at a piece of paper.
 */

const STATUS_PRESENTATION: Record<string, { tone: Tone; icon: string }> = {
  draft: { tone: 'neutral', icon: '✎' },
  issued: { tone: 'info', icon: '→' },
  part_paid: { tone: 'warning', icon: '◐' },
  paid: { tone: 'good', icon: '✓' },
  cancelled: { tone: 'neutral', icon: '✕' },
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', finance: 'Finance',
  part_exchange: 'Part-exchange', cheque: 'Cheque', other: 'Other',
};

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const date = (d: Date | null): string =>
  d === null ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function InvoicePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const canSeeCost = holds(principal, 'vehicle.cost.read');
  const canIssue = holds(principal, 'invoice.create');
  const canVoid = holds(principal, 'invoice.void');
  const canTakePayment = holds(principal, 'payment.create');

  const [detail, staff] = await Promise.all([
    loadInvoice(session, id, canSeeCost),
    loadAssignees(session),
  ]);
  if (!detail) notFound();

  const { invoice, balance } = detail;
  const status = STATUS_PRESENTATION[balance.status] ?? { tone: 'neutral' as Tone, icon: '·' };
  const isMargin = invoice.vatScheme === 'margin';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <Card>
          <Link href="/invoices" className="text-[13px] leading-[18px] text-brand-700 hover:underline">
            ← Invoices
          </Link>

          <div className="mt-2 flex flex-wrap items-start gap-3">
            {detail.registration && <Reg value={detail.registration} />}
            <div className="min-w-0 flex-1">
              <h1 className="mono text-[20px] leading-7 font-semibold">
                {invoice.reference ?? 'Draft — not yet issued'}
              </h1>
              <p className="text-ink-subtle">
                {invoice.buyerName ?? 'No buyer recorded'}
                {detail.vehicleDescription && ` · ${detail.vehicleDescription}`}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge tone={status.tone} icon={status.icon} label={label(balance.status)} />
            {invoice.kind === 'credit_note' && (
              <StatusBadge tone="warning" icon="↩" label="Credit note" />
            )}
            <StatusBadge
              tone="neutral"
              icon="£"
              label={isMargin ? 'Margin scheme' : 'VAT qualifying'}
            />
          </div>

          {detail.creditedByReference && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              Cancelled by credit note <span className="mono">{detail.creditedByReference}</span>.
              The number was never released — that is what keeps the series gapless.
            </p>
          )}
          {detail.creditsReference && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              This credit note reverses <span className="mono">{detail.creditsReference}</span>.
            </p>
          )}
        </Card>

        {/* The document, as the customer receives it. Not a second rendering. */}
        <Card title="The document">
          <p className="mb-3 text-[13px] leading-[18px] text-ink-subtle">
            {isMargin
              ? 'A margin-scheme invoice shows no VAT — not a zero, not a dash. Showing it would '
                + 'make the whole sale standard-rated.'
              : 'A VAT-qualifying sale shows VAT on the full selling price, which is what lets a '
                + 'business buyer reclaim it.'}
          </p>
          <div
            className="invoice-document overflow-x-auto rounded-md border border-edge bg-surface-2 p-4 text-[13px] leading-[18px]"
            /* The domain's renderer escapes every interpolated field. */
            dangerouslySetInnerHTML={{ __html: detail.document }}
          />
        </Card>

        <Card title="Payments">
          {detail.payments.length === 0 ? (
            <Empty title="Nothing received yet">
              Every payment and refund against this invoice appears here. Cash is checked against
              the High Value Dealer threshold as it is taken, counting everything already received
              from this customer.
            </Empty>
          ) : (
            <ul className="grid gap-2">
              {detail.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2 last:border-0 last:pb-0">
                  <span>
                    <StatusBadge
                      tone={p.direction === 'in' ? 'good' : 'warning'}
                      icon={p.direction === 'in' ? '↓' : '↑'}
                      label={p.direction === 'in' ? 'Received' : 'Refunded'}
                    />
                    <span className="ml-2 text-ink-muted">
                      {METHOD_LABELS[p.method] ?? p.method} · {date(p.receivedAt)}
                    </span>
                    {p.reason && (
                      <span className="block text-[13px] leading-[18px] text-ink-subtle">
                        {p.reason}
                      </span>
                    )}
                  </span>
                  <span className="tnum font-semibold">
                    {p.direction === 'out' && '−'}<Amount value={p.amount} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card title="Balance">
          <Figure
            label={balance.outstanding.amount <= 0n ? 'Settled' : 'Outstanding'}
            value={format(balance.outstanding.amount < 0n
              ? { ...balance.outstanding, amount: -balance.outstanding.amount }
              : balance.outstanding)}
            size="lg"
            {...(balance.outstanding.amount < 0n
              ? { hint: 'Overpaid — this much is owed back to the customer.' }
              : {})}
          />
          <dl className="mt-3 border-t border-edge pt-3">
            <Row label="Invoiced"><Amount value={balance.invoiced} /></Row>
            <Row label="Received"><Amount value={balance.paid} /></Row>
          </dl>
        </Card>

        {/* The dealer's own margin VAT, which never appears on the document.
            Cost data: the margin plus the selling price gives the purchase
            price exactly, so it is withheld with cost. */}
        {isMargin && (
          <Card title="VAT the dealership owes">
            {detail.marginVat ? (
              <>
                <dl>
                  <Row label="Margin"><Amount value={detail.marginVat.margin} /></Row>
                  <Row label="VAT due"><Amount value={detail.marginVat.vatDue} /></Row>
                </dl>
                <p className="mt-3 text-[12px] leading-4 text-ink-subtle">
                  Computed from the margin at the fraction in force on the sale date, never from a
                  rate in the code.{' '}
                  <a
                    href={detail.marginVat.sourceUrl}
                    className="text-brand-700 hover:underline"
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    Source
                  </a>
                  {' '}The customer never sees this figure.
                </p>
              </>
            ) : (
              <p className="text-[13px] leading-[18px] text-ink-subtle">
                {canSeeCost
                  ? 'No purchase price recorded against this car, so the margin cannot be computed.'
                  : 'Margin and the VAT due on it are not shown on your role.'}
              </p>
            )}
          </Card>
        )}

        <Card title="Stock book">
          {detail.stockBookNumber ? (
            <>
              <Row label="Entry">
                <span className="mono">{detail.stockBookNumber}</span>
              </Row>
              <Link
                href="/vat/stock-book"
                className="mt-2 inline-block text-[13px] leading-[18px] text-brand-700 hover:underline"
              >
                Open the stock book →
              </Link>
            </>
          ) : (
            <p className="text-[13px] leading-[18px] text-ink-subtle">
              No stock book entry is linked to this car. A margin-scheme sale must cross-reference
              one — VAT Notice 718/1 requires it on the invoice.
            </p>
          )}
        </Card>

        {invoice.status === 'draft' && canIssue && (
          <Card title="Issue">
            <IssueControl invoiceId={detail.id} />
          </Card>
        )}

        {invoice.status !== 'draft' && balance.status !== 'cancelled'
          && detail.creditedByReference === null && canVoid && (
          <Card title="Cancel this invoice">
            <CreditControl invoiceId={detail.id} />
          </Card>
        )}

        {invoice.status !== 'draft' && balance.status !== 'cancelled' && canTakePayment && (
          <Card title="Record a payment">
            <PaymentControl
              invoiceId={detail.id}
              outstandingLabel={format(balance.outstanding)}
              staff={staff}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
