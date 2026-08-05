/**
 * The owner dashboard and the Channel P&L.
 *
 * Two screens with one job between them: be trusted. The dashboard is the
 * twenty-second, one-handed view a dealer principal takes on a Monday
 * morning; the P&L is the table they take into a negotiation with Auto Trader.
 * Both are worthless the moment a figure on them cannot be checked, which is
 * why every number here carries a drill-through and why the arithmetic is done
 * by the domain rather than in SQL.
 *
 * The division of labour matters. SQL does the SELECTING — which cars, which
 * deals, which leads, in which period — and the domain does the DECIDING: what
 * counts as sold, which channel gets credit, when a sample is too small to
 * report an average. A `sum(...)` in a query looks like the same answer and
 * quietly becomes a second implementation of the rule.
 */

import { withSession, toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import {
  money, zero, format,
  ownerDashboard, channelPnl, attributeDeal, pnlToCsv,
  UNATTRIBUTED, OVERAGE_DAYS, MIN_SALES_FOR_AVERAGE, MIN_SALES_FOR_ROI,
  type OwnerDashboard, type ChannelPnl, type ChannelSpend, type Attribution,
  type LeadTouch, type Money, type Currency,
} from '@forecourt/domain';

/** The dashboard, plus what the SCREEN needs that the domain does not model. */
export interface DashboardView {
  dashboard: OwnerDashboard;
  /** Null when the principal may not see cost — the tiles that depend on it
   *  are withheld rather than shown as zero. */
  canSeeCost: boolean;
  /** Deliveries this month, for the units tile's drill-through. */
  monthLabel: string;
  queryMs: number;
}

const currencyOf = (v: unknown): Currency => (v === 'EUR' ? 'EUR' : 'GBP');

/**
 * The six owner tiles.
 *
 * `soldThisMonth` and `soldPreviousMonth` are DELIVERED deals, not deals in
 * state `sold`: a car is sold when the customer has it, and counting a
 * contracted-but-undelivered deal as a unit inflates the month a dealer is
 * judging themselves on. M12's states make the distinction available, so it
 * would be careless not to use it.
 */
export async function loadOwnerDashboard(
  session: Session,
  canSeeCost: boolean,
): Promise<DashboardView> {
  const started = Date.now();

  const data = await withSession(session, async (tx) => {
    // Cost is redacted IN SQL. The stock-value and average-gross tiles are
    // built from it, so a principal without the permission gets zeroes here
    // and null tiles below rather than a payload carrying the figures.
    const stock = await tx`
      SELECT ${canSeeCost ? tx`coalesce(v.total_cost_pence, 0)` : tx`0::bigint`} AS cost,
             v.state::text AS state,
             CASE WHEN v.booked_in_at IS NULL THEN NULL
                  ELSE GREATEST(0, EXTRACT(DAY FROM now() - v.booked_in_at)::int)
             END AS days_in_stock
      FROM vehicles v
      -- NO book-in-date filter. It dropped every undated car out of the stock
      -- VALUE, reporting zero against eighty thousand pounds of stock. What a
      -- car is worth does not depend on knowing when it arrived; only its age
      -- does, and that comes back null.
      WHERE v.state NOT IN ('sold', 'delivered', 'archived')`;

    const soldThisMonth = await tx`
      SELECT ${canSeeCost
    ? tx`coalesce(d.vehicle_price_pence, 0) - coalesce(v.total_cost_pence, 0)`
    : tx`0::bigint`} AS gross,
             -- Null rather than excluded. A sale happened whether or not we
             -- can say how long the car took, and requiring a book-in date to
             -- COUNT a unit lost real sales off the tile a dealer judges their
             -- month by.
             CASE WHEN v.booked_in_at IS NULL THEN NULL
                  ELSE GREATEST(0, EXTRACT(DAY FROM d.delivered_at - v.booked_in_at)::int)
             END AS days_to_sell
      FROM deals d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.state IN ('delivered', 'completed')
        AND d.delivered_at >= date_trunc('month', now())`;

    const soldPreviousMonth = await tx`
      SELECT CASE WHEN v.booked_in_at IS NULL THEN NULL
                  ELSE GREATEST(0, EXTRACT(DAY FROM d.delivered_at - v.booked_in_at)::int)
             END AS days_to_sell
      FROM deals d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.state IN ('delivered', 'completed')
        AND d.delivered_at >= date_trunc('month', now()) - interval '1 month'
        AND d.delivered_at <  date_trunc('month', now())`;

    const [leads] = await tx<{ today: number; awaiting: number }[]>`
      SELECT
        count(*) FILTER (WHERE l.received_at >= date_trunc('day', now()))::int AS today,
        count(*) FILTER (WHERE l.first_response_at IS NULL AND l.closed_at IS NULL)::int AS awaiting
      FROM leads l`;

    const [target] = await tx<{ units: number | null }[]>`
      SELECT (settings->>'monthly_units_target')::int AS units
      FROM tenants WHERE id = ${session.tenantId}::uuid`;

    return { stock, soldThisMonth, soldPreviousMonth, leads, target };
  });

  const dashboard = ownerDashboard({
    stock: (data.stock as Record<string, unknown>[]).map((v) => ({
      totalCost: money(toPence(v['cost'] as string), 'GBP'),
      daysInStock: v['days_in_stock'] === null ? null : Number(v['days_in_stock']),
      state: String(v['state']),
    })),
    soldThisMonth: (data.soldThisMonth as Record<string, unknown>[]).map((s) => ({
      grossProfit: money(toPence(s['gross'] as string), 'GBP'),
      daysToSell: s['days_to_sell'] === null ? null : Number(s['days_to_sell']),
    })),
    soldPreviousMonth: (data.soldPreviousMonth as Record<string, unknown>[]).map((s) => ({
      daysToSell: s['days_to_sell'] === null ? null : Number(s['days_to_sell']),
    })),
    unitsTarget: data.target?.units ?? null,
    leadsToday: data.leads?.today ?? 0,
    leadsAwaitingFirstResponse: data.leads?.awaiting ?? 0,
  });

  return {
    dashboard,
    canSeeCost,
    monthLabel: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    queryMs: Date.now() - started,
  };
}

// ----------------------------------------------------------- Channel P&L

export interface PnlView {
  pnl: ChannelPnl;
  /** Every attribution, so the screen can explain any individual sale. */
  attributions: Attribution[];
  /** Sales whose channel could not be established, named rather than dropped. */
  unattributedSales: number;
  canSeeCost: boolean;
  queryMs: number;
}

export interface PnlFilters {
  from?: string | undefined;
  to?: string | undefined;
}

/** First of the month, n months back. */
const monthsAgo = (n: number): Date => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
};

/**
 * The Channel P&L.
 *
 * `grossProfitByDeal` is the vehicle gross — selling price less what the car
 * cost. It is NOT recomputed here from anything: M12 owns the margin, and a
 * second definition of gross on a table a dealer takes into a negotiation is
 * how the negotiation ends with them being told their own numbers are wrong.
 *
 * A principal without cost cannot see gross or ROI. The rest of the table —
 * spend, leads, cost per lead, sales — is still theirs to see, because none of
 * it reveals what a car cost. Blanking the whole report would be easier and
 * would take a working tool away from the person who books the advertising.
 */
export async function loadChannelPnl(
  session: Session,
  filters: PnlFilters,
  canSeeCost: boolean,
): Promise<PnlView> {
  const started = Date.now();

  const from = filters.from ? new Date(filters.from) : monthsAgo(2);
  const to = filters.to ? new Date(filters.to) : new Date();

  const data = await withSession(session, async (tx) => {
    const spends = await tx`
      SELECT channel_label, sum(amount_pence)::text AS amount,
             bool_or(estimated) AS estimated, currency
      FROM channel_costs
      WHERE period_month >= date_trunc('month', ${from}::timestamptz)
        AND period_month <= date_trunc('month', ${to}::timestamptz)
      GROUP BY channel_label, currency`;

    // Leads per channel in the window. `source` is the channel a lead arrived
    // through; the label is made readable by the screen, not here, so the
    // spend rows and the lead rows agree on the key.
    const leads = await tx`
      SELECT l.source::text AS source, count(*)::int AS n
      FROM leads l
      WHERE l.received_at >= ${from} AND l.received_at <= ${to}
      GROUP BY l.source`;

    // Every lead touch for the buyers who bought in this window — needed to
    // report assisting channels rather than silently dropping them.
    const deals = await tx`
      SELECT d.id, d.lead_id, d.contact_id, d.delivered_at,
             ${canSeeCost
    ? tx`coalesce(d.vehicle_price_pence, 0) - coalesce(v.total_cost_pence, 0)`
    : tx`0::bigint`} AS gross
      FROM deals d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.state IN ('delivered', 'completed')
        AND d.delivered_at >= ${from} AND d.delivered_at <= ${to}`;

    const contactIds = (deals as Record<string, unknown>[])
      .map((d) => d['contact_id']).filter((c): c is string => typeof c === 'string');

    const touches = contactIds.length === 0 ? [] : await tx`
      SELECT l.id, l.contact_id, l.source::text AS source, l.received_at
      FROM leads l WHERE l.contact_id = ANY(${contactIds}::uuid[])`;

    return { spends, leads, deals, touches };
  });

  const touchesByContact = new Map<string, LeadTouch[]>();
  for (const t of data.touches as Record<string, unknown>[]) {
    const key = String(t['contact_id']);
    const list = touchesByContact.get(key) ?? [];
    list.push({
      leadId: String(t['id']),
      channelLabel: String(t['source']),
      receivedAt: toDate(t['received_at'] as Date) as Date,
    });
    touchesByContact.set(key, list);
  }

  const grossProfitByDeal = new Map<string, Money>();
  const attributions: Attribution[] = [];

  for (const raw of data.deals as Record<string, unknown>[]) {
    const dealId = String(raw['id']);
    const contactId = raw['contact_id'] === null ? null : String(raw['contact_id']);
    grossProfitByDeal.set(dealId, money(toPence(raw['gross'] as string), 'GBP'));

    // The domain decides which channel gets credit. Doing it in SQL would be
    // a second implementation of a rule that has its own tests.
    attributions.push(attributeDeal({
      dealId,
      leadId: raw['lead_id'] === null ? null : String(raw['lead_id']),
      contactId,
      soldAt: toDate(raw['delivered_at'] as Date | null),
      grossProfit: grossProfitByDeal.get(dealId)!,
    }, contactId ? touchesByContact.get(contactId) ?? [] : []));
  }

  const leadsByChannel = new Map<string, number>();
  for (const l of data.leads as Record<string, unknown>[]) {
    leadsByChannel.set(String(l['source']), Number(l['n']));
  }

  const spends: ChannelSpend[] = (data.spends as Record<string, unknown>[]).map((s) => ({
    channelLabel: String(s['channel_label']),
    spend: money(toPence(s['amount'] as string), currencyOf(s['currency'])),
    estimated: Boolean(s['estimated']),
  }));

  const pnl = channelPnl({
    spends, leadsByChannel, attributions, grossProfitByDeal, from, to,
  });

  return {
    pnl,
    attributions,
    unattributedSales: attributions.filter((a) => a.outcome === 'unattributed').length,
    canSeeCost,
    queryMs: Date.now() - started,
  };
}

/** Channels a dealer might be spending on, for the spend form. */
export async function loadChannelLabels(session: Session): Promise<string[]> {
  return withSession(session, async (tx) => {
    const rows = await tx<{ label: string }[]>`
      SELECT DISTINCT channel_label AS label FROM channel_costs
      UNION
      SELECT DISTINCT source::text AS label FROM leads
      ORDER BY label`;
    return rows.map((r) => r.label);
  });
}

/** Spend already recorded, so the form can show what is there and what is not. */
export async function loadChannelSpend(
  session: Session,
  monthIso: string,
): Promise<{ label: string; amount: Money; estimated: boolean; note: string | null }[]> {
  return withSession(session, async (tx) => {
    const rows = await tx`
      SELECT channel_label, amount_pence, currency, estimated, note
      FROM channel_costs
      WHERE period_month = date_trunc('month', ${monthIso}::timestamptz)
      ORDER BY channel_label`;
    return (rows as Record<string, unknown>[]).map((r) => ({
      label: String(r['channel_label']),
      amount: money(toPence(r['amount_pence'] as string), currencyOf(r['currency'])),
      estimated: Boolean(r['estimated']),
      note: (r['note'] as string | null) ?? null,
    }));
  });
}

export {
  pnlToCsv, format, zero, UNATTRIBUTED, OVERAGE_DAYS,
  MIN_SALES_FOR_AVERAGE, MIN_SALES_FOR_ROI,
};
