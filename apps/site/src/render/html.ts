/**
 * M6b — the render layer.
 *
 * ARCHITECTURAL NOTE: why these are template functions and not React components.
 *
 * The public vehicle detail page has a hard budget of < 120KB JavaScript and
 * must render completely without JavaScript at all (`04-design-system.md`
 * §6.4, and audit check `structured-data` depends on server-rendered markup).
 * React server components would satisfy that too, but template functions make
 * it *impossible* to regress: there is no client bundle to accidentally grow,
 * no `use client` to slip in during a refactor, and no hydration cost.
 *
 * The Next.js App Router pages in `app/` are thin wrappers that call these and
 * return the string. We get Next's routing, caching and revalidation without
 * putting a framework between a buyer and a photograph of a car.
 *
 * Interactivity that genuinely needs JavaScript (gallery swipe, filter panel)
 * is added as small, separately-budgeted progressive enhancements — never as a
 * prerequisite for seeing the car or finding the phone number.
 */

/** HTML-escape. Everything interpolated into markup goes through this. */
export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escape for an unquoted attribute context. */
export const escAttr = (value: unknown): string => esc(value).replace(/`/g, '&#96;');

/**
 * Tagged template that escapes every interpolation by default.
 *
 * Use `raw()` to opt a value out — which makes every unescaped value grep-able,
 * rather than the reverse.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    const rendered =
      v === null || v === undefined || v === false ? ''
      : Array.isArray(v) ? v.map((x) => (isRaw(x) ? x.value : esc(x))).join('')
      : isRaw(v) ? v.value
      : esc(v);
    return out + rendered + str;
  }, '');
}

interface Raw { readonly __raw: true; readonly value: string }
const isRaw = (v: unknown): v is Raw =>
  typeof v === 'object' && v !== null && (v as Raw).__raw === true;

/** Mark a string as pre-escaped. Every call site is a deliberate decision. */
export const raw = (value: string): Raw => ({ __raw: true, value });

export const when = (condition: unknown, value: string): Raw => raw(condition ? value : '');

export const classes = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');
