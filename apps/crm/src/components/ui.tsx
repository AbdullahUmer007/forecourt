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
import { BUTTON_CLASS, BUTTON_VARIANTS, type ButtonVariant } from './styles';

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info';

/*
 * A tinted ground rather than a white one.
 *
 * Every tone used to sit on `surface-1` and be told apart by a 1px border in
 * the status hue, which at 12px is a few dozen coloured pixels — on the stock
 * list, eight badges in a row read as one grey texture and the eye had to stop
 * and decode each. A 10% wash of the tone's own hue is legible at a glance and
 * still light enough that the AA-rated ink on top keeps its ratio, in both
 * modes.
 */
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-muted border-edge',
  good: 'bg-good/10 text-good border-good/25',
  warning: 'bg-warning/15 text-warning-ink border-warning/35',
  serious: 'bg-serious/15 text-warning-ink border-serious/35',
  critical: 'bg-critical/10 text-critical border-critical/25',
  info: 'bg-brand-50 text-link border-brand-600/20',
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
    <section className={`rounded-lg border border-edge bg-surface-1 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <h2 className="text-[15px] leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * The top of a screen: what it is, what it is showing, and the one thing you
 * are most likely to do next.
 *
 * Every page hand-rolled this, so the gap under the title, whether the meta
 * line existed and where the action sat all drifted apart — the kind of
 * inconsistency nobody can name but everybody reads as "unfinished" when they
 * move between two screens. One primary action per view is rule 4, which is
 * why `action` is singular.
 */
export function PageHeader(
  { title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode },
) {
  return (
    // `edge-strong`, not `edge`.
    //
    // The hairline sits on surface-2 rather than inside a card, and `edge` is
    // 1.06:1 against that plane — it rendered, at two-thirds of a pixel, and
    // could not be seen at any zoom. A divider nobody can see is not a subtle
    // divider, it is markup.
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-edge-strong pb-4">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-8 font-semibold">{title}</h1>
        {meta && <p className="mt-1 text-ink-muted">{meta}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The measured query time — on our build, not on theirs.
 *
 * CLAUDE.md budgets the stock list at 1,000 rows filtering in under 400ms and
 * the heavier screens at 500ms, and a budget nobody can see is a budget nobody
 * keeps, so the measurement stays exactly where it was. What changed is the
 * audience. A dealer reading "1142ms" beside their stock count learns nothing
 * they can act on, and when it goes over budget they are told in warning
 * orange that something is wrong with software they cannot fix — so the
 * number that exists to hold US to a promise was quietly making THEM anxious.
 *
 * It carries its own separator so that removing it in production does not
 * leave a dangling "· " at the end of every page's meta line.
 */
export function QueryTime({ ms, budget }: { ms: number; budget: number }) {
  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <>
      {' · '}
      <span className={ms > budget ? 'text-warning-ink' : 'text-ink-subtle'}>{ms}ms</span>
    </>
  );
}

/**
 * The shared field styling, re-exported.
 *
 * It is defined in `./styles` — a module with no imports — so that a client
 * component can reach for a label class without this file's `@forecourt/domain`
 * import following it into the browser bundle. Server components already
 * importing from here get it without needing to know that.
 *
 * Constants rather than an `<Input>` component because the forms in this
 * product need the raw element: a server action reads `formData` by `name`,
 * several inputs carry `defaultValue` that React must apply on mount, and
 * wrapping all that adds a layer without removing one.
 */
export { LABEL_CLASS, INPUT_CLASS, BUTTON_CLASS } from './styles';

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

export function Button(
  { children, variant = 'secondary', ...rest }:
  { children: ReactNode; variant?: ButtonVariant } &
    React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button {...rest} className={`${BUTTON_CLASS} ${BUTTON_VARIANTS[variant]}`}>
      {children}
    </button>
  );
}

/** The same control, when the thing it does is go somewhere. */
export function ButtonLink(
  { href, children, variant = 'secondary' }:
  { href: string; children: ReactNode; variant?: ButtonVariant },
) {
  return (
    <Link href={href} className={`${BUTTON_CLASS} ${BUTTON_VARIANTS[variant]}`}>
      {children}
    </Link>
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
        // Hover lifts rather than fills. A grey wash over the row also washes
        // over the reg plate and the badges sitting on it, which are the two
        // things being scanned; a border and a 1px shadow say "this one"
        // without touching anything's contrast.
        className={`flex flex-col gap-2 rounded-lg border bg-surface-1 p-3 transition-shadow duration-100 hover:shadow-(--shadow-raised) sm:min-h-11 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 ${
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
