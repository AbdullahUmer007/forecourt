import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  attributeDeal, channelPnl, ownerDashboard, drillThroughFor, pnlToCsv,
  UNATTRIBUTED, MIN_SALES_FOR_ROI, OVERAGE_DAYS, MIN_SALES_FOR_AVERAGE, PNL_COLUMNS,
  type Attribution, type LeadTouch, type DealForAttribution, type ChannelSpend,
} from './reporting.js';
import { money, zero, type Money } from './money.js';

const D = (day: number): Date => new Date(Date.UTC(2026, 7, day, 12));

const deal = (over: Partial<DealForAttribution> = {}): DealForAttribution => ({
  dealId: 'deal-1', leadId: 'lead-1', contactId: 'c1',
  soldAt: D(10), grossProfit: money(190_500n), ...over,
});

const touch = (over: Partial<LeadTouch> = {}): LeadTouch => ({
  leadId: 'lead-1', channelLabel: 'Auto Trader', receivedAt: D(1), ...over,
});

// ============================================== attribution

describe('attributing a sale to a channel', () => {
  it('credits the lead the deal was actually worked from', () => {
    const result = attributeDeal(deal(), [touch()]);
    expect(result.outcome).toBe('attributed');
    expect(result.channel).toBe('Auto Trader');
    expect(result.multiTouch).toBe(false);
  });

  it('a deal with NO lead is unattributed, never credited to the website', () => {
    // The single most tempting wrong answer. A walk-in is not a website sale,
    // and quietly crediting one makes the platform look good on the one table
    // whose whole purpose is being trusted.
    const result = attributeDeal(deal({ leadId: null }), []);
    expect(result.outcome).toBe('unattributed');
    expect(result.channel).toBeNull();
    expect(result.reason).toMatch(/rather than credited to the website/);
  });

  it('a lead we have no channel for is unattributed, not guessed', () => {
    const result = attributeDeal(deal({ leadId: 'lead-unknown' }), [touch()]);
    expect(result.outcome).toBe('unattributed');
    expect(result.reason).toMatch(/rather than guessed/);
  });

  it('names the assisting channels without crediting them', () => {
    // A buyer who saw the car on Auto Trader, came to the dealer's own site,
    // then telephoned has touched three channels. One sale, credited once —
    // and the others said out loud.
    const result = attributeDeal(deal({ leadId: 'lead-3' }), [
      touch({ leadId: 'lead-1', channelLabel: 'Auto Trader', receivedAt: D(1) }),
      touch({ leadId: 'lead-2', channelLabel: 'Own website', receivedAt: D(3) }),
      touch({ leadId: 'lead-3', channelLabel: 'Telephone', receivedAt: D(5) }),
    ]);
    expect(result.channel).toBe('Telephone');
    expect(result.assisted).toEqual(['Auto Trader', 'Own website']);
    expect(result.multiTouch).toBe(true);
    expect(result.reason).toMatch(/One sale, credited once/);
  });

  it('does not list the credited channel as also assisting itself', () => {
    const result = attributeDeal(deal({ leadId: 'lead-2' }), [
      touch({ leadId: 'lead-1', channelLabel: 'Auto Trader', receivedAt: D(1) }),
      touch({ leadId: 'lead-2', channelLabel: 'Auto Trader', receivedAt: D(4) }),
    ]);
    expect(result.channel).toBe('Auto Trader');
    expect(result.assisted).toEqual([]);
    expect(result.multiTouch).toBe(false);
  });

  it('deduplicates a channel touched twice', () => {
    const result = attributeDeal(deal({ leadId: 'lead-9' }), [
      touch({ leadId: 'lead-1', channelLabel: 'Own website' }),
      touch({ leadId: 'lead-2', channelLabel: 'Own website' }),
      touch({ leadId: 'lead-9', channelLabel: 'Carwow' }),
    ]);
    expect(result.assisted).toEqual(['Own website']);
  });
});

// ============================================== the P&L table

const attribution = (dealId: string, channel: string | null): Attribution => ({
  dealId, outcome: channel ? 'attributed' : 'unattributed',
  channel, assisted: [], multiTouch: false, reason: '',
});

const pnl = (over: Partial<Parameters<typeof channelPnl>[0]> = {}) => channelPnl({
  spends: [
    { channelLabel: 'Own website', spend: money(22_900n), estimated: false },
    { channelLabel: 'Auto Trader', spend: money(185_000n), estimated: false },
  ] as ChannelSpend[],
  leadsByChannel: new Map([['Own website', 84], ['Auto Trader', 142]]),
  attributions: [
    ...Array.from({ length: 11 }, (_, i) => attribution(`w${i}`, 'Own website')),
    ...Array.from({ length: 18 }, (_, i) => attribution(`a${i}`, 'Auto Trader')),
  ],
  grossProfitByDeal: new Map<string, Money>([
    ...Array.from({ length: 11 }, (_, i) => [`w${i}`, money(190_500n)] as const),
    ...Array.from({ length: 18 }, (_, i) => [`a${i}`, money(190_500n)] as const),
  ]),
  from: D(1), to: D(31),
  ...over,
});

describe('the Channel P&L', () => {
  it('produces the spec’s shape', () => {
    const table = pnl();
    const autoTrader = table.rows.find((r) => r.channel === 'Auto Trader')!;

    expect(autoTrader.spend).toEqual(money(185_000n));
    expect(autoTrader.leads).toBe(142);
    expect(autoTrader.sales).toBe(18);
    // The spec’s own worked example: £1,850 ÷ 142 = £13.03, ÷ 18 = £102.78.
    // Rounded half-up, not truncated — a dealer checking with a calculator
    // gets these figures and not a penny less.
    expect(autoTrader.costPerLead).toEqual(money(1_303n));
    expect(autoTrader.costPerSale).toEqual(money(10_278n));
    expect(autoTrader.grossProfit).toEqual(money(18n * 190_500n));
  });

  it('sorts by gross profit, because that is the question being asked', () => {
    const table = pnl();
    expect(table.rows[0]!.channel).toBe('Auto Trader');
  });

  it('reports the ROI as a multiple', () => {
    const website = pnl().rows.find((r) => r.channel === 'Own website')!;
    // The spec’s table says 91× for the own website, and that is what makes
    // this screen persuasive: £20,955 of gross against £229 of platform cost.
    expect(website.roi).toBeCloseTo(91.5, 1);
  });

  it('every row carries a drill-through filter', () => {
    // Design rule 5. One unverifiable number destroys trust in every other
    // number on the screen, and this screen's entire job is to be trusted.
    for (const row of pnl().rows) {
      expect(row.drillThrough.channel).toBe(row.channel);
      expect(row.drillThrough.from).toEqual(D(1));
      expect(row.drillThrough.to).toEqual(D(31));
    }
  });
});

describe('the arithmetic that would otherwise divide by zero', () => {
  it('a channel with spend and NO leads reports null, not Infinity', () => {
    const table = pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 0]]),
      attributions: [],
      grossProfitByDeal: new Map(),
    });
    const row = table.rows.find((r) => r.channel === 'Carwow')!;
    expect(row.costPerLead).toBeNull();
    expect(row.costPerSale).toBeNull();
    expect(Number.isFinite(row.roi ?? 0)).toBe(true);
  });

  it('names a channel that was paid for and produced nothing', () => {
    const table = pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 0]]),
      attributions: [],
      grossProfitByDeal: new Map(),
    });
    expect(table.silentChannels).toEqual(['Carwow']);
    expect(table.rows[0]!.summary).toMatch(/not one lead. Worth a conversation/);
  });

  it('a channel with leads and NO recorded spend reports null ROI, not Infinity', () => {
    const table = pnl({
      spends: [],
      leadsByChannel: new Map([['Word of mouth', 12]]),
      attributions: Array.from({ length: 8 }, (_, i) => attribution(`m${i}`, 'Word of mouth')),
      grossProfitByDeal: new Map(
        Array.from({ length: 8 }, (_, i) => [`m${i}`, money(150_000n)] as const)),
    });
    const row = table.rows.find((r) => r.channel === 'Word of mouth')!;
    expect(row.roi).toBeNull();
    expect(row.summary).toMatch(/no spend recorded/);
  });

  it('property: no row ever contains Infinity or NaN', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 100 }),
      fc.bigInt({ min: 0n, max: 500_000n }),
      (leads, sales, spendPence) => {
        const table = channelPnl({
          spends: [{ channelLabel: 'X', spend: money(spendPence), estimated: false }],
          leadsByChannel: new Map([['X', leads]]),
          attributions: Array.from({ length: sales }, (_, i) => attribution(`d${i}`, 'X')),
          grossProfitByDeal: new Map(
            Array.from({ length: sales }, (_, i) => [`d${i}`, money(100_000n)] as const)),
          from: D(1), to: D(31),
        });

        for (const row of table.rows) {
          if (row.roi !== null) {
            expect(Number.isFinite(row.roi)).toBe(true);
            expect(Number.isNaN(row.roi)).toBe(false);
          }
        }
        expect(Number.isNaN(table.totals.roi ?? 0)).toBe(false);
      },
    ));
  });
});

describe('small samples', () => {
  it('refuses to state an ROI below the floor', () => {
    // A dealer who cancels Auto Trader on the strength of four sales will not
    // blame their own sample size.
    const table = pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 20]]),
      attributions: Array.from({ length: 3 }, (_, i) => attribution(`c${i}`, 'Carwow')),
      grossProfitByDeal: new Map(
        Array.from({ length: 3 }, (_, i) => [`c${i}`, money(200_000n)] as const)),
    });
    const row = table.rows.find((r) => r.channel === 'Carwow')!;
    expect(row.lowConfidence).toBe(true);
    expect(row.roi).toBeNull();
    expect(row.summary).toMatch(/Too few sales to state a return/);
  });

  it('states it once the floor is met', () => {
    const table = pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 20]]),
      attributions: Array.from({ length: MIN_SALES_FOR_ROI },
        (_, i) => attribution(`c${i}`, 'Carwow')),
      grossProfitByDeal: new Map(
        Array.from({ length: MIN_SALES_FOR_ROI }, (_, i) => [`c${i}`, money(200_000n)] as const)),
    });
    const row = table.rows.find((r) => r.channel === 'Carwow')!;
    expect(row.lowConfidence).toBe(false);
    expect(row.roi).not.toBeNull();
  });
});

describe('honesty about what the table is not', () => {
  it('shows unattributed sales as their own row rather than hiding them', () => {
    // A dealer whose walk-in trade is a third of their business needs to see
    // that; excluding it overstates every channel's share.
    const table = pnl({
      attributions: [
        ...Array.from({ length: 6 }, (_, i) => attribution(`a${i}`, 'Auto Trader')),
        ...Array.from({ length: 4 }, (_, i) => attribution(`u${i}`, null)),
      ],
      grossProfitByDeal: new Map([
        ...Array.from({ length: 6 }, (_, i) => [`a${i}`, money(190_500n)] as const),
        ...Array.from({ length: 4 }, (_, i) => [`u${i}`, money(150_000n)] as const),
      ]),
    });

    const row = table.rows.find((r) => r.channel === UNATTRIBUTED)!;
    expect(row.sales).toBe(4);
    expect(table.caveats.some((c) => /could not be traced to a channel/.test(c))).toBe(true);
  });

  it('says when buyers came through more than one channel', () => {
    const table = pnl({
      attributions: [
        { ...attribution('a1', 'Auto Trader'), assisted: ['Own website'], multiTouch: true },
      ],
      grossProfitByDeal: new Map([['a1', money(190_500n)]]),
    });
    expect(table.caveats.some((c) => /more than one channel/.test(c))).toBe(true);
  });

  it('flags estimated spend rather than presenting it as invoiced', () => {
    const table = pnl({
      spends: [{ channelLabel: 'Auto Trader', spend: money(185_000n), estimated: true }],
    });
    expect(table.rows.find((r) => r.channel === 'Auto Trader')!.spendEstimated).toBe(true);
    expect(table.caveats.some((c) => /estimates rather than invoiced/.test(c))).toBe(true);
  });

  it('a clean period has no caveats', () => {
    expect(pnl().caveats).toEqual([]);
  });
});

describe('totals', () => {
  it('sum the parts', () => {
    const table = pnl();
    expect(table.totals.spend).toEqual(money(207_900n));
    expect(table.totals.leads).toBe(226);
    expect(table.totals.sales).toBe(29);
    expect(table.totals.grossProfit).toEqual(money(29n * 190_500n));
  });

  it('an empty period totals to zero without dividing by anything', () => {
    const table = channelPnl({
      spends: [], leadsByChannel: new Map(), attributions: [],
      grossProfitByDeal: new Map(), from: D(1), to: D(31),
    });
    expect(table.rows).toEqual([]);
    expect(table.totals.spend).toEqual(zero());
    expect(table.totals.roi).toBeNull();
  });
});

// ============================================== owner dashboard

describe('the owner dashboard', () => {
  const stock = (n: number, days: number, cost = 900_000n) =>
    Array.from({ length: n }, () => ({ totalCost: money(cost), daysInStock: days, state: 'live' }));

  const sold = (n: number, gross = 190_500n, days = 42) =>
    Array.from({ length: n }, () => ({ grossProfit: money(gross), daysToSell: days }));

  it('values stock at cost, excluding what is already gone', () => {
    const board = ownerDashboard({
      stock: [
        ...stock(3, 20),
        { totalCost: money(900_000n), daysInStock: 10, state: 'sold' },
      ],
      soldThisMonth: [], soldPreviousMonth: [], leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.stockValueAtCost).toEqual(money(2_700_000n));
  });

  it('counts overage and the capital tied up in it', () => {
    const board = ownerDashboard({
      stock: [...stock(2, OVERAGE_DAYS), ...stock(5, 30)],
      soldThisMonth: [], soldPreviousMonth: [], leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.overageUnits).toBe(2);
    expect(board.overageCapital).toEqual(money(1_800_000n));
    expect(board.caveats.some((c) => /capital tied up/.test(c))).toBe(true);
  });

  it('refuses an average from too few sales', () => {
    // A dealer principal glancing at this on a Monday will act on whatever it
    // says, which is the argument for it saying "not yet".
    const board = ownerDashboard({
      stock: [], soldThisMonth: sold(2), soldPreviousMonth: [],
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.averageGrossPerUnit).toBeNull();
    expect(board.averageDaysToSell).toBeNull();
    expect(board.caveats.some((c) => /too few for an average/.test(c))).toBe(true);
  });

  it('states the average once there is enough', () => {
    const board = ownerDashboard({
      stock: [], soldThisMonth: sold(MIN_SALES_FOR_AVERAGE), soldPreviousMonth: [],
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.averageGrossPerUnit).toEqual(money(190_500n));
    expect(board.averageDaysToSell).toBe(42);
  });

  it('FEWER days to sell is an improvement, not a decline', () => {
    // The one place a falling number is good news, and the easy thing to get
    // backwards on a trend arrow.
    const board = ownerDashboard({
      stock: [],
      soldThisMonth: sold(6, 190_500n, 30),
      soldPreviousMonth: sold(6, 190_500n, 45),
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.daysToSellTrend).toBe('improving');
  });

  it('a rising days-to-sell is worsening', () => {
    const board = ownerDashboard({
      stock: [],
      soldThisMonth: sold(6, 190_500n, 55),
      soldPreviousMonth: sold(6, 190_500n, 45),
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.daysToSellTrend).toBe('worsening');
  });

  it('reports the trend as unknown when last month is too thin to compare', () => {
    const board = ownerDashboard({
      stock: [], soldThisMonth: sold(6), soldPreviousMonth: sold(2),
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(board.daysToSellTrend).toBe('unknown');
  });
});

// ============================================== drill-through and export

describe('drill-through', () => {
  it('builds a filter the report screen can reproduce', () => {
    const drill = drillThroughFor('sales', { channel: 'Auto Trader', from: D(1), to: D(31) });
    expect(drill.report).toBe('sales');
    expect(drill.filters).toEqual({
      channel: 'Auto Trader', from: '2026-08-01', to: '2026-08-31',
    });
  });

  it('drops empty filters rather than sending blanks', () => {
    expect(drillThroughFor('sales', { channel: null, site: '' }).filters).toEqual({});
  });
});

describe('the P&L as a file', () => {
  it('has the spec’s columns', () => {
    expect(pnlToCsv(pnl()).split('\n')[0]).toBe(PNL_COLUMNS.join(','));
  });

  it('leaves a figure BLANK where it genuinely does not exist', () => {
    // "£0.00 cost per lead" reads as free. The truth is there were no leads
    // to divide by.
    const csv = pnlToCsv(pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 0]]),
      attributions: [],
      grossProfitByDeal: new Map(),
    }));
    const [, row] = csv.split('\n');
    expect(row).toBe('Carwow,500.00,0,,0,,0.00,,');
  });

  it('escapes a channel name containing a comma', () => {
    const csv = pnlToCsv(pnl({
      spends: [{ channelLabel: 'Motors, Gumtree', spend: money(20_300n), estimated: false }],
      leadsByChannel: new Map([['Motors, Gumtree', 31]]),
      attributions: [],
      grossProfitByDeal: new Map(),
    }));
    expect(csv).toMatch(/"Motors, Gumtree"/);
  });

  it('notes a row whose return is not stated, so a blank is not a mystery', () => {
    const csv = pnlToCsv(pnl({
      spends: [{ channelLabel: 'Carwow', spend: money(50_000n), estimated: false }],
      leadsByChannel: new Map([['Carwow', 20]]),
      attributions: [attribution('c1', 'Carwow')],
      grossProfitByDeal: new Map([['c1', money(200_000n)]]),
    }));
    expect(csv).toMatch(/Too few sales to state a return/);
  });
});
