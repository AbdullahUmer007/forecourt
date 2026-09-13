import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { loadCustomers } from '@/data/customers';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'Customers' };
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!holds(session, 'contact.read')) notFound();
  const params = await searchParams,
    q = (params['q'] ?? '').slice(0, 200),
    raw = Number(params['offset'] ?? 0),
    offset = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  const { rows, total } = await loadCustomers(session, q, offset);
  const page = (n: number) =>
    `/customers?q=${encodeURIComponent(q)}&offset=${n}`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customers"
        meta="One place for customer details, enquiries and visits."
        action={
          holds(session, 'contact.create') && (
            <Link
              href="/customers/new"
              className="inline-flex min-h-11 items-center rounded-md bg-brand-600 px-4 text-white"
            >
              New customer
            </Link>
          )
        }
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3" method="GET">
          <label className="grid min-w-0 flex-1 gap-1 text-sm">
            Find a customer
            <input
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="Name, email, phone or postcode"
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            />
          </label>
          <button className="min-h-11 rounded-md border border-edge-strong px-4">
            Search
          </button>
          {q && (
            <Link
              className="inline-flex min-h-11 items-center text-link"
              href="/customers"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>
      <p className="my-4 text-sm text-ink-muted">
        {total} {total === 1 ? 'customer' : 'customers'}
        {q ? ' matching your search' : ' in your directory'}
      </p>
      <Card>
        <div className="divide-y divide-edge">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] sm:flex min-h-20 flex-wrap items-center gap-4 rounded-md px-2 py-4 hover:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-link"
              >
                {c.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold break-words">
                  {c.name}
                </span>
                <span className="block text-sm text-ink-muted break-all">
                  {[c.email, c.phone].filter(Boolean).join(' · ') ||
                    'No contact details yet'}
                </span>
              </span>
              <span className="col-start-2 -mt-2 text-sm text-link sm:mt-0">
                View profile →
              </span>
            </Link>
          ))}
          {!rows.length && (
            <div className="py-12 text-center">
              <h2 className="text-lg font-semibold">
                {q
                  ? 'No matching customers'
                  : 'Your customer directory starts here'}
              </h2>
              <p className="mt-2 text-ink-muted">
                {q
                  ? 'Try a shorter name, phone number or email address.'
                  : 'Add a customer to keep their enquiries and appointments together.'}
              </p>
            </div>
          )}
        </div>
      </Card>
      <nav
        aria-label="Customer pages"
        className="mt-4 flex items-center justify-between text-sm"
      >
        {offset > 0 ? (
          <Link
            href={page(Math.max(0, offset - 40))}
            className="py-3 text-link"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {offset + 40 < total && (
          <Link href={page(offset + 40)} className="py-3 text-link">
            Next →
          </Link>
        )}
      </nav>
    </div>
  );
}
