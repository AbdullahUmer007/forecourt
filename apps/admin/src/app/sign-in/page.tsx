import { redirect } from 'next/navigation';
import { verify } from '@node-rs/argon2';
import { getOperatorSession, signInOperator, setOperatorCookie } from '@/auth/session';
import { Card, Problem } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Operator sign-in.
 *
 * Separate from the CRM's in every way that matters — a different cookie, a
 * different identity table, a shorter session, and MFA required
 * unconditionally rather than per-permission.
 *
 * The failure message never distinguishes an unknown email from a wrong
 * password from somebody who simply is not Forecourt staff. Telling them apart
 * would tell an attacker which of our own colleagues' addresses are worth
 * trying, and this is the login to the application that can see every
 * dealership on the platform.
 */
export default async function SignIn(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const params = await searchParams;
  const existing = await getOperatorSession();
  if (existing && !existing.mfaPending && !existing.mfaEnrolmentRequired) redirect('/');

  async function submit(formData: FormData) {
    'use server';
    const result = await signInOperator(
      String(formData.get('email') ?? ''),
      String(formData.get('password') ?? ''),
      (hash, password) => verify(hash, password).catch(() => false),
    );
    if (!result.ok || !result.token) redirect('/sign-in?failed=1');
    await setOperatorCookie(result.token);
    redirect('/');
  }

  return (
    <main className="mx-auto max-w-[420px] px-4 py-16">
      <h1 className="mb-1 text-[28px] leading-[34px] font-semibold">Platform admin</h1>
      <p className="mb-4 text-ink-muted">Forecourt staff only.</p>

      {params['failed'] && (
        <div className="mb-4">
          <Problem title="That did not work">
            That email address and password do not match a Forecourt operator account.
          </Problem>
        </div>
      )}

      {params['mfa'] && (
        <div className="mb-4">
          <Problem title="Second factor required">
            Every screen in this application reads across every dealership on the platform, so a
            second factor is required for all of it — not only for sensitive actions. Enrol one
            before signing in.
          </Problem>
        </div>
      )}

      <Card>
        <form action={submit} className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
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

          <button
            type="submit"
            className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
          >
            Sign in
          </button>
        </form>
      </Card>

      <p className="mt-4 text-[12px] leading-4 text-ink-subtle">
        Everything you do in this application is logged against your name, including which
        dealership&rsquo;s data you looked at and why.
      </p>
    </main>
  );
}
