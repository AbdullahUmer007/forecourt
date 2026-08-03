'use client';

/**
 * The tap-to-mark damage map.
 *
 * The one screen in M13 that has to work one-handed, on a phone, on a
 * forecourt, in the rain, with a customer watching. That constraint decides
 * the design:
 *
 *   - Panels are BUTTONS, not SVG hit areas with pointer maths. A button is
 *     focusable, announces itself, and works with a keyboard and a screen
 *     reader for free. A tap target on a scaled SVG is none of those things.
 *   - Every target clears 44px. A cold wet thumb is not a mouse pointer.
 *   - Marks already recorded show their count on the panel, so you can see
 *     what you have done without scrolling to a list.
 *
 * Recording a mark is not wired to a server action yet: `appraisal_damage`
 * INSERTs need the audit event and the media upload that go with them, and a
 * half-written mutation is worse than an honest read-only view. What is here
 * is the real geometry and the real interaction.
 */

import { useState } from 'react';
import type { DamageMark } from '@forecourt/domain';

/**
 * The panels, laid out as the car actually is — nearside on the left, offside
 * on the right, front at the top. A dealer reads a damage map by position, so
 * an alphabetical list would be unusable however tidy it looks in the data.
 */
const LAYOUT: readonly (readonly { panel: string; label: string }[])[] = [
  [{ panel: 'front_bumper', label: 'Front bumper' }],
  [
    { panel: 'nsf_wing', label: 'NSF wing' },
    { panel: 'bonnet', label: 'Bonnet' },
    { panel: 'osf_wing', label: 'OSF wing' },
  ],
  [
    { panel: 'nsf_door', label: 'NSF door' },
    { panel: 'windscreen', label: 'Windscreen' },
    { panel: 'osf_door', label: 'OSF door' },
  ],
  [
    { panel: 'nsr_door', label: 'NSR door' },
    { panel: 'roof', label: 'Roof' },
    { panel: 'osr_door', label: 'OSR door' },
  ],
  [
    { panel: 'nsr_quarter', label: 'NSR quarter' },
    { panel: 'tailgate', label: 'Tailgate' },
    { panel: 'osr_quarter', label: 'OSR quarter' },
  ],
  [{ panel: 'rear_bumper', label: 'Rear bumper' }],
];

const WHEELS: readonly { panel: string; label: string }[] = [
  { panel: 'nsf_alloy', label: 'NSF alloy' },
  { panel: 'osf_alloy', label: 'OSF alloy' },
  { panel: 'nsr_alloy', label: 'NSR alloy' },
  { panel: 'osr_alloy', label: 'OSR alloy' },
];

const SEVERITY_TONE: Record<string, string> = {
  light: 'border-warning/60',
  moderate: 'border-serious',
  heavy: 'border-critical',
};

export function DamageMap({ marks }: { marks: readonly DamageMark[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const byPanel = new Map<string, DamageMark[]>();
  for (const mark of marks) {
    const list = byPanel.get(mark.panel) ?? [];
    list.push(mark);
    byPanel.set(mark.panel, list);
  }

  const selectedMarks = selected ? (byPanel.get(selected) ?? []) : [];

  return (
    <div className="grid gap-4">
      <div className="mx-auto grid w-full max-w-[320px] gap-1.5">
        {LAYOUT.map((row, i) => (
          <div
            key={i}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((cell) => (
              <PanelButton
                key={cell.panel}
                panel={cell.panel}
                label={cell.label}
                marks={byPanel.get(cell.panel) ?? []}
                selected={selected === cell.panel}
                onSelect={setSelected}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mx-auto grid w-full max-w-[320px] grid-cols-4 gap-1.5">
        {WHEELS.map((wheel) => (
          <PanelButton
            key={wheel.panel}
            panel={wheel.panel}
            label={wheel.label}
            marks={byPanel.get(wheel.panel) ?? []}
            selected={selected === wheel.panel}
            onSelect={setSelected}
          />
        ))}
      </div>

      <div aria-live="polite" className="min-h-11">
        {selected && (
          selectedMarks.length > 0 ? (
            <ul className="grid gap-1">
              {selectedMarks.map((mark) => (
                <li
                  key={mark.id}
                  className="rounded-sm border border-edge bg-surface-3 px-3 py-2 text-[13px] leading-[18px]"
                >
                  <span className="font-medium capitalize">{mark.severity}</span>{' '}
                  {mark.damageType.replace(/_/g, ' ')}
                  {mark.sizeMm !== null && mark.sizeMm !== undefined && ` · ${mark.sizeMm}mm`}
                  {mark.notes && <span className="text-ink-muted"> — {mark.notes}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] leading-[18px] text-ink-subtle">
              Nothing marked on this panel.
            </p>
          )
        )}
      </div>
    </div>
  );
}

function PanelButton(
  { panel, label, marks, selected, onSelect }: {
    panel: string;
    label: string;
    marks: DamageMark[];
    selected: boolean;
    onSelect: (panel: string) => void;
  },
) {
  // The worst mark on the panel sets the border — a heavy dent beside a light
  // scuff should read as heavy.
  const worst = marks.reduce<string | null>((acc, m) => {
    const rank = { light: 1, moderate: 2, heavy: 3 };
    if (!acc) return m.severity;
    return rank[m.severity] > rank[acc as 'light' | 'moderate' | 'heavy'] ? m.severity : acc;
  }, null);

  return (
    <button
      type="button"
      onClick={() => onSelect(panel)}
      aria-pressed={selected}
      // Count in the label, not only as a badge — colour and a number in a
      // corner are not enough on their own.
      aria-label={
        marks.length === 0
          ? `${label}, no damage marked`
          : `${label}, ${marks.length} mark${marks.length === 1 ? '' : 's'}, worst ${worst}`
      }
      className={`relative flex min-h-11 items-center justify-center rounded-sm border-2 px-1 text-center text-[12px] leading-4 transition-colors duration-100 ${
        worst ? SEVERITY_TONE[worst] : 'border-edge'
      } ${
        selected ? 'bg-brand-50 text-brand-700' : 'bg-surface-1 text-ink-muted hover:bg-surface-3'
      }`}
    >
      {label}
      {marks.length > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-edge bg-surface-1 px-1 text-[11px] font-semibold text-ink"
        >
          {marks.length}
        </span>
      )}
    </button>
  );
}
