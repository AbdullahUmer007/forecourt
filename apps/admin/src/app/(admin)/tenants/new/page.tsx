import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOperator, operatorCan } from '@/auth/session';
import { CreateDealershipForm } from './create-form';

export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  const session = await requireOperator();
  if (!operatorCan(session, 'operator.manage')) redirect('/');

  return (
    <>
      <p className="mb-3">
        <Link href="/" className="text-link underline">Dealerships</Link>
        {' / '}
        New
      </p>
      <h1 className="mb-1 text-[28px] leading-[34px] font-semibold">Create a dealership</h1>
      <p className="mb-4 text-ink-muted">
        Creates the tenant, first site, brand, the nine system roles and an owner
        account. The password is shown once.
      </p>
      <CreateDealershipForm />
    </>
  );
}
