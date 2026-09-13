import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { appointmentOptions } from '@/data/appointments';
import { CustomerForm } from '@/components/customer-form';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'New customer' };
export default async function NewCustomerPage() {
  const session = await requireSession();
  if (!holds(session, 'contact.create') || !holds(session, 'contact.read'))
    notFound();
  const { sites } = await appointmentOptions(session);
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/customers"
        className="mb-4 inline-flex min-h-11 items-center text-link"
      >
        ← Customers
      </Link>
      <PageHeader
        title="New customer"
        meta="Start with the details you have. Add more as you get to know them."
      />
      <Card title="Contact details">
        <CustomerForm sites={sites} />
      </Card>
    </div>
  );
}
