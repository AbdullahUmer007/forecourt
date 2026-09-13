import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOperatorSession, operatorAdmitted, signOutOperator, MFA_BYPASS } from '@/auth/session';
import { ThemeToggle } from '@/components/theme-toggle';

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
  // read in this application casual enough to skip a second factor for —
  // unless ADMIN_MFA_BYPASS is set, which is temporary and says so on screen.
  if (!operatorAdmitted(session)) redirect('/sign-in?mfa=1');

  async function endSession() {
    'use server';
    await signOutOperator();
    redirect('/sign-in');
  }

  return (
    <>
      {/* Permanently visible, at the top of every page. */}
      <div className="bg-critical px-4 py-1.5 text-center text-[13px] leading-[18px] font-medium text-white">
        RixDrive staff · you are looking at customers&rsquo; businesses
      </div>

      {/*
        * Deliberately louder than the banner above it, because it describes a
        * weaker state than the one this application is supposed to run in.
        * A bypass nobody can see is a bypass nobody turns off.
        */}
      {MFA_BYPASS && (
        <div className="border-b-2 border-critical bg-warning px-4 py-1.5 text-center text-[13px] leading-[18px] font-semibold text-ink">
          Second-factor checks are switched off (ADMIN_MFA_BYPASS). A password alone reaches every
          dealership. Temporary — unset it once MFA enrolment ships.
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-edge bg-surface-1">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-5 py-4">
          <Link href="/" className="text-[20px] font-semibold tracking-tight">RixDrive <span className="text-link">Admin</span></Link>
          <span className="hidden text-ink-subtle sm:inline">{session.email}</span>
          <span className="rounded-sm border border-edge-strong px-2 py-0.5 text-[12px] leading-4">
            {session.role.replace(/_/g, ' ')}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />

            <form action={endSession}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10">{children}</main>
    </>
  );
}
