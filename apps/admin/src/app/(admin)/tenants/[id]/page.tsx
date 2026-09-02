import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOperator, operatorCan } from '@/auth/session';
import { loadTenant, loadTenantExtras } from '@/data/platform';
import { attachDomain, changeTenantStatus } from '@/data/tenant-actions';
import { Card, Figure, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default async function TenantDetail(
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireOperator();
  const { id } = await params;
  const [tenant, extras] = await Promise.all([loadTenant(id), loadTenantExtras(id)]);
  if (!tenant || !extras) notFound();

  const canManage = operatorCan(session, 'operator.manage');

  return (
    <>
      <p className="mb-3">
        <Link href="/" className="text-link underline">Dealerships</Link>
        {' / '}
        {tenant.name}
      </p>
      <h1 className="mb-1 text-[28px] leading-[34px] font-semibold">{tenant.name}</h1>
      <p className="mb-4 text-ink-muted">
        Counts only. Support that needs a customer record goes through impersonation.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <StatusBadge tone="neutral" icon="·" label={label(tenant.status)} />
        {tenant.plan && <StatusBadge tone="info" icon="◆" label={label(tenant.plan)} />}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Card><Figure label="Live stock" value={String(tenant.liveStock)} /></Card>
        <Card><Figure label="In stock" value={String(tenant.totalStock)} /></Card>
        <Card><Figure label="Staff" value={String(tenant.staff)} /></Card>
        <Card><Figure label="Leads waiting" value={String(tenant.leadsAwaiting)} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Owners">
          {extras.owners.length === 0 ? (
            <p className="text-ink-muted">No owner membership yet.</p>
          ) : (
            <ul className="grid gap-1">
              {extras.owners.map((o) => (
                <li key={o.email}>
                  <span className="font-medium">{o.name}</span>
                  {' · '}
                  <span className="text-ink-muted">{o.email}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Hostnames">
          {extras.domains.length === 0 ? (
            <p className="mb-3 text-ink-muted">None connected. The public site 404s until one is.</p>
          ) : (
            <ul className="mb-3 grid gap-1">
              {extras.domains.map((d) => (
                <li key={d.hostname}>
                  <code>{d.hostname}</code>
                  {d.isPrimary ? ' · primary' : ''}
                  {d.verified ? ' · verified' : ' · unverified (still 404s)'}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <form action={attachDomain} className="grid gap-2">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input
                name="hostname"
                required
                placeholder="dealer.example.co.uk"
                className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
              />
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="markVerified" />
                Mark verified — only for a host we control
              </label>
              <button
                type="submit"
                className="min-h-11 rounded-md border border-edge-strong px-4 font-medium hover:bg-surface-3"
              >
                Connect hostname
              </button>
            </form>
          )}
        </Card>

        {canManage && (
          <Card title="Status">
            <form action={changeTenantStatus} className="flex flex-wrap gap-2">
              <input type="hidden" name="tenantId" value={tenant.id} />
              {(['trial', 'live', 'suspended', 'cancelled'] as const).map((status) => (
                <button
                  key={status}
                  name="status"
                  value={status}
                  type="submit"
                  className="min-h-11 rounded-md border border-edge-strong px-3 hover:bg-surface-3"
                >
                  {label(status)}
                </button>
              ))}
            </form>
            <p className="mt-3 text-[13px] text-ink-muted">
              Cancelled withdraws the dealership from the directory. It does not
              delete invoices, the stock book or evidence.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
