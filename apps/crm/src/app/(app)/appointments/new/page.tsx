import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { loadCustomer, loadCustomers } from '@/data/customers';
import { appointmentOptions } from '@/data/appointments';
import { AppointmentForm } from '@/components/appointment-form';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'Book appointment' };
export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (
    !holds(session, 'lead.update') ||
    !holds(session, 'lead.read') ||
    !holds(session, 'contact.read')
  )
    notFound();
  const p = await searchParams,
    id = p['contact'],
    q = (p['q'] ?? '').slice(0, 200);
  const customer = id ? await loadCustomer(session, id) : null;
  if (id && !customer) notFound();
  const options = await appointmentOptions(session),
    matches = customer ? [] : (await loadCustomers(session, q)).rows;
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/appointments"
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Appointments
      </Link>
      <PageHeader
        title="Book appointment"
        meta={
          customer
            ? `Arrange a visit for ${customer.name}.`
            : 'Start by choosing the customer who is visiting.'
        }
      />
      {customer ? (
        <Card
          title={customer.name}
          action={
            <Link
              className="text-sm text-link"
              href={`/customers/${customer.id}`}
            >
              View profile →
            </Link>
          }
        >
          <AppointmentForm
            contactId={customer.id}
            leadId={p['lead'] ?? ''}
            siteId={customer.siteId}
            userId={session.userId}
            {...options}
          />
        </Card>
      ) : (
        <Card
          title="Choose a customer"
          action={
            holds(session, 'contact.create') && (
              <Link className="text-sm text-link" href="/customers/new">
                New customer →
              </Link>
            )
          }
        >
          <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 flex-1 gap-1 text-sm">
              Name, email or phone
              <input
                name="q"
                defaultValue={q}
                maxLength={200}
                className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
              />
            </label>
            <button className="min-h-11 rounded-md border border-edge-strong px-4">
              Find customer
            </button>
          </form>
          <div className="divide-y divide-edge">
            {matches.map((c) => (
              <Link
                key={c.id}
                href={`/appointments/new?contact=${c.id}`}
                className="block py-3 hover:text-link"
              >
                <span className="block font-medium">{c.name}</span>
                <span className="text-sm text-ink-muted break-all">
                  {c.email || c.phone || 'View available booking options'} →
                </span>
              </Link>
            ))}
            {!matches.length && (
              <p className="py-6 text-ink-muted">
                No matching customers. Try another search or add a new customer.
              </p>
            )}
          </div>
          {matches.length === 40 && (
            <p className="mt-4 text-xs text-ink-muted">
              Showing the first 40 customers. Search to narrow the list.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
