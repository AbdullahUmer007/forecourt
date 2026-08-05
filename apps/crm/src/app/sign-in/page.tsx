import { redirect } from 'next/navigation';
import { getSession, signIn } from '@/auth/session';

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
    <main className="mx-auto grid min-h-screen max-w-[420px] content-center gap-4 px-4">
      <div>
        <h1 className="text-[28px] leading-[34px] font-semibold">Forecourt</h1>
        <p className="text-ink-muted">Sign in to your dealership.</p>
      </div>

      {params.error && (
        <div
          role="alert"
          className="rounded-md border border-critical/40 bg-surface-1 p-3 text-critical"
        >
          <span aria-hidden="true">✕</span> {params.error}
        </div>
      )}

      <form action={attempt} className="grid gap-3 rounded-md border border-edge bg-surface-1 p-4">
        <input type="hidden" name="next" value={params.next ?? '/'} />

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Password
          </span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="flex items-center gap-2 py-1">
          <input name="trust" type="checkbox" className="h-5 w-5" />
          <span className="text-ink-muted">
            Trust this device — stay signed in for longer on this machine only
          </span>
        </label>

        <button
          type="submit"
          className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
        >
          Sign in
        </button>
      </form>

      <p className="text-[13px] leading-[18px] text-ink-subtle">
        Forgotten your password? Ask whoever manages your dealership account to reset it — we
        cannot email you a reset link yet.
      </p>
    </main>
  );
}
