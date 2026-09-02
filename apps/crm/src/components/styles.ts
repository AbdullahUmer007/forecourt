/**
 * The shared class strings, in a module with no imports at all.
 *
 * They would naturally live in `ui.tsx` beside the components that use them,
 * and they did — but `ui.tsx` imports `@forecourt/domain` for its money and
 * registration formatters, and the barrel drags `node:crypto` and the pricing
 * logic with it. Any client component reaching in for a label class would
 * have pulled all of that into the browser bundle, which is the exact thing
 * `forecourt/no-domain-barrel-in-client` exists to stop and the exact thing
 * the public site's 120KB budget cannot absorb.
 *
 * So: strings here, components there, `ui.tsx` re-exports these for the
 * server components that already import from it. One definition either way.
 */

export const LABEL_CLASS =
  'block text-[12px] leading-4 font-medium tracking-[0.02em] text-ink-muted';

/*
 * No focus styles: globals.css declares the ring once, for everything
 * interactive, rather than each control remembering to.
 */
export const INPUT_CLASS =
  'h-10 w-full rounded-md border border-edge-strong bg-surface-1 px-3 text-ink '
  + 'placeholder:text-ink-subtle hover:border-ink-subtle '
  + 'focus:border-brand-600 disabled:cursor-not-allowed disabled:bg-surface-3';

/**
 * 44px on a phone, 36px at a desk.
 *
 * Rule 7 sets a 44px minimum touch target on mobile and 24px everywhere else,
 * and a single 44px height honoured the first at the cost of the second: at a
 * desk with a mouse, every button in the product was the height of a phone
 * control, and a toolbar of them pushed the data down the page. The floor
 * lifts back to 44 below `sm`, where a thumb is doing the pressing.
 */
export const BUTTON_CLASS =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 '
  + 'text-[14px] font-medium transition-colors duration-100 '
  + 'disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:h-9';

export const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 border-brand-600 shadow-(--shadow-raised)',
  secondary: 'bg-surface-1 text-ink hover:bg-surface-3 border-edge-strong',
  quiet: 'bg-transparent text-link hover:bg-brand-50 border-transparent',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;
