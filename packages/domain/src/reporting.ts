/**
 * M18 — reporting and the Channel P&L.
 *
 * The spec calls the Channel P&L "the most persuasive screen in the product":
 * it reframes our subscription as the cheapest channel the dealer has, and
 * gives them the ammunition they lack when a marketplace raises its prices.
 *
 * That is exactly why it has to be right. A table a dealer takes into a
 * negotiation and cannot defend is worse than no table, and there are three
 * specific ways this one goes wrong:
 *
 *   1. ATTRIBUTION THAT GUESSES. A deal with no lead is not a website sale. A
 *      buyer who saw the car on Auto Trader, then came to the dealer's own
 *      site, then telephoned, has touched three channels — and quietly
 *      crediting one of them produces a number nobody can reproduce. Every
 *      deal here resolves to a NAMED channel or to `unattributed`, and
 *      assisting channels are reported beside the credited one rather than
 *      dropped.
 *
 *   2. ARITHMETIC THAT DIVIDES BY ZERO. A channel with spend and no leads, or
 *      leads and no recorded spend, is normal in the first month. `Infinity`
 *      and `NaN` on a screen a dealer is reading destroy the whole table's
 *      credibility, so neither is ever produced.
 *
 *   3. A CONFIDENT NUMBER FROM THREE SALES. Same rule as M13's observed recon
 *      averages and M14's prep report: below a floor, the ROI is not reported
 *      as a figure at all. A dealer who cancels Auto Trader on the strength of
 *      two months and four sales will not blame their own sample size.
 */

import { type Money, money, add, multiply, sum, zero, format } from './money.js';

// ------------------------------------------------------------ attribution

export type AttributionOutcome = 'attributed' | 'unattributed';

export interface LeadTouch {
  leadId: string;
  channelLabel: string;
  receivedAt: Date;
}

export interface DealForAttribution {
  dealId: string;
  /** M12's `deals.lead_id`. Null for a walk-in, and that is a real answer. */
  leadId: string | null;
  contactId: string | null;
  soldAt: Date | null;
  /** From M12's margin panel. Never recomputed here. */
  grossProfit: Money;
}

export interface Attribution {
  dealId: string;
  outcome: AttributionOutcome;
  /** The channel credited with the sale, or null. */
  channel: string | null;
  /** Other channels this buyer touched. Reported, never silently dropped. */
  assisted: readonly string[];
  /** True when more than one channel was involved — the table is not the
   *  whole story for this deal, and saying so is the honest version. */
  multiTouch: boolean;
  reason: string;
}

/**
 * The label used for a deal nobody can trace to a channel.
 *
 * A named bucket rather than an omission: a dealer whose walk-in trade is a
 * third of their business needs to see that, and a P&L that quietly excludes
 * it overstates every channel's share of the total.
 */
export const UNATTRIBUTED = 'Unattributed / walk-in';

/**
 * Which channel gets credit for a sale.
 *
 * The deal's OWN lead is credited — `deals.lead_id` is the lead the salesperson
 * actually worked, which is the closest thing to a fact available. Other leads
 * from the same contact are reported as assisting.
 *
 * Deliberately not a weighted multi-touch model. A dealer doing thirty cars a
 * month cannot audit fractional credit, and a number they cannot audit is a
 * number they will not take into a negotiation — which is the entire purpose
 * of this table.
 */
export function attributeDeal(
  deal: DealForAttribution,
  touches: readonly LeadTouch[],
): Attribution {
  const forContact = [...touches].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
  );

  const credited = deal.leadId
    ? forContact.find((t) => t.leadId === deal.leadId)
    : undefined;

  const assisted = forContact
    .filter((t) => t.leadId !== deal.leadId)
    .map((t) => t.channelLabel)
    .filter((label, i, all) => all.indexOf(label) === i && label !== credited?.channelLabel);

  if (!credited) {
    return {
      dealId: deal.dealId,
      outcome: 'unattributed',
      channel: null,
      assisted,
      multiTouch: assisted.length > 0,
      reason: deal.leadId === null
        ? 'No lead on this deal — a walk-in, or one recorded straight as a sale. Counted as ' +
          'unattributed rather than credited to the website.'
        : 'The deal names a lead we have no channel for. Counted as unattributed rather than guessed.',
    };
  }

  return {
    dealId: deal.dealId,
    outcome: 'attributed',
    channel: credited.channelLabel,
    assisted,
    multiTouch: assisted.length > 0,
    reason: assisted.length > 0
      ? `Credited to ${credited.channelLabel}; this buyer also came through ` +
        `${assisted.join(', ')}. One sale, credited once.`
      : `Credited to ${credited.channelLabel}.`,
  };
}

// ------------------------------------------------------------- the table

export interface ChannelSpend {
  channelLabel: string;
  spend: Money;
  estimated: boolean;
}

export interface ChannelPnlRow {
  channel: string;
  spend: Money | null;
  leads: number;
  /** Null rather than a division by zero. */
  costPerLead: Money | null;
  sales: number;
  costPerSale: Money | null;
  grossProfit: Money;
  /** GP ÷ spend, as a multiple. Null when there is no spend to divide by. */
  roi: number | null;
  /** Too few sales to state an ROI with a straight face. */
  lowConfidence: boolean;
  /** True when the spend figure is the dealer's estimate, not an invoice. */
  spendEstimated: boolean;
  /** The filter that reproduces this row's underlying records. */
  drillThrough: { channel: string; from: Date; to: Date };
  summary: string;
}

export interface ChannelPnl {
  rows: readonly ChannelPnlRow[];
  totals: {
    spend: Money;
    leads: number;
    sales: number;
    grossProfit: Money;
    roi: number | null;
  };
  from: Date;
  to: Date;
  /** Channels with spend recorded but no leads at all. */
  silentChannels: readonly string[];
  caveats: readonly string[];
}

/**
 * Below this many sales, an ROI is reported as null rather than as a figure.
 *
 * A dealer who cancels Auto Trader on the strength of four sales will not
 * blame their own sample size, and we will have handed them the number. Same
 * floor logic as M13's observed averages and M14's prep report.
 */
export const MIN_SALES_FOR_ROI = 6;

/**
 * Money divided by a count, or null when the count is zero.
 *
 * Rounded half-up rather than truncated, via the same tested `multiply` path
 * every other rate in the codebase uses. Truncating understates a cost-per-lead
 * by up to a penny on every row, and a dealer checking the table against their
 * own arithmetic will find the discrepancy before they find anything else.
 */
const perUnit = (total: Money, count: number): Money | null =>
  count <= 0 ? null : multiply(total, 1n, BigInt(count), 'half-up');

const asMultiple = (gross: Money, spend: Money): number | null =>
  spend.amount <= 0n ? null : Math.round((Number(gross.amount) / Number(spend.amount)) * 10) / 10;

/**
 * The table.
 *
 * Every row carries a `drillThrough` filter, because design rule 5 says every
 * number is clickable through to its source records — an unverifiable figure
 * destroys trust in the whole dashboard, and this dashboard's entire job is to
 * be trusted in a negotiation.
 */
export function channelPnl(input: {
  spends: readonly ChannelSpend[];
  leadsByChannel: ReadonlyMap<string, number>;
  attributions: readonly Attribution[];
  grossProfitByDeal: ReadonlyMap<string, Money>;
  from: Date;
  to: Date;
  currency?: 'GBP' | 'EUR';
  minSalesForRoi?: number;
}): ChannelPnl {
  const currency = input.currency ?? 'GBP';
  const floor = input.minSalesForRoi ?? MIN_SALES_FOR_ROI;

  // Every channel that appears anywhere: in spend, in leads, or in a sale.
  // A channel with leads and no spend is as interesting as the reverse.
  const channels = new Set<string>([
    ...input.spends.map((s) => s.channelLabel),
    ...input.leadsByChannel.keys(),
  ]);

  const salesByChannel = new Map<string, { count: number; gross: Money }>();
  for (const attribution of input.attributions) {
    const label = attribution.channel ?? UNATTRIBUTED;
    channels.add(label);
    const gross = input.grossProfitByDeal.get(attribution.dealId) ?? zero(currency);
    const entry = salesByChannel.get(label) ?? { count: 0, gross: zero(currency) };
    salesByChannel.set(label, {
      count: entry.count + 1,
      gross: add(entry.gross, gross),
    });
  }

  const spendByChannel = new Map(input.spends.map((s) => [s.channelLabel, s]));

  const rows: ChannelPnlRow[] = [...channels].map((channel) => {
    const spendEntry = spendByChannel.get(channel);
    const spend = spendEntry?.spend ?? null;
    const leads = input.leadsByChannel.get(channel) ?? 0;
    const sale = salesByChannel.get(channel) ?? { count: 0, gross: zero(currency) };

    const roi = spend ? asMultiple(sale.gross, spend) : null;
    const lowConfidence = sale.count < floor;

    return {
      channel,
      spend,
      leads,
      costPerLead: spend ? perUnit(spend, leads) : null,
      sales: sale.count,
      costPerSale: spend ? perUnit(spend, sale.count) : null,
      grossProfit: sale.gross,
      // Reported as null while the sample is thin, even though the arithmetic
      // would happily produce a number.
      roi: lowConfidence ? null : roi,
      lowConfidence,
      spendEstimated: spendEntry?.estimated ?? false,
      drillThrough: { channel, from: input.from, to: input.to },
      summary: describeRow(channel, spend, leads, sale.count, sale.gross, roi, lowConfidence, floor),
    };
  });

  // Most gross profit first — the question a dealer is asking is "what is
  // actually making me money", not "what is alphabetically first".
  rows.sort((a, b) => Number(b.grossProfit.amount - a.grossProfit.amount));

  const totalSpend = sum(input.spends.map((s) => s.spend), currency);
  const totalGross = sum(rows.map((r) => r.grossProfit), currency);
  const totalLeads = [...input.leadsByChannel.values()].reduce((a, b) => a + b, 0);
  const totalSales = input.attributions.length;

  const silent = rows
    .filter((r) => r.spend !== null && r.spend.amount > 0n && r.leads === 0)
    .map((r) => r.channel);

  const caveats: string[] = [];
  const unattributedRow = rows.find((r) => r.channel === UNATTRIBUTED);
  if (unattributedRow && unattributedRow.sales > 0) {
    caveats.push(
      `${unattributedRow.sales} sale${unattributedRow.sales === 1 ? '' : 's'} could not be traced ` +
      'to a channel — walk-ins, or deals recorded without a lead. They are shown separately ' +
      'rather than credited to any channel.',
    );
  }
  const multiTouch = input.attributions.filter((a) => a.multiTouch).length;
  if (multiTouch > 0) {
    caveats.push(
      `${multiTouch} buyer${multiTouch === 1 ? '' : 's'} came through more than one channel. ` +
      'Each sale is credited once, to the lead the deal was worked from; the others are listed ' +
      'as assisting.',
    );
  }
  if (rows.some((r) => r.spendEstimated)) {
    caveats.push('Some spend figures are estimates rather than invoiced amounts.');
  }
  if (silent.length > 0) {
    caveats.push(
      `${silent.join(', ')} produced no leads at all in this period despite being paid for.`,
    );
  }

  return {
    rows,
    totals: {
      spend: totalSpend,
      leads: totalLeads,
      sales: totalSales,
      grossProfit: totalGross,
      // The SAME floor the rows respect. Stating "3.8× overall" while every
      // row says "too few sales to tell" is the report contradicting itself
      // in the space of one screen — and the overall figure is the one a
      // dealer would quote back, so it is the more dangerous of the two.
      roi: totalSales >= floor ? asMultiple(totalGross, totalSpend) : null,
    },
    from: input.from,
    to: input.to,
    silentChannels: silent,
    caveats,
  };
}

function describeRow(
  channel: string,
  spend: Money | null,
  leads: number,
  sales: number,
  gross: Money,
  roi: number | null,
  lowConfidence: boolean,
  floor: number,
): string {
  if (spend === null || spend.amount === 0n) {
    return `${channel}: no spend recorded, ${leads} lead${leads === 1 ? '' : 's'}, ` +
      `${sales} sale${sales === 1 ? '' : 's'}, ${format(gross)} gross.`;
  }
  if (leads === 0) {
    return `${channel}: ${format(spend)} spent and not one lead. Worth a conversation with them.`;
  }
  if (lowConfidence) {
    return `${channel}: ${format(spend)} spent, ${leads} leads, ${sales} sale` +
      `${sales === 1 ? '' : 's'}, ${format(gross)} gross. Too few sales to state a return — ` +
      `${floor} is the point at which the figure means something.`;
  }
  return `${channel}: ${format(spend)} spent, ${leads} leads, ${sales} sales, ` +
    `${format(gross)} gross — ${roi}× return.`;
}

// -------------------------------------------------------- owner tiles

export interface OwnerDashboard {
  stockValueAtCost: Money;
  unitsSoldMtd: number;
  unitsTarget: number | null;
  averageGrossPerUnit: Money | null;
  averageDaysToSell: number | null;
  daysToSellTrend: 'improving' | 'worsening' | 'flat' | 'unknown';
  overageUnits: number;
  overageCapital: Money;
  leadsToday: number;
  leadsAwaitingFirstResponse: number;
  caveats: readonly string[];
}

/** A car this many days in stock is capital the dealer cannot get at. */
export const OVERAGE_DAYS = 90;
/** Fewer completed sales than this and an average is not reported. */
export const MIN_SALES_FOR_AVERAGE = 5;

/**
 * §26.1's six owner tiles — the twenty-second, one-handed view.
 *
 * Averages return null below the floor rather than a figure built from two
 * cars. A dealer principal glancing at this on a Monday morning will act on
 * whatever it says, which is the argument for it saying "not yet" when that
 * is the truth.
 */
export function ownerDashboard(input: {
  /** `daysInStock` is null when the car has no book-in date recorded. A car
   *  whose age is unknown still HAS a value, and still counts as stock. */
  stock: readonly { totalCost: Money; daysInStock: number | null; state: string }[];
  /** `daysToSell` is null when it cannot be computed. The sale still counts as
   *  a unit — how long it took is a different question from whether it
   *  happened, and conflating them lost real sales off the units tile. */
  soldThisMonth: readonly { grossProfit: Money; daysToSell: number | null }[];
  soldPreviousMonth: readonly { daysToSell: number | null }[];
  unitsTarget?: number | null;
  leadsToday: number;
  leadsAwaitingFirstResponse: number;
  currency?: 'GBP' | 'EUR';
}): OwnerDashboard {
  const currency = input.currency ?? 'GBP';
  const caveats: string[] = [];

  const held = input.stock.filter(
    (v) => v.state !== 'sold' && v.state !== 'delivered' && v.state !== 'archived',
  );
  const stockValueAtCost = sum(held.map((v) => v.totalCost), currency);

  // A car with no book-in date is NOT overage. Its age is unknown, and
  // claiming a car has been sitting 90 days when nobody knows when it arrived
  // is the report inventing a fact — the same rule as M19's completeness
  // score, which never counts an unassessable area as a pass.
  const overage = held.filter((v) => v.daysInStock !== null && v.daysInStock >= OVERAGE_DAYS);
  const overageCapital = sum(overage.map((v) => v.totalCost), currency);

  const undated = held.filter((v) => v.daysInStock === null).length;
  if (undated > 0) {
    caveats.push(
      `${undated} car${undated === 1 ? ' has' : 's have'} no book-in date, so `
      + `${undated === 1 ? 'it is' : 'they are'} counted in the stock value but cannot be `
      + 'assessed for overage.',
    );
  }

  const sales = input.soldThisMonth;
  const enough = sales.length >= MIN_SALES_FOR_AVERAGE;

  if (!enough && sales.length > 0) {
    caveats.push(
      `Only ${sales.length} unit${sales.length === 1 ? '' : 's'} sold so far this month — too ` +
      'few for an average that means anything.',
    );
  }

  const averageGrossPerUnit = enough
    ? money(sum(sales.map((s) => s.grossProfit), currency).amount / BigInt(sales.length), currency)
    : null;

  // Averaged only over the sales where it is KNOWN, and reported only when
  // enough of those exist. Treating an unknown as zero drags the average
  // towards a figure nobody's cars achieved.
  const timedSales = sales
    .map((s) => s.daysToSell)
    .filter((d): d is number => d !== null);

  const averageDaysToSell = timedSales.length >= MIN_SALES_FOR_AVERAGE
    ? Math.round(timedSales.reduce((t, d) => t + d, 0) / timedSales.length)
    : null;

  if (sales.length >= MIN_SALES_FOR_AVERAGE && timedSales.length < MIN_SALES_FOR_AVERAGE) {
    caveats.push(
      'Days to sell needs a book-in date, and too few of this month’s sales have one.',
    );
  }

  let trend: OwnerDashboard['daysToSellTrend'] = 'unknown';
  const timedPrevious = input.soldPreviousMonth
    .map((s) => s.daysToSell)
    .filter((d): d is number => d !== null);

  if (averageDaysToSell !== null && timedPrevious.length >= MIN_SALES_FOR_AVERAGE) {
    const previous = Math.round(
      timedPrevious.reduce((t, d) => t + d, 0) / timedPrevious.length,
    );
    // Fewer days to sell is better, so a fall is an improvement.
    trend = averageDaysToSell < previous ? 'improving'
      : averageDaysToSell > previous ? 'worsening' : 'flat';
  }

  if (overage.length > 0) {
    caveats.push(
      `${overage.length} car${overage.length === 1 ? '' : 's'} over ${OVERAGE_DAYS} days, ` +
      `${format(overageCapital)} of capital tied up.`,
    );
  }

  return {
    stockValueAtCost,
    unitsSoldMtd: sales.length,
    unitsTarget: input.unitsTarget ?? null,
    averageGrossPerUnit,
    averageDaysToSell,
    daysToSellTrend: trend,
    overageUnits: overage.length,
    overageCapital,
    leadsToday: input.leadsToday,
    leadsAwaitingFirstResponse: input.leadsAwaitingFirstResponse,
    caveats,
  };
}

// ---------------------------------------------------------- drill-through

export interface DrillThrough {
  report: string;
  filters: Readonly<Record<string, string>>;
}

/**
 * Design rule 5: every number is clickable through to its source records.
 *
 * A figure that cannot be opened is a figure nobody can check, and one
 * unverifiable number destroys trust in every other number on the screen.
 * Building the filter here rather than in the view means the report and the
 * tile cannot disagree about what the number was counting.
 */
export const drillThroughFor = (
  report: string,
  filters: Readonly<Record<string, string | number | Date | null>>,
): DrillThrough => ({
  report,
  filters: Object.fromEntries(
    Object.entries(filters)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => [
        k,
        v instanceof Date ? v.toISOString().slice(0, 10) : String(v),
      ]),
  ),
});

// ------------------------------------------------------------ CSV export

const cell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const poundsOrBlank = (m: Money | null): string =>
  m === null ? '' : (Number(m.amount) / 100).toFixed(2);

/**
 * A channel as a dealer says it.
 *
 * Lives here rather than in the screen because the CSV is generated from the
 * same rows, and a file that says `website_test_drive` where the screen said
 * "Website test drive" looks unfinished on somebody else's desk — which is
 * exactly where this file ends up.
 */
export function channelDisplayName(channel: string): string {
  const named: Record<string, string> = {
    autotrader: 'Auto Trader',
    ebay: 'eBay',
    cargurus: 'CarGurus',
    facebook: 'Facebook',
    other_marketplace: 'Other marketplace',
    website_enquiry: 'Website enquiry',
    website_callback: 'Website callback',
    website_test_drive: 'Website test drive',
    website_part_ex: 'Website part-exchange',
    website_reserve: 'Reserve online',
    saved_search: 'Saved search alert',
    phone: 'Phone',
    walk_in: 'Walk-in',
  };
  return named[channel]
    ?? channel.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const PNL_COLUMNS = [
  'Channel', 'Spend', 'Leads', 'Cost per lead', 'Sales', 'Cost per sale',
  'Gross profit', 'ROI', 'Note',
] as const;

/**
 * The P&L as a file, for the dealer to take into the negotiation.
 *
 * An empty cell where a figure genuinely does not exist, never a zero — "£0.00
 * cost per lead" reads as free, and the truth is that there were no leads to
 * divide by.
 */
export function pnlToCsv(pnl: ChannelPnl): string {
  const rows = [PNL_COLUMNS.join(',')];

  for (const row of pnl.rows) {
    rows.push([
      cell(channelDisplayName(row.channel)),
      poundsOrBlank(row.spend),
      String(row.leads),
      poundsOrBlank(row.costPerLead),
      String(row.sales),
      poundsOrBlank(row.costPerSale),
      poundsOrBlank(row.grossProfit),
      row.roi === null ? '' : `${row.roi}x`,
      cell(row.lowConfidence && row.sales > 0 ? 'Too few sales to state a return' : ''),
    ].join(','));
  }

  return rows.join('\n');
}
