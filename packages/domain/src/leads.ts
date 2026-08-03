/**
 * M10 — leads, the pipeline, SLA and outbound communications.
 *
 * The lead inbox is where a dealer either makes money or does not. The
 * research finding that shapes this module: response speed is the single
 * strongest predictor of conversion on a marketplace lead, because the buyer
 * has enquired on four cars and is waiting for whoever answers first. So the
 * SLA clock measures what the CUSTOMER experienced — the first outbound
 * message — never what somebody ticked.
 *
 * Two rules from the domain skill are enforced here rather than by convention:
 *
 *   - A lost lead must carry a structured reason. Making loss reasons optional
 *     is listed as an anti-pattern: a dealer who cannot see why they lose
 *     cannot fix it, and "not interested" typed in a box teaches nobody
 *     anything.
 *   - Every outbound message passes the M9 send-time consent gate. A marketing
 *     message cites the consent record that permitted it, by id.
 */

import {
  canSend, normaliseDestination,
  type ConsentChannel, type ConsentRecord, type SuppressionRecord, type MessageKind,
} from './consent.js';

// ---------------------------------------------------------------- types

export type LeadSource =
  | 'website_enquiry' | 'website_callback' | 'website_test_drive' | 'website_part_ex'
  | 'website_reserve' | 'saved_search' | 'phone' | 'walk_in'
  | 'autotrader' | 'ebay' | 'cargurus' | 'facebook' | 'other_marketplace';

export type LeadStage =
  | 'new' | 'contacted' | 'qualified' | 'appointment' | 'test_drive'
  | 'negotiating' | 'won' | 'lost';

export type LossReason =
  | 'price_too_high' | 'part_ex_valuation' | 'vehicle_sold' | 'no_suitable_stock'
  | 'finance_declined' | 'finance_terms' | 'bought_elsewhere' | 'changed_mind'
  | 'timing' | 'unresponsive' | 'duplicate' | 'not_genuine';

/**
 * Loss reasons in the dealer's own words, for the picker.
 *
 * Each one has to map to something a dealer can actually change — that is the
 * test for whether a reason earns a place on this list.
 */
export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price_too_high: 'Price too high',
  part_ex_valuation: 'Not enough for their part-exchange',
  vehicle_sold: 'Car sold to someone else',
  no_suitable_stock: 'Nothing suitable in stock',
  finance_declined: 'Finance declined',
  finance_terms: 'Did not like the finance terms',
  bought_elsewhere: 'Bought elsewhere',
  changed_mind: 'Changed their mind',
  timing: 'Not ready yet',
  unresponsive: 'Could not reach them',
  duplicate: 'Duplicate enquiry',
  not_genuine: 'Not a genuine enquiry',
};

export const TERMINAL_STAGES: readonly LeadStage[] = ['won', 'lost'];

export interface Lead {
  id: string;
  tenantId: string;
  contactId: string;
  vehicleId: string | null;
  source: LeadSource;
  sourceReference: string | null;
  stage: LeadStage;
  assignedTo: string | null;
  receivedAt: Date;
  firstResponseAt: Date | null;
  dueAt: Date | null;
  closedAt: Date | null;
  lossReason: LossReason | null;
  lossDetail: string | null;
  lostTo: string | null;
}

// --------------------------------------------------------------- pipeline

/**
 * Which stages a lead may move to.
 *
 * Deliberately permissive forward and backward — a real sale does not walk
 * neatly down a funnel, and a pipeline that refuses to let someone correct a
 * mis-click is a pipeline they stop updating. What it does NOT allow is
 * leaving a terminal stage without an explicit reopen, so "won" cannot quietly
 * become "negotiating" and corrupt the conversion figures.
 */
export function allowedTransitions(from: LeadStage): readonly LeadStage[] {
  if (TERMINAL_STAGES.includes(from)) return [];
  const working: LeadStage[] = [
    'new', 'contacted', 'qualified', 'appointment', 'test_drive', 'negotiating',
  ];
  return [...working.filter((s) => s !== from), 'won', 'lost'];
}

export interface StageChange {
  stage: LeadStage;
  lossReason?: LossReason | null;
  lossDetail?: string | null;
  lostTo?: string | null;
  at: Date;
}

export interface StageResult {
  ok: boolean;
  lead: Lead;
  error: string | null;
}

/**
 * Move a lead to a new stage.
 *
 * Refuses a `lost` transition with no reason. That refusal is the feature —
 * the reason is never filled in later, so it has to be impossible to skip at
 * the only moment anyone knows the answer.
 */
export function changeStage(lead: Lead, change: StageChange): StageResult {
  if (change.stage === lead.stage) {
    return { ok: true, lead, error: null };
  }

  if (TERMINAL_STAGES.includes(lead.stage)) {
    return {
      ok: false, lead,
      error: `This lead is already marked ${lead.stage}. Reopen it before changing the stage.`,
    };
  }

  if (!allowedTransitions(lead.stage).includes(change.stage)) {
    return { ok: false, lead, error: `A lead cannot move from ${lead.stage} to ${change.stage}.` };
  }

  if (change.stage === 'lost' && !change.lossReason) {
    return {
      ok: false, lead,
      // Says what to do, not just what is wrong.
      error: 'Choose why this lead was lost. It is the only way to see what is costing you sales.',
    };
  }

  return {
    ok: true,
    error: null,
    lead: {
      ...lead,
      stage: change.stage,
      closedAt: TERMINAL_STAGES.includes(change.stage) ? change.at : null,
      lossReason: change.stage === 'lost' ? change.lossReason ?? null : null,
      lossDetail: change.stage === 'lost' ? change.lossDetail ?? null : null,
      lostTo: change.stage === 'lost' ? change.lostTo ?? null : null,
    },
  };
}

/** Reopening is explicit, and is its own event in the lead's history. */
export function reopen(lead: Lead): StageResult {
  if (!TERMINAL_STAGES.includes(lead.stage)) {
    return { ok: false, lead, error: 'This lead is already open.' };
  }
  return {
    ok: true, error: null,
    lead: { ...lead, stage: 'negotiating', closedAt: null, lossReason: null, lossDetail: null, lostTo: null },
  };
}

// -------------------------------------------------------------------- SLA

/**
 * Default response targets, in minutes.
 *
 * A marketplace buyer has enquired on several cars and is waiting for whoever
 * answers first, so those get the tightest clock. A walk-in is standing in
 * front of someone and needs no timer at all.
 */
export const DEFAULT_SLA_MINUTES: Record<LeadSource, number> = {
  autotrader: 15, ebay: 15, cargurus: 15, facebook: 15, other_marketplace: 15,
  website_enquiry: 30, website_callback: 30, website_test_drive: 30,
  website_reserve: 15, website_part_ex: 60,
  saved_search: 240,
  phone: 60, walk_in: 60,
};

export const slaDueAt = (
  receivedAt: Date,
  source: LeadSource,
  overrideMinutes?: number,
): Date => new Date(receivedAt.getTime() + (overrideMinutes ?? DEFAULT_SLA_MINUTES[source]) * 60_000);

export interface SlaState {
  breached: boolean;
  /** Negative once overdue, so a countdown and an overrun use one number. */
  minutesRemaining: number;
  /** How long the customer actually waited, once answered. */
  responseMinutes: number | null;
  label: string;
}

/**
 * The SLA position of a lead.
 *
 * Measured from `firstResponseAt`, which is stamped by the first outbound
 * message rather than by a user action — the customer's experience is the
 * thing being measured, and a "mark as contacted" button measures the staff
 * member's memory instead.
 */
export function slaState(lead: Lead, now: Date): SlaState {
  const due = lead.dueAt ?? slaDueAt(lead.receivedAt, lead.source);

  if (lead.firstResponseAt) {
    const responseMinutes = Math.round(
      (lead.firstResponseAt.getTime() - lead.receivedAt.getTime()) / 60_000);
    const breached = lead.firstResponseAt.getTime() > due.getTime();
    return {
      breached,
      minutesRemaining: 0,
      responseMinutes,
      label: breached
        ? `Answered after ${responseMinutes} min — past the target`
        : `Answered in ${responseMinutes} min`,
    };
  }

  const minutesRemaining = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (minutesRemaining < 0) {
    return {
      breached: true, minutesRemaining, responseMinutes: null,
      label: `${Math.abs(minutesRemaining)} min overdue`,
    };
  }
  return {
    breached: false, minutesRemaining, responseMinutes: null,
    label: `${minutesRemaining} min to respond`,
  };
}

// ------------------------------------------------------- marketplace leads

export interface ParsedLead {
  ok: boolean;
  source: LeadSource;
  sourceReference: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  registration: string | null;
  message: string | null;
  /** Why a parse failed, so triage has something to work with. */
  problems: string[];
}

/**
 * Parse a marketplace lead into our shape.
 *
 * Portals change their email format without notice, so a parser that throws on
 * an unexpected layout drops a real buyer on the floor. This one always
 * returns a lead — with `ok: false` and the problems named — so a failed parse
 * becomes a manual triage item rather than a lost sale. That fallback is the
 * whole point of the function.
 */
export function parseMarketplaceLead(
  source: LeadSource,
  fields: Readonly<Record<string, string | undefined>>,
): ParsedLead {
  const problems: string[] = [];
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = fields[k];
      if (v && v.trim()) return v.trim();
    }
    return null;
  };

  const email = pick('email', 'customer_email', 'from_email', 'buyerEmail');
  const phone = pick('phone', 'telephone', 'customer_phone', 'buyerPhone');
  const name = pick('name', 'customer_name', 'full_name', 'buyerName');
  const registration = pick('registration', 'vrm', 'reg', 'plate');
  const message = pick('message', 'enquiry', 'comments', 'body');
  const sourceReference = pick('reference', 'lead_id', 'id', 'enquiryId');

  // A lead we cannot reply to is not a lead. This is the only hard failure.
  if (!email && !phone) {
    problems.push('no email address or phone number — there is no way to reply to this enquiry');
  }
  if (!name) problems.push('no customer name');
  if (!registration) problems.push('no vehicle registration — could not match it to a car in stock');
  if (!sourceReference) problems.push('no marketplace reference — cannot deduplicate if it arrives twice');

  return {
    ok: Boolean(email || phone),
    source, sourceReference, name,
    email: email ? normaliseDestination('email', email) : null,
    phone: phone ? normaliseDestination('phone', phone) : null,
    registration: registration ? registration.toUpperCase().replace(/\s+/g, '') : null,
    message, problems,
  };
}

// ------------------------------------------------------- outbound messages

/**
 * Re-exported from the consent module rather than redeclared. Two definitions
 * of "is this marketing?" would drift, and the one that decides whether a
 * consent check applies is not a good place for that to happen.
 */
export type { MessageKind } from './consent.js';

export interface OutboundRequest {
  leadId: string | null;
  contactId: string;
  channel: ConsentChannel;
  destination: string;
  subject: string | null;
  body: string;
  kind: MessageKind;
  /** The moment of sending — not of scheduling, not of queueing. */
  sentAt: Date;
  consentHistory: readonly ConsentRecord[];
  suppressions: readonly SuppressionRecord[];
  contactErased?: boolean;
  idempotencyKey?: string;
}

export interface OutboundDecision {
  status: 'send' | 'blocked';
  /** The consent record relied on, written against the message as evidence. */
  consentId: string | null;
  reason: string;
}

/**
 * The gate every outbound message passes, at the moment of sending.
 *
 * Thin on purpose: the decision belongs to `canSend` in the consent module, so
 * there is exactly one implementation of "may we contact this person?" in the
 * codebase. A second copy here would drift, and the two would disagree in
 * precisely the situation where it matters.
 *
 * What this adds is the RECORD: a blocked message is still stored, with the
 * reason, because "we did not send this, and here is why" is the evidence that
 * the gate works. A silently dropped message proves nothing.
 */
export function prepareOutbound(req: OutboundRequest): OutboundDecision {
  const decision = canSend({
    kind: req.kind,
    channel: req.channel,
    destination: req.destination,
    consentHistory: req.consentHistory,
    suppressions: req.suppressions,
    sentAt: req.sentAt,
    ...(req.contactErased === undefined ? {} : { contactErased: req.contactErased }),
  });

  return decision.send
    ? { status: 'send', consentId: decision.consentId, reason: decision.reason }
    : { status: 'blocked', consentId: null, reason: decision.reason };
}

/**
 * An idempotency key for an outbound send.
 *
 * Anything that reaches a provider is a job, and a job retries. Without a
 * stable key a retry sends the message twice, which for a marketing send is
 * also a second unlawful contact if consent lapsed between attempts.
 */
export const outboundIdempotencyKey = (
  leadId: string | null, channel: ConsentChannel, destination: string, bodyHash: string,
): string => `${leadId ?? 'no-lead'}:${channel}:${normaliseDestination(channel, destination)}:${bodyHash}`;

// ------------------------------------------------------------- reporting

export interface PipelineSummary {
  byStage: Record<LeadStage, number>;
  open: number;
  breachedSla: number;
  /** Won ÷ closed. Null when nothing has closed — 0% would be a lie. */
  conversionRate: number | null;
}

export function summarisePipeline(leads: readonly Lead[], now: Date): PipelineSummary {
  const byStage = {
    new: 0, contacted: 0, qualified: 0, appointment: 0,
    test_drive: 0, negotiating: 0, won: 0, lost: 0,
  } as Record<LeadStage, number>;

  let breachedSla = 0;
  for (const lead of leads) {
    byStage[lead.stage]++;
    if (!TERMINAL_STAGES.includes(lead.stage) && slaState(lead, now).breached) breachedSla++;
  }

  const closed = byStage.won + byStage.lost;
  return {
    byStage,
    open: leads.length - closed,
    breachedSla,
    // Reporting 0% against no closed deals reads as failure rather than as
    // absence of data, and a dealer who sees that stops trusting the dashboard.
    conversionRate: closed === 0 ? null : byStage.won / closed,
  };
}

/**
 * Why deals are being lost, most costly first.
 *
 * This is the report the whole structured-loss-reason rule exists to produce:
 * "you lost eleven deals on part-exchange valuations last month" is a buying
 * instruction, and it is invisible without it.
 */
export function lossAnalysis(leads: readonly Lead[]): { reason: LossReason; label: string; count: number }[] {
  const counts = new Map<LossReason, number>();
  for (const lead of leads) {
    if (lead.stage === 'lost' && lead.lossReason) {
      counts.set(lead.lossReason, (counts.get(lead.lossReason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: LOSS_REASON_LABELS[reason], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
