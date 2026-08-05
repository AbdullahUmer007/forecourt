'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { recordChannelSpend } from '@/data/spend-actions';
import type { SpendOutcome } from '@/data/spend-apply';

/**
 * Recording what a channel cost this month.
 *
 * The "estimated" tick is the important control. Most dealers know roughly
 * what Auto Trader costs before the invoice lands, and a P&L that refuses a
 * figure until the paperwork arrives is a P&L nobody fills in. Marking it
 * instead means the table can carry the number AND say it is not confirmed —
 * which is the difference between a useful estimate and a fabricated fact.
 */
export function SpendForm(
  { channels, defaultMonth }: { channels: readonly string[]; defaultMonth: string },
) {
  const [state, formAction] = useActionState<SpendOutcome | null, FormData>(
    recordChannelSpend, null);

  return (
    <form action={formAction} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Channel
        </span>
        <input
          name="channelLabel"
          list="channel-labels"
          required
          maxLength={80}
          placeholder="Auto Trader"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
        {/* A datalist, not a select: most dealers advertise somewhere we do
            not integrate with, and a closed list would leave that spend out of
            the P&L entirely — which makes the table flattering, not useful. */}
        <datalist id="channel-labels">
          {channels.map((c) => <option key={c} value={c} />)}
        </datalist>
      </label>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Month
        </span>
        <input
          type="date"
          name="month"
          defaultValue={defaultMonth}
          required
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Amount
        </span>
        <input
          name="amount"
          required
          inputMode="decimal"
          placeholder="1250.00"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      <div className="flex items-end">
        <Submit />
      </div>

      <label className="flex items-center gap-2 sm:col-span-4">
        <input type="checkbox" name="estimated" className="h-5 w-5" />
        <span className="text-ink-muted">
          This is my estimate — the invoice has not arrived yet
        </span>
      </label>

      <label className="grid gap-1 sm:col-span-4">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Note (optional)
        </span>
        <input
          name="note"
          maxLength={200}
          placeholder="Includes the homepage takeover"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      {state && (
        <div className="sm:col-span-4">
          {state.ok
            ? <p role="status" className="text-[13px] leading-[18px] text-good-ink">
                <span aria-hidden="true">✓</span> {state.message}
              </p>
            : <p role="alert" className="text-[13px] leading-[18px] text-critical">
                <span aria-hidden="true">✕</span> {state.error}
              </p>}
        </div>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Record'}
    </button>
  );
}
