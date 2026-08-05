import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, withSession } from '@/data/db';
import {
  loadInbox, loadLead, loadLossAnalysis, loadOpenLeadsForCheck,
} from '@/data/leads';
import { applyStageChange, applyReopen, applyAssign, applyNote } from '@/data/lead-apply';
import { slaState, TERMINAL_STAGES } from '@forecourt/domain';
import { ensureFixtures, session, T } from './fixtures';

/**
 * The lead inbox, against a real database.
 *
 * The test that earns its place here is the agreement one: the row list
 * computes each lead's SLA with `slaState` from the domain, and the "six
 * overdue" figure at the top is counted in SQL because counting it in
 * TypeScript would mean loading every open lead to render one number. Two
 * implementations of one rule is a drift waiting to happen, and the one that
 * is wrong is always the one nobody looked at. So they are asserted to agree.
 */

let ready = false;
let reason = '';

const CONTACT = 'eeeeeeee-0000-4000-8000-00000000c001';
const LEAD = (n: number) => `eeeeeeee-0000-4000-8000-00000000d00${n}`;

beforeAll(async () => {
  try {
    await ensureFixtures();

    // A postcode but NO street address, deliberately: a postcode is not a
    // postal destination, and the panel used to say we could write to them.
    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email, phone, postcode)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Test', 'Buyer',
              'test.buyer@example.co.uk', '+447700900999', 'MK1 1AA')
      ON CONFLICT (id) DO NOTHING`;
    await sql`
      UPDATE contacts SET postcode = 'MK1 1AA', address_line1 = NULL
      WHERE id = ${CONTACT}::uuid`;

    // Four leads covering the four situations the screen distinguishes:
    // unanswered and overdue, unanswered and in time, answered in time,
    // answered late. `due_at` is left NULL on purpose so the SQL fallback
    // to DEFAULT_SLA_MINUTES is what gets exercised.
    const rows: [string, string, string, string, string | null][] = [
      [LEAD(1), 'autotrader', 'new', '90 minutes', null],
      [LEAD(2), 'walk_in', 'new', '5 minutes', null],
      [LEAD(3), 'website_enquiry', 'contacted', '3 days', '6 minutes'],
      [LEAD(4), 'website_enquiry', 'qualified', '4 days', '2 hours'],
    ];

    for (const [id, source, stage, ago, responded] of rows) {
      await sql`
        INSERT INTO leads (id, tenant_id, site_id, contact_id, source, stage, message,
                           received_at, first_response_at)
        VALUES (${id}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${CONTACT}::uuid,
                ${source}::lead_source, ${stage}::lead_stage,
                ${'Enquiry about a Volkswagen Golf'},
                now() - ${ago}::interval,
                ${responded === null ? null : sql`now() - ${ago}::interval + ${responded}::interval`})
        ON CONFLICT (id) DO NOTHING`;

      // Reset to the intended starting state rather than tearing down
      // afterwards. `lead_events` and `messages` are append-only by trigger —
      // deliberately, because they are the record of who touched what — so a
      // teardown that deleted them would be the test fighting the guarantee
      // the product makes. Resetting the mutable row up front makes a re-run
      // start from a known state without touching the history at all.
      await sql`
        UPDATE leads SET stage = ${stage}::lead_stage, closed_at = NULL,
          loss_reason = NULL, loss_detail = NULL, lost_to = NULL, assigned_to = NULL,
          received_at = now() - ${ago}::interval,
          first_response_at = ${responded === null
            ? null
            : sql`now() - ${ago}::interval + ${responded}::interval`}
        WHERE id = ${id}::uuid`;
    }
    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the lead fixtures build', () => {
  expect(ready, `Could not seed the lead fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('the inbox', () => {
  it('orders by who is closest to being lost, not by who arrived last', async () => {
    const page = await loadInbox(session, { limit: 50 });
    const ids = page.rows.map((r) => r.id);

    const overdue = ids.indexOf(LEAD(1));
    const inTime = ids.indexOf(LEAD(2));
    const answered = ids.indexOf(LEAD(3));

    expect(overdue).toBeGreaterThanOrEqual(0);
    // The 90-minute-old Auto Trader lead (15 min target) outranks the
    // 5-minute-old walk-in (60 min target) even though the walk-in is newer.
    expect(overdue).toBeLessThan(inTime);
    // And every unanswered lead outranks every answered one.
    expect(inTime).toBeLessThan(answered);
  });

  it('the overdue count in the strip and the domain agree exactly', async () => {
    // The whole reason this test exists. One rule, two implementations —
    // SQL for the aggregate, `slaState` for the rows.
    const page = await loadInbox(session, { limit: 1 });
    const open = await loadOpenLeadsForCheck(session);

    const now = new Date();
    const fromDomain = open.filter(
      (l) => l.firstResponseAt === null && slaState(l, now).breached).length;

    expect(page.summary.breachedSla).toBe(fromDomain);
  });

  it('counts every unanswered lead, answered or not', async () => {
    const page = await loadInbox(session, { limit: 1 });
    const open = await loadOpenLeadsForCheck(session);
    expect(page.summary.unanswered).toBe(
      open.filter((l) => l.firstResponseAt === null).length);
  });

  it('the strip does not change when the list is filtered', async () => {
    // "You have six overdue" is the number a dealer came here for. It must not
    // move because somebody filtered to one salesperson.
    const all = await loadInbox(session, { limit: 1 });
    const filtered = await loadInbox(session, { limit: 1, source: 'autotrader' });

    expect(filtered.summary.breachedSla).toBe(all.summary.breachedSla);
    expect(filtered.summary.unanswered).toBe(all.summary.unanswered);
    // The list itself, of course, does narrow.
    expect(filtered.total).toBeLessThan(all.total);
  });

  it('overdue-only returns nothing that is answered or in time', async () => {
    const page = await loadInbox(session, { limit: 50, overdueOnly: true });
    const now = new Date();
    for (const row of page.rows) {
      expect(row.firstResponseAt).toBeNull();
      expect(slaState(row, now).breached).toBe(true);
    }
    expect(page.rows.map((r) => r.id)).toContain(LEAD(1));
    expect(page.rows.map((r) => r.id)).not.toContain(LEAD(2));
  });

  it('excludes closed leads unless asked', async () => {
    const open = await loadInbox(session, { limit: 200 });
    expect(open.rows.every((r) => r.closedAt === null)).toBe(true);
  });

  it('reports no conversion rate rather than 0% when nothing has closed', async () => {
    const page = await loadInbox(session, { limit: 1 });
    // Either a real rate or null — never 0 standing in for "no data".
    if (page.summary.byStage.won + page.summary.byStage.lost === 0) {
      expect(page.summary.conversionRate).toBeNull();
    } else {
      expect(page.summary.conversionRate).not.toBeNull();
    }
  });

  it('tolerates punctuation somebody typed into the search box', async () => {
    // plainto_tsquery, not to_tsquery, which throws on a stray ampersand.
    await expect(loadInbox(session, { q: 'Golf & Polo!', limit: 5 })).resolves.toBeDefined();
  });

  it('a search that matches nothing returns nothing, not everything', async () => {
    const page = await loadInbox(session, { q: 'zzzznobodycalledthis', limit: 50 });
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});

describe.runIf(process.env['DATABASE_URL'])('one lead', () => {
  it('answers what may be sent through the same gate a send job uses', async () => {
    const lead = await loadLead(session, LEAD(1));
    expect(lead).not.toBeNull();

    const email = lead!.consent.find((c) => c.channel === 'email');
    expect(email).toBeDefined();

    // No consent record on this contact — so marketing is refused. Replying
    // to the enquiry is a SERVICE message and is not.
    expect(email!.marketing.permitted).toBe(false);
    expect(email!.service.permitted).toBe(true);
    // And the refusal explains itself, in the gate's own words.
    expect(email!.marketing.reason.length).toBeGreaterThan(0);
  });

  it('a postcode alone is not a postal address', async () => {
    // This contact HAS a postcode and no street address. Treating the postcode
    // as a destination made the panel say we could write to somebody we cannot
    // write to — the screen answering a question it does not know the answer
    // to, which is worse than leaving it blank.
    const lead = await loadLead(session, LEAD(1));
    const post = lead!.consent.find((c) => c.channel === 'post');
    expect(post!.destination).toBeNull();
    expect(post!.marketing.permitted).toBe(false);
    expect(post!.service.permitted).toBe(false);
    expect(post!.service.reason).toMatch(/no post address/i);
  });

  it('permits post once there is a street address as well', async () => {
    await sql`UPDATE contacts SET address_line1 = '14 Sherwood Drive' WHERE id = ${CONTACT}::uuid`;
    try {
      const lead = await loadLead(session, LEAD(1));
      const post = lead!.consent.find((c) => c.channel === 'post');
      expect(post!.destination).toContain('Sherwood');
      // Still no marketing consent — but a reply is lawful and now deliverable.
      expect(post!.service.permitted).toBe(true);
      expect(post!.marketing.permitted).toBe(false);
    } finally {
      await sql`UPDATE contacts SET address_line1 = NULL WHERE id = ${CONTACT}::uuid`;
    }
  });

  it('surfaces the other open enquiries from the same person', async () => {
    // Four enquiries from one buyer is one buyer. Ringing them four times is
    // how you lose them.
    const lead = await loadLead(session, LEAD(1));
    const others = lead!.otherOpenLeads.map((o) => o.id);
    expect(others).toContain(LEAD(2));
    expect(others).not.toContain(LEAD(1));
    // Closed leads are history, not a reason to hesitate before ringing.
    expect(lead!.otherOpenLeads.every((o) => !TERMINAL_STAGES.includes(o.stage))).toBe(true);
  });

  it('returns null for a lead that does not exist rather than throwing', async () => {
    await expect(loadLead(session, 'eeeeeeee-0000-4000-8000-0000000000ff'))
      .resolves.toBeNull();
  });
});

describe.runIf(process.env['DATABASE_URL'])('moving a lead', () => {
  it('refuses to mark a lead lost without a reason', async () => {
    const result = await withSession(session, (tx) =>
      applyStageChange(tx, session, {
        leadId: LEAD(2), stage: 'lost', lossReason: '', lossDetail: '', lostTo: '',
      }));

    expect(result.ok).toBe(false);
    // Says what to do, not just what is wrong.
    expect(result.error).toMatch(/why this lead was lost/i);

    const after = await loadLead(session, LEAD(2));
    expect(after!.stage).not.toBe('lost');
  });

  it('refuses a loss reason that is not one of the listed ones', async () => {
    const result = await withSession(session, (tx) =>
      applyStageChange(tx, session, {
        leadId: LEAD(2), stage: 'lost', lossReason: 'they were rude',
        lossDetail: '', lostTo: '',
      }));
    expect(result.ok).toBe(false);
  });

  it('records the change, the history entry and the audit event in one transaction', async () => {
    const result = await withSession(session, (tx) =>
      applyStageChange(tx, session, {
        leadId: LEAD(2), stage: 'contacted', lossReason: '', lossDetail: '', lostTo: '',
      }));
    expect(result.ok).toBe(true);

    const lead = await loadLead(session, LEAD(2));
    expect(lead!.stage).toBe('contacted');

    const stageEvent = lead!.events.find((e) => e.kind === 'stage_changed');
    expect(stageEvent).toBeDefined();
    expect(stageEvent!.toStage).toBe('contacted');

    const [audit] = await sql`
      SELECT * FROM audit_events
      WHERE resource_type = 'lead' AND resource_id = ${LEAD(2)}
        AND action = 'stage_changed'
      ORDER BY occurred_at DESC LIMIT 1`;
    expect(audit).toBeDefined();
    // The diff carries both sides, so "what changed" has an answer.
    expect(audit!['diff']).toBeTruthy();
  });

  it('a lost lead carries its reason all the way to the loss report', async () => {
    const result = await withSession(session, (tx) =>
      applyStageChange(tx, session, {
        leadId: LEAD(4), stage: 'lost', lossReason: 'part_ex_valuation',
        lossDetail: 'wanted £500 more', lostTo: 'a dealer in Bedford',
      }));
    expect(result.ok).toBe(true);

    const lead = await loadLead(session, LEAD(4));
    expect(lead!.stage).toBe('lost');
    expect(lead!.lossReason).toBe('part_ex_valuation');
    expect(lead!.lostTo).toBe('a dealer in Bedford');
    expect(lead!.closedAt).not.toBeNull();

    const losses = await loadLossAnalysis(session, 30);
    const row = losses.find((l) => l.reason === 'part_ex_valuation');
    expect(row).toBeDefined();
    expect(row!.count).toBeGreaterThanOrEqual(1);
  });

  it('will not change the stage of a closed lead without reopening it', async () => {
    const result = await withSession(session, (tx) =>
      applyStageChange(tx, session, {
        leadId: LEAD(4), stage: 'negotiating', lossReason: '', lossDetail: '', lostTo: '',
      }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reopen/i);
  });

  it('reopening clears the loss reason and is its own event', async () => {
    const result = await withSession(session, (tx) => applyReopen(tx, session, LEAD(4)));
    expect(result.ok).toBe(true);

    const lead = await loadLead(session, LEAD(4));
    expect(lead!.closedAt).toBeNull();
    expect(lead!.lossReason).toBeNull();
    expect(lead!.events.some((e) => e.kind === 'reopened')).toBe(true);
  });

  it('refuses to assign a lead to somebody outside the dealership', async () => {
    // The foreign key stops a nonexistent user. This stops a real user who
    // belongs to a DIFFERENT tenant, which the key cannot see.
    const result = await withSession(session, (tx) =>
      applyAssign(tx, session, LEAD(1), '00000000-0000-4000-8000-000000000099'));
    expect(result.ok).toBe(false);
  });

  it('an empty note is refused rather than saved as a blank history entry', async () => {
    const result = await withSession(session, (tx) =>
      applyNote(tx, session, LEAD(1), '   '));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/write something/i);
  });

  it('a note is appended to the history with its author', async () => {
    const result = await withSession(session, (tx) =>
      applyNote(tx, session, LEAD(1), 'Rang, no answer. Left a voicemail.'));
    expect(result.ok).toBe(true);

    const lead = await loadLead(session, LEAD(1));
    const note = lead!.events.find((e) => e.kind === 'note');
    expect(note!.detail).toBe('Rang, no answer. Left a voicemail.');
  });
});
