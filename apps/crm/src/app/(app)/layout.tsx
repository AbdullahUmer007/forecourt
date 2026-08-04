import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, signOut } from '@/auth/session';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/appraisals', label: 'Part-exchange' },
  { href: '/prep', label: 'Prep' },
  { href: '/stock', label: 'Stock' },
  { href: '/leads', label: 'Leads' },
  { href: '/deals', label: 'Deals' },
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
            {NAV.map((item) => (
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
