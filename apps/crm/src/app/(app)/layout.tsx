import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, signOut } from '@/auth/session';
import { holds } from '@forecourt/domain';

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
const NAV: { href: string; label: string; needs?: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/appraisals', label: 'Part-exchange' },
  { href: '/prep', label: 'Prep' },
  { href: '/stock', label: 'Stock' },
  { href: '/leads', label: 'Leads' },
  { href: '/deals', label: 'Deals' },
  { href: '/invoices', label: 'Invoices' },
  // Named "VAT book" rather than "Stock book": to a dealer, "the stock book"
  // and "stock" are different things and the nav already has Stock above.
  { href: '/vat/stock-book', label: 'VAT book', needs: 'stockbook.read' },
  { href: '/reports/channels', label: 'Channel P&L', needs: 'report.read' },
];

/**
 * The authenticated shell, and the single place the CRM decides whether a
 * request may see anything at all.
 *
 * Every authenticated route lives under this layout, so a new page cannot
 * forget the check — it is not a call each page makes, it is the group they
 * are in. /sign-in sits outside the group and is the only route without it.
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
    <>
      <header className="sticky top-0 z-10 border-b border-edge bg-surface-1">
        <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-2">
          <Link href="/" className="font-semibold tracking-tight">Forecourt</Link>
          <span className="hidden text-ink-subtle sm:inline">{session.tenantName}</span>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form action={endSession}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
              title={`Signed in as ${session.displayName}`}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6">{children}</main>
    </>
  );
}
