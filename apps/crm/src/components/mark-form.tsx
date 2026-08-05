'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { recordDamageMark, type MarkResult } from '@/data/damage';

const TYPES = [
  ['scuff', 'Scuff'], ['scratch', 'Scratch'], ['dent', 'Dent'], ['chip', 'Chip'],
  ['kerbing', 'Kerbing'], ['crack', 'Crack'], ['corrosion', 'Corrosion'],
  ['paint_mismatch', 'Paint mismatch'], ['tear', 'Tear'], ['stain', 'Stain'],
  ['wear', 'Wear'], ['missing', 'Missing'], ['warning_light', 'Warning light'],
] as const;

const SEVERITIES = [
  ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy'],
] as const;

/**
 * Recording a mark, for someone holding a phone in one hand on a forecourt.
 *
 * Severity is three big buttons rather than a select: a dropdown on a phone is
 * a modal wheel, and this is the field that gets set on every single mark.
 * The photo input uses `capture="environment"` so it opens the camera rather
 * than a file browser.
 */
export function MarkForm(
  { appraisalId, panel, label, onDone }: {
    appraisalId: string;
    panel: string;
    label: string;
    onDone: () => void;
  },
) {
  // The server action is handed straight to the form, so it submits and works
  // with JavaScript disabled or still loading. On a forecourt with one bar of
  // signal that is not a nicety.
  const [state, formAction] = useActionState<MarkResult | null, FormData>(
    recordDamageMark, null,
  );
  const [severity, setSeverity] = useState<string>('moderate');

  const error = state && !state.ok ? state.error ?? 'That did not save. Try again.' : null;
  // A warning is not a failure: the mark IS recorded, it simply could not be
  // priced. Closing the form on it would hide the one thing to act on.
  const warning = state?.ok ? state.warning ?? null : null;

  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-edge bg-surface-1 p-3">
      <input type="hidden" name="appraisalId" value={appraisalId} />
      <input type="hidden" name="panel" value={panel} />
      <input type="hidden" name="severity" value={severity} />

      <h3 className="text-[16px] leading-6 font-semibold">Mark {label}</h3>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          What is wrong
        </span>
        <select
          name="damageType"
          defaultValue="scuff"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        >
          {TYPES.map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-1">
        <legend className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          How bad
        </legend>
        <div className="grid grid-cols-3 gap-1.5">
          {SEVERITIES.map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={severity === value}
              onClick={() => setSeverity(value)}
              className={`min-h-11 rounded-md border font-medium ${
                severity === value
                  ? 'border-brand-600 bg-brand-50 text-link'
                  : 'border-edge-strong bg-surface-1 text-ink-muted hover:bg-surface-3'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Size (mm)
          </span>
          <input
            name="sizeMm"
            type="number"
            min="0"
            max="5000"
            inputMode="numeric"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Photo
          </span>
          <input
            name="photo"
            type="file"
            accept="image/*"
            capture="environment"
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3 py-2 text-[13px]"
          />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
          Note
        </span>
        <input
          name="notes"
          type="text"
          maxLength={200}
          placeholder="Refurbishable, through lacquer only…"
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
        />
      </label>

      {error && (
        <p role="alert" className="text-critical">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}
      {warning && (
        <div role="status" className="rounded-md border border-warning/50 p-2 text-warning-ink">
          <span aria-hidden="true">!</span> {warning}
        </div>
      )}

      <div className="flex gap-2">
        <SaveButton label={warning ? 'Save another' : 'Save mark'} />
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3"
        >
          {warning ? 'Done' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

/**
 * Its own component because `useFormStatus` reads the status of the form it is
 * rendered INSIDE — called in the parent it would always report idle, which is
 * a spinner that never spins.
 */
function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 flex-1 rounded-md border border-brand-600 bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
