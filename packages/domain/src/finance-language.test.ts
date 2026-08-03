/**
 * M8 — cost-of-credit language detection.
 *
 * The scanner's value is entirely in its precision. One false positive on a
 * cash price and a dealer switches it off; one miss on "£199 a month" and they
 * have an unaccompanied financial promotion on 120 pages.
 */

import { describe, it, expect } from 'vitest';
import { scanForCostOfCredit, publishDecision } from './finance-language.js';

const kinds = (text: string): string[] => scanForCostOfCredit('description', text).map((f) => f.kind);

describe('what the scanner must catch', () => {
  it.each([
    ['Only £199 per month!', 'periodic_payment'],
    ['From £149 a month with finance', 'periodic_payment'],
    ['£99/month', 'periodic_payment'],
    ['£250 pcm', 'periodic_payment'],
    ['Monthly payments of £189', 'periodic_payment'],
    ['9.9% APR representative', 'apr'],
    ['12.9%APR', 'apr'],
    ['5.9% interest', 'interest_rate'],
    ['4.5% per annum', 'interest_rate'],
    ['0% finance available', 'credit_offer'],
    ['Interest free credit', 'credit_offer'],
    ['Bad credit? No problem', 'credit_offer'],
    ['Guaranteed finance for everyone', 'credit_offer'],
    ['No deposit needed', 'deposit_incentive'],
    ['Nothing to pay until January', 'deposit_incentive'],
  ])('flags %j as %s', (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it('reports where it found it, so the dealer can go and fix it', () => {
    const [finding] = scanForCostOfCredit('description', 'Lovely car. Only £199 per month.');
    expect(finding!.match).toBe('£199 per month');
    expect(finding!.index).toBeGreaterThan(0);
    expect(finding!.field).toBe('description');
    expect(finding!.explanation).toMatch(/CONC 3\.5\.3R/);
    expect(finding!.suggestion).toMatch(/finance block/);
  });
});

describe('what the scanner must NOT catch', () => {
  // A scanner that flags every price gets switched off in a week and then
  // protects nothing. False positives are the failure mode here, not misses.
  it.each([
    'One owner from new, £12,995.',
    'Full service history. Priced at £8,499 with a new MOT.',
    'Two keys, £150 of new tyres fitted during prep.',
    '£1,200 below the retail price guide.',
    'Six months warranty included, worth £399.',
    'Road tax is £190 a year.',
    'This car has done 40,470 miles.',
    'Comes with a 5% discount on servicing for a year.',
  ])('leaves %j alone', (text) => {
    expect(scanForCostOfCredit('description', text)).toEqual([]);
  });
});

describe('scanning more than one field', () => {
  it('does not lose matches in later fields to a stateful regex', () => {
    // A shared global RegExp keeps `lastIndex` between calls, which silently
    // skips matches in every field after the first. That bug is invisible in a
    // single-field test, so it gets its own.
    const decision = publishDecision({
      hasRepresentativeExample: false,
      fields: {
        title: '£199 per month',
        description: '£249 per month',
        'block:hero': '£299 per month',
      },
    });
    expect(decision.findings).toHaveLength(3);
    expect(decision.findings.map((f) => f.field).sort()).toEqual(['block:hero', 'description', 'title']);
  });
});

describe('the publish gate', () => {
  it('lets clean copy through', () => {
    const decision = publishDecision({
      hasRepresentativeExample: false,
      fields: { description: 'One owner from new, full service history, £12,995.' },
    });
    expect(decision.canPublish).toBe(true);
    expect(decision.message).toBeNull();
  });

  it('blocks a payment figure with no example on the page', () => {
    const decision = publishDecision({
      hasRepresentativeExample: false,
      fields: { description: 'Drive away for £199 a month!' },
    });
    expect(decision.canPublish).toBe(false);
    // What happened, why, and what to do — never "An error occurred".
    expect(decision.message).toMatch(/Can't publish/);
    expect(decision.message).toMatch(/£199 a month/);
    expect(decision.message).toMatch(/description/);
    expect(decision.message).toMatch(/CONC 3\.5\.3R/);
    expect(decision.message).not.toMatch(/error occurred|invalid input|validation failed/i);
  });

  it('counts the rest, so a dealer knows the size of the job', () => {
    const decision = publishDecision({
      hasRepresentativeExample: false,
      fields: { description: '£199 a month. 9.9% APR. No deposit.' },
    });
    expect(decision.message).toMatch(/2 other figures need the same treatment/);
  });

  it('allows publishing with an example, but still says something', () => {
    // A payment typed into prose cannot follow the lender's rates when they
    // move, so the dealer should know it is there even when it is lawful today.
    const decision = publishDecision({
      hasRepresentativeExample: true,
      fields: { description: 'Drive away for £199 a month!' },
    });
    expect(decision.canPublish).toBe(true);
    expect(decision.message).toMatch(/do not update when the lender's rates change/);
  });

  it('ignores empty and missing fields', () => {
    expect(publishDecision({
      hasRepresentativeExample: false,
      fields: { description: null, title: undefined, caption: '' },
    }).canPublish).toBe(true);
  });
});
