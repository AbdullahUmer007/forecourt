/**
 * M9 — consent, as a record.
 *
 * CLAUDE.md rule 7: consent is a record, never a boolean — channel, basis,
 * source, timestamp, wording version — and it is re-checked AT SEND TIME.
 *
 * The reason that rule exists is that `marketing_opt_in = true` cannot answer
 * any question an ICO investigation actually asks. Which channel? On what
 * lawful basis? Obtained how, and when? Showing what words? A boolean answers
 * none of them, and by the time anyone asks, the evidence is gone.
 *
 * So the current position of a channel is DERIVED from an append-only history
 * rather than stored. `consentPosition()` is the only way to ask, and it takes
 * the moment you are asking about, because "did we have consent?" is always a
 * question about a point in time — usually the moment a message went out, not
 * the moment someone is reading the record afterwards.
 *
 * ⚠️ Not legal advice, and not a substitute for the retained consultant's
 * sign-off. What is encoded here is the four-part PECR reg. 22 test and the
 * shape of the record; whether a given dealer's wording satisfies it is a
 * question for someone qualified to answer it.
 */

// ---------------------------------------------------------------- types

export type ConsentChannel = 'email' | 'sms' | 'phone' | 'post' | 'whatsapp';
export type ConsentBasis = 'explicit' | 'soft_opt_in' | 'legitimate_interest';
export type ConsentSource =
  | 'website_form' | 'in_person' | 'telephone' | 'import' | 'aggregator' | 'staff_entry';

/**
 * The channels PECR reg. 22 governs — unsolicited direct marketing by
 * electronic mail, which includes SMS. Post and live telephone calls are
 * governed differently (TPS for phone, legitimate interest available for
 * post), which is why the basis rules below branch on this set rather than
 * treating every channel the same.
 */
export const PECR_ELECTRONIC_CHANNELS: readonly ConsentChannel[] = ['email', 'sms', 'whatsapp'];

export interface ConsentRecord {
  id: string;
  tenantId: string;
  contactId: string;
  channel: ConsentChannel;
  basis: ConsentBasis;
  /** false is a WITHDRAWAL — a new row, never an edit to the granting row. */
  granted: boolean;
  source: ConsentSource;
  /** Which exact words were shown. Required on a grant, absent on a withdrawal. */
  wordingId: string | null;
  evidence: string | null;
  sourceDetail: string | null;
  expiresAt: Date | null;
  recordedAt: Date;
  recordedBy: string | null;
}

export interface SuppressionRecord {
  channel: ConsentChannel;
  /** Normalised by `normaliseDestination`. */
  destination: string;
  active: boolean;
  createdAt: Date;
}

// ------------------------------------------------------------ normalisation

/**
 * Normalise a destination so a suppression written one way still matches a
 * send addressed another way.
 *
 * "Dave@Example.COM " and "dave@example.com" are the same inbox, and a
 * suppression that only matches the exact bytes someone typed is a suppression
 * that fails the first time it matters. Phone numbers go to E.164 for the same
 * reason: 07700 900123, +447700900123 and 447700900123 are one handset.
 *
 * Deliberately NOT doing gmail dot-stripping or plus-address folding: those are
 * provider-specific behaviours, and treating `a+cars@gmail.com` as the same
 * address as `a@gmail.com` would suppress mail the person may still want.
 * Over-suppressing is safer than under-suppressing, but silently merging two
 * addresses a user deliberately kept separate is its own kind of wrong.
 */
export function normaliseDestination(channel: ConsentChannel, raw: string): string {
  const trimmed = raw.trim();
  if (channel === 'email') return trimmed.toLowerCase();

  if (channel === 'sms' || channel === 'phone' || channel === 'whatsapp') {
    const digits = trimmed.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    // UK national → E.164. 07700 900123 becomes +447700900123.
    if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
    if (digits.startsWith('44')) return `+${digits}`;
    return digits;
  }
  return trimmed.toLowerCase();
}

// ------------------------------------------------------------ the position

export interface ConsentPosition {
  channel: ConsentChannel;
  /** Whether marketing may be sent on this channel at the asked-about moment. */
  permitted: boolean;
  basis: ConsentBasis | null;
  /** The record the answer came from, so a decision is always explainable. */
  record: ConsentRecord | null;
  /** Plain English, for the CRM and for an audit response. */
  reason: string;
}

/**
 * The consent position for one channel, AS AT a given moment.
 *
 * `asAt` is required rather than defaulted to now, because every caller wants
 * a different moment and the wrong default is silent: a send job wants the
 * send time, an audit wants the date of the message being complained about,
 * and a CRM screen wants now. Making it explicit means nobody gets the
 * scheduling-time answer to a send-time question, which is the exact bug
 * rule 7 exists to prevent.
 */
export function consentPosition(
  channel: ConsentChannel,
  history: readonly ConsentRecord[],
  asAt: Date,
): ConsentPosition {
  const relevant = history
    .filter((r) => r.channel === channel && r.recordedAt.getTime() <= asAt.getTime())
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const latest = relevant.at(-1);

  if (!latest) {
    return {
      channel, permitted: false, basis: null, record: null,
      reason: `no consent record for ${channel}`,
    };
  }

  if (!latest.granted) {
    return {
      channel, permitted: false, basis: latest.basis, record: latest,
      reason: `consent withdrawn on ${latest.recordedAt.toISOString().slice(0, 10)}`,
    };
  }

  if (latest.expiresAt && latest.expiresAt.getTime() <= asAt.getTime()) {
    return {
      channel, permitted: false, basis: latest.basis, record: latest,
      reason: `consent expired on ${latest.expiresAt.toISOString().slice(0, 10)}`,
    };
  }

  // Legitimate interest cannot carry unsolicited electronic marketing to an
  // individual — that is what PECR reg. 22 says, and it is the most common
  // way a dealer's mailing list becomes unlawful. It remains available for
  // post, and for corporate subscribers.
  if (latest.basis === 'legitimate_interest' && PECR_ELECTRONIC_CHANNELS.includes(channel)) {
    return {
      channel, permitted: false, basis: latest.basis, record: latest,
      reason: `legitimate interest cannot support ${channel} marketing to an individual (PECR reg. 22)`,
    };
  }

  return {
    channel, permitted: true, basis: latest.basis, record: latest,
    reason: latest.basis === 'soft_opt_in'
      ? 'PECR soft opt-in from an existing customer relationship'
      : `${latest.basis} consent recorded ${latest.recordedAt.toISOString().slice(0, 10)}`,
  };
}

// -------------------------------------------------------- soft opt-in test

export interface SoftOptInFacts {
  /**
   * Details obtained directly from this person in the course of a sale or
   * NEGOTIATIONS for a sale. A quote request, a test-drive booking or a
   * part-exchange valuation counts. Browsing the website does not, and neither
   * does a list someone bought.
   */
  obtainedInSaleOrNegotiation: boolean;
  /** Marketing limited to the dealer's OWN similar products or services. */
  ownSimilarProductsOnly: boolean;
  /** A clear, free opt-out was offered AT THE POINT OF COLLECTION. */
  optOutOfferedAtCollection: boolean;
  /** Every subsequent message carries an easy opt-out. */
  optOutInEveryMessage: boolean;
}

export interface SoftOptInResult {
  available: boolean;
  /** Every condition that failed, not just the first — a partial fix is not a fix. */
  failures: string[];
}

/**
 * The PECR reg. 22 soft opt-in test: all four conditions, or none of it.
 *
 * Returns every failure rather than short-circuiting, because someone fixing
 * this needs the whole list. Told only about the first, they fix it, re-run,
 * and discover the second — which is how a compliance fix becomes four
 * deployments.
 */
export function softOptInAvailable(facts: SoftOptInFacts): SoftOptInResult {
  const failures: string[] = [];
  if (!facts.obtainedInSaleOrNegotiation) {
    failures.push('details were not obtained during a sale or negotiations for one');
  }
  if (!facts.ownSimilarProductsOnly) {
    failures.push('marketing is not limited to the dealer’s own similar products or services');
  }
  if (!facts.optOutOfferedAtCollection) {
    failures.push('no free opt-out was offered at the point of collection');
  }
  if (!facts.optOutInEveryMessage) {
    failures.push('subsequent messages do not all carry an easy opt-out');
  }
  return { available: failures.length === 0, failures };
}

/**
 * A third party's consent generally cannot be relied on for THIS dealer.
 *
 * An aggregator's "the customer agreed to be contacted by selected partners"
 * is not consent for a named dealer unless that dealer was named. Soft opt-in
 * cannot rescue it either — the details were not obtained by this dealer in
 * the course of a sale. So an aggregator lead can be responded to about the
 * enquiry itself (that is not marketing) but cannot be added to a mailing
 * list on the strength of the aggregator's tick box.
 */
export function aggregatorConsentUsable(facts: {
  namedThisDealer: boolean;
  evidenceOfWordingSupplied: boolean;
}): { usable: boolean; reason: string } {
  if (!facts.namedThisDealer) {
    return {
      usable: false,
      reason: 'the customer was not told this dealer specifically would contact them',
    };
  }
  if (!facts.evidenceOfWordingSupplied) {
    return {
      usable: false,
      reason: 'the aggregator did not supply the wording the customer actually agreed to',
    };
  }
  return { usable: true, reason: 'the customer was named this dealer and the wording was supplied' };
}

// -------------------------------------------------------------- suppression

/**
 * Whether a destination is suppressed, as at a moment.
 *
 * Latest row wins, so an unsubscribe followed by a re-subscribe reads as
 * permitted while both rows survive as history.
 */
export function isSuppressed(
  channel: ConsentChannel,
  destination: string,
  suppressions: readonly SuppressionRecord[],
  asAt: Date,
): boolean {
  const target = normaliseDestination(channel, destination);
  const latest = suppressions
    .filter((s) => s.channel === channel
      && s.destination === target
      && s.createdAt.getTime() <= asAt.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
  return latest?.active ?? false;
}

// ------------------------------------------------------- the send-time gate

export type MessageKind =
  /** Marketing. Needs a lawful basis and is blocked without one. */
  | 'marketing'
  /**
   * A reply to something this person asked for: an enquiry response, a booked
   * test-drive confirmation, an invoice, an MOT reminder for a car they bought.
   * Not direct marketing, so it does not need marketing consent — and blocking
   * it would mean a dealer could not answer their own customer, which is both
   * absurd and worse for the customer.
   */
  | 'service';

export interface SendGateInput {
  kind: MessageKind;
  channel: ConsentChannel;
  destination: string;
  consentHistory: readonly ConsentRecord[];
  suppressions: readonly SuppressionRecord[];
  /** The moment of SENDING. Not the moment of scheduling. */
  sentAt: Date;
  /** Set when the contact record has been erased under a DSR. */
  contactErased?: boolean;
}

export interface SendDecision {
  send: boolean;
  reason: string;
  /** The consent record relied on, recorded against the message as evidence. */
  consentId: string | null;
}

/**
 * The gate every outbound message passes through, evaluated at send time.
 *
 * This is the third of the three golden-file rules in `forecourt-feature`:
 * a marketing message never dispatches without a valid consent record. The
 * check lives here, as a pure function with tests, rather than inside a queue
 * worker where it cannot be exercised.
 *
 * Order matters. Suppression is checked BEFORE consent, because a suppression
 * overrides everything: someone who has said "stop" has said stop, even if a
 * later consent record exists somewhere, and even for a service message where
 * the suppression was a hard bounce or a spam complaint.
 */
export function canSend(input: SendGateInput): SendDecision {
  if (input.contactErased) {
    return { send: false, reason: 'contact has been erased under a data subject request', consentId: null };
  }

  if (isSuppressed(input.channel, input.destination, input.suppressions, input.sentAt)) {
    return {
      send: false,
      reason: `${input.destination} is on the suppression list for ${input.channel}`,
      consentId: null,
    };
  }

  if (input.kind === 'service') {
    return {
      send: true,
      reason: 'service message about something this contact asked for — not direct marketing',
      consentId: null,
    };
  }

  const position = consentPosition(input.channel, input.consentHistory, input.sentAt);
  return position.permitted
    ? { send: true, reason: position.reason, consentId: position.record?.id ?? null }
    : { send: false, reason: position.reason, consentId: null };
}

// ------------------------------------------------------------- staleness

/**
 * ICO good practice, not law: consent goes stale after roughly two years of
 * inactivity. Expressed in months so the value can move to `compliance_rules`
 * without changing a call site, and returned as a DATE rather than a boolean
 * so the CRM can show "goes stale in March" instead of only "stale".
 */
export const CONSENT_STALE_MONTHS = 24;

export function consentGoesStaleOn(lastActivity: Date, staleMonths = CONSENT_STALE_MONTHS): Date {
  const d = new Date(lastActivity);
  d.setMonth(d.getMonth() + staleMonths);
  return d;
}
