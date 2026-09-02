import { redirect } from 'next/navigation';
import { getSession, signIn } from '@/auth/session';
import { BrandMark } from '@/components/icons';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The tab a dealer is looking for, named. */
export const metadata = { title: 'Sign in' };

/**
 * Sign in.
 *
 * A server action, not a fetch: the credential never touches client
 * JavaScript, the form works with JavaScript disabled, and there is no token
 * for an XSS to read because the session lives in an httpOnly cookie.
 */
export default async function SignInPage(
  { searchParams }: { searchParams: Promise<{ error?: string; next?: string }> },
) {
  if (await getSession()) redirect('/');
  const params = await searchParams;

  async function attempt(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '/');

    const result = await signIn(email, password, {
      trustedDevice: formData.get('trust') === 'on',
    });

    if (!result.ok) {
      redirect(`/sign-in?error=${encodeURIComponent(result.message ?? 'Sign-in failed.')}`);
    }
    // A destination is only honoured if it is a path on this site. An
    // open redirect on a login page is how a phishing link borrows our domain.
    redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[400px] content-center gap-5 px-4 py-10">
      {/*
        The brand, at the only size it ever gets to be this big.
        ───────────────────────────────────────────────────────────────────
        This is the one screen with nothing else on it, and the first thing a
        new dealer sees on the morning they are handed the login. Everywhere
        else the mark is 28px in the corner of a rail.
      */}
      <div className="text-center">
        <BrandMark size={44} className="mx-auto text-brand-600" />
        <h1 className="mt-3 text-[26px] leading-8 font-semibold">RixDrive</h1>
        <p className="mt-1 text-ink-muted">Sign in to your dealership.</p>
      </div>

      {params.error && (
        <div
          role="alert"
          className="rounded-md border border-critical/40 bg-critical/10 p-3 text-critical"
        >
          <span aria-hidden="true">✕</span> {params.error}
        </div>
      )}

      <form
        action={attempt}
        className="grid gap-4 rounded-lg border border-edge bg-surface-1 p-5 shadow-(--shadow-raised)"
      >
        <input type="hidden" name="next" value={params.next ?? '/'} />

        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            className={INPUT_CLASS}
          />
        </label>

        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex items-start gap-2.5 py-0.5">
          <input name="trust" type="checkbox" className="mt-0.5 size-4 accent-brand-600" />
          <span className="text-[13px] leading-[18px] text-ink-muted">
            Trust this device — stay signed in for longer on this machine only
          </span>
        </label>

        <button
          type="submit"
          className="h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white transition-colors duration-100 hover:bg-brand-700"
        >
          Sign in
        </button>
      </form>

      <p className="text-center text-[13px] leading-[18px] text-ink-subtle">
        Forgotten your password? Ask whoever manages your dealership account to reset it — we
        cannot email you a reset link yet.
      </p>
    </main>
  );
}
