import { redirect } from 'next/navigation';
import { getSession } from '@/auth/session';
import { beginEnrolment } from '@/auth/mfa';
import { EnrolForm, ChallengeForm } from '@/components/mfa-forms';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Two-step verification' };

/**
 * The second factor — enrolment or challenge, depending on which is owed.
 *
 * Deliberately OUTSIDE the `(app)` route group, because a session sitting here
 * has a correct password and nothing else. It must not render the masthead, it
 * must not reach a tenant-scoped query, and it must not be one forgotten
 * `getSession()` away from doing either.
 */
export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  // Already through — nothing owed here.
  if (!session.mfaPending && !session.mfaEnrolmentRequired) redirect('/');

  if (session.mfaEnrolmentRequired) {
    const offer = await beginEnrolment();
    return (
      <main className="mx-auto grid min-h-screen max-w-[460px] content-center gap-4 px-4">
        <div>
          <h1 className="text-[28px] leading-[34px] font-semibold">Set up your authenticator</h1>
          <p className="text-ink-muted">
            This account can see commission figures, evidence exports or permissions, so it needs
            a second factor before it can be used.
          </p>
        </div>
        <EnrolForm secret={offer.secret} uri={offer.uri} email={session.email} />
      </main>
    );
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-[420px] content-center gap-4 px-4">
      <div>
        <h1 className="text-[28px] leading-[34px] font-semibold">Enter your code</h1>
        <p className="text-ink-muted">
          Six digits from your authenticator app, or one of your recovery codes.
        </p>
      </div>
      <ChallengeForm />
    </main>
  );
}
