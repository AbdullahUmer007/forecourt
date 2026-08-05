'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { completeReset } from '@/auth/reset';
import type { CompleteResult } from '@/auth/reset';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Setting…' : 'Set password'}
    </button>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState<CompleteResult | null, FormData>(completeReset, null);

  if (state?.ok) {
    return (
      <div className="grid gap-3 rounded-md border border-good/40 bg-surface-1 p-4">
        <h2 className="text-[16px] leading-6 font-semibold">
          <span aria-hidden="true">✓</span> Password set
        </h2>
        <p className="text-ink-muted">
          Everywhere you were signed in has been signed out, including this device. Sign in again
          with the new password.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-md border border-edge bg-surface-1 p-4">
      <input type="hidden" name="token" value={token} />

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          New password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      {state && !state.ok && (
        <div role="alert" className="grid gap-1 text-critical">
          {state.error && <p><span aria-hidden="true">✕</span> {state.error}</p>}
          {/* Every problem at once. Fixing them one at a time is how a reset
              becomes four attempts and ends up written on a card by the till. */}
          {state.problems && state.problems.length > 0 && (
            <ul className="list-disc pl-5 text-[13px] leading-[18px]">
              {state.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>
      )}

      <Submit />
    </form>
  );
}
