import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { holds } from '@forecourt/domain';
import { listAssignableRoles, listStaff } from '@/data/staff';
import { StaffStatusForm } from '@/components/staff-status-form';
import { PageHeader, Card, StatusBadge } from '@/components/ui';
import { InviteForm } from './invite-form';
import { StaffRemove } from '@/components/staff-remove';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const session = await requireSession();
  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'user.invite') && !holds(principal, 'staff.read') && !holds(principal, 'user.update')) {
    notFound();
  }

  const [staff, roles] = await Promise.all([listStaff(session), listAssignableRoles(session)]);
  const canInvite = holds(principal, 'user.invite');

  return (
    <>
      <PageHeader
        title="People"
        meta="Staff of this dealership. Removing someone ends their login here; it does not delete the person."
      />

      {canInvite && (
        <Card title="Add staff" className="mb-4">
          <InviteForm roles={roles} />
        </Card>
      )}

      <Card title="On this dealership">
        {staff.length === 0 ? (
          <p className="text-ink-muted">Nobody has been invited yet.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {staff.map((m) => (
              <li key={m.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-[13px] text-ink-subtle">{m.email} · {m.roleName}</div>
                </div>
                <StatusBadge
                  tone={m.status === 'active' ? 'good' : m.status === 'suspended' ? 'warning' : 'neutral'}
                  icon={m.status === 'active' ? '✓' : '·'}
                  label={m.status}
                />
                {m.status === 'active' && !m.isLastOwner && holds(principal, 'user.update') && (
                  <StaffStatusForm membershipId={m.membershipId} status="suspended" />
                )}
                {m.status === 'suspended' && holds(principal, 'user.update') && (
                  <StaffStatusForm membershipId={m.membershipId} status="active" />
                )}
                {m.status !== 'removed' && !m.isLastOwner && holds(principal, 'user.remove') && (
                  <StaffRemove membershipId={m.membershipId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
