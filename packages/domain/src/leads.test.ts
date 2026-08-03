import { describe, it, expect } from 'vitest';
import {
  changeStage, reopen, allowedLeadTransitions, slaState, slaDueAt, DEFAULT_SLA_MINUTES,
  parseMarketplaceLead, prepareOutbound, outboundIdempotencyKey,
  summarisePipeline, lossAnalysis, LOSS_REASON_LABELS,
  type Lead, type LossReason,
} from './leads.js';
import type { ConsentRecord, SuppressionRecord } from './consent.js';

const AUG = (day: number, hour = 9, min = 0): Date =>
  new Date(Date.UTC(2026, 7, day, hour, min, 0));

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'l1', tenantId: 't1', contactId: 'p1', vehicleId: 'v1',
  source: 'website_enquiry', sourceReference: null,
  stage: 'new', assignedTo: null,
  receivedAt: AUG(3), firstResponseAt: null, dueAt: null,
  closedAt: null, lossReason: null, lossDetail: null, lostTo: null,
  ...over,
});

// ---------------------------------------------------------------- pipeline
describe('the lead pipeline', () => {
  it('moves forward through the funnel', () => {
    const r = changeStage(lead(), { stage: 'contacted', at: AUG(3, 10) });
    expect(r.ok).toBe(true);
    expect(r.lead.stage).toBe('contacted');
  });

  it('allows moving backwards — a real sale is not a neat funnel', () => {
    const r = changeStage(lead({ stage: 'negotiating' }), { stage: 'contacted', at: AUG(3, 10) });
    expect(r.ok).toBe(true);
  });

  it('REFUSES to mark a lead lost without a reason', () => {
    // The reason is never filled in later, so it must be impossible to skip at
    // the only moment anyone knows the answer.
    const r = changeStage(lead(), { stage: 'lost', at: AUG(3, 10) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/why this lead was lost/i);
    expect(r.lead.stage).toBe('new');
  });

  it('accepts a lost lead with a structured reason', () => {
    const r = changeStage(lead(), {
      stage: 'lost', lossReason: 'price_too_high', lostTo: 'Bletchley Motors', at: AUG(3, 10),
    });
    expect(r.ok).toBe(true);
    expect(r.lead.lossReason).toBe('price_too_high');
    expect(r.lead.closedAt).toEqual(AUG(3, 10));
  });

  it('stamps closedAt on won as well as lost', () => {
    const r = changeStage(lead(), { stage: 'won', at: AUG(3, 10) });
    expect(r.lead.closedAt).toEqual(AUG(3, 10));
  });

  it('will not silently move a closed lead', () => {
    // "won" quietly becoming "negotiating" would corrupt the conversion figure.
    const won = lead({ stage: 'won', closedAt: AUG(3) });
    const r = changeStage(won, { stage: 'negotiating', at: AUG(4) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reopen/i);
    expect(allowedLeadTransitions('won')).toHaveLength(0);
  });

  it('reopens explicitly, clearing the loss reason', () => {
    const lost = lead({ stage: 'lost', closedAt: AUG(3), lossReason: 'timing' });
    const r = reopen(lost);
    expect(r.ok).toBe(true);
    expect(r.lead.stage).toBe('negotiating');
    expect(r.lead.lossReason).toBeNull();
    expect(r.lead.closedAt).toBeNull();
  });

  it('every loss reason has a dealer-facing label', () => {
    for (const [reason, label] of Object.entries(LOSS_REASON_LABELS)) {
      expect(label.length, `${reason} needs a label`).toBeGreaterThan(3);
      // Dealer vocabulary: part-exchange, never trade-in.
      expect(label.toLowerCase()).not.toContain('trade-in');
    }
  });
});

// --------------------------------------------------------------------- SLA
describe('the SLA clock', () => {
  it('gives a marketplace lead the tightest target', () => {
    // The buyer has enquired on four cars and is waiting for whoever answers.
    expect(DEFAULT_SLA_MINUTES.autotrader).toBeLessThan(DEFAULT_SLA_MINUTES.website_enquiry);
    expect(DEFAULT_SLA_MINUTES.autotrader).toBeLessThan(DEFAULT_SLA_MINUTES.walk_in);
  });

  it('counts down before the deadline', () => {
    const s = slaState(lead({ receivedAt: AUG(3, 9) }), AUG(3, 9, 10));
    expect(s.breached).toBe(false);
    expect(s.minutesRemaining).toBe(20);
    expect(s.label).toContain('20 min to respond');
  });

  it('goes negative and says overdue once past it', () => {
    const s = slaState(lead({ receivedAt: AUG(3, 9) }), AUG(3, 10));
    expect(s.breached).toBe(true);
    expect(s.minutesRemaining).toBeLessThan(0);
    expect(s.label).toContain('overdue');
  });

  it('measures what the CUSTOMER waited, from the first outbound message', () => {
    const answered = lead({ receivedAt: AUG(3, 9), firstResponseAt: AUG(3, 9, 12) });
    const s = slaState(answered, AUG(4));
    expect(s.responseMinutes).toBe(12);
    expect(s.breached).toBe(false);
  });

  it('records a breach even once answered late', () => {
    const late = lead({ receivedAt: AUG(3, 9), firstResponseAt: AUG(3, 11) });
    const s = slaState(late, AUG(4));
    expect(s.breached).toBe(true);
    expect(s.responseMinutes).toBe(120);
  });

  it('honours a per-tenant override', () => {
    expect(slaDueAt(AUG(3, 9), 'website_enquiry', 5)).toEqual(AUG(3, 9, 5));
  });
});

// ----------------------------------------------------------- lead parsing
describe('marketplace lead parsing', () => {
  it('parses a well-formed lead', () => {
    const p = parseMarketplaceLead('autotrader', {
      name: 'Dave Smith', email: 'Dave@Example.com', phone: '07700 900123',
      registration: 'wn22 hnl', message: 'Is it still available?', reference: 'AT-9931',
    });
    expect(p.ok).toBe(true);
    expect(p.email).toBe('dave@example.com');
    expect(p.phone).toBe('+447700900123');
    expect(p.registration).toBe('WN22HNL');
    expect(p.problems).toHaveLength(0);
  });

  it('NEVER throws on an unexpected layout — it triages instead', () => {
    // Portals change their format without notice. A parser that throws drops
    // a real buyer on the floor.
    const p = parseMarketplaceLead('ebay', { something_unexpected: 'x' });
    expect(p.ok).toBe(false);
    expect(p.problems.length).toBeGreaterThan(0);
  });

  it('is usable with only a phone number', () => {
    const p = parseMarketplaceLead('facebook', { phone: '07700900123' });
    expect(p.ok).toBe(true);
    expect(p.problems).toContain('no customer name');
  });

  it('fails only when there is no way to reply at all', () => {
    const p = parseMarketplaceLead('cargurus', { name: 'Dave' });
    expect(p.ok).toBe(false);
    expect(p.problems.join(' ')).toMatch(/no way to reply/);
  });

  it('tolerates the different field names each portal uses', () => {
    const a = parseMarketplaceLead('autotrader', { customer_email: 'a@b.com' });
    const b = parseMarketplaceLead('ebay', { buyerEmail: 'a@b.com' });
    expect(a.email).toBe('a@b.com');
    expect(b.email).toBe('a@b.com');
  });
});

// ------------------------------------------------------ the outbound gate
describe('the outbound message gate', () => {
  const consent = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
    id: 'c1', tenantId: 't1', contactId: 'p1',
    channel: 'email', basis: 'explicit', granted: true,
    source: 'website_form', wordingId: 'w1',
    evidence: null, sourceDetail: null, expiresAt: null,
    recordedAt: AUG(1), recordedBy: null,
    ...over,
  });

  const base = {
    leadId: 'l1', contactId: 'p1',
    channel: 'email' as const, destination: 'dave@example.com',
    subject: 'About the Model X', body: 'Still available.',
    sentAt: AUG(10),
    consentHistory: [consent()],
    suppressions: [] as SuppressionRecord[],
  };

  it('sends a marketing message and cites the consent record by id', () => {
    // "We checked" is not evidence. Which record, by id, is.
    const d = prepareOutbound({ ...base, kind: 'marketing' });
    expect(d.status).toBe('send');
    expect(d.consentId).toBe('c1');
  });

  it('BLOCKS a marketing message with no consent record', () => {
    const d = prepareOutbound({ ...base, kind: 'marketing', consentHistory: [] });
    expect(d.status).toBe('blocked');
    expect(d.consentId).toBeNull();
  });

  it('blocks marketing withdrawn between queueing and sending', () => {
    const history = [
      consent({ id: 'grant', recordedAt: AUG(1) }),
      consent({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(9) }),
    ];
    expect(prepareOutbound({ ...base, kind: 'marketing', consentHistory: history }).status)
      .toBe('blocked');
  });

  it('lets a service reply through — a dealer must be able to answer', () => {
    const d = prepareOutbound({ ...base, kind: 'service', consentHistory: [] });
    expect(d.status).toBe('send');
  });

  it('lets suppression stop even a service message', () => {
    const suppressions = [{
      channel: 'email' as const, destination: 'dave@example.com',
      active: true, createdAt: AUG(2),
    }];
    expect(prepareOutbound({ ...base, kind: 'service', suppressions }).status).toBe('blocked');
  });

  it('blocks everything to an erased contact', () => {
    expect(prepareOutbound({ ...base, kind: 'service', contactErased: true }).status).toBe('blocked');
  });

  it('always gives a reason a human can act on', () => {
    const d = prepareOutbound({ ...base, kind: 'marketing', consentHistory: [] });
    expect(d.reason.length).toBeGreaterThan(10);
    expect(d.reason).not.toMatch(/error occurred/i);
  });

  it('builds a stable idempotency key so a retry cannot send twice', () => {
    const a = outboundIdempotencyKey('l1', 'email', 'Dave@Example.com', 'abc');
    const b = outboundIdempotencyKey('l1', 'email', 'dave@example.com', 'abc');
    expect(a).toBe(b);
    expect(outboundIdempotencyKey('l1', 'email', 'dave@example.com', 'different')).not.toBe(a);
  });
});

// ------------------------------------------------------------- reporting
describe('pipeline reporting', () => {
  it('reports null conversion when nothing has closed, never 0%', () => {
    // 0% against no data reads as failure and a dealer stops trusting it.
    const s = summarisePipeline([lead(), lead({ id: 'l2', stage: 'contacted' })], AUG(4));
    expect(s.conversionRate).toBeNull();
    expect(s.open).toBe(2);
  });

  it('computes conversion from closed leads only', () => {
    const leads = [
      lead({ id: 'a', stage: 'won', closedAt: AUG(3) }),
      lead({ id: 'b', stage: 'lost', closedAt: AUG(3), lossReason: 'timing' }),
      lead({ id: 'c', stage: 'negotiating' }),
    ];
    expect(summarisePipeline(leads, AUG(4)).conversionRate).toBe(0.5);
  });

  it('counts breached SLAs among open leads only', () => {
    const leads = [
      lead({ id: 'open-late', receivedAt: AUG(3, 1) }),
      lead({ id: 'closed-late', receivedAt: AUG(3, 1), stage: 'won', closedAt: AUG(3, 2) }),
    ];
    expect(summarisePipeline(leads, AUG(3, 12)).breachedSla).toBe(1);
  });

  it('ranks loss reasons so the costliest is first', () => {
    // "You lost eleven deals on part-exchange valuations" is a buying
    // instruction — and it is invisible without structured reasons.
    const mk = (id: string, reason: LossReason): Lead =>
      lead({ id, stage: 'lost', closedAt: AUG(3), lossReason: reason });
    const leads = [
      mk('1', 'part_ex_valuation'), mk('2', 'part_ex_valuation'),
      mk('3', 'part_ex_valuation'), mk('4', 'price_too_high'),
    ];
    const analysis = lossAnalysis(leads);
    expect(analysis[0]).toEqual({
      reason: 'part_ex_valuation',
      label: 'Not enough for their part-exchange',
      count: 3,
    });
  });
});
