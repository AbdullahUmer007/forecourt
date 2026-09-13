'use client';

import { useActionState, useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { createLead, saveFollowUp, changeLeadStage, reopenLead, assignLead, addLeadNote } from '@/data/lead-actions';
import type { LeadOutcome } from '@/data/lead-apply';
// The MODULE, not the barrel. A client component importing `@forecourt/domain`
// pulls the whole domain into the browser bundle — including `evidence.ts`,
// which imports `node:crypto` and cannot be bundled for a browser at all. The
// build fails outright, which is the good outcome; the bad one is the version
// of this mistake that merely ships eighty kilobytes of server-side pricing
// logic to a phone. Client components import the one module they need.
import { LOSS_REASON_LABELS, allowedLeadTransitions, type LeadStage } from '@forecourt/domain/leads';

const label = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Submit({ idle, busy, disabled = false }:
  { idle: string; busy: string; disabled?: boolean }) {
  // Separate component because `useFormStatus` reports the status of the form
  // it is rendered INSIDE — called in the parent it always reads idle.
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

function Result({ state }: { state: LeadOutcome | null }) {
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
 * Moving a lead through the pipeline.
 *
 * The loss-reason picker appears the moment `lost` is selected and the field
 * is `required`, so the browser refuses the submit before the server does.
 * That is the point: the reason is never filled in later, and this is the only
 * moment anybody knows the answer. The server refuses it too, and so does a
 * CHECK constraint — three times over, because a rule enforced only in the
 * browser is a rule enforced nowhere.
 */
export function StageControl(
  { leadId, stage }: { leadId: string; stage: LeadStage },
) {
  const [state, formAction] = useActionState<LeadOutcome | null, FormData>(changeLeadStage, null);
  const [target, setTarget] = useState<string>('');

  const options = allowedLeadTransitions(stage);

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="leadId" value={leadId} />

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Move to
        </span>
        <select
          name="stage"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        >
          <option value="">Choose a stage…</option>
          {options.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </label>

      {target === 'lost' && (
        <div className="grid gap-2 rounded-md border border-edge-strong p-2">
          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Why was it lost?
            </span>
            <select
              name="lossReason"
              required
              defaultValue=""
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            >
              <option value="" disabled>Choose a reason…</option>
              {(Object.keys(LOSS_REASON_LABELS) as (keyof typeof LOSS_REASON_LABELS)[])
                .map((r) => <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>)}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Who did they buy from? (optional)
            </span>
            {/* Free text because it is a competitor's name, and it is the most
                valuable field on a lost lead. */}
            <input
              name="lostTo"
              maxLength={120}
              placeholder="Another dealer, a private seller…"
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
              Anything else worth recording? (optional)
            </span>
            <input
              name="lossDetail"
              maxLength={300}
              className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
            />
          </label>
        </div>
      )}

      <Result state={state} />
      <Submit idle="Move" busy="Moving…" disabled={target === ''} />
    </form>
  );
}

/** Reopening is explicit and is its own event — a "won" cannot quietly become
 *  "negotiating" and corrupt the conversion figures. */
export function ReopenControl({ leadId }: { leadId: string }) {
  const [state, formAction] = useActionState<LeadOutcome | null, FormData>(reopenLead, null);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Result state={state} />
      <Submit idle="Reopen this lead" busy="Reopening…" />
    </form>
  );
}

export function AssignControl(
  { leadId, assignedTo, people }: {
    leadId: string;
    assignedTo: string | null;
    people: readonly { id: string; name: string }[];
  },
) {
  const [state, formAction] = useActionState<LeadOutcome | null, FormData>(assignLead, null);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Assigned to
        </span>
        <select
          name="assignTo"
          defaultValue={assignedTo ?? ''}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        >
          <option value="">Nobody</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <Result state={state} />
      <Submit idle="Save" busy="Saving…" />
    </form>
  );
}

export function NoteControl({ leadId }: { leadId: string }) {
  const [state, formAction] = useActionState<LeadOutcome | null, FormData>(addLeadNote, null);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Add a note
        </span>
        <textarea
          name="note"
          rows={3}
          required
          maxLength={2000}
          placeholder="Rang, no answer. Left a voicemail."
          className="rounded-md border border-edge-strong bg-surface-1 p-3"
        />
      </label>
      <Result state={state} />
      <Submit idle="Save note" busy="Saving…" />
    </form>
  );
}

export function FollowUpControl({ leadId, version, scheduled }: { leadId: string; version: number; scheduled: boolean }) {
  const [localAt, setLocalAt] = useState('');
  const [note, setNote] = useState('');
  const [state, action, pending] = useActionState<LeadOutcome | null, FormData>(async (previous, data) => {
    const enteredAt = String(data.get('localAt') ?? '');
    setLocalAt(enteredAt);
    const date = new Date(enteredAt);
    data.set('at', Number.isFinite(date.getTime()) ? date.toISOString() : '');
    const result = await saveFollowUp(previous, data);
    if (result.ok) { setLocalAt(''); setNote(''); setOperation('schedule'); }
    return result;
  }, null);
  const [zone, setZone] = useState('your device time zone');
  const [operation, setOperation] = useState('schedule');
  useEffect(() => { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  return <form action={action} className="grid gap-3">
    <input type="hidden" name="leadId" value={leadId} />
    <input type="hidden" name="version" value={version} />
    <fieldset disabled={pending} className="grid min-w-0 gap-3">
      <label className="grid gap-1 text-sm font-medium">Action
        <select name="operation" value={operation} onChange={e => setOperation(e.target.value)} className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3">
          <option value="schedule">{scheduled ? 'Reschedule follow-up' : 'Schedule follow-up'}</option>
          {scheduled && <><option value="complete">Complete follow-up</option><option value="cancel">Cancel follow-up</option></>}
        </select>
      </label>
      {operation === 'schedule' && <label className="grid gap-1 text-sm font-medium">Date and time
        <input type="datetime-local" name="localAt" required defaultValue={localAt} className="min-h-11 min-w-0 rounded-md border border-edge-strong bg-surface-1 px-3" />
        <span className="text-xs font-normal text-ink-subtle">Enter time in {zone}. Saved times are displayed in UK time.</span>
      </label>}
      <label className="grid gap-1 text-sm font-medium">{operation === 'schedule' ? 'What needs to happen?' : operation === 'complete' ? 'What was the outcome?' : 'Reason for cancelling'}
        <textarea name="note" required value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} placeholder={operation === 'schedule' ? 'Call to arrange a viewing…' : 'Record what happened…'} className="rounded-md border border-edge-strong bg-surface-1 p-3" />
      </label>
      <Result state={state} />
      <Submit idle={operation === 'schedule' ? 'Save follow-up' : operation === 'complete' ? 'Complete follow-up' : 'Cancel follow-up'} busy="Saving…" />
    </fieldset>
  </form>;
}

export function NewLeadControl({ sites, customers }: { sites: { id: string; name: string }[]; customers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<LeadOutcome | null, FormData>(createLead, null);
  const [contact, setContact] = useState('');
  const inputClass = 'min-h-11 w-full rounded-md border border-edge-strong bg-surface-1 px-3';
  return <form action={action} className="grid gap-4">
    <fieldset disabled={pending} className="grid min-w-0 gap-4">
      <label className="grid gap-1 font-medium">Customer<select name="contactId" value={contact} onChange={e => setContact(e.target.value)} className={inputClass}>
        <option value="">Create a new customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {!contact && <div className="grid gap-4 sm:grid-cols-2">
        {[['firstName', 'First name', 'text', 100], ['lastName', 'Last name', 'text', 100], ['email', 'Email', 'email', 254], ['phone', 'Phone', 'tel', 40]].map(([name, label, type, max]) => <label key={name} className="grid gap-1 font-medium">{label}<input name={String(name)} type={String(type)} maxLength={Number(max)} className={inputClass} /></label>)}
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 font-medium">Dealership site<select name="siteId" required className={inputClass}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Enquiry source<select name="source" required className={inputClass}>{[['phone', 'Phone call'], ['walk_in', 'Walk-in'], ['autotrader', 'Auto Trader'], ['ebay', 'eBay'], ['cargurus', 'CarGurus'], ['facebook', 'Facebook'], ['other_marketplace', 'Other marketplace']].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      </div>
      <label className="grid gap-1 font-medium">What are they looking for?<textarea name="message" rows={4} maxLength={4000} className="rounded-md border border-edge-strong bg-surface-1 p-3" placeholder="Car, budget, questions and preferred time to call…" /></label>
      <p className="text-sm text-ink-subtle">The enquiry will be assigned to you. Customer marketing permissions are managed separately.</p>
      {sites.length === 0 && <p role="alert" className="text-critical">No dealership site is assigned to you. Ask your manager to update your site access.</p>}
      <Result state={state} /><Submit idle="Create enquiry" busy="Creating…" disabled={sites.length === 0} />
    </fieldset>
  </form>;
}
