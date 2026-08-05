'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { moveDeal, decideAddon, recordRepair } from '@/data/deal-actions';
import type { DealOutcome } from '@/data/deal-apply';
// The MODULE, not the barrel — `forecourt/no-domain-barrel-in-client`.
import { allowedDealTransitions, type DealState } from '@forecourt/domain/deals';

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const FORMATIONS: { value: string; label: string; consequence: string }[] = [
  {
    value: 'on_premises',
    label: 'On the forecourt',
    consequence: 'No cancellation right. This includes a customer who enquired online and then '
      + 'signed here.',
  },
  {
    value: 'distance',
    label: 'At a distance — phone, email or online',
    consequence: '14-day cancellation right, starting the day after delivery.',
  },
  {
    value: 'off_premises',
    label: 'Away from the forecourt — at their home or work',
    consequence: '14-day cancellation right, starting the day after delivery.',
  },
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

function Result({ state }: { state: DealOutcome | null }) {
  if (!state) return null;
  return state.ok
    ? <p role="status" className="text-[13px] leading-[18px] text-good-ink">
        <span aria-hidden="true">✓</span> {state.message}
      </p>
    : <p role="alert" className="text-[13px] leading-[18px] text-critical">
        <span aria-hidden="true">✕</span> {state.error}
      </p>;
}

/**
 * Moving a deal through its states.
 *
 * The contract-formation picker appears when moving to `contracted` and the
 * deal has not already recorded it. Each option states its CONSEQUENCE beside
 * it, because the field is meaningless to a salesperson otherwise and the
 * consequence — whether the customer gets 14 days to change their mind — is
 * the only thing that makes the choice answerable. "Enquired online, signed in
 * the showroom" is the case everybody gets wrong, so it is named on the option
 * rather than left to be inferred.
 */
export function DealStateControl(
  { dealId, state, contractFormation }: {
    dealId: string;
    state: DealState;
    contractFormation: string | null;
  },
) {
  const [result, formAction] = useActionState<DealOutcome | null, FormData>(moveDeal, null);
  const [target, setTarget] = useState<string>('');

  const options = allowedDealTransitions(state);
  const needsFormation = target === 'contracted' && contractFormation === null;
  const needsReason = target === 'cancelled';

  if (options.length === 0) {
    return (
      <p className="text-[13px] leading-[18px] text-ink-muted">
        This deal is {label(state).toLowerCase()} and cannot move again.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="dealId" value={dealId} />

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Move to
        </span>
        <select
          name="to"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        >
          <option value="">Choose…</option>
          {options.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </label>

      {needsFormation && (
        <fieldset className="grid gap-2 rounded-md border border-edge-strong p-3">
          <legend className="px-1 text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Where was this contract formed?
          </legend>
          {FORMATIONS.map((f) => (
            <label key={f.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="contractFormation"
                value={f.value}
                required
                className="mt-1 h-5 w-5"
              />
              <span>
                <span className="font-medium">{f.label}</span>
                <span className="block text-[13px] leading-[18px] text-ink-muted">
                  {f.consequence}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {needsReason && (
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Why is it being cancelled?
          </span>
          <input
            name="cancellationReason"
            required
            maxLength={300}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
      )}

      <Result state={result} />
      <Submit idle="Move" busy="Moving…" disabled={target === ''} />
    </form>
  );
}

/**
 * Accepting or declining one add-on.
 *
 * PRIN 2A wants a demands-and-needs statement PER PRODUCT, recorded at the
 * moment of acceptance — so the field is on the accept path, required, and
 * empty by default. A statement pre-filled from the product setup would be the
 * same product-level boilerplate the rule exists to stop.
 */
export function AddonControl(
  { dealId, addonId, productName, accepted, declined }: {
    dealId: string;
    addonId: string;
    productName: string;
    accepted: boolean;
    declined: boolean;
  },
) {
  const [result, formAction] = useActionState<DealOutcome | null, FormData>(decideAddon, null);
  const [decision, setDecision] = useState<string>('');

  return (
    <form action={formAction} className="mt-2 grid gap-2 border-t border-edge pt-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="addonId" value={addonId} />

      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2">
          <input
            type="radio" name="decision" value="accept"
            checked={decision === 'accept'}
            onChange={() => setDecision('accept')}
            className="h-5 w-5"
          />
          <span>{accepted ? 'Accepted' : 'Customer accepted'}</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio" name="decision" value="decline"
            checked={decision === 'decline'}
            onChange={() => setDecision('decline')}
            className="h-5 w-5"
          />
          <span>{declined ? 'Declined' : 'Customer declined'}</span>
        </label>
      </div>

      {decision === 'accept' && (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Why does {productName} meet what this customer said they needed?
            </span>
            <textarea
              name="demandsAndNeeds"
              rows={2}
              required
              maxLength={1000}
              placeholder="They drive 20,000 miles a year and wanted cover beyond the balance of the manufacturer warranty."
              className="rounded-md border border-edge-strong bg-surface-1 p-3"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Fair-value reference (optional)
            </span>
            <input
              name="fairValueReference"
              maxLength={200}
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            />
          </label>
        </div>
      )}

      <Result state={result} />
      <Submit idle="Record" busy="Recording…" disabled={decision === ''} />
    </form>
  );
}

/**
 * Opening or closing a repair attempt.
 *
 * Each one pauses the 30-day right to reject, and on resumption at least seven
 * days must remain. Nothing about the deadline is stored — it is recomputed
 * from the attempts every time the deal is read.
 */
export function RepairControl(
  { dealId, openRepairId }: { dealId: string; openRepairId: string | null },
) {
  const [result, formAction] = useActionState<DealOutcome | null, FormData>(recordRepair, null);

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="repairId" value={openRepairId ?? ''} />

      {openRepairId ? (
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            What was the outcome?
          </span>
          <input
            name="outcome"
            required
            maxLength={300}
            placeholder="Turbo replaced under warranty, road tested."
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
      ) : (
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            What fault did the customer report?
          </span>
          <input
            name="faultReported"
            required
            maxLength={300}
            placeholder="Engine management light, loss of power above 3,000rpm."
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>
      )}

      <Result state={result} />
      <Submit
        idle={openRepairId ? 'Close the repair' : 'Open a repair'}
        busy="Saving…"
      />
    </form>
  );
}
