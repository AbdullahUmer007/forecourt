import { describe, it, expect } from 'vitest';
import {
  findDuplicates, planMerge, redactVulnerability, dsrDueDate, planErasure,
  erasedContact, VULNERABILITY_PERMISSION, type Contact,
} from './contacts.js';
import { consentPosition, type ConsentRecord } from './consent.js';

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: 'p1', tenantId: 't1', kind: 'individual',
  firstName: 'Dave', lastName: 'Smith', companyName: null,
  email: 'dave@example.com', phone: '07700900123', postcode: 'MK2 2BA',
  vulnerabilityDrivers: [], vulnerabilityNote: null,
  legalHold: false, legalHoldReason: null,
  mergedIntoId: null, erasedAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

// ---------------------------------------------------------------- dupes
describe('duplicate detection', () => {
  it('matches on email however it was typed', () => {
    const existing = [contact({ id: 'p2', email: 'DAVE@Example.com ' })];
    const [m] = findDuplicates({ ...contact(), phone: null }, existing);
    expect(m?.contactId).toBe('p2');
    expect(m?.autoMergeable).toBe(true);
  });

  it('matches on phone across UK number formats', () => {
    const existing = [contact({ id: 'p2', email: null, phone: '+44 7700 900123' })];
    const [m] = findDuplicates({ ...contact(), email: null }, existing);
    expect(m?.signals).toContain('same phone number');
    expect(m?.autoMergeable).toBe(true);
  });

  it('does NOT auto-merge a name-and-postcode match', () => {
    // A father and son at one address are two people with two sets of
    // consent and two finance histories. Auto-merging them would combine both.
    const existing = [contact({ id: 'p2', email: 'other@example.com', phone: '07700900999' })];
    const [m] = findDuplicates({ ...contact() }, existing);
    expect(m).toBeDefined();
    expect(m!.autoMergeable).toBe(false);
    expect(m!.signals).toContain('same surname');
  });

  it('never proposes a merged-away or erased record', () => {
    const existing = [
      contact({ id: 'gone', mergedIntoId: 'p9' }),
      contact({ id: 'erased', erasedAt: new Date() }),
    ];
    expect(findDuplicates(contact(), existing)).toHaveLength(0);
  });

  it('ranks the strongest match first', () => {
    const existing = [
      contact({ id: 'weak', email: null, phone: null }),
      contact({ id: 'strong' }),
    ];
    expect(findDuplicates(contact(), existing)[0]?.contactId).toBe('strong');
  });

  it('explains every match', () => {
    const [m] = findDuplicates(contact(), [contact({ id: 'p2' })]);
    expect(m!.signals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- merge
describe('merging contacts', () => {
  const consent = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
    id: 'c1', tenantId: 't1', contactId: 'p2',
    channel: 'email', basis: 'explicit', granted: true,
    source: 'website_form', wordingId: 'w1',
    evidence: null, sourceDetail: null, expiresAt: null,
    recordedAt: new Date('2026-08-01T00:00:00Z'), recordedBy: null,
    ...over,
  });

  it('refuses to merge a contact into itself', () => {
    expect(() => planMerge(contact(), contact(), [])).toThrow(/into itself/);
  });

  it('refuses to merge across tenants', () => {
    // A cross-tenant merge is the leak this codebase exists to prevent,
    // arriving through a housekeeping feature.
    expect(() => planMerge(contact(), contact({ id: 'p2', tenantId: 'OTHER' }), []))
      .toThrow(/across tenants/);
  });

  it('fills the winner’s gaps from the loser', () => {
    const winner = contact({ phone: null });
    const loser = contact({ id: 'p2', phone: '07700900456' });
    expect(planMerge(winner, loser, []).fields.phone).toBe('07700900456');
  });

  it('keeps the winner’s value and warns when both differ', () => {
    const plan = planMerge(contact(), contact({ id: 'p2', firstName: 'David' }), []);
    expect(plan.fields.firstName).toBeUndefined();
    expect(plan.warnings.join(' ')).toContain('firstName differs');
  });

  it('NEVER drops a consent record — it re-points them', () => {
    // A merge that loses a withdrawal re-subscribes someone who unsubscribed.
    const consents = [
      consent({ id: 'grant', contactId: 'p2' }),
      consent({ id: 'withdraw', contactId: 'p2', granted: false, wordingId: null }),
    ];
    const plan = planMerge(contact(), contact({ id: 'p2' }), consents);
    expect(plan.consentIdsToRepoint).toEqual(['grant', 'withdraw']);
  });

  it('a withdrawal on the losing record still blocks after the merge', () => {
    // The end-to-end property that matters: merge, re-point, then ask.
    const merged = [
      consent({ id: 'grant', contactId: 'p1', recordedAt: new Date('2026-08-01T00:00:00Z') }),
      consent({
        id: 'withdraw', contactId: 'p1', granted: false, wordingId: null,
        recordedAt: new Date('2026-08-05T00:00:00Z'),
      }),
    ];
    expect(consentPosition('email', merged, new Date('2026-08-10T00:00:00Z')).permitted).toBe(false);
  });

  it('unions vulnerability drivers rather than replacing them', () => {
    const winner = contact({ vulnerabilityDrivers: ['health'] });
    const loser = contact({ id: 'p2', vulnerabilityDrivers: ['resilience'] });
    const plan = planMerge(winner, loser, []);
    expect(new Set(plan.fields.vulnerabilityDrivers)).toEqual(new Set(['health', 'resilience']));
  });

  it('inherits a legal hold from either side', () => {
    const loser = contact({ id: 'p2', legalHold: true, legalHoldReason: 'finance complaint' });
    const plan = planMerge(contact(), loser, []);
    expect(plan.fields.legalHold).toBe(true);
    expect(plan.fields.legalHoldReason).toBe('finance complaint');
  });
});

// -------------------------------------------------------- vulnerability
describe('vulnerability access', () => {
  const c = contact({ vulnerabilityDrivers: ['health'], vulnerabilityNote: 'Recently bereaved' });

  it('redacts without the permission', () => {
    const out = redactVulnerability(c, new Set(['contact.read']));
    expect(out.vulnerabilityDrivers).toEqual([]);
    expect(out.vulnerabilityNote).toBeNull();
  });

  it('shows with the permission', () => {
    expect(redactVulnerability(c, new Set([VULNERABILITY_PERMISSION])).vulnerabilityNote)
      .toBe('Recently bereaved');
  });

  it('shows for a wildcard principal', () => {
    expect(redactVulnerability(c, new Set(['*'])).vulnerabilityDrivers).toEqual(['health']);
  });
});

// ------------------------------------------------------------------ DSR
describe('data subject requests', () => {
  it('is due one month after the request', () => {
    expect(dsrDueDate(new Date('2026-08-03T00:00:00Z')).toISOString().slice(0, 10))
      .toBe('2026-09-02');
  });

  it('erases in full when nothing must be retained', () => {
    const d = planErasure({
      legalHold: false, legalHoldReason: null,
      hasFinanceIntroduction: false, hasStockBookEntry: false,
    });
    expect(d.erase).toBe(true);
    expect(d.retained).toHaveLength(0);
  });

  it('erases the rest but retains a statutory record — not all-or-nothing', () => {
    // Refusing the WHOLE request because one invoice must be kept is
    // over-refusal, and is its own breach.
    const d = planErasure({
      legalHold: false, legalHoldReason: null,
      hasFinanceIntroduction: true, hasStockBookEntry: true,
    });
    expect(d.erase).toBe(true);
    expect(d.retained).toHaveLength(2);
  });

  it('refuses under a legal hold, and says why', () => {
    const d = planErasure({
      legalHold: true, legalHoldReason: 'live FOS complaint',
      hasFinanceIntroduction: false, hasStockBookEntry: false,
    });
    expect(d.erase).toBe(false);
    expect(d.reason).toContain('live FOS complaint');
  });

  it('scrubs the fields but keeps the id', () => {
    // Deal and invoice rows reference this id; a dangling reference inside a
    // compliance record is worse than a tombstone.
    const out = erasedContact(contact(), new Date('2026-08-10T00:00:00Z'));
    expect(out.id).toBe('p1');
    expect(out.email).toBeNull();
    expect(out.firstName).toBeNull();
    expect(out.vulnerabilityNote).toBeNull();
    expect(out.erasedAt).not.toBeNull();
  });
});
