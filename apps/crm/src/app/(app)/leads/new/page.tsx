import Link from 'next/link';
import { notFound } from 'next/navigation';
import { holds } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { withSession } from '@/data/db';
import { PageHeader, Card } from '@/components/ui';
import { NewLeadControl } from '@/components/lead-controls';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'New enquiry' };
export default async function NewLeadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  if (!holds(session, 'lead.create')) notFound();
  const q = ((await searchParams)['q'] ?? '').trim().slice(0, 200);
  const options = await withSession(session, async tx => {
    const sites = await tx`SELECT id, name FROM sites ORDER BY name`;
    const customers = q && holds(session, 'contact.read') ? await tx`SELECT id, first_name, last_name, company_name, email, phone FROM contacts
      WHERE erased_at IS NULL AND merged_into_id IS NULL AND strpos(lower(concat_ws(' ', first_name, last_name, company_name, email, phone)), lower(${q})) > 0
      ORDER BY last_name, first_name, id LIMIT 30` : [];
    return { sites: sites.filter(s => session.scope === 'all_sites' || session.siteIds.includes(String(s['id']))).map(s => ({ id: String(s['id']), name: String(s['name']) })),
      customers: customers.map(c => ({ id: String(c['id']), name: [c['first_name'], c['last_name'], c['company_name'], c['email'], c['phone']].filter(Boolean).join(' · ') })) };
  });
  return <div className="mx-auto max-w-3xl">
    <Link href="/leads" className="mb-4 inline-flex min-h-11 items-center text-link">← Sales inbox</Link>
    <PageHeader title="New enquiry" meta="Turn a call or a visit into a clear next step." />
    <Card title="Find an existing customer">
      <form method="GET" className="mb-3 flex flex-wrap gap-2"><label className="grid flex-1 gap-1 text-sm">Name, email or phone<input name="q" defaultValue={q} maxLength={200} className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3" /></label><button className="self-end min-h-11 rounded-md border border-edge-strong px-4">Find customer</button></form>
      {q && <p role="status" className="text-sm text-ink-muted">{options.customers.length ? `${options.customers.length} matches. Select a customer below. Showing up to 30; narrow your search if needed.` : 'No matches. You can create a customer below.'}</p>}
    </Card>
    <div className="mt-4"><Card title="Enquiry details"><NewLeadControl key={q} {...options} /></Card></div>
  </div>;
}
