import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOperatorSession, signOutOperator } from '@/auth/session';

export const dynamic = 'force-dynamic';

/**
 * The authenticated shell, and the single place this application decides
 * whether a request may see anything at all.
 *
 * Same shape as the CRM's `(app)` group and for the same reason: every
 * authenticated route lives under it, so a new page cannot forget the check.
 *
 * The banner is not decoration. An operator with the CRM open in another tab
 * is one keystroke from thinking they are in a dealer's own account, and this
 * application reads across every dealership on the platform.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getOperatorSession();
  if (!session) redirect('/sign-in');

  // MFA is required unconditionally here, not per-permission. There is no
  // read in this application casual enough to skip a second factor for.
  if (session.mfaPending || session.mfaEnrolmentRequired) redirect('/sign-in?mfa=1');

  async function endSession() {
    'use server';
    await signOutOperator();
    redirect('/sign-in');
  }

  return (
    <>
      {/* Permanently visible, at the top of every page. */}
      <div className="bg-critical px-4 py-1.5 text-center text-[13px] leading-[18px] font-medium text-white">
        Forecourt staff · you are looking at customers&rsquo; businesses
      </div>

      <header className="sticky top-0 z-10 border-b border-edge bg-surface-1">
        <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-2">
          <Link href="/" className="font-semibold tracking-tight">Platform admin</Link>
          <span className="hidden text-ink-subtle sm:inline">{session.email}</span>
          <span className="rounded-sm border border-edge-strong px-2 py-0.5 text-[12px] leading-4">
            {session.role.replace(/_/g, ' ')}
          </span>

          <form action={endSession} className="ml-auto">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-4">{children}</main>
    </>
  );
}
