/**
 * Money.
 *
 * Rule 2 of CLAUDE.md: money is integer minor units (pence) with an explicit
 * currency. Never a float. Never a `number` for arithmetic across values.
 * Never currency arithmetic in the browser.
 */

export type Currency = 'GBP' | 'EUR';

export interface Money {
  readonly amount: bigint; // minor units (pence)
  readonly currency: Currency;
}

export const money = (amount: bigint | number, currency: Currency = 'GBP'): Money => {
  if (typeof amount === 'number' && !Number.isInteger(amount)) {
    throw new TypeError(
      `Money must be constructed from integer minor units, got ${amount}. ` +
        `Use fromPounds() if you have a decimal amount.`,
    );
  }
  return { amount: BigInt(amount), currency };
};

export const zero = (currency: Currency = 'GBP'): Money => money(0n, currency);

/**
 * Parse a decimal pound amount. Accepts "12,499.99", "£12499.99", 12499.99.
 * Rounds half-up at the penny, because a float can never represent 0.1 exactly
 * and we would rather round deterministically than inherit IEEE-754 drift.
 */
export function fromPounds(value: string | number, currency: Currency = 'GBP'): Money {
  const s = typeof value === 'number' ? value.toFixed(4) : value.replace(/[£,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TypeError(`Not a valid amount: ${String(value)}`);

  const negative = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const pencePart = (frac + '00').slice(0, 2);
  const remainder = frac.slice(2, 3);

  let pence = BigInt(whole) * 100n + BigInt(pencePart);
  if (remainder && Number(remainder) >= 5) pence += 1n; // half-up

  return money(negative ? -pence : pence, currency);
}

const assertSame = (a: Money, b: Money): void => {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
};

export const add = (a: Money, b: Money): Money => (assertSame(a, b), money(a.amount + b.amount, a.currency));
export const subtract = (a: Money, b: Money): Money => (assertSame(a, b), money(a.amount - b.amount, a.currency));
export const negate = (a: Money): Money => money(-a.amount, a.currency);
export const isZero = (a: Money): boolean => a.amount === 0n;
export const isNegative = (a: Money): boolean => a.amount < 0n;
export const compare = (a: Money, b: Money): -1 | 0 | 1 =>
  (assertSame(a, b), a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0);
export const max = (a: Money, b: Money): Money => (compare(a, b) >= 0 ? a : b);
export const min = (a: Money, b: Money): Money => (compare(a, b) <= 0 ? a : b);
export const sum = (items: readonly Money[], currency: Currency = 'GBP'): Money =>
  items.reduce(add, zero(currency));

export type Rounding = 'half-up' | 'half-even' | 'down';

/**
 * Multiply by a rational factor without ever touching a float.
 * `multiply(m, 1n, 6n)` is the VAT margin fraction.
 */
export function multiply(
  m: Money,
  numerator: bigint,
  denominator: bigint,
  rounding: Rounding = 'half-up',
): Money {
  if (denominator === 0n) throw new RangeError('Division by zero');

  const negative = m.amount < 0n !== denominator < 0n;
  const absAmount = m.amount < 0n ? -m.amount : m.amount;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const scaled = absAmount * absNum;
  const quotient = scaled / absDen;
  const remainder = scaled % absDen;

  let result = quotient;
  if (rounding !== 'down' && remainder !== 0n) {
    const twice = remainder * 2n;
    if (twice > absDen) result += 1n;
    else if (twice === absDen) {
      // exact half
      if (rounding === 'half-up') result += 1n;
      else if (quotient % 2n !== 0n) result += 1n; // half-even
    }
  }

  return money(negative ? -result : result, m.currency);
}

/** Apply a rate expressed in basis points (1250 = 12.50%). */
export const applyBasisPoints = (m: Money, bps: number, rounding: Rounding = 'half-up'): Money =>
  multiply(m, BigInt(Math.round(bps)), 10_000n, rounding);

/**
 * Split an amount into n parts with no lost pennies. The remainder is
 * distributed one penny at a time from the first part onward.
 */
export function allocate(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts must be a positive integer');
  const n = BigInt(parts);
  const base = m.amount / n;
  let remainder = m.amount - base * n;
  const step = remainder < 0n ? -1n : 1n;
  if (remainder < 0n) remainder = -remainder;

  return Array.from({ length: parts }, (_, i) =>
    money(base + (BigInt(i) < remainder ? step : 0n), m.currency),
  );
}

const SYMBOL: Record<Currency, string> = { GBP: '£', EUR: '€' };

export function format(m: Money, opts: { pence?: boolean; compact?: boolean } = {}): string {
  const { pence = true, compact = false } = opts;
  const negative = m.amount < 0n;
  const abs = negative ? -m.amount : m.amount;
  const symbol = SYMBOL[m.currency];

  if (compact) {
    const whole = Number(abs / 100n);
    const [value, suffix] =
      whole >= 1_000_000 ? [whole / 1_000_000, 'M'] : whole >= 1_000 ? [whole / 1_000, 'K'] : [whole, ''];
    const text = suffix ? `${Number(value.toFixed(1))}${suffix}` : whole.toLocaleString('en-GB');
    return `${negative ? '−' : ''}${symbol}${text}`;
  }

  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '−' : ''}${symbol}${whole}${pence ? `.${frac}` : ''}`;
}

export const toPence = (m: Money): bigint => m.amount;
export const serialise = (m: Money): { amount: string; currency: Currency } => ({
  amount: m.amount.toString(),
  currency: m.currency,
});
export const deserialise = (v: { amount: string; currency: Currency }): Money =>
  money(BigInt(v.amount), v.currency);
