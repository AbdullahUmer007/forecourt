/**
 * The CRM's primitives.
 *
 * Small on purpose. The design system's rules are enforced by the component
 * signatures rather than by review — most importantly `StatusBadge`, which
 * cannot be constructed without both an icon and a label, because rule 2 says
 * colour never carries meaning alone and a rule that lives in a document gets
 * broken by the third person to add a status.
 */

import type { ReactNode } from 'react';
import { format, type Money } from '@forecourt/domain';

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-muted border-edge',
  good: 'bg-surface-1 text-good border-good/40',
  warning: 'bg-surface-1 text-warning-ink border-warning/50',
  serious: 'bg-surface-1 text-warning-ink border-serious/60',
  critical: 'bg-surface-1 text-critical border-critical/40',
  info: 'bg-brand-50 text-brand-700 border-brand-600/30',
};

/**
 * A status, never a bare colour.
 *
 * `icon` and `label` are both required and neither is optional — that is the
 * whole point of the component existing rather than a span with a class.
 * A colour-blind user, a greyscale print and a dealer glancing at a phone in
 * sunlight all get the same information.
 */
export function StatusBadge(
  { tone, icon, label }: { tone: Tone; icon: string; label: string },
) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[12px] leading-4 font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

export function Card(
  { title, action, children, className = '' }:
  { title?: string; action?: ReactNode; children: ReactNode; className?: string },
) {
  return (
    // Borders before shadows — rule 3. There are four elevation levels and a
    // card is not one of the raised ones.
    <section className={`rounded-md border border-edge bg-surface-1 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <h2 className="text-[16px] leading-6 font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A labelled figure. `mono` for anything that must align in a column. */
export function Figure(
  { label, value, hint, size = 'md' }:
  { label: string; value: string; hint?: string; size?: 'md' | 'lg' | 'xl' },
) {
  // Large standalone figures use PROPORTIONAL figures deliberately: tabular
  // makes `121` look loose at display size. Only columns get .tnum.
  const sizes = {
    md: 'text-[20px] leading-7',
    lg: 'text-[28px] leading-[34px]',
    xl: 'text-[40px] leading-[44px]',
  };
  return (
    <div>
      <div className="text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-subtle">
        {label}
      </div>
      <div className={`${sizes[size]} font-semibold text-ink`}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] leading-4 text-ink-subtle">{hint}</div>}
    </div>
  );
}

export const Amount = ({ value, className = '' }: { value: Money; className?: string }) => (
  <span className={`tnum ${className}`}>{format(value)}</span>
);

/** A registration, in the plate typeface treatment the trade expects. */
export const Reg = ({ value }: { value: string }) => {
  const spaced = value.length === 7 ? `${value.slice(0, 4)} ${value.slice(4)}` : value;
  return (
    <span className="mono inline-block rounded-sm border border-edge-strong bg-surface-3 px-1.5 py-0.5 text-[13px] leading-[18px] font-medium tracking-wide">
      {spaced}
    </span>
  );
};

/**
 * An empty state that teaches the next action — rule 6. A list that renders
 * nothing and says nothing is how a dealer concludes the software is broken.
 */
export function Empty(
  { title, children, action }: { title: string; children: ReactNode; action?: ReactNode },
) {
  return (
    <div className="rounded-md border border-dashed border-edge-strong bg-surface-1 px-6 py-10 text-center">
      <h3 className="text-[16px] leading-6 font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-[52ch] text-ink-muted">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * An error state that says what to do, not just what failed. "An error
 * occurred" is banned by CLAUDE.md and by every reviewer.
 */
export function Problem(
  { title, children }: { title: string; children: ReactNode },
) {
  return (
    <div className="rounded-md border border-critical/40 bg-surface-1 p-4">
      <h3 className="flex items-center gap-2 text-[16px] leading-6 font-semibold text-critical">
        <span aria-hidden="true">✕</span> {title}
      </h3>
      <div className="mt-1 text-ink-muted">{children}</div>
    </div>
  );
}

/**
 * 44px minimum touch target on mobile — rule 7. Enforced by the component
 * rather than left to whoever writes the next button.
 */
export function Button(
  { children, variant = 'secondary', ...rest }:
  { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' } &
    React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 border-brand-600',
    secondary: 'bg-surface-1 text-ink hover:bg-surface-3 border-edge-strong',
    quiet: 'bg-transparent text-brand-700 hover:bg-brand-50 border-transparent',
  };
  return (
    <button
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-[14px] font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-edge py-2 last:border-0">
    <dt className="text-ink-muted">{label}</dt>
    <dd className="text-right font-medium">{children}</dd>
  </div>
);
