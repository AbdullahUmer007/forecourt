/**
 * M20 — platform administration and billing.
 *
 * Our side, never mixed into tenant UI. Most of it is ordinary — a directory,
 * subscriptions, flags, quotas. One part is not, and it is why this file has
 * the longest comment in the package:
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SUPPORT IMPERSONATION IS THE MOST DANGEROUS FEATURE IN THE PRODUCT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It is a deliberate, documented way for somebody at Forecourt to read a
 * dealer's customer data — their contacts, their deals, their commissions.
 * Rule 1 of CLAUDE.md, four layers of tenant isolation, the whole leak suite:
 * all of it is downstream of this feature not being casual.
 *
 * So every safeguard is a REFUSAL rather than a warning. `canImpersonate`
 * returns a decision that names what is missing, and there is no path that
 * produces a session token without one — the same structural argument as M8's
 * `ApprovedPromotion` and M19's `ComplianceStatement`.
 */

import { type Money, money, isNegative, format } from './money.js';

// ------------------------------------------------------------ the plans

export type PlatformPlan = 'starter' | 'pro' | 'group' | 'reseller';

export type SubscriptionStatus =
  | 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled';

export interface PlanBand {
  plan: PlatformPlan;
  label: string;
  /** Stock ceiling this band covers. Null on reseller, which is negotiated. */
  stockLimit: number | null;
  monthlyPrice: Money;
}

/**
 * The stock-banded pricing from the strategy documents.
 *
 * Priced ABOVE the direct competitor deliberately — DECISIONS.md, 1 August:
 * undercutting a one-person operation in a commoditised tier signals a worse
 * product and starts a race we cannot win. We sell the gap, not the price.
 */
export const PLAN_BANDS: readonly PlanBand[] = [
  { plan: 'starter', label: 'Starter', stockLimit: 25, monthlyPrice: money(18_900n) },
  { plan: 'pro', label: 'Pro', stockLimit: 60, monthlyPrice: money(24_900n) },
  { plan: 'group', label: 'Group', stockLimit: 150, monthlyPrice: money(31_900n) },
  { plan: 'reseller', label: 'Reseller', stockLimit: null, monthlyPrice: money(0n) },
];

export interface BandRecommendation {
  current: PlanBand | null;
  recommended: PlanBand;
  changed: boolean;
  message: string;
}

/**
 * The band a tenant's stock actually puts them in.
 *
 * Recommends rather than applies. A dealer who buys ten cars for a bank
 * holiday weekend should not find their direct debit has silently gone up —
 * a price rise is a conversation, and one that happens automatically is the
 * kind of thing that ends up on a forum.
 */
export function recommendBand(
  stockCount: number,
  currentPlan: PlatformPlan | null,
): BandRecommendation {
  const current = PLAN_BANDS.find((b) => b.plan === currentPlan) ?? null;
  const recommended = PLAN_BANDS.find(
    (b) => b.stockLimit !== null && stockCount <= b.stockLimit,
  ) ?? PLAN_BANDS[2]!;

  const changed = current !== null && current.plan !== recommended.plan;

  return {
    current,
    recommended,
    changed,
    message: !changed
      ? `${stockCount} cars — within the ${recommended.label} band.`
      : `${stockCount} cars puts this dealer in ${recommended.label} ` +
        `(${format(recommended.monthlyPrice)}), not ${current!.label}. Worth a conversation ` +
        'before anything changes on their bill.',
  };
}

// --------------------------------------------------------------- dunning

/** How long a failed payment is chased before access is affected. */
export const DUNNING_GRACE_DAYS = 14;

export interface DunningState {
  status: SubscriptionStatus;
  daysPastDue: number;
  daysOfGraceLeft: number;
  /** Access is restricted. Deliberately late, and never silent. */
  restricted: boolean;
  message: string;
}

const DAY_MS = 86_400_000;

/**
 * Where a past-due account stands.
 *
 * The grace period is generous on purpose. A dealer whose card expired should
 * not lose access to their own stock book on the morning it happens — their
 * VAT records are in here, and locking somebody out of their statutory records
 * over a failed direct debit is not a position we want to defend.
 */
export function dunningState(input: {
  status: SubscriptionStatus;
  pastDueSince: Date | null;
  asAt: Date;
  graceDays?: number;
}): DunningState {
  const grace = input.graceDays ?? DUNNING_GRACE_DAYS;

  if (input.status !== 'past_due' || input.pastDueSince === null) {
    return {
      status: input.status, daysPastDue: 0, daysOfGraceLeft: grace,
      restricted: false, message: 'Up to date.',
    };
  }

  const daysPastDue = Math.floor(
    (input.asAt.getTime() - input.pastDueSince.getTime()) / DAY_MS,
  );
  const left = grace - daysPastDue;

  return {
    status: input.status,
    daysPastDue,
    daysOfGraceLeft: Math.max(0, left),
    restricted: left <= 0,
    message: left > 0
      ? `Payment failed ${daysPastDue} day${daysPastDue === 1 ? '' : 's'} ago. ` +
        `${left} day${left === 1 ? '' : 's'} before access is limited.`
      : 'Payment has been outstanding beyond the grace period. Access is limited — but the ' +
        'stock book and VAT records stay readable and exportable, because they are the ' +
        'dealer’s statutory records and not ours to withhold.',
  };
}

// ----------------------------------------------------------- usage quota

export type UsageMetric =
  | 'vehicle_lookup' | 'provenance_check' | 'sms' | 'e_signature' | 'valuation';

export interface UsageState {
  metric: UsageMetric;
  used: number;
  quota: number | null;
  remaining: number | null;
  /** Past the point where somebody should look. */
  overQuota: boolean;
  approaching: boolean;
  cost: Money;
  message: string;
}

/** Warn at this fraction of the quota. */
export const QUOTA_WARNING_FRACTION = 0.8;

/**
 * Where a tenant is against a metered quota.
 *
 * Vehicle lookups cost real money per call, so this is both a billing input
 * and the thing that catches a runaway job before it produces a five-figure
 * invoice — which is a failure mode with our name on it, not the dealer's.
 */
export function usageState(input: {
  metric: UsageMetric;
  used: number;
  quota: number | null;
  cost: Money;
}): UsageState {
  if (input.quota === null) {
    return {
      ...input, remaining: null, overQuota: false, approaching: false,
      message: `${input.used} this month, no cap set. ${format(input.cost)} of provider cost.`,
    };
  }

  const remaining = input.quota - input.used;
  const overQuota = remaining < 0;
  const approaching = !overQuota && input.used >= input.quota * QUOTA_WARNING_FRACTION;

  return {
    ...input,
    remaining,
    overQuota,
    approaching,
    message: overQuota
      ? `${input.used} against a cap of ${input.quota} — ${-remaining} over, ` +
        `${format(input.cost)} of provider cost. Check nothing is looping.`
      : approaching
        ? `${input.used} of ${input.quota} used.`
        : `${input.used} of ${input.quota} used, ${format(input.cost)} of provider cost.`,
  };
}

// ----------------------------------------------------- IMPERSONATION

export type ImpersonationBlockerCode =
  | 'no_grant' | 'grant_expired' | 'grant_revoked' | 'no_reason' | 'reason_too_short'
  | 'no_expiry' | 'window_too_long' | 'self_approval';

export interface ImpersonationBlocker {
  code: ImpersonationBlockerCode;
  message: string;
}

/** The longest a support visit may be authorised for in one go. */
export const MAX_IMPERSONATION_HOURS = 4;
/** A reason shorter than this is not a reason. */
export const MIN_REASON_LENGTH = 10;

export interface ImpersonationGrant {
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface ImpersonationRequest {
  operatorId: string;
  tenantId: string;
  reason: string;
  requestedHours: number;
  asAt: Date;
}

export interface ImpersonationDecision {
  allowed: boolean;
  blockers: readonly ImpersonationBlocker[];
  expiresAt: Date | null;
  /** What the tenant's own UI must display for the whole session. */
  banner: string | null;
}

/**
 * Whether somebody at Forecourt may enter a dealer's account.
 *
 * Every one of the spec's conditions is a REFUSAL, not a warning, and the
 * blockers are returned together so an operator fixes them in one go rather
 * than discovering them one denial at a time.
 *
 * There is no override. If a dealer has not granted access, we do not have
 * access — including when they are on the phone asking for help, because the
 * grant takes them ten seconds and the alternative is a habit.
 */
export function canImpersonate(
  request: ImpersonationRequest,
  grant: ImpersonationGrant | null,
): ImpersonationDecision {
  const blockers: ImpersonationBlocker[] = [];

  if (!grant) {
    blockers.push({
      code: 'no_grant',
      message:
        'This dealership has not granted support access. Ask them to turn it on — it takes ' +
        'them ten seconds, and there is no way round it from our side.',
    });
  } else if (grant.revokedAt !== null) {
    blockers.push({
      code: 'grant_revoked',
      message: 'This dealership withdrew support access. Ask them to grant it again.',
    });
  } else if (grant.expiresAt.getTime() <= request.asAt.getTime()) {
    blockers.push({
      code: 'grant_expired',
      message:
        `Support access lapsed on ${grant.expiresAt.toISOString().slice(0, 10)}. ` +
        'Ask them to grant it again.',
    });
  }

  const reason = request.reason.trim();
  if (reason.length === 0) {
    blockers.push({ code: 'no_reason', message: 'A reason is required.' });
  } else if (reason.length < MIN_REASON_LENGTH) {
    blockers.push({
      code: 'reason_too_short',
      message:
        'Write what you are actually going to look at. "Support" is not a reason, and this ' +
        'ends up in the dealership’s own audit trail where they will read it.',
    });
  }

  if (request.requestedHours <= 0) {
    blockers.push({
      code: 'no_expiry',
      message: 'A support session has to end. Set how long you need.',
    });
  } else if (request.requestedHours > MAX_IMPERSONATION_HOURS) {
    blockers.push({
      code: 'window_too_long',
      message:
        `${MAX_IMPERSONATION_HOURS} hours is the maximum. Start another session if you need ` +
        'longer — a session that runs all day is an account, not a support visit.',
    });
  }

  const allowed = blockers.length === 0;

  return {
    allowed,
    blockers,
    expiresAt: allowed
      ? new Date(request.asAt.getTime() + request.requestedHours * 3_600_000)
      : null,
    // §28: visibly banner-flagged in the tenant's own UI. Names the person,
    // because "Forecourt support" is not who is reading their customer list.
    banner: allowed
      ? `Forecourt support is signed in to your account. Reason: “${reason}”. ` +
        'This ends automatically, and everything done is recorded in your audit trail.'
      : null,
  };
}

/**
 * The extra approval for finance commission and full payment details.
 *
 * A DIFFERENT person, always. One member of staff can never reach the most
 * sensitive data in the product alone — the same four-eyes principle the
 * database enforces with a CHECK constraint, expressed here so the refusal
 * has a sentence attached to it.
 */
export function canElevate(input: {
  operatorId: string;
  approverId: string | null;
  reason: string;
}): { allowed: boolean; blockers: readonly ImpersonationBlocker[] } {
  const blockers: ImpersonationBlocker[] = [];

  if (!input.approverId) {
    blockers.push({
      code: 'self_approval',
      message:
        'Commission and full payment details need a second person to approve. Ask a colleague ' +
        '— this is the most sensitive data in the product.',
    });
  } else if (input.approverId === input.operatorId) {
    blockers.push({
      code: 'self_approval',
      message:
        'You cannot approve your own access to commission data. That is the entire point of ' +
        'the second approval.',
    });
  }

  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    blockers.push({
      code: 'reason_too_short',
      message: 'Say what you need the commission data for.',
    });
  }

  return { allowed: blockers.length === 0, blockers };
}

export interface ImpersonationSessionState {
  expiresAt: Date;
  endedAt: Date | null;
  revoked: boolean;
}

/** Whether a running session may still be used. */
export function sessionStillValid(
  session: ImpersonationSessionState,
  asAt: Date,
): { valid: boolean; reason: string | null } {
  if (session.revoked) {
    return { valid: false, reason: 'The dealership revoked this session.' };
  }
  if (session.endedAt !== null) {
    return { valid: false, reason: 'This session has ended.' };
  }
  if (session.expiresAt.getTime() <= asAt.getTime()) {
    return { valid: false, reason: 'This session expired. Start a new one if you still need it.' };
  }
  return { valid: true, reason: null };
}

// ------------------------------------------------------- tenant health

export interface TenantHealth {
  score: number;
  band: 'healthy' | 'watch' | 'at_risk';
  signals: readonly string[];
}

/**
 * A rough health score for the tenant directory.
 *
 * Deliberately crude and deliberately labelled as such: it is a prompt to look
 * at an account, not a judgement about one. The signals are listed so whoever
 * looks can see what drove it rather than trusting a number we invented.
 */
export function tenantHealth(input: {
  activeUsersLast30Days: number;
  vehiclesLive: number;
  dealsLast30Days: number;
  pastDue: boolean;
  openErrorCount: number;
}): TenantHealth {
  const signals: string[] = [];
  let score = 100;

  if (input.activeUsersLast30Days === 0) {
    score -= 40;
    signals.push('Nobody has signed in for 30 days.');
  } else if (input.activeUsersLast30Days === 1) {
    score -= 10;
    signals.push('Only one person is using it.');
  }

  if (input.vehiclesLive === 0) {
    score -= 25;
    signals.push('No live stock.');
  }

  if (input.dealsLast30Days === 0) {
    score -= 20;
    signals.push('No deals in 30 days.');
  }

  if (input.pastDue) {
    score -= 15;
    signals.push('Payment past due.');
  }

  if (input.openErrorCount > 10) {
    score -= 10;
    signals.push(`${input.openErrorCount} unresolved integration errors.`);
  }

  const bounded = Math.max(0, Math.min(100, score));

  return {
    score: bounded,
    band: bounded >= 70 ? 'healthy' : bounded >= 40 ? 'watch' : 'at_risk',
    signals,
  };
}

/** Monthly recurring revenue across the directory. */
export const totalMrr = (
  subscriptions: readonly { status: SubscriptionStatus; monthlyPrice: Money | null }[],
  currency: 'GBP' | 'EUR' = 'GBP',
): Money =>
  subscriptions
    .filter((s) => s.status === 'active' || s.status === 'past_due')
    .reduce(
      (total, s) => (s.monthlyPrice && !isNegative(s.monthlyPrice)
        ? money(total.amount + s.monthlyPrice.amount, currency)
        : total),
      money(0n, currency),
    );
