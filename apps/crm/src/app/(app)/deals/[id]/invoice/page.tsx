import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { invoiceDraftReview } from '@/data/deal-invoice';
import { DealInvoiceForm } from '@/components/deal-invoice-form';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'Prepare invoice' };
export default async function PrepareInvoice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    session = await requireSession(),
    review = await invoiceDraftReview(session, id);
  if (!review) notFound();
  if (review.invoiceId) redirect(`/invoices/${review.invoiceId}`);
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/deals/${id}`}
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Deal
      </Link>
      <PageHeader
        title="Prepare an invoice"
        meta="Check the details before creating the draft."
      />
      <Card title="Invoice details">
        <dl className="mb-6 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Customer</dt>
            <dd className="mt-1 font-medium">{review.buyerName}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Billing address</dt>
            <dd className="mt-1">{review.buyerAddress || 'Address needed'}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Vehicle</dt>
            <dd className="mt-1 font-medium">{review.vehicle}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Deal cash price</dt>
            <dd className="mt-1 text-2xl font-semibold">{review.price}</dd>
          </div>
        </dl>
        <p className="mb-6 border-t border-edge pt-4 text-sm text-ink-muted">
          A draft has no invoice number. Review the generated document before
          using the separate issue action.
        </p>
        {review.problem ? (
          <div
            role="alert"
            className="space-y-3 rounded-md border border-edge-strong p-4"
          >
            <p>{review.problem}</p>{review.problem.startsWith('Discount') && <Link className="inline-flex min-h-11 items-center text-link" href={`/deals/${id}/discount`}>Review discount approval →</Link>}
            <div className="flex flex-wrap gap-4">
              <Link
                href={`/customers/${review.customerId}`}
                className="inline-flex min-h-11 items-center text-link"
              >
                Customer details →
              </Link>
              <Link
                href={`/stock/${review.vehicleId}`}
                className="inline-flex min-h-11 items-center text-link"
              >
                Vehicle details →
              </Link>
            </div>
          </div>
        ) : (
          <DealInvoiceForm dealId={id} revision={review.revision} />
        )}
      </Card>
    </div>
  );
}
