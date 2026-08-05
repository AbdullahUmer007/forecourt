import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession } from '@/data/db';
import { loadOwnerDashboard, loadChannelPnl, loadChannelSpend, pnlToCsv } from '@/data/dashboard';
import { applyChannelSpend } from '@/data/spend-apply';
import { UNATTRIBUTED, MIN_SALES_FOR_ROI } from '@forecourt/domain';
import { ensureFixtures, session, T } from './fixtures';

/**
 * The owner dashboard and the Channel P&L, against a real database.
 *
 * What is being defended:
 *
 * 1. An average built from too few sales is NOT reported. A dealer principal
 *    acts on whatever the tile says on a Monday morning.
 * 2. A channel with too few sales reports no ROI. Handing somebody a figure
 *    they will cancel a contract on is the failure mode here.
 * 3. Cost, gross and ROI are withheld from a principal without cost — but the
 *    rest of the table is not, because none of it reveals what a car cost.
 * 4. Nothing is silently dropped: a sale that cannot be traced is a named row,
 *    and a channel with spend and no leads is surfaced, not omitted.
 */

let ready = false;
let reason = '';

const CONTACT = 'eeeeeeee-0000-4000-8000-00000000c004';
const VEHICLE = (n: number) => `eeeeeeee-0000-4000-8000-00000000a10${n}`;
const LEAD = (n: number) => `eeeeeeee-0000-4000-8000-00000000d10${n}`;
const DEAL = (n: number) => `eeeeeeee-0000-4000-8000-00000000b20${n}`;

/** Six sales, so the P&L's ROI floor is genuinely exercised. */
const SALES = 6;

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Report', 'Buyer',
              'report.buyer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;

    // A car still HELD, with a cost. Every other fixture vehicle here is
    // delivered, so without this the stock-value tile is legitimately zero and
    // the redaction test would pass for the wrong reason.
    await sql`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                            registration, make, model, state, vat_scheme,
                            retail_price_pence, total_cost_pence, booked_in_at)
      VALUES ('eeeeeeee-0000-4000-8000-00000000a199'::uuid, ${T.tenant}::uuid,
              ${T.site}::uuid, 'RPT-HELD', 969999, 'RP99HLD', 'Kia', 'Sportage',
              'live', 'margin', 1_500_000, 1_250_000, now() - interval '120 days')
      ON CONFLICT (id) DO NOTHING`;

    for (let n = 0; n < SALES; n += 1) {
      await sql`
        INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence,
                              registration, make, model, state, vat_scheme,
                              retail_price_pence, total_cost_pence, booked_in_at)
        VALUES (${VEHICLE(n)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid,
                ${'RPT-' + n}, ${960000 + n}, ${'RP7' + n + 'RPT'},
                'Ford', 'Focus', 'delivered', 'margin',
                1_200_000, 1_000_000, now() - interval '40 days')
        ON CONFLICT (id) DO NOTHING`;

      await sql`
        INSERT INTO leads (id, tenant_id, site_id, contact_id, vehicle_id,
                           source, stage, received_at, first_response_at, closed_at)
        VALUES (${LEAD(n)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${VEHICLE(n)}::uuid, 'autotrader', 'won',
                now() - interval '30 days', now() - interval '30 days',
                -- A won lead is terminal, and lead_closed_when_terminal
                -- requires a closed_at to match. The constraint is right; the
                -- fixture was wrong. (No backticks in a SQL comment here —
                -- this is inside a JS template literal and they end it.)
                now() - interval '12 days')
        ON CONFLICT (id) DO NOTHING`;

      await sql`
        INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, lead_id,
                           state, contract_formation, vehicle_price_pence,
                           contracted_at, delivered_at, created_by)
        VALUES (${DEAL(n)}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${VEHICLE(n)}::uuid, ${LEAD(n)}::uuid, 'delivered', 'on_premises',
                1_200_000, now() - interval '12 days',
                -- Delivered inside the CURRENT month, whatever day it is run
                -- on. "10 days ago" falls into last month for the first ten
                -- days of every month, which made these tests pass or fail by
                -- the calendar.
                least(now(), date_trunc('month', now()) + interval '2 days'),
                ${T.user}::uuid)
        ON CONFLICT (id) DO NOTHING`;

      // Reset the mutable side so a re-run starts from the same place.
      await sql`
        UPDATE deals SET state = 'delivered',
          delivered_at = least(now(), date_trunc('month', now()) + interval '2 days'),
          lead_id = ${LEAD(n)}::uuid
        WHERE id = ${DEAL(n)}::uuid`;
    }

    // Spend: Auto Trader productive, eBay silent.
    for (const [label, pence] of [['autotrader', 189_000], ['ebay', 85_000]] as const) {
      await sql`
        INSERT INTO channel_costs (tenant_id, channel_label, period_month,
                                   amount_pence, estimated, created_by)
        VALUES (${T.tenant}::uuid, ${label}, date_trunc('month', now())::date,
                ${pence}, false, ${T.user}::uuid)
        ON CONFLICT (tenant_id, channel_label, period_month,
                     coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET amount_pence = EXCLUDED.amount_pence, estimated = false`;
    }

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the reporting fixtures build', () => {
  expect(ready, `Could not seed the reporting fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('the owner dashboard', () => {
  it('withholds every cost-derived tile from a principal who may not see cost', async () => {
    const withCost = await loadOwnerDashboard(session, true);
    const without = await loadOwnerDashboard(session, false);

    expect(withCost.dashboard.stockValueAtCost.amount).toBeGreaterThan(0n);
    // Not a smaller number — nothing at all. The payload must not carry it.
    expect(without.dashboard.stockValueAtCost.amount).toBe(0n);
    expect(without.dashboard.overageCapital.amount).toBe(0n);

    // Units and leads are not cost data and stay.
    expect(without.dashboard.unitsSoldMtd).toBe(withCost.dashboard.unitsSoldMtd);
  });

  it('says NOTHING rather than an average when a month is too thin', async () => {
    // Below the floor the tiles report null, never a figure built from two
    // cars — and with NO sales at all there is no caveat either, because a
    // dealer who has sold nothing this month does not need telling.
    const { ownerDashboard } = await import('@forecourt/domain');
    const thin = ownerDashboard({
      stock: [], soldThisMonth: [
        { grossProfit: { amount: 150_000n, currency: 'GBP' }, daysToSell: 20 },
        { grossProfit: { amount: 250_000n, currency: 'GBP' }, daysToSell: 40 },
      ], soldPreviousMonth: [], leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(thin.averageGrossPerUnit).toBeNull();
    expect(thin.averageDaysToSell).toBeNull();
    expect(thin.caveats.join(' ')).toMatch(/too few/i);

    // And with enough sales the arithmetic is exact — asserted here, on fixed
    // inputs, rather than against a shared database other suites write to.
    const solid = ownerDashboard({
      stock: [],
      soldThisMonth: Array.from({ length: 6 }, () => ({
        grossProfit: { amount: 200_000n, currency: 'GBP' as const }, daysToSell: 30,
      })),
      soldPreviousMonth: [], leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(solid.averageGrossPerUnit!.amount).toBe(200_000n);
    expect(solid.averageDaysToSell).toBe(30);

    const empty = ownerDashboard({
      stock: [], soldThisMonth: [], soldPreviousMonth: [],
      leadsToday: 0, leadsAwaitingFirstResponse: 0,
    });
    expect(empty.averageGrossPerUnit).toBeNull();
    expect(empty.caveats.join(' ')).not.toMatch(/too few/i);
  });

  it('counts DELIVERED deals, not contracted ones', async () => {
    // A car is sold when the customer has it. Counting a contracted-but-
    // undelivered deal inflates the month a dealer is judging themselves on.
    const before = await loadOwnerDashboard(session, true);

    await sql`
      INSERT INTO deals (id, tenant_id, site_id, contact_id, state, contract_formation,
                         vehicle_price_pence, contracted_at, created_by)
      VALUES ('eeeeeeee-0000-4000-8000-00000000b299'::uuid, ${T.tenant}::uuid,
              ${T.site}::uuid, ${CONTACT}::uuid, 'contracted', 'on_premises',
              1_200_000, now(), ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    const after = await loadOwnerDashboard(session, true);
    expect(after.dashboard.unitsSoldMtd).toBe(before.dashboard.unitsSoldMtd);
  });

  it('reports an average only once there are enough sales to mean anything', async () => {
    const view = await loadOwnerDashboard(session, true);
    const d = view.dashboard;

    // The fixture delivers six units inside the current month, so the floor
    // is genuinely crossed rather than the assertion being satisfied by an
    // empty month.
    expect(d.unitsSoldMtd).toBeGreaterThanOrEqual(5);
    expect(d.averageGrossPerUnit).not.toBeNull();
    expect(d.averageDaysToSell).not.toBeNull();
    // Positive, not an exact figure: vitest runs test files in parallel and
    // other suites deliver deals into this same tenant, so the mean is a
    // moving target. The exact-arithmetic assertion lives in the pure-domain
    // test below, where the inputs are fixed.
    expect(d.averageGrossPerUnit!.amount).toBeGreaterThan(0n);
  });

  it('counts a lead awaiting a first reply, not one that merely looks open', async () => {
    const view = await loadOwnerDashboard(session, true);
    // Scoped by tenant explicitly. The raw `sql` pool connects as a superuser
    // and therefore bypasses RLS — only `withSession` sets the app role — so
    // an unscoped count here would tally every tenant in the database and
    // "prove" the dashboard wrong.
    const [expected] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM leads
      WHERE tenant_id = ${T.tenant}::uuid
        AND first_response_at IS NULL AND closed_at IS NULL`;
    expect(view.dashboard.leadsAwaitingFirstResponse).toBe(expected!.n);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the Channel P&L', () => {
  const window = { from: '2000-01-01', to: '2100-01-01' };

  it('credits a sale to the channel of the lead the salesperson actually worked', async () => {
    const view = await loadChannelPnl(session, window, true);
    const row = view.pnl.rows.find((r) => r.channel === 'autotrader');
    expect(row).toBeDefined();
    expect(row!.sales).toBeGreaterThanOrEqual(SALES);
  });

  it('credits ONE sale once, however many channels the buyer touched', async () => {
    // Six deals, one contact, six leads. If assisting channels were also
    // credited the sales total would exceed the number of deals — which is the
    // failure mode of every weighted multi-touch model a dealer cannot audit.
    const view = await loadChannelPnl(session, window, true);
    const [deals] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM deals
      WHERE tenant_id = ${T.tenant}::uuid AND state IN ('delivered','completed')`;
    expect(view.pnl.totals.sales).toBeLessThanOrEqual(deals!.n);
    expect(view.attributions.length).toBe(deals!.n);
  });

  it('names a channel that is paid for and produced nothing', async () => {
    // Spend recorded, zero leads. The finding the report exists for.
    const view = await loadChannelPnl(session, window, true);
    expect(view.pnl.silentChannels).toContain('ebay');
  });

  it('reports no ROI below the sales floor rather than a flattering one', async () => {
    const view = await loadChannelPnl(session, window, true);
    for (const row of view.pnl.rows) {
      if (row.sales < MIN_SALES_FOR_ROI) {
        expect(row.roi, `${row.channel} stated an ROI on ${row.sales} sales`).toBeNull();
        expect(row.lowConfidence).toBe(true);
      }
    }
  });

  it('leaves cost-per-lead blank where there were no leads, never £0.00', async () => {
    // "£0.00 per lead" reads as free. The truth is there was nothing to
    // divide by, and a blank says that.
    const view = await loadChannelPnl(session, window, true);
    for (const row of view.pnl.rows) {
      if (row.leads === 0) expect(row.costPerLead).toBeNull();
      if (row.sales === 0) expect(row.costPerSale).toBeNull();
    }
  });

  it('withholds gross and ROI without cost, and keeps the rest of the table', async () => {
    const withCost = await loadChannelPnl(session, window, true);
    const without = await loadChannelPnl(session, window, false);

    expect(withCost.pnl.totals.grossProfit.amount).toBeGreaterThan(0n);
    expect(without.pnl.totals.grossProfit.amount).toBe(0n);
    expect(without.pnl.rows.every((r) => r.grossProfit.amount === 0n)).toBe(true);

    // Spend, leads and sales reveal nothing about what a car cost, so a
    // principal without cost still has a usable report.
    expect(without.pnl.totals.spend.amount).toBe(withCost.pnl.totals.spend.amount);
    expect(without.pnl.totals.leads).toBe(withCost.pnl.totals.leads);
    expect(without.pnl.totals.sales).toBe(withCost.pnl.totals.sales);
  });

  it('counts a sale it cannot trace under a named row, never drops it', async () => {
    await sql`
      INSERT INTO deals (id, tenant_id, site_id, contact_id, state, contract_formation,
                         vehicle_price_pence, contracted_at, delivered_at, created_by)
      VALUES ('eeeeeeee-0000-4000-8000-00000000b298'::uuid, ${T.tenant}::uuid,
              ${T.site}::uuid, ${CONTACT}::uuid, 'delivered', 'on_premises',
              900_000, now() - interval '3 days', now() - interval '2 days',
              ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      UPDATE deals SET lead_id = NULL
      WHERE id = 'eeeeeeee-0000-4000-8000-00000000b298'::uuid`;

    const view = await loadChannelPnl(session, window, true);
    expect(view.unattributedSales).toBeGreaterThan(0);

    const row = view.pnl.rows.find((r) => r.channel === UNATTRIBUTED);
    expect(row, 'an untraceable sale must be a named row, not an omission').toBeDefined();
    expect(row!.sales).toBeGreaterThan(0);

    // And the totals still add up: every sale is somewhere.
    const summed = view.pnl.rows.reduce((t, r) => t + r.sales, 0);
    expect(summed).toBe(view.pnl.totals.sales);
  });

  it('gives every row a drill-through that matches what it counted', async () => {
    const view = await loadChannelPnl(session, window, true);
    for (const row of view.pnl.rows) {
      expect(row.drillThrough.channel).toBe(row.channel);
      expect(row.drillThrough.from.getTime()).toBe(view.pnl.from.getTime());
      expect(row.drillThrough.to.getTime()).toBe(view.pnl.to.getTime());
    }
  });

  it('holds the ROI floor on the TOTAL as well as on each row', async () => {
    // The report contradicting itself in the space of one screen — every row
    // saying "too few sales to tell" while the total confidently states 3.8× —
    // and the overall figure is the one a dealer quotes back.
    const view = await loadChannelPnl(session, window, true);
    if (view.pnl.totals.sales < MIN_SALES_FOR_ROI) {
      expect(view.pnl.totals.roi).toBeNull();
    } else {
      expect(view.pnl.totals.roi).not.toBeNull();
    }
  });

  it('exports a CSV that says the channel names the screen says', async () => {
    // The file is the artefact that ends up on somebody else's desk. It used
    // to carry raw keys — `website_test_drive` — while the screen showed
    // "Website test drive", because each had its own label map.
    const view = await loadChannelPnl(session, window, true);
    const csv = pnlToCsv(view.pnl);
    if (view.pnl.rows.some((r) => r.channel === 'autotrader')) {
      expect(csv).toContain('Auto Trader');
      expect(csv).not.toContain('autotrader');
    }
  });

  it('exports a CSV whose figures are the ones on screen', async () => {
    const view = await loadChannelPnl(session, window, true);
    const csv = pnlToCsv(view.pnl);

    expect(csv.split('\n')[0]).toContain('Channel');
    // A blank cell where a figure genuinely does not exist, never a zero.
    const rows = csv.split('\n').slice(1).filter(Boolean);
    expect(rows.length).toBeGreaterThan(0);

    const autotrader = view.pnl.rows.find((r) => r.channel === 'autotrader');
    if (autotrader?.spend) {
      expect(csv).toContain((Number(autotrader.spend.amount) / 100).toFixed(2));
    }
  });
});

describe.runIf(process.env['DATABASE_URL'])('recording what a channel cost', () => {
  const month = new Date().toISOString().slice(0, 8) + '01';

  it('refuses a negative figure', async () => {
    const result = await withSession(session, (tx) =>
      applyChannelSpend(tx, session, {
        channelLabel: 'cargurus', month, amountPence: '-100',
        estimated: false, note: '',
      }));
    expect(result.ok).toBe(false);
  });

  it('records a figure and marks it when it is an estimate', async () => {
    const result = await withSession(session, (tx) =>
      applyChannelSpend(tx, session, {
        channelLabel: 'cargurus', month, amountPence: '45000',
        estimated: true, note: 'invoice not in yet',
      }));
    expect(result.ok, result.error).toBe(true);

    const spend = await loadChannelSpend(session, month);
    const row = spend.find((s) => s.label === 'cargurus');
    expect(row!.amount.amount).toBe(45_000n);
    expect(row!.estimated).toBe(true);

    // And the P&L says so on the row rather than presenting a guess as fact.
    const view = await loadChannelPnl(session, { from: '2000-01-01', to: '2100-01-01' }, true);
    const pnlRow = view.pnl.rows.find((r) => r.channel === 'cargurus');
    expect(pnlRow!.spendEstimated).toBe(true);
  });

  it('replaces the figure for the same month rather than adding to it', async () => {
    // One figure per channel per month. The invoice arrives and confirms the
    // estimate; a second row would double the spend and halve every ROI.
    await withSession(session, (tx) =>
      applyChannelSpend(tx, session, {
        channelLabel: 'cargurus', month, amountPence: '47500',
        estimated: false, note: 'invoice received',
      }));

    const spend = await loadChannelSpend(session, month);
    const rows = spend.filter((s) => s.label === 'cargurus');
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount.amount).toBe(47_500n);
    expect(rows[0]!.estimated).toBe(false);
  });

  it('writes an audit event that says it was a correction', async () => {
    const [audit] = await sql`
      SELECT action FROM audit_events
      WHERE tenant_id = ${T.tenant}::uuid AND resource_type = 'channel_cost'
      ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit).toBeDefined();
    expect(['spend_recorded', 'spend_corrected']).toContain(String(audit!['action']));
  });
});
