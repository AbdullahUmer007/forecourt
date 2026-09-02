import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession, signOut } from '@/auth/session';
import { AppShell, type NavItem } from '@/components/app-shell';
import { SignOutIcon } from '@/components/icons';
import { holds, roleByKey } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * `needs` is the permission the DESTINATION enforces, not a second gate.
 *
 * The page itself still refuses — UI hiding is a convenience and never the
 * control. But a nav entry that leads to a 404 is a worse convenience than
 * none: it tells somebody the feature exists, then implies the product is
 * broken when they click it. Both the VAT book and the Channel P&L call
 * `notFound()` for a principal without the permission, so both were doing
 * exactly that.
 */
const NAV: (NavItem & { needs?: string })[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/appraisals', label: 'Part-exchange', icon: 'appraisal' },
  { href: '/prep', label: 'Prep', icon: 'prep' },
  { href: '/stock', label: 'Stock', icon: 'stock' },
  { href: '/leads', label: 'Leads', icon: 'leads' },
  { href: '/deals', label: 'Deals', icon: 'deals' },
  { href: '/invoices', label: 'Invoices', icon: 'invoices' },
  // Named "VAT book" rather than "Stock book": to a dealer, "the stock book"
  // and "stock" are different things and the nav already has Stock above.
  { href: '/vat/stock-book', label: 'VAT book', icon: 'vat', needs: 'stockbook.read' },
  { href: '/reports/channels', label: 'Channel P&L', icon: 'reports', needs: 'report.read' },
  { href: '/channels', label: 'Channels', icon: 'channels', needs: 'channel.read' },
  { href: '/compliance', label: 'Compliance', icon: 'compliance', needs: 'compliance.read' },
  { href: '/accounting', label: 'Accounting', icon: 'accounting', needs: 'report.financial.read' },
];

/**
 * The authenticated shell, and the single place the CRM decides whether a
 * request may see anything at all.
 *
 * Every authenticated route lives under this layout, so a new page cannot
 * forget the check — it is not a call each page makes, it is the group they
 * are in. /sign-in sits outside the group and is the only route without it.
 *
 * The chrome itself is in `<AppShell>`, which is a client component because it
 * needs the current path. The decisions stay here, on the server: this file
 * still resolves the session, still enforces MFA and still filters the nav by
 * permission before a single destination reaches the browser.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  // A correct password is not a signed-in session when the permissions mandate
  // a second factor. This redirect is the whole enforcement: every
  // authenticated route is in this group, so there is no page that renders
  // above it and no page that has to remember to check.
  if (session.mfaPending || session.mfaEnrolmentRequired) redirect('/mfa');

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  const nav = NAV.filter((item) => !item.needs || holds(principal, item.needs));

  async function endSession() {
    'use server';
    await signOut();
    redirect('/sign-in');
  }

  return (
    <AppShell
      items={nav.map(({ href, label, icon }) => ({ href, label, icon }))}
      tenantName={session.tenantName}
      displayName={session.displayName}
      // The role's own name, not its key: a dealer reads "Sales executive",
      // never `sales_exec`. Falling back to the key is deliberate — a custom
      // role a tenant added is better shown raw than shown as nothing.
      roleLabel={roleByKey(session.roleKey)?.name ?? session.roleKey}
      signOut={(
        <form action={endSession}>
          <button
            type="submit"
            title="Sign out"
            aria-label="Sign out"
            className="grid size-9 place-items-center rounded-md text-ink-subtle hover:bg-surface-3 hover:text-ink"
          >
            <SignOutIcon size={18} />
          </button>
        </form>
      )}
    >
      {children}
    </AppShell>
  );
}
