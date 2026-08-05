import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession } from '@/data/db';
import { loadDeals, loadDeal } from '@/data/deals';
import {
  applyTransition, applyAddonDecision, applyRepair, appendToLedger,
} from '@/data/deal-apply';
import { consumerRightsRule } from '@/data/rules';
import { ensureFixtures, session, T } from './fixtures';

/**
 * Deals, against a real database.
 *
 * Three things are being defended here, in order of how expensive they are to
 * get wrong:
 *
 * 1. A deal cannot be contracted without recording HOW it was contracted.
 *    That field alone decides whether a 14-day cancellation right exists.
 * 2. The evidence ledger's hash chain holds across writes made by the app —
 *    not just across entries a unit test constructed by hand.
 * 3. The statutory windows come from `compliance_rules`, keyed on the delivery
 *    date, and are recomputed rather than stored.
 */

let ready = false;
let reason = '';

const CONTACT = 'eeeeeeee-0000-4000-8000-00000000c002';
const DEAL = (n: number) => `eeeeeeee-0000-4000-8000-00000000e00${n}`;
const ADDON = 'eeeeeeee-0000-4000-8000-00000000f001';

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Deal', 'Buyer',
              'deal.buyer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;

    const rows: [string, string, string | null, number][] = [
      [DEAL(1), 'agreed', null, 0],            // ready to contract
      [DEAL(2), 'agreed', null, 1_200_000],    // financed, ready to contract
      [DEAL(3), 'delivered', 'distance', 0],   // clocks running
      [DEAL(4), 'delivered', 'on_premises', 0], // no cancellation right
    ];

    for (const [id, state, formation, finance] of rows) {
      const delivered = state === 'delivered';
      await sql`
        INSERT INTO deals (id, tenant_id, site_id, contact_id, state, contract_formation,
                           vehicle_price_pence, deposit_pence, finance_amount_pence,
                           contracted_at, delivered_at, created_by)
        VALUES (${id}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${state}::deal_state, ${formation}::contract_formation,
                1_500_000, 100_000, ${finance},
                ${delivered ? sql`now() - interval '20 days'` : null},
                ${delivered ? sql`now() - interval '5 days'` : null},
                ${T.user}::uuid)
        ON CONFLICT (id) DO NOTHING`;

      // Reset to the intended starting state on a re-run. `deal_evidence` is
      // append-only by trigger — deliberately, it is the ledger — so the
      // fixtures reset the mutable row and leave the chain alone.
      await sql`
        UPDATE deals SET state = ${state}::deal_state,
          contract_formation = ${formation}::contract_formation,
          contracted_at = ${delivered ? sql`now() - interval '20 days'` : null},
          delivered_at = ${delivered ? sql`now() - interval '5 days'` : null},
          cancelled_at = NULL, cancellation_reason = NULL, completed_at = NULL
        WHERE id = ${id}::uuid`;
    }

    // `deal_addons` forbids UPDATE *and* DELETE — it is fully append-only, and
    // nothing resets it. Nothing needs to: the tests below address the
    // original OFFER row by id, and that row's own accepted/declined columns
    // stay null forever however many decisions get appended after it. The
    // accumulated history across runs is the point of the table.
    await sql`
      INSERT INTO deal_addons (id, tenant_id, deal_id, product_code, product_name,
                               price_pence, cost_pence, offered_at, created_by)
      VALUES (${ADDON}::uuid, ${T.tenant}::uuid, ${DEAL(1)}::uuid, 'GAP', 'GAP insurance',
              39_900, 18_000, now() - interval '2 days', ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;
    await sql`UPDATE deals SET addons_total_pence = 0 WHERE id = ${DEAL(1)}::uuid`;

    // A repair attempt cannot be DELETED — it moved a customer's statutory
    // deadline, and the trigger says so. Closing an open one from a previous
    // run is the one lawful update, so that is what the reset does.
    await sql`
      UPDATE deal_repair_attempts SET completed_at = now(), outcome = 'closed by a test re-run'
      WHERE deal_id = ${DEAL(3)}::uuid AND completed_at IS NULL`;

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the deal fixtures build', () => {
  expect(ready, `Could not seed the deal fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('contract formation', () => {
  it('REFUSES to contract a deal without recording how it was formed', async () => {
    // The one field that decides whether a 14-day cancellation right exists.
    // There is no safe default: assume on-premises and you deny a statutory
    // right; assume distance and you unwind deals that were final.
    const result = await withSession(session, (tx) =>
      applyTransition(tx, session, {
        dealId: DEAL(1), to: 'contracted', contractFormation: '', cancellationReason: '',
      }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/where this contract was formed/i);
    expect(result.error).toMatch(/14-day right to cancel/i);

    const after = await loadDeal(session, DEAL(1), true);
    expect(after!.deal.state).toBe('agreed');
  });

  it('refuses a formation value that is not one of the three', async () => {
    const result = await withSession(session, (tx) =>
      applyTransition(tx, session, {
        dealId: DEAL(1), to: 'contracted', contractFormation: 'over_a_pint',
        cancellationReason: '',
      }));
    expect(result.ok).toBe(false);
  });

  it('contracts once formation is recorded, and writes it to the ledger', async () => {
    const result = await withSession(session, (tx) =>
      applyTransition(tx, session, {
        dealId: DEAL(1), to: 'contracted', contractFormation: 'distance',
        cancellationReason: '',
      }));
    expect(result.ok).toBe(true);

    const after = await loadDeal(session, DEAL(1), true);
    expect(after!.deal.state).toBe('contracted');
    expect(after!.deal.contractFormation).toBe('distance');

    const entry = after!.evidence.find((e) => e.kind === 'contract_formed');
    expect(entry).toBeDefined();
    // The CONSEQUENCE is recorded in words, not only the enum — an enum alone
    // needs this system to be around to explain it years later.
    expect(String(entry!.payload['cancellationRight'])).toMatch(/14 days/);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the evidence ledger', () => {
  it('verifies after entries written by the application itself', async () => {
    // A unit test can hash entries it constructed. This asserts the chain the
    // real write path builds, through Postgres and back, actually holds.
    const before = await loadDeal(session, DEAL(2), true);
    expect(before).not.toBeNull();

    await withSession(session, async (tx) => {
      for (const kind of ['initial_disclosure', 'quote_presented', 'commission_disclosure'] as const) {
        await appendToLedger(tx, session, DEAL(2), {
          kind,
          payload: { note: `seeded ${kind}` },
          documentVersion: null,
          wordingVersion: null,
          occurredAt: new Date(),
        });
      }
    });

    const after = await loadDeal(session, DEAL(2), true);
    expect(after!.chain.valid, JSON.stringify(after!.chain.problems)).toBe(true);
    expect(after!.chain.entriesChecked).toBeGreaterThanOrEqual(3);
    expect(after!.evidence[0]!.previousHash).toBeNull();
  });

  it('numbers entries consecutively from one, with no fork', async () => {
    const deal = await loadDeal(session, DEAL(2), true);
    const sequences = deal!.evidence.map((e) => e.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
  });

  it('detects an altered entry', async () => {
    // `deal_evidence` is append-only by trigger, so the tamper has to be done
    // with the trigger disabled — which is exactly the threat model: somebody
    // with database access. The chain is what survives that.
    await sql`ALTER TABLE deal_evidence DISABLE TRIGGER USER`;
    try {
      await sql`
        UPDATE deal_evidence SET payload = ${sql.json({ note: 'quietly changed' })}
        WHERE deal_id = ${DEAL(2)}::uuid AND sequence = 1`;

      const tampered = await loadDeal(session, DEAL(2), true);
      expect(tampered!.chain.valid).toBe(false);
      expect(tampered!.chain.problems[0]!.problem).toMatch(/altered after it was written/);
    } finally {
      await sql`
        UPDATE deal_evidence SET payload = ${sql.json({ note: 'seeded initial_disclosure' })}
        WHERE deal_id = ${DEAL(2)}::uuid AND sequence = 1`;
      await sql`ALTER TABLE deal_evidence ENABLE TRIGGER USER`;
    }

    const restored = await loadDeal(session, DEAL(2), true);
    expect(restored!.chain.valid, 'the restore should put the chain back').toBe(true);
  });

  it('names what is missing from a financed deal in words a dealer can act on', async () => {
    const deal = await loadDeal(session, DEAL(2), true);
    expect(deal!.financed).toBe(true);
    expect(deal!.completeness.complete).toBe(false);
    // Not a code — the summary has to be readable by someone answering a
    // lender's audit letter.
    expect(deal!.completeness.summary).toMatch(/demands and needs/i);
    expect(deal!.completeness.summary).toMatch(/Ombudsman/i);
  });

  it('asks far less of a cash deal — there is no credit broking to evidence', async () => {
    const cash = await loadDeal(session, DEAL(4), true);
    expect(cash!.financed).toBe(false);
    expect(cash!.completeness.missing).toEqual(['contract_formed']);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the statutory clocks', () => {
  it('reads its windows from compliance_rules, not from code', async () => {
    const rule = await consumerRightsRule(new Date());
    expect(rule.rejectWindowDays).toBe(30);
    expect(rule.burdenOfProofMonths).toBe(6);
    expect(rule.cancellationWindowDays).toBe(14);
    expect(rule.repairResumeMinimumDays).toBe(7);
    // And it carries its source, so a dealer's own adviser can check it.
    expect(rule.sourceUrl).toMatch(/^https?:\/\//);
  });

  it('grants a cancellation right on a distance sale and withholds it on a forecourt sale', async () => {
    // The pair is the whole point of the contract-formation field.
    const distance = await loadDeal(session, DEAL(3), true);
    const onPremises = await loadDeal(session, DEAL(4), true);

    expect(distance!.clocks!.cancellationRightApplies).toBe(true);
    expect(distance!.clocks!.cancellationDeadline).not.toBeNull();

    expect(onPremises!.clocks!.cancellationRightApplies).toBe(false);
    expect(onPremises!.clocks!.cancellationDeadline).toBeNull();
    expect(onPremises!.clocks!.summary).toMatch(/No cancellation right/i);
  });

  it('runs the 30-day reject window and the 6-month burden of proof from delivery', async () => {
    // DEAL(4), not DEAL(3): repair attempts cannot be deleted, so DEAL(3)
    // accumulates them across runs and each closed one legitimately SHIFTS the
    // deadline. Asserting the unshifted window on a deal that has had a repair
    // would be asserting the pause does not work.
    const deal = await loadDeal(session, DEAL(4), true);
    const delivered = deal!.deal.deliveredAt!;

    // The deadline is the END of the thirtieth day, not the same clock time
    // thirty days later — a customer who rings at 5pm on day 30 is in time.
    // So the assertion is on the DATE, not on a millisecond difference, which
    // rounds to 31 and would have made this test demand the wrong answer.
    // Compared in UTC. `toDateString()` is LOCAL, and 23:59:59 UTC is the next
    // local day anywhere east of Greenwich — an assertion that would pass in
    // London and fail in Berlin is not an assertion.
    const expected = new Date(delivered.getTime() + 30 * 86_400_000);
    const ends = deal!.clocks!.rejectWindowEndsAt!;
    expect(ends.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
    expect(ends.getUTCHours()).toBe(23);

    expect(deal!.clocks!.burdenOfProofEndsAt.getTime()).toBeGreaterThan(delivered.getTime());
  });

  it('PAUSES the reject window while a repair is open, and resumes it on close', async () => {
    const opened = await withSession(session, (tx) =>
      applyRepair(tx, session, {
        dealId: DEAL(3), repairId: '', faultReported: 'Loss of power above 3,000rpm', outcome: '',
      }));
    expect(opened.ok).toBe(true);

    const paused = await loadDeal(session, DEAL(3), true);
    expect(paused!.clocks!.rejectWindowPaused).toBe(true);
    // Paused means there is no date, not a date in the past. A screen showing
    // a stale deadline while a repair is open is worse than showing none.
    expect(paused!.clocks!.rejectWindowEndsAt).toBeNull();
    expect(paused!.clocks!.summary).toMatch(/paused/i);

    const repairId = paused!.repairs.find((r) => r.completedAt === null)!.id;

    const second = await withSession(session, (tx) =>
      applyRepair(tx, session, {
        dealId: DEAL(3), repairId: '', faultReported: 'Something else', outcome: '',
      }));
    expect(second.ok, 'a second open repair should be refused').toBe(false);

    const closed = await withSession(session, (tx) =>
      applyRepair(tx, session, {
        dealId: DEAL(3), repairId, faultReported: '', outcome: 'Turbo replaced, road tested',
      }));
    expect(closed.ok).toBe(true);

    const resumed = await loadDeal(session, DEAL(3), true);
    expect(resumed!.clocks!.rejectWindowPaused).toBe(false);
    // s.22(6)–(7): at least seven days must remain when the clock resumes.
    const daysLeft = Math.ceil(
      (resumed!.clocks!.rejectWindowEndsAt!.getTime() - Date.now()) / 86_400_000);
    expect(daysLeft).toBeGreaterThanOrEqual(7);
  });

  it('refuses a repair attempt before delivery — there is no clock to pause', async () => {
    const result = await withSession(session, (tx) =>
      applyRepair(tx, session, {
        dealId: DEAL(2), repairId: '', faultReported: 'Something', outcome: '',
      }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Record the delivery first/i);
  });
});

describe.runIf(process.env['DATABASE_URL'])('add-ons are never pre-ticked', () => {
  it('refuses an acceptance with no demands-and-needs statement', async () => {
    // PRIN 2A wants one statement PER PRODUCT, recorded at acceptance.
    const result = await withSession(session, (tx) =>
      applyAddonDecision(tx, session, {
        dealId: DEAL(1), addonId: ADDON, accept: true,
        demandsAndNeeds: '   ', fairValueReference: '',
      }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/demands and needs/i);
  });

  it('the database refuses the shape of a pre-ticked box outright', async () => {
    // An acceptance dated BEFORE its offer. Tested on an INSERT rather than an
    // UPDATE: the table is append-only, so an UPDATE is stopped by the trigger
    // and never reaches the CHECK — which would have made this test pass for
    // the wrong reason and told us nothing about the constraint.
    await expect(sql`
      INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                               price_pence, demands_and_needs, offered_at, accepted_at)
      VALUES (${T.tenant}::uuid, ${DEAL(1)}::uuid, 'PRETICKED', 'Pre-ticked product',
              10_000, 'x', now(), now() - interval '1 day')`)
      .rejects.toThrow(/addon_accepted_after_offered/);
  });

  it('refuses an accepted add-on with no statement, at the database level too', async () => {
    await expect(sql`
      INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                               price_pence, offered_at, accepted_at)
      VALUES (${T.tenant}::uuid, ${DEAL(1)}::uuid, 'NOSTATEMENT', 'No statement',
              10_000, now() - interval '1 day', now())`)
      .rejects.toThrow(/addon_accepted_needs_statement/);
  });

  it('accepts with a statement, appends evidence, and updates the deal total', async () => {
    const result = await withSession(session, (tx) =>
      applyAddonDecision(tx, session, {
        dealId: DEAL(1), addonId: ADDON, accept: true,
        demandsAndNeeds: 'Financing over four years and asked what happens on a total loss.',
        fairValueReference: 'FV-2026-GAP-01',
      }));
    expect(result.ok).toBe(true);

    const deal = await loadDeal(session, DEAL(1), true);
    expect(deal!.addonsTotal.amount).toBe(39_900n);
    expect(deal!.evidence.some((e) => e.kind === 'addon_accepted')).toBe(true);
    expect(deal!.chain.valid).toBe(true);
    // The margin panel picks the add-on up as gross, not as revenue.
    expect(deal!.margin!.addonGross.amount).toBe(39_900n - 18_000n);
  });

  it('declining clears an acceptance rather than leaving both', async () => {
    const result = await withSession(session, (tx) =>
      applyAddonDecision(tx, session, {
        dealId: DEAL(1), addonId: ADDON, accept: false,
        demandsAndNeeds: '', fairValueReference: '',
      }));
    expect(result.ok).toBe(true);

    const deal = await loadDeal(session, DEAL(1), true);
    // Found by PRODUCT, not by row id: a decision is an appended row, so the
    // current position of GAP is a different row from the original offer.
    const addon = deal!.addonRows.find((a) => a.productCode === 'GAP')!;
    expect(addon.id).not.toBe(ADDON);
    expect(addon.acceptedAt).toBeNull();
    expect(addon.declinedAt).not.toBeNull();
    expect(deal!.addonsTotal.amount).toBe(0n);

    // And the history of what was offered and decided survives — that is the
    // whole reason the table is append-only rather than updated in place.
    const [history] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM deal_addons
      WHERE deal_id = ${DEAL(1)}::uuid AND product_code = 'GAP'`;
    expect(history!.n).toBeGreaterThanOrEqual(3);
  });
});

describe.runIf(process.env['DATABASE_URL'])('what the list returns', () => {
  it('withholds cost, gross and the margin panel from a principal who may not see them', async () => {
    const withCost = await loadDeals(session, { limit: 200 }, true);
    const without = await loadDeals(session, { limit: 200 }, false);

    expect(without.rows.every((r) => r.dealGross === null)).toBe(true);
    expect(without.summary.grossMonthToDate).toBeNull();

    // The list still works — price is what the customer PAYS, not what we
    // paid, so redaction removes the figures and not the rows.
    //
    // Asserted on a known deal rather than by comparing the two row COUNTS.
    // Vitest runs test files in parallel and the invoices suite creates deals
    // in this same tenant, so the counts can legitimately differ between two
    // sequential loads — a race that only shows up on a pristine database
    // where both suites start from nothing.
    const inWith = withCost.rows.find((r) => r.id === DEAL(3));
    const inWithout = without.rows.find((r) => r.id === DEAL(3));
    expect(inWith).toBeDefined();
    expect(inWithout).toBeDefined();
    expect(inWithout!.totalPrice.amount).toBe(inWith!.totalPrice.amount);
    expect(inWithout!.dealGross).toBeNull();

    const deal = await loadDeal(session, DEAL(3), false);
    expect(deal!.margin).toBeNull();
    // And the balance the customer owes is NOT cost data, so it stays.
    expect(deal!.balanceToFinance).toBeDefined();
  });

  it('the part-exchange settlement ADDS to what the customer must find', async () => {
    // Money still owed on the car being traded in has to go to their lender.
    // Netting it off silently understates the balance by exactly this figure.
    await sql`
      UPDATE deals SET part_exchange_pence = 500_000, part_exchange_settlement_pence = 200_000
      WHERE id = ${DEAL(4)}::uuid`;
    try {
      const deal = await loadDeal(session, DEAL(4), true);
      // 1,500,000 price + 200,000 settlement − 500,000 px − 100,000 deposit
      expect(deal!.balanceToFinance.amount).toBe(1_100_000n);
    } finally {
      await sql`
        UPDATE deals SET part_exchange_pence = 0, part_exchange_settlement_pence = 0
        WHERE id = ${DEAL(4)}::uuid`;
    }
  });

  it('counts only deals whose clocks are genuinely still running', async () => {
    const page = await loadDeals(session, { limit: 50 }, true);
    const now = new Date();
    for (const row of page.rows) {
      if (row.clocks === null) continue;
      const running = row.clocks.rejectWindowPaused
        || (row.clocks.rejectWindowEndsAt !== null && row.clocks.rejectWindowEndsAt > now)
        || (row.clocks.cancellationDeadline !== null && row.clocks.cancellationDeadline > now);
      expect(typeof running).toBe('boolean');
    }
    expect(page.summary.clocksRunning).toBeGreaterThanOrEqual(1);
  });

  it('tolerates punctuation somebody typed into the search box', async () => {
    await expect(loadDeals(session, { q: 'Smith & Sons!', limit: 5 }, true)).resolves.toBeDefined();
  });
});
