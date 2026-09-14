import Link from 'next/link';
import { holds } from '@forecourt/domain';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { dealBuilderOptions } from '@/data/deal-builder';
import { DealBuilderForm } from '@/components/deal-builder-form';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'New deal' };
export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession(),
    q = await searchParams;
  const options = await dealBuilderOptions(
    session,
    q['q'] ?? '',
    q['vehicle'] ?? '',
    q['contact'] ?? '',
    q['lead'] ?? '',
  );
  if (!options) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/deals"
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Deals
      </Link>
      <PageHeader
        title="Start a deal"
        meta="Bring the customer, the car and the cash price together."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <Card title="Draft details">
          <form
            method="get"
            className="mb-6 flex flex-wrap items-end gap-3 border-b border-edge pb-5"
          >
            <input
              type="hidden"
              name="vehicle"
              value={options.selectedVehicle}
            />
            <input
              type="hidden"
              name="contact"
              value={options.selectedContact}
            />
            <input type="hidden" name="lead" value={options.lead?.id ?? ''} />
            <label className="grid flex-1 gap-2 text-sm font-medium">
              Find a customer or car
              <input
                className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
                name="q"
                defaultValue={q['q'] ?? ''}
                placeholder="Name, email, reg or model"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-md border border-edge-strong px-4"
            >
              Search lists
            </button>
            <Link
              href="/deals/new"
              className="inline-flex min-h-11 items-center text-link"
            >
              Reset
            </Link>
          </form>
          <p className="mb-5 text-sm text-ink-muted">
            Each list shows up to 50 matches. Search to narrow the choices;
            selected records stay available.
          </p>
          <DealBuilderForm
            key={`${q['q'] ?? ''}:${options.selectedVehicle}:${options.selectedContact}`}
            contacts={options.contacts}
            vehicles={options.vehicles}
            contactId={options.selectedContact}
            vehicleId={options.selectedVehicle}
            leadId={options.lead?.id ?? ''}
          />
        </Card>
        <aside className="space-y-5">
          <Card title="A clear starting point">
            <p className="text-sm leading-6 text-ink-muted">
              This creates an internal draft. Stock availability and the enquiry
              stage stay unchanged. No payment is recorded or message sent.
            </p>
            {options.lead && (
              <Link
                className="mt-4 inline-flex min-h-11 items-center text-link"
                href={`/leads/${options.lead.id}`}
              >
                View linked enquiry →
              </Link>
            )}
          </Card>
          {holds(session, 'contact.create') && (
            <Card title="New customer?">
              <p className="mb-3 text-sm text-ink-muted">
                Add their details first, then return here to start the deal.
              </p>
              <Link
                className="inline-flex min-h-11 items-center text-link"
                href="/customers/new"
              >
                Create customer →
              </Link>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
