import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  COMPLIANCE_DISCLAIMER, SOURCES, statement,
  complaintClock, DISP_FINAL_RESPONSE_DAYS,
  breachClock, ICO_NOTIFY_HOURS,
  registerStatus, RENEWAL_WARNING_DAYS,
  evidenceGaps, EXPECTED_EVIDENCE,
  complianceScore, MIN_AREAS_FOR_SCORE, collectStatements,
  type ScoreArea, type RegisterEntry,
} from './compliance-centre.js';

const DAY = 86_400_000;
const AT = (dayOffset: number, hours = 0): Date =>
  new Date(Date.UTC(2026, 7, 5, 0, 0, 0) + dayOffset * DAY + hours * 3_600_000);

// ============================================ the citation gate

describe('every compliance statement cites its source', () => {
  it('cannot be built without a citation', () => {
    // The structural argument, same as M8's ApprovedPromotion: there is no
    // path to a screen that asserts a regulatory position without saying
    // where it came from.
    const s = statement('x', 'Something is wrong.', SOURCES.dispFinalResponse);
    expect(s.citation.reference).toBe('DISP 1.6.2R');
    expect(s.citation.url).toMatch(/^https:\/\//);
    expect(s.citation.summary.length).toBeGreaterThan(30);
  });

  it('carries the disclaimer with it', () => {
    // §27.4: mandatory and prominent. It travels with the finding rather than
    // living in a footer somebody can forget to render.
    expect(statement('x', 'y', SOURCES.dispFinalResponse).disclaimer)
      .toBe(COMPLIANCE_DISCLAIMER);
  });

  it('the disclaimer says what we are and are not', () => {
    expect(COMPLIANCE_DISCLAIMER).toMatch(/not legal or regulatory advice/);
    expect(COMPLIANCE_DISCLAIMER).toMatch(/You remain responsible/);
    expect(COMPLIANCE_DISCLAIMER).toMatch(/your adviser can check our interpretation/);
  });

  it('every source has a reference, a real URL and a summary', () => {
    for (const [key, source] of Object.entries(SOURCES)) {
      expect(source.reference.length, key).toBeGreaterThan(3);
      expect(source.url, key).toMatch(/^https:\/\//);
      expect(source.summary.length, key).toBeGreaterThan(30);
    }
  });

  it('every statement any rule produces carries a citation', () => {
    const everything = collectStatements([
      complaintClock({
        receivedAt: AT(-70), finalResponseAt: null, acknowledgedAt: null,
        fosRightsGiven: false, asAt: AT(0),
      }),
      breachClock({
        becameAwareAt: AT(-5), reportedToIcoAt: null, notReportableReason: null,
        subjectsNotifiedAt: null, highRisk: true, asAt: AT(0),
      }),
    ]);

    expect(everything.length).toBeGreaterThan(2);
    for (const s of everything) {
      expect(s.citation.reference, s.code).toBeTruthy();
      expect(s.disclaimer, s.code).toBe(COMPLIANCE_DISCLAIMER);
    }
  });
});

// ============================================ DISP

describe('the DISP final-response clock', () => {
  const complaint = (over: Partial<Parameters<typeof complaintClock>[0]> = {}) =>
    complaintClock({
      receivedAt: AT(-10), finalResponseAt: null, acknowledgedAt: AT(-9),
      fosRightsGiven: false, asAt: AT(0), ...over,
    });

  it('runs eight weeks from when the complaint was RECEIVED', () => {
    // Not from when somebody got round to logging it. A complaint made on the
    // forecourt on Saturday and entered on Tuesday is already three days old,
    // and the deadline does not care which date is in our database.
    const clock = complaint();
    expect(clock.finalResponseDueAt.getTime())
      .toBe(AT(-10).getTime() + DISP_FINAL_RESPONSE_DAYS * DAY);
  });

  it('is not breached inside the window', () => {
    expect(complaint().breached).toBe(false);
  });

  it('IS breached once eight weeks pass with no response', () => {
    const clock = complaint({ receivedAt: AT(-70) });
    expect(clock.breached).toBe(true);
    expect(clock.statements.some((s) => s.code === 'disp_final_response_late')).toBe(true);
    expect(clock.statements[0]!.message).toMatch(/can go to the Financial Ombudsman now/);
  });

  it('a complaint ANSWERED in week six does not become breached in week nine', () => {
    // Measured against the response where one exists. Otherwise every properly
    // handled complaint turns red a month later.
    const clock = complaint({
      receivedAt: AT(-70), finalResponseAt: AT(-30), fosRightsGiven: true,
    });
    expect(clock.answered).toBe(true);
    expect(clock.breached).toBe(false);
  });

  it('a response sent LATE is reported as late even though it was sent', () => {
    const clock = complaint({
      receivedAt: AT(-90), finalResponseAt: AT(-10), fosRightsGiven: true,
    });
    expect(clock.breached).toBe(true);
    expect(clock.statements[0]!.message).toMatch(/days after the eight-week deadline/);
  });

  it('warns before the deadline, not after', () => {
    const clock = complaint({ receivedAt: AT(-(DISP_FINAL_RESPONSE_DAYS - 5)) });
    expect(clock.approaching).toBe(true);
    expect(clock.statements.some((s) => s.code === 'disp_final_response_due')).toBe(true);
  });

  it('a final response without FOS rights is not a compliant final response', () => {
    const clock = complaint({ finalResponseAt: AT(-1), fosRightsGiven: false });
    const problem = clock.statements.find((s) => s.code === 'disp_fos_rights_missing');
    expect(problem).toBeDefined();
    expect(problem!.citation.reference).toBe('DISP 1.6.2R(1)');
  });

  it('flags an unacknowledged complaint', () => {
    expect(complaint({ acknowledgedAt: null }).statements
      .some((s) => s.code === 'disp_not_acknowledged')).toBe(true);
  });

  it('says nothing about acknowledgement once a final response exists', () => {
    const clock = complaint({
      acknowledgedAt: null, finalResponseAt: AT(-1), fosRightsGiven: true,
    });
    expect(clock.statements.some((s) => s.code === 'disp_not_acknowledged')).toBe(false);
  });

  it('a properly handled complaint produces no statements at all', () => {
    expect(complaint({ finalResponseAt: AT(-2), fosRightsGiven: true }).statements).toEqual([]);
  });
});

// ============================================ breach

describe('the 72-hour ICO clock', () => {
  const breach = (over: Partial<Parameters<typeof breachClock>[0]> = {}) =>
    breachClock({
      becameAwareAt: AT(-1), reportedToIcoAt: null, notReportableReason: null,
      subjectsNotifiedAt: null, highRisk: false, asAt: AT(0), ...over,
    });

  it('says so when nobody has assessed the risk to the people affected', () => {
    // Three states, not two. Article 33 asks whether to tell the REGULATOR;
    // Article 34 asks whether to tell the PEOPLE, and it is a different
    // question with a different answer. An unassessed breach used to evaluate
    // as low risk — the report deciding the question on the firm's behalf, in
    // the direction that requires no work — and the schema had no column to
    // record the answer in at all.
    const unassessed = breach({ highRisk: null });
    expect(unassessed.statements.map((s) => s.code)).toContain('breach_risk_not_assessed');

    // Assessed and judged low risk: no finding, because a decision was made.
    const low = breach({ highRisk: false });
    expect(low.statements.map((s) => s.code)).not.toContain('breach_risk_not_assessed');
    expect(low.statements.map((s) => s.code)).not.toContain('breach_subjects_not_notified');

    // Assessed as high risk and nobody told: the finding Article 34 is for.
    const high = breach({ highRisk: true, subjectsNotifiedAt: null });
    expect(high.statements.map((s) => s.code)).toContain('breach_subjects_not_notified');

    // High risk and the people WERE told: nothing outstanding.
    const told = breach({ highRisk: true, subjectsNotifiedAt: AT(0) });
    expect(told.statements.map((s) => s.code)).not.toContain('breach_subjects_not_notified');
  });

  it('every statement it makes carries a source citation', () => {
    // §27.4: a dealer's own adviser has to be able to check our reading.
    for (const clock of [breach({ highRisk: null }), breach({ highRisk: true })]) {
      for (const st of clock.statements) {
        expect(st.citation.url).toMatch(/^https?:\/\//);
        expect(st.citation.reference.length).toBeGreaterThan(0);
      }
    }
  });

  it('runs from AWARENESS, not from when the breach happened', () => {
    // The distinction is the whole thing. A laptop taken in March and noticed
    // in June gives 72 hours from June, and a firm that measures from March
    // has misread the Article.
    const clock = breach({ becameAwareAt: AT(-1) });
    expect(clock.icoDeadlineAt.getTime())
      .toBe(AT(-1).getTime() + ICO_NOTIFY_HOURS * 3_600_000);
  });

  it('counts down while the window is open', () => {
    const clock = breach();
    expect(clock.breached).toBe(false);
    expect(clock.hoursRemaining).toBeGreaterThan(0);
    expect(clock.statements[0]!.message).toMatch(/hours left to report/);
  });

  it('is breached once 72 hours pass with no report and no decision', () => {
    const clock = breach({ becameAwareAt: AT(-5) });
    expect(clock.breached).toBe(true);
    expect(clock.statements.some((s) => s.code === 'breach_not_reported')).toBe(true);
  });

  it('a recorded DECISION that it is not reportable stops the clock', () => {
    // Article 33(1) permits it where there is no risk to rights and freedoms —
    // but as a decision with a justification, never a silence.
    const clock = breach({
      becameAwareAt: AT(-5),
      notReportableReason: 'Encrypted device, key not compromised, no data accessible.',
    });
    expect(clock.breached).toBe(false);
  });

  it('a BLANK not-reportable reason does not stop the clock', () => {
    expect(breach({ becameAwareAt: AT(-5), notReportableReason: '   ' }).breached).toBe(true);
  });

  it('reporting late is recorded as late', () => {
    const clock = breach({ becameAwareAt: AT(-5), reportedToIcoAt: AT(-1) });
    expect(clock.reported).toBe(true);
    expect(clock.statements.some((s) => s.code === 'breach_reported_late')).toBe(true);
    expect(clock.statements[0]!.message).toMatch(/must explain the delay/);
  });

  it('reporting in time produces no complaint about timing', () => {
    const clock = breach({ becameAwareAt: AT(-1), reportedToIcoAt: AT(0) });
    expect(clock.statements.some((s) => s.code.startsWith('breach_reported'))).toBe(false);
  });

  it('a high-risk breach must also tell the people affected', () => {
    const clock = breach({ reportedToIcoAt: AT(0), highRisk: true });
    const problem = clock.statements.find((s) => s.code === 'breach_subjects_not_notified');
    expect(problem!.citation.reference).toBe('UK GDPR Article 34(1)');
  });

  it('does not demand subject notification when the risk is not high', () => {
    const clock = breach({ reportedToIcoAt: AT(0), highRisk: false });
    expect(clock.statements.some((s) => s.code === 'breach_subjects_not_notified')).toBe(false);
  });
});

// ============================================ registers

describe('the registers', () => {
  const entry = (over: Partial<RegisterEntry> = {}): RegisterEntry => ({
    id: 'r1', kind: 'motor_trade_insurance',
    description: 'Motor trade insurance', expiresOn: AT(60), ...over,
  });

  it('a valid entry says nothing', () => {
    const status = registerStatus(entry(), AT(0));
    expect(status.state).toBe('valid');
    expect(status.statement).toBeNull();
  });

  it('warns ahead of a renewal', () => {
    const status = registerStatus(entry({ expiresOn: AT(RENEWAL_WARNING_DAYS - 1) }), AT(0));
    expect(status.state).toBe('expiring');
    expect(status.statement!.message).toMatch(/expires in \d+ days/);
  });

  it('an expired entry is the point of the register', () => {
    // A lapsed trade plate or insurance is not "a task" — it is a business
    // that cannot lawfully do what it is doing today.
    const status = registerStatus(entry({ expiresOn: AT(-5) }), AT(0));
    expect(status.state).toBe('expired');
    expect(status.statement!.message).toMatch(/expired 5 days ago/);
  });

  it('an entry with no expiry is not treated as expired', () => {
    const status = registerStatus(entry({ expiresOn: null }), AT(0));
    expect(status.state).toBe('no_expiry');
    expect(status.statement).toBeNull();
  });

  it('a competence record cites the training rule specifically', () => {
    const status = registerStatus(
      entry({ kind: 'staff_competence', description: 'A Whitfield — finance', expiresOn: AT(-1) }),
      AT(0),
    );
    expect(status.statement!.citation.reference).toBe('TC 2.1.1R');
  });

  it('property: state and daysRemaining never disagree', () => {
    fc.assert(fc.property(fc.integer({ min: -400, max: 400 }), (offset) => {
      const status = registerStatus(entry({ expiresOn: AT(offset) }), AT(0));
      if (status.daysRemaining === null) return;
      if (status.daysRemaining < 0) expect(status.state).toBe('expired');
      else if (status.daysRemaining <= RENEWAL_WARNING_DAYS) expect(status.state).toBe('expiring');
      else expect(status.state).toBe('valid');
    }));
  });
});

// ============================================ evidence gaps

describe('evidence completeness per deal', () => {
  it('a complete finance deal has no gaps', () => {
    const gap = evidenceGaps({
      dealId: 'd1', kindsPresent: [...EXPECTED_EVIDENCE], financeIntroduced: true,
    });
    expect(gap.complete).toBe(true);
    expect(gap.statement).toBeNull();
  });

  it('names exactly what is missing', () => {
    const gap = evidenceGaps({
      dealId: 'd1',
      kindsPresent: EXPECTED_EVIDENCE.filter((k) => k !== 'affordability'),
      financeIntroduced: true,
    });
    expect(gap.missing).toEqual(['affordability']);
    expect(gap.statement!.message).toMatch(/affordability/);
  });

  it('says why it matters NOW rather than later', () => {
    // §27.1 wants gaps surfaced while memories are fresh, not discovered when
    // a complaint arrives two years later.
    const gap = evidenceGaps({ dealId: 'd1', kindsPresent: [], financeIntroduced: true });
    expect(gap.statement!.message).toMatch(/nobody remembers in two years/);
  });

  it('a CASH sale has no finance evidence to be missing', () => {
    // Reporting one as incomplete trains the dealer to ignore the list.
    const gap = evidenceGaps({ dealId: 'd2', kindsPresent: [], financeIntroduced: false });
    expect(gap.complete).toBe(true);
    expect(gap.missing).toEqual([]);
  });
});

// ============================================ the score

describe('the completeness score', () => {
  const area = (over: Partial<ScoreArea> = {}): ScoreArea => ({
    key: 'a', label: 'Area', checked: 10, passing: 9, unknown: false, statements: [], ...over,
  });

  it('is the fraction of checks passing', () => {
    const score = complianceScore([
      area({ key: 'a', checked: 10, passing: 10 }),
      area({ key: 'b', checked: 10, passing: 5 }),
      area({ key: 'c', checked: 10, passing: 9 }),
    ]);
    expect(score.score).toBe(80);
  });

  it('DOES NOT count an unassessable area as a pass', () => {
    // The failure mode of every compliance dashboard that flatters its
    // customer: a score that quietly excludes what it could not measure reads
    // 100% for a dealer who has recorded nothing at all.
    const score = complianceScore([
      area({ key: 'a', checked: 10, passing: 10 }),
      area({ key: 'b', checked: 10, passing: 10 }),
      area({ key: 'c', checked: 10, passing: 10 }),
      area({ key: 'd', label: 'Complaints', checked: 0, passing: 0, unknown: true }),
    ]);
    expect(score.score).toBe(100);
    // …but it says so, loudly, rather than pretending the area is fine.
    expect(score.unassessed).toEqual(['Complaints']);
    expect(score.summary).toMatch(/Not included, because there is nothing to check yet/);
  });

  it('states NO score when too little is measurable', () => {
    const score = complianceScore([
      area({ key: 'a', checked: 5, passing: 5 }),
      area({ key: 'b', label: 'Breaches', checked: 0, passing: 0, unknown: true }),
      area({ key: 'c', label: 'Registers', checked: 0, passing: 0, unknown: true }),
    ]);
    expect(score.score).toBeNull();
    expect(score.summary).toMatch(/too few for an overall figure/);
    expect(score.summary).toMatch(/Breaches, Registers/);
  });

  it('states one once enough areas are assessable', () => {
    const areas = Array.from({ length: MIN_AREAS_FOR_SCORE },
      (_, i) => area({ key: `a${i}`, checked: 4, passing: 4 }));
    expect(complianceScore(areas).score).toBe(100);
  });

  it('always carries the disclaimer', () => {
    expect(complianceScore([]).disclaimer).toBe(COMPLIANCE_DISCLAIMER);
  });

  it('property: a score is never outside 0–100 and never NaN', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 })),
        { maxLength: 10 }),
      (pairs) => {
        const areas = pairs.map(([checked, passing], i) => area({
          key: `k${i}`, checked, passing: Math.min(passing, checked), unknown: false,
        }));
        const score = complianceScore(areas);
        if (score.score === null) return;
        expect(Number.isNaN(score.score)).toBe(false);
        expect(score.score).toBeGreaterThanOrEqual(0);
        expect(score.score).toBeLessThanOrEqual(100);
      },
    ));
  });
});
