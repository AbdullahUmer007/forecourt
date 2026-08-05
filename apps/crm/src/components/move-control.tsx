'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { moveCard } from '@/data/prep-move';
import type { MoveOutcome } from '@/data/prep-apply';

/**
 * Moving a card between stages.
 *
 * A select and a button rather than drag-and-drop. Dragging a card across a
 * horizontally-scrolling board is a two-handed gesture on a desk; AC1 asks for
 * one-handed in a workshop, and a select is operable by thumb, by keyboard and
 * by screen reader without any of the three being an afterthought. Drag can be
 * added on top later as an enhancement for the desk — it cannot be retrofitted
 * underneath as an accessibility fix.
 *
 * The action is handed straight to the form, so it works without JavaScript.
 */
export function MoveControl(
  { cardId, currentStageId, stages }: {
    cardId: string;
    currentStageId: string;
    stages: readonly { id: string; name: string }[];
  },
) {
  const [state, formAction] = useActionState<MoveOutcome | null, FormData>(moveCard, null);
  const [target, setTarget] = useState<string>('');

  const needsReason = state?.needsReason ?? null;

  return (
    // Collapsed until asked for.
    //
    // Expanded, this control is a label, a select and a button — about 130px
    // on every card on the board. A prep board is read far more often than it
    // is acted on: the question is which car is blocked and why, and the
    // answer was being pushed below the fold by a form nobody had asked for
    // yet. `<details>` keeps it one tap away and keeps working with no
    // JavaScript, which is the same reason the form posts to a server action.
    //
    // Forced open once the server has said something — an overridable blocker
    // needing a reason, or an error — because a message inside a closed
    // disclosure is a message nobody reads.
    <details
      open={Boolean(state)}
      className="mt-3 border-t border-edge pt-3 [&[open]>summary]:mb-2"
    >
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md px-2 font-medium text-link hover:bg-surface-3">
        <span aria-hidden="true">→</span> Move this car
      </summary>

      <form action={formAction} className="grid gap-2">
        <input type="hidden" name="cardId" value={cardId} />

        <label className="grid gap-1">
          <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
            Move to
          </span>
          <select
            name="toStageId"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
          >
            <option value="">Choose a stage…</option>
            {stages
              .filter((s) => s.id !== currentStageId)
              .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        {/* Overridable blockers: the move is allowed, but somebody has to say
            why. A card that slides past an open block with nobody accountable
            is how the days metric quietly stops meaning anything. */}
        {needsReason && (
          <div className="grid gap-2 rounded-md border border-warning/50 p-2">
            <ul className="list-disc pl-4 text-[13px] leading-[18px] text-warning-ink">
              {needsReason.map((b) => <li key={b.code}>{b.message}</li>)}
            </ul>
            <label className="grid gap-1">
              <span className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
                Reason for moving anyway
              </span>
              <input
                name="override"
                required
                maxLength={200}
                placeholder="Part fitted, block not closed yet…"
                className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-3"
              />
            </label>
          </div>
        )}

        {state && !state.ok && !needsReason && state.error && (
          <p role="alert" className="text-[13px] leading-[18px] text-critical">
            <span aria-hidden="true">✕</span> {state.error}
          </p>
        )}

        <MoveButton disabled={target === ''} needsReason={Boolean(needsReason)} />
      </form>
    </details>
  );
}

/**
 * Separate because `useFormStatus` reports the status of the form it is
 * rendered inside — called in the parent it always reads idle.
 */
function MoveButton({ disabled, needsReason }: { disabled: boolean; needsReason: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="min-h-11 rounded-md border border-edge-strong bg-surface-1 px-4 font-medium hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Moving…' : needsReason ? 'Move anyway' : 'Move'}
    </button>
  );
}
