/**
 * What the platform admin application can see.
 *
 * Every read here is a count or a platform-level record. There is no query in
 * this file that returns a dealer's customer, a lead's message, a deal, an
 * invoice or a piece of evidence — and that is not a convention: `app_platform`
 * has no grant on those tables, so the database refuses them.
 *
 * Support that genuinely needs a dealer's records goes through impersonation,
 * which the dealer has to grant, which expires, and which is logged in a table
 * we cannot edit.
 */

import { acrossTenants, toDate, toPence } from './db';
import {
  recommendBand, dunningState, usageState, canImpersonate,
  DUNNING_GRACE_DAYS, MAX_IMPERSONATION_HOURS, PLAN_BANDS,
  money,
  type BandRecommendation, type DunningState, type UsageState,
  type ImpersonationDecision, type Money, type PlatformPlan,
} from '@forecourt/domain';

export interface TenantRow {
  id: string;
  name: string;
  status: string;
  plan: PlatformPlan | null;
  subscriptionStatus: string | null;
  monthlyPrice: Money | null;
  stockBandLimit: number | null;
  /** Counts only. The admin app cannot read a car, only how many there are. */
  liveStock: number;
  totalStock: number;
  staff: number;
  unitsThisMonth: number;
  leadsAwaiting: number;
  /** Recomputed, never stored. */
  band: BandRecommendation | null;
  dunning: DunningState | null;
  /** Whether the dealership has granted support access right now. */
  supportGranted: boolean;
  supportGrantExpiresAt: Date | null;
}

export interface PlatformView {
  tenants: TenantRow[];
  summary: {
    tenants: number;
    live: number;
    pastDue: number;
    trialing: number;
    monthlyRecurring: Money;
  };
  queryMs: number;
}

export async function loadPlatform(): Promise<PlatformView> {
  const started = Date.now();
  const now = new Date();

  const data = await acrossTenants(async (tx) => {
    // One aggregate query rather than a query per tenant: a directory that
    // makes N round trips is a directory that gets slow at exactly the point
    // the business is going well.
    const rows = await tx`
      SELECT t.id, t.name, t.status::text AS status,
             s.plan::text AS plan, s.status::text AS subscription_status,
             s.monthly_price_pence, s.stock_band_limit, s.past_due_since,
             s.current_period_end,
             (SELECT count(*) FROM vehicles v
               WHERE v.tenant_id = t.id AND v.state IN ('live','reserved'))::int AS live_stock,
             (SELECT count(*) FROM vehicles v
               WHERE v.tenant_id = t.id
                 AND v.state NOT IN ('sold','delivered','archived'))::int AS total_stock,
             (SELECT count(*) FROM tenant_memberships m
               WHERE m.tenant_id = t.id AND m.status = 'active')::int AS staff,
             (SELECT count(*) FROM deals d
               WHERE d.tenant_id = t.id AND d.state IN ('delivered','completed')
                 AND d.delivered_at >= date_trunc('month', now()))::int AS units_month,
             (SELECT count(*) FROM leads l
               WHERE l.tenant_id = t.id
                 AND l.first_response_at IS NULL AND l.closed_at IS NULL)::int AS leads_awaiting,
             g.expires_at AS grant_expires_at,
             g.revoked_at AS grant_revoked_at
      FROM tenants t
      LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT expires_at, revoked_at FROM impersonation_grants
        WHERE tenant_id = t.id AND revoked_at IS NULL AND expires_at > now()
        ORDER BY granted_at DESC LIMIT 1
      ) g ON TRUE
      WHERE t.deleted_at IS NULL
      ORDER BY t.name`;

    return rows;
  });

  const tenants: TenantRow[] = (data as Record<string, unknown>[]).map((r) => {
    const plan = (r['plan'] as PlatformPlan | null) ?? null;
    const liveStock = Number(r['live_stock'] ?? 0);
    const pastDueSince = toDate(r['past_due_since'] as Date | null);
    const grantExpires = toDate(r['grant_expires_at'] as Date | null);

    return {
      id: String(r['id']),
      name: String(r['name']),
      status: String(r['status']),
      plan,
      subscriptionStatus: (r['subscription_status'] as string | null) ?? null,
      monthlyPrice: r['monthly_price_pence'] === null
        ? null : money(toPence(r['monthly_price_pence'] as string), 'GBP'),
      stockBandLimit: r['stock_band_limit'] === null ? null : Number(r['stock_band_limit']),
      liveStock,
      totalStock: Number(r['total_stock'] ?? 0),
      staff: Number(r['staff'] ?? 0),
      unitsThisMonth: Number(r['units_month'] ?? 0),
      leadsAwaiting: Number(r['leads_awaiting'] ?? 0),
      // Recommended, never applied. A dealer who buys ten cars for a bank
      // holiday should not discover their direct debit has gone up.
      band: plan ? recommendBand(Number(r['total_stock'] ?? 0), plan) : null,
      dunning: r['subscription_status'] === null ? null : dunningState({
        status: r['subscription_status'] as DunningStateInput,
        pastDueSince,
        asAt: now,
      }),
      supportGranted: grantExpires !== null && toDate(r['grant_revoked_at'] as Date | null) === null,
      supportGrantExpiresAt: grantExpires,
    };
  });

  const monthlyRecurring = tenants.reduce(
    (total, t) => total + (t.subscriptionStatus === 'active' ? (t.monthlyPrice?.amount ?? 0n) : 0n),
    0n,
  );

  return {
    tenants,
    summary: {
      tenants: tenants.length,
      live: tenants.filter((t) => t.status === 'live').length,
      pastDue: tenants.filter((t) => t.subscriptionStatus === 'past_due').length,
      trialing: tenants.filter((t) => t.subscriptionStatus === 'trialing').length,
      monthlyRecurring: money(monthlyRecurring, 'GBP'),
    },
    queryMs: Date.now() - started,
  };
}

type DunningStateInput = Parameters<typeof dunningState>[0]['status'];

// ------------------------------------------------------- one dealership

export interface TenantDetail extends TenantRow {
  usage: { metric: string; quantity: number; quota: number | null; state: UsageState }[];
  flags: { flag: string; enabled: boolean; reason: string | null; expiresAt: Date | null }[];
  /** The log of us reading their data. Append-only, and shown to us plainly. */
  impersonations: {
    id: string; operatorName: string; reason: string; status: string;
    startedAt: Date; endedAt: Date | null; expiresAt: Date;
    elevated: boolean; elevatedByName: string | null; elevationReason: string | null;
  }[];
}

export async function loadTenant(tenantId: string): Promise<TenantDetail | null> {
  const view = await loadPlatform();
  const base = view.tenants.find((t) => t.id === tenantId);
  if (!base) return null;

  const data = await acrossTenants(async (tx) => {
    const [usage, flags, impersonations] = await Promise.all([
      tx`SELECT metric::text AS metric, quantity, quota, cost_pence
         FROM usage_records
         WHERE tenant_id = ${tenantId}::uuid
           AND period_month = date_trunc('month', now())::date`,
      tx`SELECT flag, enabled, reason, expires_at FROM feature_flags
         WHERE tenant_id = ${tenantId}::uuid ORDER BY flag`,
      tx`SELECT s.*, o.name AS operator_name, e.name AS elevated_by_name
         FROM impersonation_sessions s
         LEFT JOIN users o ON o.id = s.operator_id
         LEFT JOIN users e ON e.id = s.elevated_by
         WHERE s.tenant_id = ${tenantId}::uuid
         ORDER BY s.started_at DESC LIMIT 25`,
    ]);
    return { usage, flags, impersonations };
  });

  return {
    ...base,
    usage: (data.usage as Record<string, unknown>[]).map((u) => {
      const quantity = Number(u['quantity'] ?? 0);
      const quota = u['quota'] === null ? null : Number(u['quota']);
      return {
        metric: String(u['metric']),
        quantity,
        quota,
        state: usageState({
          metric: u['metric'] as Parameters<typeof usageState>[0]['metric'],
          used: quantity,
          quota,
          // What it has actually cost. Vehicle lookups are billed per call,
          // so this is both a billing input and the thing that catches a
          // runaway job before it produces a five-figure invoice.
          cost: money(toPence(u['cost_pence'] as string), 'GBP'),
        }),
      };
    }),
    flags: (data.flags as Record<string, unknown>[]).map((f) => ({
      flag: String(f['flag']),
      enabled: Boolean(f['enabled']),
      reason: (f['reason'] as string | null) ?? null,
      expiresAt: toDate(f['expires_at'] as Date | null),
    })),
    impersonations: (data.impersonations as Record<string, unknown>[]).map((s) => ({
      id: String(s['id']),
      operatorName: String(s['operator_name'] ?? 'Unknown operator'),
      reason: String(s['reason']),
      status: String(s['status']),
      startedAt: toDate(s['started_at'] as Date) as Date,
      endedAt: toDate(s['ended_at'] as Date | null),
      expiresAt: toDate(s['expires_at'] as Date) as Date,
      elevated: Boolean(s['elevated']),
      elevatedByName: (s['elevated_by_name'] as string | null) ?? null,
      elevationReason: (s['elevation_reason'] as string | null) ?? null,
    })),
  };
}

/**
 * Whether this operator may enter this dealership right now.
 *
 * Asked BEFORE the button is offered as well as when it is pressed, so the
 * refusals are visible rather than discovered. There is no override.
 */
export async function assessImpersonation(input: {
  operatorId: string;
  tenantId: string;
  reason: string;
  requestedHours: number;
}): Promise<ImpersonationDecision> {
  const grant = await acrossTenants(async (tx) => {
    const [row] = await tx`
      SELECT granted_by, granted_at, expires_at, revoked_at
      FROM impersonation_grants
      WHERE tenant_id = ${input.tenantId}::uuid
      ORDER BY granted_at DESC LIMIT 1`;
    return row ?? null;
  });

  return canImpersonate(
    { ...input, asAt: new Date() },
    grant === null ? null : {
      grantedBy: String(grant['granted_by']),
      grantedAt: toDate(grant['granted_at'] as Date) as Date,
      expiresAt: toDate(grant['expires_at'] as Date) as Date,
      revokedAt: toDate(grant['revoked_at'] as Date | null),
    },
  );
}

export { DUNNING_GRACE_DAYS, MAX_IMPERSONATION_HOURS, PLAN_BANDS };
