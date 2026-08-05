'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { confirmEnrolment, completeChallenge } from '@/auth/mfa';
import type { EnrolmentResult, ChallengeResult } from '@/auth/mfa';

const FIELD =
  'min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3 text-center text-[20px] tracking-[0.3em]';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Checking…' : label}
    </button>
  );
}

/**
 * Enrolment.
 *
 * The secret is shown as text rather than a QR code: generating a QR needs a
 * client library, and this page must stay tiny and work on a workshop
 * connection. Every authenticator app accepts a typed key, and the `otpauth://`
 * link opens the app directly on the phone the person is already holding.
 */
export function EnrolForm(
  { secret, uri, email }: { secret: string; uri: string; email: string },
) {
  const [state, action] = useActionState<EnrolmentResult | null, FormData>(
    confirmEnrolment, null,
  );

  // Issued once. There is no second chance by construction — they are hashed
  // on the way into the database.
  if (state?.ok && state.recoveryCodes) {
    return (
      <div className="grid gap-3 rounded-md border border-good/40 bg-surface-1 p-4">
        <h2 className="text-[16px] leading-6 font-semibold">
          <span aria-hidden="true">✓</span> Authenticator set up
        </h2>
        <p className="text-ink-muted">
          Save these recovery codes somewhere other than your phone. Each one works once, and
          they are the only way back in if you lose the device.{' '}
          <strong>They will not be shown again.</strong>
        </p>
        <ul className="mono grid grid-cols-2 gap-1 rounded-md border border-edge bg-surface-3 p-3 text-[14px]">
          {state.recoveryCodes.map((code) => <li key={code}>{code}</li>)}
        </ul>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700"
        >
          I have saved them — continue
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-md border border-edge bg-surface-1 p-4">
      <input type="hidden" name="secret" value={secret} />

      <div className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          1 — add this key to your authenticator
        </span>
        <code className="mono block break-all rounded-md border border-edge bg-surface-3 p-3 text-[14px]">
          {secret}
        </code>
        <p className="text-[13px] leading-[18px] text-ink-subtle">
          Account: {email}. On the phone you are holding, this link opens the app directly:{' '}
          <a href={uri} className="text-link underline">add to authenticator</a>.
        </p>
      </div>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          2 — enter the six digits it shows
        </span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className={FIELD}
        />
      </label>

      {state && !state.ok && state.error && (
        <p role="alert" className="text-critical">
          <span aria-hidden="true">✕</span> {state.error}
        </p>
      )}

      <Submit label="Confirm" />
    </form>
  );
}

export function ChallengeForm() {
  const [state, action] = useActionState<ChallengeResult | null, FormData>(
    completeChallenge, null,
  );

  return (
    <form action={action} className="grid gap-3 rounded-md border border-edge bg-surface-1 p-4">
      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Code
        </span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className={FIELD}
        />
      </label>

      {state && !state.ok && state.error && (
        <p role="alert" className="text-critical">
          <span aria-hidden="true">✕</span> {state.error}
        </p>
      )}

      <Submit label="Continue" />
    </form>
  );
}
