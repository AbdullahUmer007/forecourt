/**
 * GOLDEN RULE 3: a marketing message never dispatches without a valid consent
 * record.
 *
 * `forecourt-feature` names three golden-file tests that must never be
 * deleted. The other two guard the margin-scheme invoice and the finance
 * promotion. This is the third, and it is the one M9 and M10 exist to make
 * enforceable.
 *
 * It is deliberately adversarial: rather than asserting the happy path works,
 * it enumerates every way a message could reach a person who has not agreed to
 * receive it, and asserts each one is refused. A gate is only worth having if
 * you have tried to get past it.
 */

import { describe, it, expect } from 'vitest';
import {
  canSend, consentPosition, type ConsentRecord, type SuppressionRecord, type ConsentChannel,
} from '../../packages/domain/src/consent.js';
import { prepareOutbound } from '../../packages/domain/src/leads.js';
import { canSendAlertWithConsent } from '../../packages/domain/src/shortlist.js';
import { EMPTY_QUERY } from '../../packages/domain/src/search.js';

const AUG = (d: number): Date => new Date(Date.UTC(2026, 7, d, 12));

const consent = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  id: 'c1', tenantId: 't1', contactId: 'p1',
  channel: 'email', basis: 'explicit', granted: true,
  source: 'website_form', wordingId: 'w1',
  evidence: null, sourceDetail: null, expiresAt: null,
  recordedAt: AUG(1), recordedBy: null,
  ...over,
});

const outbound = (over: Record<string, unknown> = {}) => ({
  leadId: 'l1', contactId: 'p1',
  channel: 'email' as const, destination: 'dave@example.com',
  subject: 'Our latest stock', body: 'Cars!',
  kind: 'marketing' as const,
  sentAt: AUG(10),
  consentHistory: [consent()],
  suppressions: [] as SuppressionRecord[],
  ...over,
});

describe('GOLDEN: a marketing message cannot dispatch without valid consent', () => {
  it('sends only when a real consent record permits it', () => {
    const d = prepareOutbound(outbound());
    expect(d.status).toBe('send');
    // The record is cited BY ID. "We checked" is not evidence.
    expect(d.consentId).toBe('c1');
  });

  // Every way in. Each of these has been a real breach at some company.
  const refusals: [string, Record<string, unknown>][] = [
    ['no consent record at all', { consentHistory: [] }],
    ['consent withdrawn before the send', {
      consentHistory: [
        consent({ id: 'grant', recordedAt: AUG(1) }),
        consent({ id: 'withdraw', granted: false, wordingId: null, recordedAt: AUG(9) }),
      ],
    }],
    ['consent expired', { consentHistory: [consent({ expiresAt: AUG(5) })] }],
    ['consent for a different channel only', {
      channel: 'sms', consentHistory: [consent({ channel: 'email' })],
    }],
    ['legitimate interest claimed for email', {
      consentHistory: [consent({ basis: 'legitimate_interest' })],
    }],
    ['destination on the suppression list', {
      suppressions: [{
        channel: 'email' as ConsentChannel, destination: 'dave@example.com',
        active: true, createdAt: AUG(2),
      }],
    }],
    ['contact erased under a DSR', { contactErased: true }],
  ];

  for (const [scenario, over] of refusals) {
    it(`refuses to dispatch: ${scenario}`, () => {
      const d = prepareOutbound(outbound(over));
      expect(d.status, scenario).toBe('blocked');
      // A blocked send must never hand back a consent id — that would put a
      // false citation in the audit trail.
      expect(d.consentId, scenario).toBeNull();
      expect(d.reason.length, scenario).toBeGreaterThan(10);
    });
  }

  it('a consent record dated AFTER the send does not justify it', () => {
    // Back-dating: someone re-subscribes later, and the earlier send must not
    // become retrospectively lawful.
    const d = prepareOutbound(outbound({
      consentHistory: [consent({ recordedAt: AUG(20) })], sentAt: AUG(10),
    }));
    expect(d.status).toBe('blocked');
  });

  it('the same gate governs saved-search alerts', () => {
    // An alert is direct marketing. If it were sent as a service message it
    // would bypass consent entirely — the single most damaging mistake
    // available in this module.
    const search = {
      id: 's1', tenantId: 't1', contactId: 'p1', token: null,
      name: 'Automatic Golf', canonicalPath: '/used-cars/vw/golf',
      query: EMPTY_QUERY, frequency: 'daily' as const,
      consentId: 'c1', createdAt: AUG(1), lastNotifiedAt: null,
    };
    const blocked = canSendAlertWithConsent(search, {
      now: AUG(10), matchingVehicleCount: 5,
      channel: 'email', destination: 'dave@example.com',
      consentHistory: [], suppressions: [],
    });
    expect(blocked.send).toBe(false);
  });

  it('a service reply is NOT blocked — a dealer must answer their own customer', () => {
    // The exemption has to exist, and it has to be narrow. It covers replies
    // to something the person asked for, and nothing else.
    expect(prepareOutbound(outbound({ kind: 'service', consentHistory: [] })).status).toBe('send');
  });

  it('but suppression still stops a service message', () => {
    const suppressions = [{
      channel: 'email' as ConsentChannel, destination: 'dave@example.com',
      active: true, createdAt: AUG(2),
    }];
    expect(prepareOutbound(outbound({ kind: 'service', suppressions })).status).toBe('blocked');
  });

  it('there is exactly ONE implementation of the decision', () => {
    // `prepareOutbound` must delegate to `canSend` rather than reimplementing
    // it. Two copies drift, and they disagree precisely when it matters.
    const args = outbound({ consentHistory: [consent()] });
    const viaGate = canSend({
      kind: 'marketing', channel: 'email', destination: 'dave@example.com',
      consentHistory: [consent()], suppressions: [], sentAt: AUG(10),
    });
    const viaOutbound = prepareOutbound(args);
    expect(viaOutbound.status === 'send').toBe(viaGate.send);
    expect(viaOutbound.consentId).toBe(viaGate.consentId);
  });

  it('the position is always explainable to someone who was not there', () => {
    const p = consentPosition('email', [consent({ granted: false, wordingId: null })], AUG(10));
    expect(p.reason).toMatch(/withdrawn/);
    expect(p.record?.id).toBeDefined();
  });
});
