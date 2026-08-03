import { describe, it, expect } from 'vitest';
import {
  consentPosition, softOptInAvailable, aggregatorConsentUsable, isSuppressed,
  canSend, normaliseDestination, consentGoesStaleOn,
  type ConsentRecord, type SuppressionRecord,
} from './consent.js';

const AUG = (day: number, hour = 12): Date =>
  new Date(Date.UTC(2026, 7, day, hour, 0, 0));

const record = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  id: 'c1', tenantId: 't1', contactId: 'p1',
  channel: 'email', basis: 'explicit', granted: true,
  source: 'website_form', wordingId: 'w1',
  evidence: null, sourceDetail: null, expiresAt: null,
  recordedAt: AUG(1), recordedBy: 'u1',
  ...over,
});

// ---------------------------------------------------------------- position
describe('the consent position', () => {
  it('refuses when there is no record at all', () => {
    const p = consentPosition('email', [], AUG(10));
    expect(p.permitted).toBe(false);
    expect(p.reason).toContain('no consent record');
  });

  it('permits on an explicit grant', () => {
    expect(consentPosition('email', [record()], AUG(10)).permitted).toBe(true);
  });

  it('treats a withdrawal as a new row that wins', () => {
    const history = [
      record({ id: 'grant', recordedAt: AUG(1) }),
      record({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(5) }),
    ];
    const p = consentPosition('email', history, AUG(10));
    expect(p.permitted).toBe(false);
    expect(p.record?.id).toBe('withdraw');
  });

  it('lets a later re-grant override an earlier withdrawal', () => {
    const history = [
      record({ id: 'grant', recordedAt: AUG(1) }),
      record({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(5) }),
      record({ id: 'regrant', recordedAt: AUG(8) }),
    ];
    expect(consentPosition('email', history, AUG(10)).record?.id).toBe('regrant');
  });

  it('answers as at the moment asked, not as at now', () => {
    // THE rule-7 test. A message sent on 3 August must be judged against the
    // position on 3 August, even though consent was withdrawn on the 5th.
    const history = [
      record({ id: 'grant', recordedAt: AUG(1) }),
      record({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(5) }),
    ];
    expect(consentPosition('email', history, AUG(3)).permitted).toBe(true);
    expect(consentPosition('email', history, AUG(10)).permitted).toBe(false);
  });

  it('ignores records dated after the moment asked about', () => {
    const history = [record({ id: 'future', recordedAt: AUG(20) })];
    expect(consentPosition('email', history, AUG(10)).permitted).toBe(false);
  });

  it('keeps channels separate — email consent is not SMS consent', () => {
    const history = [record({ channel: 'email' })];
    expect(consentPosition('email', history, AUG(10)).permitted).toBe(true);
    expect(consentPosition('sms', history, AUG(10)).permitted).toBe(false);
  });

  it('expires a consent that has passed its expiry', () => {
    const history = [record({ expiresAt: AUG(5) })];
    expect(consentPosition('email', history, AUG(4)).permitted).toBe(true);
    expect(consentPosition('email', history, AUG(6)).permitted).toBe(false);
  });

  it('refuses legitimate interest for electronic marketing to an individual', () => {
    // PECR reg. 22. This is the most common way a dealer's list goes unlawful.
    for (const channel of ['email', 'sms', 'whatsapp'] as const) {
      const p = consentPosition(channel, [record({ channel, basis: 'legitimate_interest' })], AUG(10));
      expect(p.permitted, `${channel} must not permit legitimate interest`).toBe(false);
      expect(p.reason).toContain('PECR reg. 22');
    }
  });

  it('still allows legitimate interest for post', () => {
    const p = consentPosition('post', [record({ channel: 'post', basis: 'legitimate_interest' })], AUG(10));
    expect(p.permitted).toBe(true);
  });

  it('always explains itself', () => {
    // Every decision has to be defensible to someone who was not there.
    for (const history of [[], [record({ granted: false, wordingId: null })], [record()]]) {
      expect(consentPosition('email', history, AUG(10)).reason.length).toBeGreaterThan(10);
    }
  });
});

// ------------------------------------------------------------- soft opt-in
describe('the PECR soft opt-in test', () => {
  const allTrue = {
    obtainedInSaleOrNegotiation: true,
    ownSimilarProductsOnly: true,
    optOutOfferedAtCollection: true,
    optOutInEveryMessage: true,
  };

  it('needs all four conditions', () => {
    expect(softOptInAvailable(allTrue).available).toBe(true);
  });

  it('fails if any single condition fails', () => {
    for (const key of Object.keys(allTrue) as (keyof typeof allTrue)[]) {
      const facts = { ...allTrue, [key]: false };
      expect(softOptInAvailable(facts).available, `${key} should be required`).toBe(false);
    }
  });

  it('reports EVERY failure, not just the first', () => {
    // Told only the first, someone fixes it, re-runs, finds the next — and a
    // compliance fix becomes four deployments.
    const result = softOptInAvailable({
      obtainedInSaleOrNegotiation: false,
      ownSimilarProductsOnly: false,
      optOutOfferedAtCollection: false,
      optOutInEveryMessage: false,
    });
    expect(result.failures).toHaveLength(4);
  });

  it('does not treat browsing as a negotiation', () => {
    // Someone looking at the website has not entered negotiations for a sale.
    expect(softOptInAvailable({ ...allTrue, obtainedInSaleOrNegotiation: false }).available).toBe(false);
  });
});

// ------------------------------------------------------------- aggregator
describe('aggregator consent', () => {
  it('is unusable when the dealer was not named', () => {
    const r = aggregatorConsentUsable({ namedThisDealer: false, evidenceOfWordingSupplied: true });
    expect(r.usable).toBe(false);
  });

  it('is unusable without the wording the customer agreed to', () => {
    const r = aggregatorConsentUsable({ namedThisDealer: true, evidenceOfWordingSupplied: false });
    expect(r.usable).toBe(false);
  });

  it('is usable only when both hold', () => {
    expect(aggregatorConsentUsable({ namedThisDealer: true, evidenceOfWordingSupplied: true }).usable).toBe(true);
  });
});

// ------------------------------------------------------------ normalisation
describe('destination normalisation', () => {
  it('folds email case and whitespace', () => {
    expect(normaliseDestination('email', ' Dave@Example.COM ')).toBe('dave@example.com');
  });

  it('brings UK numbers to one E.164 form', () => {
    const forms = ['07700 900123', '+447700900123', '447700900123', '(07700) 900-123'];
    const normalised = forms.map((f) => normaliseDestination('sms', f));
    expect(new Set(normalised).size, `got ${JSON.stringify(normalised)}`).toBe(1);
    expect(normalised[0]).toBe('+447700900123');
  });

  it('does NOT fold plus-addressing', () => {
    // a+cars@gmail.com is deliberately a different address from a@gmail.com:
    // silently merging two addresses someone kept separate suppresses mail
    // they may still want.
    expect(normaliseDestination('email', 'a+cars@gmail.com'))
      .not.toBe(normaliseDestination('email', 'a@gmail.com'));
  });
});

// ------------------------------------------------------------ suppression
describe('suppression', () => {
  const supp = (over: Partial<SuppressionRecord> = {}): SuppressionRecord => ({
    channel: 'email', destination: 'dave@example.com', active: true, createdAt: AUG(2), ...over,
  });

  it('matches regardless of how the address was typed', () => {
    expect(isSuppressed('email', ' DAVE@Example.com ', [supp()], AUG(10))).toBe(true);
  });

  it('lets a later re-subscribe lift it, keeping both rows', () => {
    const history = [supp({ createdAt: AUG(2) }), supp({ active: false, createdAt: AUG(6) })];
    expect(isSuppressed('email', 'dave@example.com', history, AUG(10))).toBe(false);
    // and the history is still there to read as at an earlier date
    expect(isSuppressed('email', 'dave@example.com', history, AUG(4))).toBe(true);
  });

  it('is per channel', () => {
    expect(isSuppressed('sms', 'dave@example.com', [supp()], AUG(10))).toBe(false);
  });
});

// -------------------------------------------------------------- send gate
describe('the send-time gate', () => {
  const base = {
    channel: 'email' as const,
    destination: 'dave@example.com',
    consentHistory: [record()],
    suppressions: [] as SuppressionRecord[],
    sentAt: AUG(10),
  };

  it('sends marketing when consent is valid', () => {
    const d = canSend({ ...base, kind: 'marketing' });
    expect(d.send).toBe(true);
    expect(d.consentId).toBe('c1');
  });

  it('blocks marketing with no consent record', () => {
    expect(canSend({ ...base, kind: 'marketing', consentHistory: [] }).send).toBe(false);
  });

  it('blocks marketing withdrawn between scheduling and sending', () => {
    // The scenario rule 7 is written for.
    const history = [
      record({ id: 'grant', recordedAt: AUG(1) }),
      record({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(9) }),
    ];
    expect(canSend({ ...base, kind: 'marketing', consentHistory: history }).send).toBe(false);
  });

  it('lets a service reply through without marketing consent', () => {
    // A dealer must be able to answer their own customer's enquiry.
    const d = canSend({ ...base, kind: 'service', consentHistory: [] });
    expect(d.send).toBe(true);
  });

  it('lets suppression override even a service message', () => {
    // A hard bounce or a spam complaint means stop, whatever the message is.
    const suppressions = [{
      channel: 'email' as const, destination: 'dave@example.com',
      active: true, createdAt: AUG(2),
    }];
    expect(canSend({ ...base, kind: 'service', suppressions }).send).toBe(false);
    expect(canSend({ ...base, kind: 'marketing', suppressions }).send).toBe(false);
  });

  it('blocks everything to an erased contact', () => {
    expect(canSend({ ...base, kind: 'service', contactErased: true }).send).toBe(false);
    expect(canSend({ ...base, kind: 'marketing', contactErased: true }).send).toBe(false);
  });

  it('never returns a consentId it did not rely on', () => {
    // The id is written against the message as evidence. A blocked send that
    // still handed back an id would put a false citation in the audit trail.
    const blocked = canSend({ ...base, kind: 'marketing', consentHistory: [] });
    expect(blocked.consentId).toBeNull();
    const service = canSend({ ...base, kind: 'service', consentHistory: [] });
    expect(service.consentId).toBeNull();
  });

  it('always says why', () => {
    for (const kind of ['marketing', 'service'] as const) {
      expect(canSend({ ...base, kind }).reason.length).toBeGreaterThan(10);
    }
  });
});

describe('consent staleness', () => {
  it('goes stale two years after the last activity', () => {
    expect(consentGoesStaleOn(new Date('2026-08-03T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2028-08-03');
  });
});
