import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { loadCustomer } from '@/data/customers';
import { appointmentStamp } from '@/data/appointments';
import { CustomerForm } from '@/components/customer-form';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'Customer profile' };
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession(),
    c = await loadCustomer(session, (await params).id);
  if (!c) notFound();
  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/customers"
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Customers
      </Link>
      <PageHeader
        title={c.name}
        meta="Customer profile"
        action={
          holds(session, 'lead.update') &&
          holds(session, 'lead.read') && (
            <Link
              href={`/appointments/new?contact=${c.id}`}
              className="inline-flex min-h-11 items-center rounded-md bg-brand-600 px-4 text-white"
            >
              Book appointment
            </Link>
          )
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Customer details">
          <CustomerForm
            key={c.id}
            customer={c}
            sites={[]}
            editable={holds(session, 'contact.update')}
          />
        </Card>
        <div className="space-y-5">
          <Card
            title="Enquiries"
            action={
              holds(session, 'lead.create') && (
                <Link
                  className="text-sm text-link"
                  href={`/leads/new?q=${encodeURIComponent(c.email || c.phone || c.name)}`}
                >
                  New enquiry →
                </Link>
              )
            }
          >
            <div className="divide-y divide-edge">
              {c.leads.map((l) => (
                <Link
                  href={`/leads/${l.id}`}
                  key={l.id}
                  className="block py-3 hover:text-link"
                >
                  <span className="text-xs uppercase text-ink-muted">
                    {l.stage.replaceAll('_', ' ')}
                  </span>
                  <span className="mt-1 block line-clamp-2">
                    {l.message || 'View enquiry'}
                  </span>
                </Link>
              ))}
              {!c.leads.length && (
                <p className="py-4 text-sm text-ink-muted">
                  No visible enquiries for this customer yet.
                </p>
              )}
            </div>
          </Card>
          <Card title="Appointments">
            <div className="divide-y divide-edge">
              {c.appointments.map((a) => (
                <Link
                  href={`/appointments/${a.id}`}
                  key={a.id}
                  className="block py-3 hover:text-link"
                >
                  <span className="block font-medium capitalize">
                    {a.purpose.replaceAll('_', ' ')} ·{' '}
                    {appointmentStamp(a.startsAt)}
                  </span>
                  <span className="text-sm text-ink-muted capitalize">
                    {a.status.replaceAll('_', ' ')}
                  </span>
                </Link>
              ))}
              {!c.appointments.length && (
                <p className="py-4 text-sm text-ink-muted">
                  No appointments yet. Book a viewing, test drive or collection
                  from this profile.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
