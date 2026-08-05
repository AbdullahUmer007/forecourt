import { ResetForm } from '@/components/reset-form';
import { MIN_PASSWORD_LENGTH } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * Setting a new password from a reset link.
 *
 * Outside the `(app)` group and reading no session — the person using this has
 * by definition lost the ability to sign in. The token is validated when it is
 * SPENT, not when this page loads: telling someone "that link is expired"
 * before they type anything is a free oracle for anyone holding a stolen link.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto grid min-h-screen max-w-[420px] content-center gap-4 px-4">
      <div>
        <h1 className="text-[28px] leading-[34px] font-semibold">Set a new password</h1>
        <p className="text-ink-muted">
          Use at least {MIN_PASSWORD_LENGTH} characters. Three or four unrelated words is easier
          to remember and harder to guess than a short one with symbols in it.
        </p>
      </div>
      <ResetForm token={token} />
    </main>
  );
}
