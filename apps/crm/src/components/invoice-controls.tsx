'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { issueInvoiceAction, creditInvoiceAction, recordPaymentAction } from '@/data/invoice-actions';
import type { InvoiceOutcome } from '@/data/invoice-apply';

const METHODS: { value: string; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'finance', label: 'Finance' },
  { value: 'part_exchange', label: 'Part-exchange' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

function Submit({ idle, busy, disabled = false }:
  { idle: string; busy: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? busy : idle}
    </button>
  );
}

function Result({ state }: { state: InvoiceOutcome | null }) {
  if (!state) return null;
  return (
    <div>
      {state.ok
        ? <p role="status" className="text-[13px] leading-[18px] text-good-ink">
            <span aria-hidden="true">✓</span> {state.message}
          </p>
        : <p role="alert" className="text-[13px] leading-[18px] text-critical">
            <span aria-hidden="true">✕</span> {state.error}
          </p>}
    </div>
  );
}

/**
 * Issuing a draft.
 *
 * Deliberately a confirm step rather than a one-click button: issuing
 * allocates a gapless VAT invoice number that can never be released, freezes
 * the document, and writes the sale side of the stock book. None of that can
 * be undone — it can only be credited, which produces a second document.
 */
export function IssueControl({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState<InvoiceOutcome | null, FormData>(
    issueInvoiceAction, null);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p className="text-[13px] leading-[18px] text-ink-muted">
        Issuing takes the next number in the series, freezes the document and records the sale in
        the VAT stock book. None of that can be undone — an issued invoice is cancelled by
        crediting it, which raises a second document.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 h-5 w-5"
        />
        <span className="text-ink-muted">The figures and the buyer’s details are correct.</span>
      </label>
      <Result state={state} />
      <Submit idle="Issue this invoice" busy="Issuing…" disabled={!confirmed} />
    </form>
  );
}

export function CreditControl({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState<InvoiceOutcome | null, FormData>(
    creditInvoiceAction, null);

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Why is this invoice being cancelled?
        </span>
        <input
          name="reason"
          required
          maxLength={300}
          placeholder="Customer rejected the car under CRA s.22"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>
      <p className="text-[12px] leading-4 text-ink-subtle">
        The number is never released. A credit note is raised with its own number carrying the
        reversed amounts, so the series stays gapless.
      </p>
      <Result state={state} />
      <Submit idle="Raise a credit note" busy="Crediting…" />
    </form>
  );
}

/**
 * Recording a payment or a refund.
 *
 * Cash gets the AML treatment: the server assesses it against the High Value
 * Dealer threshold in force on the day, counting linked payments together. If
 * it is refused, the refusal comes back with the reason in full and — only
 * where an override is lawful — the fields to authorise one. Those fields are
 * NOT shown up front: an override offered before the block appears is an
 * invitation.
 */
export function PaymentControl(
  { invoiceId, outstandingLabel, staff }: {
    invoiceId: string;
    outstandingLabel: string;
    staff: readonly { id: string; name: string }[];
  },
) {
  const [state, formAction] = useActionState<InvoiceOutcome | null, FormData>(
    recordPaymentAction, null);
  const [method, setMethod] = useState('card');
  const [direction, setDirection] = useState('in');

  const blocked = state?.ok === false && state.aml?.overridable === true;

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input
            type="radio" name="direction" value="in"
            checked={direction === 'in'} onChange={() => setDirection('in')}
            className="h-5 w-5"
          />
          <span>Money in</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio" name="direction" value="out"
            checked={direction === 'out'} onChange={() => setDirection('out')}
            className="h-5 w-5"
          />
          <span>Refund</span>
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Amount — {outstandingLabel} outstanding
        </span>
        <input
          name="amount"
          required
          inputMode="decimal"
          placeholder="250.00"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          How
        </span>
        <select
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        >
          {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>

      {method === 'cash' && direction === 'in' && (
        <p className="text-[12px] leading-4 text-ink-muted">
          Cash is checked against the High Value Dealer threshold, counting everything already
          taken from this customer — two payments that add up are one transaction.
        </p>
      )}

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          {direction === 'out' ? 'Why is it being refunded?' : 'Reference (optional)'}
        </span>
        <input
          name={direction === 'out' ? 'reason' : 'reference'}
          required={direction === 'out'}
          maxLength={200}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      {/* Shown only once the server has actually refused, and only when an
          override would be lawful. A registered dealer never sees this,
          because for them the payment is not blocked at all. */}
      {blocked && (
        <div className="grid gap-2 rounded-md border border-critical/40 p-3">
          <p className="text-[13px] leading-[18px] text-critical">{state?.aml?.reason}</p>
          <p className="text-[12px] leading-4 text-ink-muted">
            Overriding this is a documented decision. It is written to the compliance record with
            the name of the person authorising it.
          </p>
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Authorised by
            </span>
            <select
              name="overrideAuthorisedBy"
              defaultValue=""
              required
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            >
              <option value="" disabled>Choose…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Reason for overriding
            </span>
            <textarea
              name="overrideReason"
              rows={2}
              required
              minLength={10}
              maxLength={500}
              className="rounded-md border border-edge-strong bg-surface-1 p-3"
            />
          </label>
        </div>
      )}

      {/* A refusal that is NOT overridable still explains itself in full. */}
      {state?.ok === false && state.aml && !state.aml.overridable && (
        <p role="alert" className="text-[13px] leading-[18px] text-critical">
          {state.aml.reason}
        </p>
      )}

      {/* And an accepted payment that is close to the threshold says so, so
          the conversation happens before the next one rather than after. */}
      {state?.ok === true && state.aml?.outcome === 'approaching' && (
        <p role="status" className="text-[13px] leading-[18px] text-warning-ink">
          {state.aml.reason}
        </p>
      )}

      <Result state={state} />
      <Submit idle={direction === 'out' ? 'Record refund' : 'Record payment'} busy="Saving…" />
    </form>
  );
}
