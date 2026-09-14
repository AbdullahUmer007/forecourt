import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { discountPage } from '@/data/discount-approvals';
import { DiscountForm } from '@/components/discount-form';
import { Card, PageHeader } from '@/components/ui';
import { format, money } from '@forecourt/domain';
export const metadata = { title: 'Discount approval' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    c = await discountPage(await requireSession(), id);
  if (!c) notFound();
  const pounds = (v: string) => format(money(BigInt(v), 'GBP'));
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/deals/${id}`}
        className="inline-flex min-h-11 items-center text-link"
      >
        ← Deal
      </Link>
      <PageHeader
        title="Discount approval"
        meta={`${c.registration} · Review the price before preparing a quotation.`}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Price under review">
          <dl className="grid gap-4">
            {[
              ['Advertised price', c.retail ? pounds(c.retail) : 'Not set'],
              ['Deal cash price', pounds(c.price)],
              ['Discount', pounds(c.discount)],
              ['Status', c.status.replaceAll('_', ' ')],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-ink-muted">{k}</dt>
                <dd className="mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {c.reason && (
            <p className="mt-5 whitespace-pre-wrap">Request: {c.reason}</p>
          )}
          {c.decisionReason && (
            <p className="mt-3 whitespace-pre-wrap">
              Decision: {c.decisionReason}
            </p>
          )}
          <p className="mt-5 text-sm text-ink-muted">
            Approval applies to this reviewed deal and advertised price. Later
            changes require a fresh review.
          </p>
        </Card>
        <Card title="Next action">
          {!c.eligible ? (
            <p>
              This deal does not currently need an eligible discount approval.
              Set a lower cash price on an uninvoiced deal before contract to
              request one.
            </p>
          ) : c.status === 'approved' ? (
            <>
              <p className="mb-4">Approved for the current deal details.</p>
              <Link
                className="inline-flex min-h-11 items-center text-link"
                href={`/deals/${id}/quotes`}
              >
                Prepare quotation →
              </Link>
            </>
          ) : c.status === 'pending' ? (
            c.canDecide ? (
              <DiscountForm
                key={c.binding}
                id={id}
                binding={c.binding}
                sequence={c.requestSequence}
                review
              />
            ) : (
              <p>
                Waiting for another permitted reviewer with a sufficient
                approval limit. Share this page with them.
              </p>
            )
          ) : c.canRequest ? (
            <DiscountForm
              key={c.binding + c.status}
              id={id}
              binding={c.binding}
              sequence={c.requestSequence}
            />
          ) : (
            <p>You cannot request a discount on this deal.</p>
          )}
        </Card>
      </div>
      <Card title="Approval history" className="mt-6">
        {c.history.length ? (
          <ol className="space-y-4">
            {c.history.map((h) => (
              <li key={h.sequence} className="border-b border-edge pb-3">
                <p className="font-medium">
                  {h.decision} ·{' '}
                  {new Date(h.at).toLocaleString('en-GB', {
                    timeZone: 'Europe/London',
                  })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                  {h.reason}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No discount requests yet.</p>
        )}
      </Card>
    </div>
  );
}
