/**
 * The compliance centre.
 *
 * The screen a dealer opens when something has gone wrong, and — more usefully
 * — the one that tells them before it does. Four clocks and a score:
 *
 *  - DISP: eight weeks from when a complaint was RECEIVED
 *  - UK GDPR Article 33: 72 hours from when the firm became AWARE
 *  - registers: trade plate, insurance, FCA permission, AML policy, expiring
 *  - evidence: which finance-introduced deals cannot be evidenced
 *
 * Every statement carries a source citation, because §27.4 requires a dealer's
 * own adviser to be able to check our interpretation. Nothing here composes a
 * statement itself: `statement()` in the domain takes the citation as a
 * required argument and there is no other constructor.
 *
 * The score's denominator is the thing to get right, and the domain owns it:
 * an area with nothing to check is `unknown`, named, and left OUT of the
 * fraction rather than counted as a pass. A dashboard that excludes what it
 * could not measure reads 100% for a dealer who has recorded nothing.
 */

import { withSession, toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import {
  money,
  complaintClock, breachClock, registerStatus, evidenceGaps, complianceScore,
  COMPLIANCE_DISCLAIMER, DISP_FINAL_RESPONSE_DAYS, ICO_NOTIFY_HOURS,
  RENEWAL_WARNING_DAYS, EXPECTED_EVIDENCE,
  type ComplaintClock, type BreachClock, type RegisterStatus, type RegisterKind,
  type EvidenceGap, type ComplianceScore, type ScoreArea, type Money,
} from '@forecourt/domain';

export interface ComplaintRow {
  id: string;
  reference: string | null;
  summary: string;
  status: string;
  contactName: string | null;
  dealId: string | null;
  redress: Money | null;
  rootCause: string | null;
  clock: ComplaintClock;
}

export interface BreachRow {
  id: string;
  summary: string;
  status: string;
  subjectsAffected: number | null;
  containment: string | null;
  icoReference: string | null;
  /** Null when nobody has assessed the risk to the people affected. */
  highRisk: boolean | null;
  highRiskReason: string | null;
  clock: BreachClock;
}

export interface RegisterRow extends RegisterStatus {
  reference: string | null;
  issuer: string | null;
  subjectName: string | null;
}

export interface EvidenceGapRow extends EvidenceGap {
  reference: string | null;
  contactName: string | null;
  deliveredAt: Date | null;
}

export interface ComplianceView {
  complaints: ComplaintRow[];
  breaches: BreachRow[];
  registers: RegisterRow[];
  gaps: EvidenceGapRow[];
  score: ComplianceScore;
  /** Open tasks, so the centre is a place to act rather than only to read. */
  tasks: {
    id: string; title: string; detail: string | null; status: string;
    dueOn: Date | null; citationRef: string | null; citationUrl: string | null;
  }[];
  queryMs: number;
}

const contactNameOf = (r: Record<string, unknown>): string | null => {
  const name = [r['first_name'], r['last_name']].filter(Boolean).join(' ')
    || (r['company_name'] as string | null)
    || (r['email'] as string | null);
  return name || null;
};

export async function loadComplianceCentre(session: Session): Promise<ComplianceView> {
  const started = Date.now();
  const now = new Date();

  const data = await withSession(session, async (tx) => {
    const [complaints, breaches, registers, tasks, deals] = await Promise.all([
      tx`SELECT c.*, ct.first_name, ct.last_name, ct.company_name, ct.email
         FROM complaints c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         ORDER BY c.received_at DESC`,
      tx`SELECT * FROM data_breaches ORDER BY became_aware_at DESC`,
      tx`SELECT r.*, u.name AS subject_name
         FROM compliance_registers r
         LEFT JOIN users u ON u.id = r.subject_user_id
         ORDER BY r.expires_on NULLS LAST`,
      tx`SELECT * FROM compliance_tasks WHERE status = 'open' ORDER BY due_on NULLS LAST`,
      // Finance-introduced deals and the evidence kinds each one carries. A
      // cash sale has no finance evidence to be missing, so `financeIntroduced`
      // is what decides whether a gap exists at all.
      tx`SELECT d.id, d.reference, d.delivered_at,
                d.finance_amount_pence > 0 AS financed,
                ct.first_name, ct.last_name, ct.company_name, ct.email,
                coalesce(
                  array_agg(DISTINCT e.kind::text) FILTER (WHERE e.kind IS NOT NULL),
                  '{}'
                ) AS kinds
         FROM deals d
         LEFT JOIN contacts ct ON ct.id = d.contact_id
         LEFT JOIN deal_evidence e ON e.deal_id = d.id
         WHERE d.state IN ('contracted', 'delivered', 'completed')
         GROUP BY d.id, ct.first_name, ct.last_name, ct.company_name, ct.email
         ORDER BY d.delivered_at DESC NULLS LAST`,
    ]);

    return { complaints, breaches, registers, tasks, deals };
  });

  const complaints: ComplaintRow[] = (data.complaints as Record<string, unknown>[])
    .map((c) => ({
      id: String(c['id']),
      reference: (c['reference'] as string | null) ?? null,
      summary: String(c['summary']),
      status: String(c['status']),
      contactName: contactNameOf(c),
      dealId: c['deal_id'] === null ? null : String(c['deal_id']),
      redress: c['redress_pence'] === null
        ? null : money(toPence(c['redress_pence'] as string), 'GBP'),
      rootCause: (c['root_cause'] as string | null) ?? null,
      clock: complaintClock({
        receivedAt: toDate(c['received_at'] as Date) as Date,
        finalResponseAt: toDate(c['final_response_at'] as Date | null),
        acknowledgedAt: toDate(c['acknowledged_at'] as Date | null),
        fosRightsGiven: Boolean(c['fos_rights_given']),
        asAt: now,
      }),
    }));

  const breaches: BreachRow[] = (data.breaches as Record<string, unknown>[]).map((b) => ({
    id: String(b['id']),
    summary: String(b['summary']),
    status: String(b['status']),
    subjectsAffected: b['subjects_affected'] === null ? null : Number(b['subjects_affected']),
    containment: (b['containment'] as string | null) ?? null,
    icoReference: (b['ico_reference'] as string | null) ?? null,
    highRisk: b['high_risk'] === null || b['high_risk'] === undefined
      ? null : Boolean(b['high_risk']),
    highRiskReason: (b['high_risk_reason'] as string | null) ?? null,
    clock: breachClock({
      becameAwareAt: toDate(b['became_aware_at'] as Date) as Date,
      reportedToIcoAt: toDate(b['reported_to_ico_at'] as Date | null),
      notReportableReason: (b['not_reportable_reason'] as string | null) ?? null,
      subjectsNotifiedAt: toDate(b['subjects_notified_at'] as Date | null),
      // Article 34's trigger, read from the record rather than inferred from
      // the number affected — one person's bank details is a high risk and a
      // thousand postcodes may not be. NULL means nobody has assessed it,
      // which the clock reports as a finding rather than treating as low risk.
      highRisk: b['high_risk'] === null || b['high_risk'] === undefined
        ? null : Boolean(b['high_risk']),
      asAt: now,
    }),
  }));

  const registers: RegisterRow[] = (data.registers as Record<string, unknown>[]).map((r) => ({
    ...registerStatus({
      id: String(r['id']),
      kind: r['kind'] as RegisterKind,
      description: String(r['description']),
      expiresOn: toDate(r['expires_on'] as Date | null),
    }, now),
    reference: (r['reference'] as string | null) ?? null,
    issuer: (r['issuer'] as string | null) ?? null,
    subjectName: (r['subject_name'] as string | null) ?? null,
  }));

  const gaps: EvidenceGapRow[] = (data.deals as Record<string, unknown>[])
    .map((d) => ({
      ...evidenceGaps({
        dealId: String(d['id']),
        kindsPresent: (d['kinds'] as string[]) ?? [],
        financeIntroduced: Boolean(d['financed']),
      }),
      reference: (d['reference'] as string | null) ?? null,
      contactName: contactNameOf(d),
      deliveredAt: toDate(d['delivered_at'] as Date | null),
    }))
    .filter((g) => !g.complete);

  // The areas, built here because only this layer knows what data exists.
  // `unknown` is the important flag: it means "nothing to check", which is not
  // the same as "all clear" and must not be counted as a pass.
  const financedDeals = (data.deals as Record<string, unknown>[]).filter((d) => d['financed']);

  const areas: ScoreArea[] = [
    {
      key: 'complaints',
      label: 'Complaint handling',
      checked: complaints.length,
      passing: complaints.filter((c) => !c.clock.breached && c.clock.statements.length === 0).length,
      unknown: complaints.length === 0,
      statements: complaints.flatMap((c) => c.clock.statements),
    },
    {
      key: 'breaches',
      label: 'Data breach reporting',
      checked: breaches.length,
      passing: breaches.filter((b) => !b.clock.breached && b.clock.statements.length === 0).length,
      unknown: breaches.length === 0,
      statements: breaches.flatMap((b) => b.clock.statements),
    },
    {
      key: 'registers',
      label: 'Permissions, insurance and policies',
      checked: registers.length,
      passing: registers.filter((r) => r.state === 'valid' || r.state === 'no_expiry').length,
      unknown: registers.length === 0,
      statements: registers.map((r) => r.statement).filter((s) => s !== null),
    },
    {
      key: 'evidence',
      label: 'Finance evidence',
      checked: financedDeals.length,
      passing: financedDeals.length - gaps.length,
      unknown: financedDeals.length === 0,
      statements: gaps.map((g) => g.statement).filter((s) => s !== null),
    },
  ];

  return {
    complaints,
    breaches,
    registers,
    gaps,
    score: complianceScore(areas),
    tasks: (data.tasks as Record<string, unknown>[]).map((t) => ({
      id: String(t['id']),
      title: String(t['title']),
      detail: (t['detail'] as string | null) ?? null,
      status: String(t['status']),
      dueOn: toDate(t['due_on'] as Date | null),
      citationRef: (t['citation_ref'] as string | null) ?? null,
      citationUrl: (t['citation_url'] as string | null) ?? null,
    })),
    queryMs: Date.now() - started,
  };
}

export {
  COMPLIANCE_DISCLAIMER, DISP_FINAL_RESPONSE_DAYS, ICO_NOTIFY_HOURS,
  RENEWAL_WARNING_DAYS, EXPECTED_EVIDENCE,
};
