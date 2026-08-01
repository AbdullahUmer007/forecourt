/**
 * Consumer rights clocks.
 *
 * Consumer Rights Act 2015:
 *   - 30-day short-term right to reject, from delivery (s.22(3))
 *   - the clock PAUSES during a repair attempt and, on resumption, at least
 *     7 days must remain (s.22(6)–(7))
 *   - 6-month reversed burden of proof, from delivery
 *
 * Consumer Contracts Regulations 2013:
 *   - 14-day cancellation right, DISTANCE and OFF-PREMISES sales only
 *   - clock starts the day AFTER delivery (or collection, where the buyer
 *     contracted remotely and collects)
 *   - it does NOT apply where the contract was concluded in person on the
 *     trader's premises, even after an online enquiry
 *
 * All windows come from `compliance_rules`, keyed on the delivery date.
 * All arithmetic is done at end-of-day boundaries in the tenant's timezone,
 * because a dealer counts days, not hours, and will not accept an off-by-one.
 */

export type ContractFormation = 'on_premises' | 'distance' | 'off_premises';

export interface ConsumerRightsRule {
  readonly rejectWindowDays: number; // 30
  readonly repairResumeMinimumDays: number; // 7
  readonly burdenOfProofMonths: number; // 6
  readonly cancellationWindowDays: number; // 14
  readonly sourceUrl: string;
}

export interface RepairAttempt {
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface ConsumerRightsClocks {
  readonly deliveredAt: Date;
  readonly contractFormation: ContractFormation;
  /** Null while a repair is open — the clock is paused. */
  readonly rejectWindowEndsAt: Date | null;
  readonly rejectWindowPaused: boolean;
  readonly burdenOfProofEndsAt: Date;
  /** Null for on-premises sales — no CCR cancellation right exists. */
  readonly cancellationDeadline: Date | null;
  readonly cancellationRightApplies: boolean;
}

const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + n);
  if (r.getUTCDate() < day) r.setUTCDate(0); // clamp 31 Jan + 1 month → 28/29 Feb
  return r;
};

/** End of the calendar day, in the tenant's timezone offset (minutes east of UTC). */
export const endOfDay = (d: Date, tzOffsetMinutes = 0): Date => {
  const local = new Date(d.getTime() + tzOffsetMinutes * 60_000);
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() - tzOffsetMinutes * 60_000);
};

export function calculateClocks(params: {
  deliveredAt: Date;
  contractFormation: ContractFormation;
  repairAttempts?: readonly RepairAttempt[];
  rule: ConsumerRightsRule;
  tzOffsetMinutes?: number;
}): ConsumerRightsClocks {
  const { deliveredAt, contractFormation, repairAttempts = [], rule, tzOffsetMinutes = 0 } = params;

  // --- 30-day right to reject, with repair pauses -------------------------
  let endsAt = endOfDay(addDays(deliveredAt, rule.rejectWindowDays), tzOffsetMinutes);
  let paused = false;

  for (const attempt of [...repairAttempts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    if (attempt.startedAt > endsAt) continue; // repair began after the window closed

    if (attempt.completedAt === null) {
      paused = true;
      break;
    }

    const pausedMs = attempt.completedAt.getTime() - attempt.startedAt.getTime();
    const shifted = new Date(endsAt.getTime() + pausedMs);
    // s.22(6)–(7): at least 7 days must remain when the clock resumes
    const minimum = endOfDay(addDays(attempt.completedAt, rule.repairResumeMinimumDays), tzOffsetMinutes);
    endsAt = shifted > minimum ? shifted : minimum;
  }

  // --- CCR 14-day cancellation -------------------------------------------
  const cancellationRightApplies = contractFormation !== 'on_premises';
  const cancellationDeadline = cancellationRightApplies
    ? endOfDay(addDays(deliveredAt, 1 + rule.cancellationWindowDays), tzOffsetMinutes)
    : null;

  return {
    deliveredAt,
    contractFormation,
    rejectWindowEndsAt: paused ? null : endsAt,
    rejectWindowPaused: paused,
    burdenOfProofEndsAt: endOfDay(addMonths(deliveredAt, rule.burdenOfProofMonths), tzOffsetMinutes),
    cancellationDeadline,
    cancellationRightApplies,
  };
}

export const daysRemaining = (deadline: Date | null, now: Date): number | null =>
  deadline === null ? null : Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS));

/** Days in stock, counted in the tenant's timezone. */
export const daysInStock = (bookedInAt: Date, soldAt: Date | null, now: Date): number =>
  Math.max(0, Math.floor(((soldAt ?? now).getTime() - bookedInAt.getTime()) / DAY_MS));
