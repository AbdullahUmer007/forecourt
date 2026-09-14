import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { cashQuotePage } from '@/data/cash-quotes';
import {
  CashQuoteSave,
  PrintCashQuote,
} from '@/components/cash-quote-controls';
import { Card, PageHeader } from '@/components/ui';
import { money, format } from '@forecourt/domain';
export const metadata = { title: 'Cash quotations' };
export default async function QuotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params,
    q = await searchParams,
    data = await cashQuotePage(await requireSession(), id);
  if (!data) notFound();
  const selected = q.version
    ? data.versions.find((v) => String(v.sequence) === q.version)
    : undefined;
  if (q.version && !selected) notFound();
  const quote = selected?.quote ?? data.quote;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="quote-controls">
        <Link
          className="inline-flex min-h-11 items-center text-link"
          href={`/deals/${id}`}
        >
          ← Deal
        </Link>
        <PageHeader
          title="Cash quotations"
          meta="Keep a record of the price and details at each revision."
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <article
          id="cash-quote"
          className="rounded-lg border border-edge bg-surface-1 p-6 sm:p-8"
        >
          <p className="text-sm text-ink-muted">
            {selected
              ? `Saved version ${selected.version}`
              : 'Preview — not saved'}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Cash quotation</h2>
          <p className="mt-2 font-medium">
            {quote.dealer}{quote.branch !== quote.dealer ? ` · ${quote.branch}` : ''}
          </p>
          {selected && (
            <p className="mt-2 text-sm text-ink-muted">
              Recorded{' '}
              {new Date(selected.at).toLocaleString('en-GB', {
                timeZone: 'Europe/London',
              })}{' '}
              · UK time
            </p>
          )}
          <dl className="my-8 grid gap-6">
            <div>
              <dt className="text-sm text-ink-muted">Prepared for</dt>
              <dd className="mt-1 font-medium">{quote.customer}</dd>
              <dd className="mt-1 whitespace-pre-wrap">{quote.address}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Vehicle</dt>
              <dd className="mt-1 font-medium">{quote.vehicle}</dd>
            </div>
            <div className="border-y border-edge py-5">
              <dt className="text-sm text-ink-muted">Total cash price</dt>
              <dd className="mt-2 text-3xl font-semibold">
                {format(money(BigInt(quote.pricePence), 'GBP'))}
              </dd>
            </div>
          </dl>
          <p className="text-sm leading-6 text-ink-muted">
            This records the cash price only. Availability and the final sale
            details must be confirmed with the dealership. It is not an invoice
            or an order confirmation.
          </p>
        </article>
        <aside className="quote-controls space-y-5">
          <Card title={selected ? 'Saved document' : 'Review and save'}>
            {selected ? (
              <>
                <p className="mb-4 text-sm text-ink-muted">
                  This version keeps the details as they were when saved.
                </p>
                <PrintCashQuote />
                <Link
                  href={`/deals/${id}/quotes`}
                  className="mt-4 flex min-h-11 items-center text-link"
                >
                  Review current deal →
                </Link>
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-ink-muted">
                  Check the customer, car and total before saving. Saving does
                  not send the quote or change the deal stage.
                </p>
                {data.problem ? (
                  <div><p role="alert">{data.problem}</p>{data.problem.startsWith('Discount') && <Link className="mt-4 inline-flex min-h-11 items-center text-link" href={`/deals/${id}/discount`}>Review discount approval →</Link>}</div>
                ) : data.canSave ? (
                  <CashQuoteSave id={id} revision={data.revision} />
                ) : (
                  <p>
                    You need permission to update this deal to save a version.
                  </p>
                )}
              </>
            )}
          </Card>
          <Card title="Saved versions">
            {data.versions.length ? (
              <ul className="space-y-3">
                {data.versions.map((v) => (
                  <li key={v.sequence}>
                    <Link
                      aria-current={
                        selected?.sequence === v.sequence ? 'page' : undefined
                      }
                      className="block min-h-11 rounded-md border border-edge p-3 text-link"
                      href={`/deals/${id}/quotes?version=${v.sequence}`}
                    >
                      Version {v.version}
                      <span className="block text-sm text-ink-muted">
                        {new Date(v.at).toLocaleDateString('en-GB', {
                          timeZone: 'Europe/London',
                        })}{' '}
                        · {format(money(BigInt(v.quote.pricePence), 'GBP'))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No saved quotations yet.</p>
            )}
          </Card>
        </aside>
      </div>
      <style>{`@media print { body * { visibility:hidden } #cash-quote,#cash-quote * { visibility:visible } #cash-quote { position:absolute;left:0;top:0;width:100%;border:0;box-shadow:none;background:white;color:black } #cash-quote * { color:black!important } .quote-controls { display:none } }`}</style>
    </div>
  );
}
