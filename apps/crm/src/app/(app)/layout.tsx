import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, signOut } from '@/auth/session';
import { Nav } from '@/components/nav';
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
  { href: '/channels', label: 'Channels', needs: 'channel.read' },
  { href: '/compliance', label: 'Compliance', needs: 'compliance.read' },
  { href: '/accounting', label: 'Accounting', needs: 'report.financial.read' },
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
      {/*
        Two rows, not one.
        ─────────────────────────────────────────────────────────────────────
        Twelve sections, the brand, the dealership name and a sign-out control
        do not fit on one line at 1440px — they wrapped, and a masthead that
        wraps mid-word reads as a broken page before anybody has looked at the
        data. Worse, on a phone the nav was clipped at four items with no way
        to reach the rest: Stock, Leads and Deals were unreachable on the
        device §7 of the domain skill says a sales executive is standing on the
        forecourt holding.

        Identity on row one, sections on row two, and the sections row scrolls.
      */}
      <header className="sticky top-0 z-10 border-b border-edge bg-surface-1">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2">
          <Link href="/" className="shrink-0 font-semibold tracking-tight">Forecourt</Link>
          <span className="truncate text-ink-subtle">{session.tenantName}</span>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* Who you are signed in as, on the page rather than in a tooltip.
                A dealership where two people share a machine needs to be able
                to see whose name is about to go on the audit row. */}
            <span className="hidden max-w-[16ch] truncate text-ink-muted md:inline">
              {session.displayName}
            </span>
            <form action={endSession}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-md border border-edge-strong px-3 font-medium text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <Nav items={nav.map((item) => ({ href: item.href, label: item.label }))} />
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6">{children}</main>
    </>
  );
}
