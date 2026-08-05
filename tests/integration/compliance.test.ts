import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/data/db';
import { loadComplianceCentre } from '@/data/compliance';
import { ensureFixtures, session, T } from './fixtures';

/**
 * The compliance centre, against a real database.
 *
 * What is being defended:
 *
 * 1. The DISP clock runs from RECEIPT, and a complaint answered in time never
 *    later turns red.
 * 2. The 72-hour clock runs from AWARENESS, and an unassessed Article 34 risk
 *    is a finding rather than a low-risk answer.
 * 3. Every statement carries a source citation. §27.4: a dealer's own adviser
 *    has to be able to check our reading.
 * 4. The score never counts an unassessable area as a pass, and states no
 *    figure at all below the floor.
 */

let ready = false;
let reason = '';

const CONTACT = 'eeeeeeee-0000-4000-8000-00000000c005';
const CMP = (n: number) => `eeeeeeee-0000-4000-8000-0000000f000${n}`;
const BRE = (n: number) => `eeeeeeee-0000-4000-8000-0000000f001${n}`;
const REG = (n: number) => `eeeeeeee-0000-4000-8000-0000000f002${n}`;

beforeAll(async () => {
  try {
    await ensureFixtures();

    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email)
      VALUES (${CONTACT}::uuid, ${T.tenant}::uuid, 'individual', 'Complaint', 'Buyer',
              'complaint.buyer@example.co.uk')
      ON CONFLICT (id) DO NOTHING`;

    // 1: received 70 days ago, unanswered — past the eight weeks.
    await sql`
      INSERT INTO complaints (id, tenant_id, contact_id, summary, status, received_at,
                              acknowledged_at, fos_rights_given, created_by)
      VALUES (${CMP(1)}::uuid, ${T.tenant}::uuid, ${CONTACT}::uuid,
              'Breached: no final response inside eight weeks.', 'investigating',
              now() - interval '70 days', now() - interval '69 days', false, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // 2: answered in week six. Must never later become "breached".
    await sql`
      INSERT INTO complaints (id, tenant_id, contact_id, summary, status, received_at,
                              acknowledged_at, final_response_at, outcome,
                              fos_rights_given, created_by)
      VALUES (${CMP(2)}::uuid, ${T.tenant}::uuid, ${CONTACT}::uuid,
              'Answered in week six, long ago.', 'final_response_sent',
              now() - interval '200 days', now() - interval '199 days',
              now() - interval '158 days', 'not_upheld', true, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // 3: an unassessed Article 34 risk.
    await sql`
      INSERT INTO data_breaches (id, tenant_id, summary, status, became_aware_at, created_by)
      VALUES (${BRE(1)}::uuid, ${T.tenant}::uuid,
              'Laptop taken; encryption not confirmed.', 'assessing',
              now() - interval '5 days', ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // 4: assessed high risk, nobody told.
    await sql`
      INSERT INTO data_breaches (id, tenant_id, summary, status, became_aware_at,
                                 reported_to_ico_at, ico_reference,
                                 high_risk, created_by)
      VALUES (${BRE(2)}::uuid, ${T.tenant}::uuid,
              'Finance applications emailed to the wrong lender.', 'reported_to_ico',
              now() - interval '10 days', now() - interval '10 days', 'ICO-TEST-1',
              true, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // Reset the assessment explicitly. ON CONFLICT DO NOTHING leaves an
    // earlier run's row untouched, and rolling migration 0021 back DROPS the
    // column — which is exactly what its down migration warns about, and
    // which turned this fixture's `true` into NULL between two runs.
    await sql`
      UPDATE data_breaches SET high_risk = true, high_risk_reason = NULL,
        subjects_notified_at = NULL
      WHERE id = ${BRE(2)}::uuid`;
    await sql`
      UPDATE data_breaches SET high_risk = NULL, high_risk_reason = NULL
      WHERE id = ${BRE(1)}::uuid`;

    await sql`
      INSERT INTO compliance_registers (id, tenant_id, kind, description, expires_on, created_by)
      VALUES (${REG(1)}::uuid, ${T.tenant}::uuid, 'motor_trade_insurance',
              'Road risk policy', current_date - 12, ${T.user}::uuid),
             (${REG(2)}::uuid, ${T.tenant}::uuid, 'trade_plate',
              'Trade plate', current_date + 18, ${T.user}::uuid),
             (${REG(3)}::uuid, ${T.tenant}::uuid, 'aml_policy',
              'AML policy', NULL, ${T.user}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  await sql.end();
});

it('the compliance fixtures build', () => {
  expect(ready, `Could not seed the compliance fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('the complaint clock', () => {
  it('breaches at eight weeks from RECEIPT, not from when it was logged', async () => {
    const view = await loadComplianceCentre(session);
    const row = view.complaints.find((c) => c.id === CMP(1));
    expect(row).toBeDefined();
    expect(row!.clock.breached).toBe(true);
    expect(row!.clock.statements.map((s) => s.code)).toContain('disp_final_response_late');
  });

  it('a complaint answered in time never later turns red', async () => {
    // Measured against the RESPONSE, not against now. Otherwise every properly
    // handled complaint goes red a month later, which is how a dashboard
    // trains its user to ignore it.
    const view = await loadComplianceCentre(session);
    const row = view.complaints.find((c) => c.id === CMP(2));
    expect(row!.clock.answered).toBe(true);
    expect(row!.clock.breached).toBe(false);
    expect(row!.clock.statements).toEqual([]);
  });
});

describe.runIf(process.env['DATABASE_URL'])('the 72-hour breach clock', () => {
  it('names an unassessed Article 34 risk instead of treating it as low', async () => {
    // The state that was invisible until migration 0021: the schema had no
    // column for the assessment, so every breach evaluated as low risk and
    // the "these people have not been told" statement could never fire.
    const view = await loadComplianceCentre(session);
    const row = view.breaches.find((b) => b.id === BRE(1));
    expect(row!.highRisk).toBeNull();
    expect(row!.clock.statements.map((s) => s.code)).toContain('breach_risk_not_assessed');
  });

  it('flags a high-risk breach where the people affected were not told', async () => {
    const view = await loadComplianceCentre(session);
    const row = view.breaches.find((b) => b.id === BRE(2));
    expect(row!.highRisk).toBe(true);
    expect(row!.clock.statements.map((s) => s.code)).toContain('breach_subjects_not_notified');
  });

  it('the database refuses a low-risk decision with no justification', async () => {
    // Deciding a breach is NOT high risk is a decision with a reason, exactly
    // as the Article 33 not-reportable decision is. Never a silence.
    await expect(sql`
      INSERT INTO data_breaches (tenant_id, summary, status, became_aware_at, high_risk)
      VALUES (${T.tenant}::uuid, 'No justification', 'assessing', now(), false)`)
      .rejects.toThrow(/breach_low_risk_has_reason/);
  });
});

describe.runIf(process.env['DATABASE_URL'])('registers', () => {
  it('separates expired, expiring and no-expiry rather than lumping them', async () => {
    const view = await loadComplianceCentre(session);
    const byId = new Map(view.registers.map((r) => [r.entry.id, r]));

    expect(byId.get(REG(1))!.state).toBe('expired');
    expect(byId.get(REG(2))!.state).toBe('expiring');
    // No expiry is NOT "valid" — nothing was recorded, and saying valid would
    // be the screen inventing an answer.
    expect(byId.get(REG(3))!.state).toBe('no_expiry');
    expect(byId.get(REG(3))!.statement).toBeNull();
  });
});

describe.runIf(process.env['DATABASE_URL'])('every statement is checkable', () => {
  it('carries a citation with a real URL and a reference', async () => {
    // §27.4. A compliance claim without a source is an assertion we are not
    // entitled to make about somebody else's regulatory position.
    const view = await loadComplianceCentre(session);

    const all = [
      ...view.complaints.flatMap((c) => c.clock.statements),
      ...view.breaches.flatMap((b) => b.clock.statements),
      ...view.registers.map((r) => r.statement).filter((s) => s !== null),
      ...view.gaps.map((g) => g.statement).filter((s) => s !== null),
    ];
    expect(all.length).toBeGreaterThan(0);

    for (const s of all) {
      expect(s.citation.url, s.code).toMatch(/^https?:\/\//);
      expect(s.citation.reference.length, s.code).toBeGreaterThan(0);
      expect(s.disclaimer.length, s.code).toBeGreaterThan(0);
    }
  });
});

describe.runIf(process.env['DATABASE_URL'])('the score', () => {
  it('never counts an unassessable area as a pass', async () => {
    const view = await loadComplianceCentre(session);

    for (const area of view.score.areas) {
      if (area.unknown || area.checked === 0) {
        // Named, and out of the fraction. Not silently passing.
        expect(view.score.unassessed).toContain(area.label);
        expect(area.passing).toBeLessThanOrEqual(area.checked);
      }
    }

    // And the fraction is only over the assessable areas.
    const assessable = view.score.areas.filter((a) => !a.unknown && a.checked > 0);
    if (assessable.length >= 3) {
      const checked = assessable.reduce((t, a) => t + a.checked, 0);
      const passing = assessable.reduce((t, a) => t + a.passing, 0);
      expect(view.score.score).toBe(Math.round((passing / checked) * 100));
    } else {
      expect(view.score.score).toBeNull();
      expect(view.score.summary).toMatch(/too few|set up/i);
    }
  });

  it('carries the disclaimer with the score, not in a footer', async () => {
    const view = await loadComplianceCentre(session);
    expect(view.score.disclaimer.length).toBeGreaterThan(0);
  });

  it('counts a cash deal as having nothing missing, not as incomplete', async () => {
    // A cash sale has no finance evidence to be missing. Flagging one trains
    // the dealer to ignore the list.
    const view = await loadComplianceCentre(session);
    const [cash] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM deals
      WHERE tenant_id = ${T.tenant}::uuid
        AND state IN ('contracted','delivered','completed')
        AND finance_amount_pence = 0`;

    // None of the gaps belongs to a cash deal.
    const gapIds = view.gaps.map((g) => g.dealId);
    if (gapIds.length > 0 && cash!.n > 0) {
      const [cashInGaps] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM deals
        WHERE id = ANY(${gapIds}::uuid[]) AND finance_amount_pence = 0`;
      expect(cashInGaps!.n).toBe(0);
    }
  });
});
