/**
 * M19 — the compliance centre.
 *
 * Compliance is the differentiator, so it gets a front door. Two rules shape
 * everything here:
 *
 *   1. NOTHING RENDERS WITHOUT A SOURCE. §27.4 requires that every compliance
 *      rule links to the FCA Handbook reference, HMRC notice or piece of
 *      legislation it comes from, so a dealer's own adviser can check our
 *      interpretation. A statement without a citation is an assertion, and we
 *      are not entitled to make assertions about somebody else's regulatory
 *      position. `ComplianceStatement` cannot be constructed without one — the
 *      same structural argument as M8's `ApprovedPromotion`.
 *
 *   2. THE SCORE MUST NOT FLATTER. A completeness score that reads 94% because
 *      the denominator quietly excluded everything unmeasured is worse than no
 *      score: it tells a dealer they are fine. Anything we cannot assess is
 *      counted as unknown and named, never dropped.
 *
 * And the disclaimer is not decoration. Forecourt provides tooling and
 * record-keeping, not legal or regulatory advice, and the dealer remains
 * responsible for their own compliance. It travels with every surface built
 * from this module.
 */

// ------------------------------------------------------------ disclaimer

/**
 * §27.4, mandatory and prominent. Exported as a constant so there is exactly
 * one wording, and carried on every structure this module produces so a
 * surface cannot render the findings without it.
 */
export const COMPLIANCE_DISCLAIMER =
  'Forecourt provides compliance tooling and record-keeping, not legal or regulatory advice. ' +
  'You remain responsible for your own compliance. Every rule below links to its source so ' +
  'your adviser can check our interpretation.';

// ------------------------------------------------------------- citations

export interface SourceCitation {
  /** How the source is cited in the trade — "DISP 1.6.2R", "VAT Notice 718/1". */
  reference: string;
  /** Where to read it. */
  url: string;
  /** What it says, in one line, for somebody who is not going to click. */
  summary: string;
}

export interface ComplianceStatement {
  code: string;
  message: string;
  citation: SourceCitation;
  disclaimer: string;
}

/**
 * The only way to build a compliance statement.
 *
 * Takes the citation as a required argument, so there is no path to a screen
 * that asserts a regulatory position without saying where it came from.
 */
export const statement = (
  code: string,
  message: string,
  citation: SourceCitation,
): ComplianceStatement => ({
  code,
  message,
  citation,
  disclaimer: COMPLIANCE_DISCLAIMER,
});

/**
 * The sources this module cites.
 *
 * Held here rather than inline so that when a rule changes, the citation is
 * updated in one place — and so a reviewer can read the whole list of what we
 * claim to be interpreting.
 */
export const SOURCES = {
  dispFinalResponse: {
    reference: 'DISP 1.6.2R',
    url: 'https://www.handbook.fca.org.uk/handbook/DISP/1/6.html',
    summary:
      'A firm must send a final response, or explain why it cannot and when it will, within ' +
      'eight weeks of receiving a complaint.',
  },
  dispFosRights: {
    reference: 'DISP 1.6.2R(1)',
    url: 'https://www.handbook.fca.org.uk/handbook/DISP/1/6.html',
    summary:
      'A final response must tell the complainant they may refer the matter to the Financial ' +
      'Ombudsman Service, and enclose the standard explanatory leaflet.',
  },
  dispPromptAcknowledgement: {
    reference: 'DISP 1.6.1R',
    url: 'https://www.handbook.fca.org.uk/handbook/DISP/1/6.html',
    summary: 'A firm must acknowledge a complaint promptly.',
  },
  breachNotifyIco: {
    reference: 'UK GDPR Article 33(1)',
    url: 'https://www.legislation.gov.uk/eur/2016/679/article/33',
    summary:
      'A personal data breach must be reported to the ICO without undue delay and, where ' +
      'feasible, within 72 hours of the controller becoming aware of it.',
  },
  breachNotifySubjects: {
    reference: 'UK GDPR Article 34(1)',
    url: 'https://www.legislation.gov.uk/eur/2016/679/article/34',
    summary:
      'Where a breach is likely to result in a high risk to individuals, they must be told ' +
      'without undue delay.',
  },
  fcaCompetence: {
    reference: 'TC 2.1.1R',
    url: 'https://www.handbook.fca.org.uk/handbook/TC/2/1.html',
    summary:
      'A firm must not assess an employee as competent to carry on an activity until they have ' +
      'demonstrated the necessary competence, and must keep records of that assessment.',
  },
  evidenceRetention: {
    reference: 'CONC 3.7 / SYSC 9.1',
    url: 'https://www.handbook.fca.org.uk/handbook/SYSC/9/1.html',
    summary:
      'A firm must keep orderly records of its business sufficient to enable the FCA to monitor ' +
      'compliance, including what was disclosed to a customer and when.',
  },
  amlRegistration: {
    reference: 'MLR 2017 reg. 14',
    url: 'https://www.legislation.gov.uk/uksi/2017/692/regulation/14',
    summary:
      'A high value dealer accepting €10,000 (now £10,000) or more in cash must be registered ' +
      'with HMRC before doing so.',
  },
} as const satisfies Record<string, SourceCitation>;

// --------------------------------------------------------- DISP clocks

/** DISP 1.6.2R. Eight weeks from receipt, in days. */
export const DISP_FINAL_RESPONSE_DAYS = 56;
/** How long before the deadline the dashboard starts saying so. */
export const DISP_WARNING_DAYS = 14;

export interface ComplaintClock {
  receivedAt: Date;
  finalResponseDueAt: Date;
  daysRemaining: number;
  breached: boolean;
  approaching: boolean;
  /** Answered in time, whether or not the deadline has since passed. */
  answered: boolean;
  statements: readonly ComplianceStatement[];
}

const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS);

/**
 * Where a complaint stands against DISP.
 *
 * The clock runs from when the complaint was RECEIVED, not from when somebody
 * got round to logging it — a complaint made on the forecourt on Saturday and
 * entered on Tuesday is already three days old, and the deadline does not
 * care which date is in our database.
 */
export function complaintClock(input: {
  receivedAt: Date;
  finalResponseAt: Date | null;
  acknowledgedAt: Date | null;
  fosRightsGiven: boolean;
  asAt: Date;
}): ComplaintClock {
  const dueAt = new Date(input.receivedAt.getTime() + DISP_FINAL_RESPONSE_DAYS * DAY_MS);
  const answered = input.finalResponseAt !== null;

  // Measured against the response where one was sent, so a complaint answered
  // in week six does not become "breached" in week nine.
  const measuredAt = input.finalResponseAt ?? input.asAt;
  const breached = measuredAt.getTime() > dueAt.getTime();
  const daysRemaining = daysBetween(input.asAt, dueAt);

  const statements: ComplianceStatement[] = [];

  if (breached) {
    statements.push(statement(
      'disp_final_response_late',
      answered
        ? `The final response went out ${daysBetween(dueAt, measuredAt)} days after the ` +
          'eight-week deadline.'
        : `No final response, and the eight-week deadline passed ${-daysRemaining} days ago. ` +
          'The complainant can go to the Financial Ombudsman now.',
      SOURCES.dispFinalResponse,
    ));
  } else if (!answered && daysRemaining <= DISP_WARNING_DAYS) {
    statements.push(statement(
      'disp_final_response_due',
      `A final response is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
      SOURCES.dispFinalResponse,
    ));
  }

  if (answered && !input.fosRightsGiven) {
    statements.push(statement(
      'disp_fos_rights_missing',
      'The final response did not record that the complainant was told about the Financial ' +
      'Ombudsman Service. A response without that is not a compliant final response.',
      SOURCES.dispFosRights,
    ));
  }

  if (!input.acknowledgedAt && !answered) {
    statements.push(statement(
      'disp_not_acknowledged',
      'This complaint has not been acknowledged.',
      SOURCES.dispPromptAcknowledgement,
    ));
  }

  return {
    receivedAt: input.receivedAt,
    finalResponseDueAt: dueAt,
    daysRemaining,
    breached,
    approaching: !answered && !breached && daysRemaining <= DISP_WARNING_DAYS,
    answered,
    statements,
  };
}

// -------------------------------------------------------- breach clocks

/** UK GDPR Article 33(1). */
export const ICO_NOTIFY_HOURS = 72;

export interface BreachClock {
  becameAwareAt: Date;
  icoDeadlineAt: Date;
  hoursRemaining: number;
  breached: boolean;
  reported: boolean;
  statements: readonly ComplianceStatement[];
}

/**
 * The 72-hour clock, which runs from AWARENESS rather than from the breach.
 *
 * The distinction is the whole thing. A laptop taken in March and noticed in
 * June gives 72 hours from June — and a firm that reports late because it
 * measured from March has misread the Article. Article 33 also permits not
 * reporting where the breach is unlikely to result in a risk, but that is a
 * decision with a justification, never a silence, so a breach marked
 * unreportable without a reason is flagged.
 */
export function breachClock(input: {
  becameAwareAt: Date;
  reportedToIcoAt: Date | null;
  notReportableReason: string | null;
  subjectsNotifiedAt: Date | null;
  highRisk: boolean;
  asAt: Date;
}): BreachClock {
  const deadline = new Date(input.becameAwareAt.getTime() + ICO_NOTIFY_HOURS * 3_600_000);
  const reported = input.reportedToIcoAt !== null;
  const decidedNotReportable = (input.notReportableReason ?? '').trim().length > 0;

  const measuredAt = input.reportedToIcoAt ?? input.asAt;
  const breached = !reported && !decidedNotReportable
    && measuredAt.getTime() > deadline.getTime();

  const hoursRemaining = Math.floor(
    (deadline.getTime() - input.asAt.getTime()) / 3_600_000,
  );

  const statements: ComplianceStatement[] = [];

  if (reported && input.reportedToIcoAt!.getTime() > deadline.getTime()) {
    statements.push(statement(
      'breach_reported_late',
      'This was reported to the ICO more than 72 hours after the firm became aware. The report ' +
      'must explain the delay.',
      SOURCES.breachNotifyIco,
    ));
  } else if (breached) {
    statements.push(statement(
      'breach_not_reported',
      `The 72-hour window closed ${-hoursRemaining} hours ago and there is no ICO report and ` +
      'no recorded decision that it was not reportable.',
      SOURCES.breachNotifyIco,
    ));
  } else if (!reported && !decidedNotReportable) {
    statements.push(statement(
      'breach_clock_running',
      `${hoursRemaining} hours left to report this to the ICO, or to record why it is not ` +
      'reportable.',
      SOURCES.breachNotifyIco,
    ));
  }

  if (input.highRisk && input.subjectsNotifiedAt === null) {
    statements.push(statement(
      'breach_subjects_not_notified',
      'This is recorded as high risk to the people affected, and they have not been told.',
      SOURCES.breachNotifySubjects,
    ));
  }

  return {
    becameAwareAt: input.becameAwareAt,
    icoDeadlineAt: deadline,
    hoursRemaining,
    breached,
    reported,
    statements,
  };
}

// ----------------------------------------------------------- registers

export type RegisterKind =
  | 'trade_plate' | 'motor_trade_insurance' | 'fca_permission' | 'appointed_rep_agreement'
  | 'staff_competence' | 'aml_policy' | 'aml_risk_assessment' | 'dpia'
  | 'sub_processor' | 'trade_body_membership' | 'other';

export interface RegisterEntry {
  id: string;
  kind: RegisterKind;
  description: string;
  expiresOn: Date | null;
}

export interface RegisterStatus {
  entry: RegisterEntry;
  state: 'valid' | 'expiring' | 'expired' | 'no_expiry';
  daysRemaining: number | null;
  statement: ComplianceStatement | null;
}

/** How far ahead a renewal is worth surfacing. */
export const RENEWAL_WARNING_DAYS = 30;

const REGISTER_CITATION: Partial<Record<RegisterKind, SourceCitation>> = {
  staff_competence: SOURCES.fcaCompetence,
  fca_permission: SOURCES.evidenceRetention,
  aml_policy: SOURCES.amlRegistration,
  aml_risk_assessment: SOURCES.amlRegistration,
};

export function registerStatus(
  entry: RegisterEntry,
  asAt: Date,
  warningDays = RENEWAL_WARNING_DAYS,
): RegisterStatus {
  if (entry.expiresOn === null) {
    return { entry, state: 'no_expiry', daysRemaining: null, statement: null };
  }

  const daysRemaining = daysBetween(asAt, entry.expiresOn);
  const state = daysRemaining < 0 ? 'expired'
    : daysRemaining <= warningDays ? 'expiring' : 'valid';

  // A lapsed trade plate or insurance is not "a task" — it is a business that
  // cannot lawfully do what it is doing today.
  const citation = REGISTER_CITATION[entry.kind] ?? SOURCES.evidenceRetention;

  return {
    entry,
    state,
    daysRemaining,
    statement: state === 'expired'
      ? statement('register_expired',
          `${entry.description} expired ${-daysRemaining} days ago.`, citation)
      : state === 'expiring'
        ? statement('register_expiring',
            `${entry.description} expires in ${daysRemaining} days.`, citation)
        : null,
  };
}

// ------------------------------------------------- evidence completeness

/**
 * The evidence a finance-introduced deal is expected to carry.
 *
 * Drawn from M12's `evidence_kind` enum. A deal missing one of these is not
 * necessarily non-compliant — but it is a deal the dealer cannot evidence, and
 * §27.1 wants those surfaced "while memories are fresh" rather than discovered
 * when a complaint arrives two years later.
 */
export const EXPECTED_EVIDENCE: readonly string[] = [
  'initial_disclosure',
  'quote_presented',
  'commission_disclosure',
  'demands_and_needs',
  'affordability',
  'adequate_explanation',
  'vulnerability_screen',
  'contract_formed',
];

export interface EvidenceGap {
  dealId: string;
  missing: readonly string[];
  complete: boolean;
  statement: ComplianceStatement | null;
}

export function evidenceGaps(
  deal: { dealId: string; kindsPresent: readonly string[]; financeIntroduced: boolean },
): EvidenceGap {
  // A cash sale has no finance evidence to be missing, and reporting it as
  // incomplete trains the dealer to ignore the list.
  if (!deal.financeIntroduced) {
    return { dealId: deal.dealId, missing: [], complete: true, statement: null };
  }

  const present = new Set(deal.kindsPresent);
  const missing = EXPECTED_EVIDENCE.filter((k) => !present.has(k));

  return {
    dealId: deal.dealId,
    missing,
    complete: missing.length === 0,
    statement: missing.length === 0 ? null : statement(
      'evidence_incomplete',
      `${missing.length} evidence record${missing.length === 1 ? '' : 's'} missing: ` +
      `${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}. Fill these in now — the question ` +
      'an ombudsman asks is what the customer saw on the day, and nobody remembers in two years.',
      SOURCES.evidenceRetention,
    ),
  };
}

// ------------------------------------------------------------- the score

export interface ScoreArea {
  key: string;
  label: string;
  /** How many things were checked. Zero means the area could not be assessed. */
  checked: number;
  passing: number;
  /** Not assessable — no data, not "all clear". */
  unknown: boolean;
  statements: readonly ComplianceStatement[];
}

export interface ComplianceScore {
  /** 0–100, or null when too little is measurable to state one. */
  score: number | null;
  areas: readonly ScoreArea[];
  /** Areas that could not be assessed at all, named rather than dropped. */
  unassessed: readonly string[];
  disclaimer: string;
  summary: string;
}

/** Below this many assessable areas, no overall score is stated. */
export const MIN_AREAS_FOR_SCORE = 3;

/**
 * The completeness score.
 *
 * The denominator is the thing to get right. A score that quietly excludes
 * everything it could not measure reads 100% for a dealer who has recorded
 * nothing at all — which is the exact opposite of the truth, and it is the
 * failure mode of every compliance dashboard that flatters its customer.
 *
 * So: an area with nothing to check is `unknown`, it is named, and it is left
 * out of the fraction rather than counted as a pass. If fewer than three areas
 * are assessable, there is no score — just the list of what to set up.
 */
export function complianceScore(areas: readonly ScoreArea[]): ComplianceScore {
  const assessable = areas.filter((a) => !a.unknown && a.checked > 0);
  const unassessed = areas.filter((a) => a.unknown || a.checked === 0).map((a) => a.label);

  if (assessable.length < MIN_AREAS_FOR_SCORE) {
    return {
      score: null,
      areas,
      unassessed,
      disclaimer: COMPLIANCE_DISCLAIMER,
      summary:
        `Only ${assessable.length} of ${areas.length} areas can be assessed yet, which is too ` +
        'few for an overall figure. Set up the rest before reading anything into a score: ' +
        `${unassessed.join(', ')}.`,
    };
  }

  const checked = assessable.reduce((t, a) => t + a.checked, 0);
  const passing = assessable.reduce((t, a) => t + a.passing, 0);
  const score = Math.round((passing / checked) * 100);

  return {
    score,
    areas,
    unassessed,
    disclaimer: COMPLIANCE_DISCLAIMER,
    summary: unassessed.length === 0
      ? `${score}% — ${passing} of ${checked} checks passing across ${assessable.length} areas.`
      : `${score}% across the ${assessable.length} areas that can be assessed. ` +
        `Not included, because there is nothing to check yet: ${unassessed.join(', ')}.`,
  };
}

/** Every statement a dashboard is about to show, worst first. */
export const collectStatements = (
  sources: readonly { statements: readonly ComplianceStatement[] }[],
): ComplianceStatement[] => sources.flatMap((s) => [...s.statements]);
