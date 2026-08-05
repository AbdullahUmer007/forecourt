import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PLAN_BANDS, recommendBand, dunningState, DUNNING_GRACE_DAYS,
  usageState, QUOTA_WARNING_FRACTION,
  canImpersonate, canElevate, sessionStillValid,
  MAX_IMPERSONATION_HOURS,
  tenantHealth, totalMrr,
  type ImpersonationGrant, type ImpersonationRequest,
} from './platform.js';
import { money, zero } from './money.js';

const DAY = 86_400_000;
const AT = (offsetDays: number, hours = 0): Date =>
  new Date(Date.UTC(2026, 7, 5) + offsetDays * DAY + hours * 3_600_000);

// ================================================ IMPERSONATION

describe('support impersonation — the most dangerous feature in the product', () => {
  const grant = (over: Partial<ImpersonationGrant> = {}): ImpersonationGrant => ({
    grantedBy: 'dealer-owner', grantedAt: AT(-1), expiresAt: AT(7), revokedAt: null, ...over,
  });

  const request = (over: Partial<ImpersonationRequest> = {}): ImpersonationRequest => ({
    operatorId: 'staff-1', tenantId: 't1',
    reason: 'Checking why their Auto Trader feed is rejecting three cars.',
    requestedHours: 2, asAt: AT(0), ...over,
  });

  it('a complete, consented, time-limited request is allowed', () => {
    const decision = canImpersonate(request(), grant());
    expect(decision.allowed).toBe(true);
    expect(decision.expiresAt).toEqual(AT(0, 2));
  });

  it('REFUSES without a grant, and there is no override', () => {
    // If a dealer has not granted access, we do not have access — including
    // when they are on the phone asking for help.
    const decision = canImpersonate(request(), null);
    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0]!.code).toBe('no_grant');
    expect(decision.blockers[0]!.message).toMatch(/no way round it from our side/);
  });

  it('refuses a revoked grant', () => {
    expect(canImpersonate(request(), grant({ revokedAt: AT(-1) })).blockers[0]!.code)
      .toBe('grant_revoked');
  });

  it('refuses an expired grant', () => {
    expect(canImpersonate(request(), grant({ expiresAt: AT(-1) })).blockers[0]!.code)
      .toBe('grant_expired');
  });

  it('refuses "support" as a reason', () => {
    // A dropdown becomes one click. This has to be a sentence somebody wrote.
    const decision = canImpersonate(request({ reason: 'support' }), grant());
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.some((b) => b.code === 'reason_too_short')).toBe(true);
  });

  it('tells the operator their reason is read by the dealership', () => {
    const decision = canImpersonate(request({ reason: 'fix' }), grant());
    expect(decision.blockers.find((b) => b.code === 'reason_too_short')!.message)
      .toMatch(/own audit trail where they will read it/);
  });

  it('refuses a session with no end', () => {
    expect(canImpersonate(request({ requestedHours: 0 }), grant()).blockers[0]!.code)
      .toBe('no_expiry');
  });

  it('refuses a window longer than the maximum', () => {
    // A session that runs all day is an account, not a support visit.
    const decision = canImpersonate(
      request({ requestedHours: MAX_IMPERSONATION_HOURS + 1 }), grant());
    expect(decision.blockers[0]!.code).toBe('window_too_long');
    expect(decision.blockers[0]!.message).toMatch(/is an account, not a support visit/);
  });

  it('reports EVERY blocker at once, not the first', () => {
    const decision = canImpersonate(
      request({ reason: '', requestedHours: 99 }), null);
    expect(decision.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(['no_grant', 'no_reason', 'window_too_long']));
  });

  it('produces a banner naming the reason for the tenant’s own UI', () => {
    const decision = canImpersonate(request(), grant());
    expect(decision.banner).toMatch(/Forecourt support is signed in to your account/);
    expect(decision.banner).toMatch(/Auto Trader feed/);
    expect(decision.banner).toMatch(/recorded in your audit trail/);
  });

  it('produces NO banner and NO expiry when refused', () => {
    const decision = canImpersonate(request(), null);
    expect(decision.banner).toBeNull();
    expect(decision.expiresAt).toBeNull();
  });

  it('property: a decision is allowed only when there are no blockers', () => {
    fc.assert(fc.property(
      fc.boolean(), fc.string({ maxLength: 40 }), fc.integer({ min: -2, max: 12 }),
      (hasGrant, reason, hours) => {
        const decision = canImpersonate(
          request({ reason, requestedHours: hours }),
          hasGrant ? grant() : null,
        );
        expect(decision.allowed).toBe(decision.blockers.length === 0);
        if (!decision.allowed) {
          expect(decision.banner).toBeNull();
          expect(decision.expiresAt).toBeNull();
        }
      },
    ));
  });
});

describe('the second approval for commission data', () => {
  it('allows a genuine four-eyes approval', () => {
    expect(canElevate({
      operatorId: 'staff-1', approverId: 'staff-2',
      reason: 'Investigating a commission disclosure complaint.',
    }).allowed).toBe(true);
  });

  it('REFUSES self-approval — that is the entire point', () => {
    const decision = canElevate({
      operatorId: 'staff-1', approverId: 'staff-1',
      reason: 'Investigating a commission disclosure complaint.',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0]!.message).toMatch(/entire point of the second approval/);
  });

  it('refuses with no approver at all', () => {
    expect(canElevate({
      operatorId: 'staff-1', approverId: null,
      reason: 'Investigating a commission disclosure complaint.',
    }).allowed).toBe(false);
  });

  it('still requires a reason', () => {
    expect(canElevate({
      operatorId: 'staff-1', approverId: 'staff-2', reason: 'x',
    }).allowed).toBe(false);
  });
});

describe('a running session', () => {
  it('is valid inside its window', () => {
    expect(sessionStillValid({ expiresAt: AT(0, 3), endedAt: null, revoked: false }, AT(0, 1))
      .valid).toBe(true);
  });

  it('stops at its expiry', () => {
    const check = sessionStillValid(
      { expiresAt: AT(0, 1), endedAt: null, revoked: false }, AT(0, 2));
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/expired/);
  });

  it('stops when the dealership revokes it mid-session', () => {
    const check = sessionStillValid(
      { expiresAt: AT(0, 3), endedAt: null, revoked: true }, AT(0, 1));
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/revoked/);
  });

  it('stops once ended', () => {
    expect(sessionStillValid(
      { expiresAt: AT(0, 3), endedAt: AT(0, 1), revoked: false }, AT(0, 2)).valid).toBe(false);
  });
});

// ================================================ plans and dunning

describe('plan bands', () => {
  it('recommends by stock count', () => {
    expect(recommendBand(18, 'starter').recommended.plan).toBe('starter');
    expect(recommendBand(40, 'starter').recommended.plan).toBe('pro');
    expect(recommendBand(120, 'pro').recommended.plan).toBe('group');
  });

  it('RECOMMENDS rather than applies', () => {
    // A dealer who buys ten cars for a bank holiday weekend should not find
    // their direct debit has silently gone up.
    const recommendation = recommendBand(40, 'starter');
    expect(recommendation.changed).toBe(true);
    expect(recommendation.message).toMatch(/Worth a conversation before anything changes/);
  });

  it('says nothing when the band is right', () => {
    expect(recommendBand(18, 'starter').changed).toBe(false);
  });

  it('prices above the competitor, deliberately', () => {
    // DECISIONS.md, 1 August: undercutting a one-person operation in a
    // commoditised tier signals a worse product.
    const starter = PLAN_BANDS.find((b) => b.plan === 'starter')!;
    expect(starter.monthlyPrice.amount).toBeGreaterThan(12_000n);
  });
});

describe('dunning', () => {
  it('says nothing while payments are fine', () => {
    expect(dunningState({ status: 'active', pastDueSince: null, asAt: AT(0) }).restricted)
      .toBe(false);
  });

  it('gives a generous grace period before restricting anything', () => {
    const state = dunningState({
      status: 'past_due', pastDueSince: AT(-3), asAt: AT(0),
    });
    expect(state.restricted).toBe(false);
    expect(state.daysOfGraceLeft).toBe(DUNNING_GRACE_DAYS - 3);
  });

  it('restricts only after the grace period', () => {
    expect(dunningState({
      status: 'past_due', pastDueSince: AT(-DUNNING_GRACE_DAYS - 1), asAt: AT(0),
    }).restricted).toBe(true);
  });

  it('NEVER withholds the stock book or VAT records', () => {
    // They are the dealer's statutory records. Locking somebody out of them
    // over a failed direct debit is not a position worth defending.
    const state = dunningState({
      status: 'past_due', pastDueSince: AT(-30), asAt: AT(0),
    });
    expect(state.message).toMatch(/stock book and VAT records stay readable and exportable/);
  });
});

// ================================================ usage

describe('metered usage', () => {
  it('reports against a quota', () => {
    const state = usageState({
      metric: 'vehicle_lookup', used: 40, quota: 100, cost: money(4_000n),
    });
    expect(state.remaining).toBe(60);
    expect(state.overQuota).toBe(false);
    expect(state.approaching).toBe(false);
  });

  it('warns before the cap', () => {
    const state = usageState({
      metric: 'vehicle_lookup', used: Math.ceil(100 * QUOTA_WARNING_FRACTION),
      quota: 100, cost: money(8_000n),
    });
    expect(state.approaching).toBe(true);
  });

  it('flags a runaway before it becomes a five-figure invoice', () => {
    // Which is a failure mode with our name on it, not the dealer's.
    const state = usageState({
      metric: 'vehicle_lookup', used: 5_000, quota: 100, cost: money(500_000n),
    });
    expect(state.overQuota).toBe(true);
    expect(state.message).toMatch(/Check nothing is looping/);
  });

  it('handles no cap without pretending there is one', () => {
    const state = usageState({
      metric: 'sms', used: 300, quota: null, cost: money(1_200n),
    });
    expect(state.remaining).toBeNull();
    expect(state.overQuota).toBe(false);
    expect(state.message).toMatch(/no cap set/);
  });
});

// ================================================ directory

describe('tenant health', () => {
  const healthy = {
    activeUsersLast30Days: 4, vehiclesLive: 30, dealsLast30Days: 12,
    pastDue: false, openErrorCount: 0,
  };

  it('a busy dealership scores well', () => {
    const health = tenantHealth(healthy);
    expect(health.band).toBe('healthy');
    expect(health.signals).toEqual([]);
  });

  it('nobody signing in is the strongest signal', () => {
    const health = tenantHealth({ ...healthy, activeUsersLast30Days: 0 });
    expect(health.band).not.toBe('healthy');
    expect(health.signals).toContain('Nobody has signed in for 30 days.');
  });

  it('names every signal, so the number can be checked', () => {
    // A prompt to look at an account, not a judgement about one.
    const health = tenantHealth({
      activeUsersLast30Days: 0, vehiclesLive: 0, dealsLast30Days: 0,
      pastDue: true, openErrorCount: 20,
    });
    expect(health.band).toBe('at_risk');
    expect(health.signals.length).toBe(5);
  });

  it('property: the score never leaves 0–100', () => {
    fc.assert(fc.property(
      fc.record({
        activeUsersLast30Days: fc.integer({ min: 0, max: 50 }),
        vehiclesLive: fc.integer({ min: 0, max: 300 }),
        dealsLast30Days: fc.integer({ min: 0, max: 100 }),
        pastDue: fc.boolean(),
        openErrorCount: fc.integer({ min: 0, max: 500 }),
      }),
      (input) => {
        const health = tenantHealth(input);
        expect(health.score).toBeGreaterThanOrEqual(0);
        expect(health.score).toBeLessThanOrEqual(100);
      },
    ));
  });
});

describe('MRR', () => {
  it('counts active and past-due, not cancelled or trialing', () => {
    // A trial is not revenue, and a cancelled account is not either. Past-due
    // still is — the money is owed.
    expect(totalMrr([
      { status: 'active', monthlyPrice: money(24_900n) },
      { status: 'past_due', monthlyPrice: money(18_900n) },
      { status: 'trialing', monthlyPrice: money(18_900n) },
      { status: 'cancelled', monthlyPrice: money(31_900n) },
    ])).toEqual(money(43_800n));
  });

  it('is zero with nothing on the books', () => {
    expect(totalMrr([])).toEqual(zero());
  });

  it('ignores a subscription with no price set', () => {
    expect(totalMrr([{ status: 'active', monthlyPrice: null }])).toEqual(zero());
  });
});
