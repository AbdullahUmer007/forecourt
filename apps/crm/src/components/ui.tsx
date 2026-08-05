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
import Link from 'next/link';
import { format, formatRegistration, type Money } from '@forecourt/domain';

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-muted border-edge',
  good: 'bg-surface-1 text-good border-good/40',
  warning: 'bg-surface-1 text-warning-ink border-warning/50',
  serious: 'bg-surface-1 text-warning-ink border-serious/60',
  critical: 'bg-surface-1 text-critical border-critical/40',
  info: 'bg-brand-50 text-link border-brand-600/30',
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

/**
 * Money.
 *
 * `pence` defaults to true because a document — an invoice, a stock book entry,
 * a ledger line — has to reconcile to the penny. A LIST does not: fourteen
 * rows of `£45,999.00` are fourteen `.00`s a dealer's eye has to step over to
 * compare two prices, and the domain skill says whole pounds at a glance,
 * two decimals on a document. Pass `pence={false}` on anything being scanned.
 */
export const Amount = (
  { value, pence = true, className = '' }:
  { value: Money; pence?: boolean; className?: string },
) => (
  <span className={`tnum ${className}`}>{format(value, { pence })}</span>
);

/** A registration, in the plate typeface treatment the trade expects. */
export const Reg = ({ value }: { value: string }) => {
  // The domain's formatter, not a length check. The old rule — "7 characters,
  // split 4 and 3" — puts a space in the middle of a Northern Ireland plate
  // (ABC 1234 is 7 characters) and in the middle of some dateless ones.
  const spaced = formatRegistration(value);
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
    quiet: 'bg-transparent text-link hover:bg-brand-50 border-transparent',
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

/**
 * A row in one of the three big lists — stock, leads, deals.
 *
 * It exists because all three had the same layout written out three times, and
 * all three were broken in the same way on a phone: a flex row whose children
 * had no basis, so at 390px the badges and the price held their intrinsic
 * width, the description was squeezed to `N…`, and the page scrolled
 * sideways. The vehicle a dealer is looking for is the one thing that must
 * never be the field that gets cut.
 *
 * The trick is `sm:contents` on the mobile grouping wrapper: below `sm` it is
 * a real flex line holding the reg, the description and the money; at `sm` and
 * up it stops generating a box at all and its children become direct items of
 * the row, ordered back into the single dense line a desk user wants. One
 * markup, two layouts, no duplicated row component.
 *
 *   mobile   [reg]  description        £price
 *            [badge] [badge] [badge]
 *
 *   desktop  [reg]  description   [badges]   £price
 */
export function ListRow(
  { href, reg, title, meta, badges, money, tone = 'default' }: {
    href: string;
    reg?: ReactNode;
    title: ReactNode;
    meta?: ReactNode;
    badges?: ReactNode;
    money?: ReactNode;
    /** `alert` draws the border in the critical hue — used for a breached SLA. */
    tone?: 'default' | 'alert';
  },
) {
  return (
    // `min-w-0` on the grid item, and it is the fix for the whole class of bug.
    //
    // `truncate` sets `white-space: nowrap`, so the description's MIN-content
    // width is the entire string — clipping is a paint-time effect and the
    // sizing algorithm never hears about it. That propagated all the way up:
    // row → anchor → this item → the list's single auto track, which every
    // row shares, so one long description widened every row on the page and
    // the document scrolled sideways. Overriding the automatic minimum size
    // here lets the track be the width of the screen and the ellipsis do its
    // job.
    <li className="min-w-0">
      <Link
        href={href}
        className={`flex flex-col gap-2 rounded-md border bg-surface-1 p-3 hover:bg-surface-3 sm:min-h-11 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 ${
          tone === 'alert' ? 'border-critical' : 'border-edge hover:border-edge-strong'
        }`}
      >
        {/* `min-w-0` is load-bearing. This is a flex container that is itself
            a flex item, so its automatic minimum size is its min-content — and
            without the override the row refuses to shrink below that, pushes
            past the viewport and takes the whole page's horizontal scroll with
            it. It is exactly the bug that squeezed "Nissan Qashqai" down to
            "N…" on a phone. */}
        <div className="flex min-w-0 items-start gap-3 sm:contents">
          {reg && <div className="shrink-0 sm:order-1">{reg}</div>}

          <div className="min-w-0 flex-1 sm:order-2">
            <div className="font-medium">{title}</div>
            {meta}
          </div>

          {money && (
            <div className="w-24 shrink-0 text-right sm:order-4 sm:w-28">{money}</div>
          )}
        </div>

        {badges && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:order-3">
            {badges}
          </div>
        )}
      </Link>
    </li>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-edge py-2 last:border-0">
    <dt className="text-ink-muted">{label}</dt>
    <dd className="text-right font-medium">{children}</dd>
  </div>
);
