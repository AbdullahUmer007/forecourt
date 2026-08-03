/**
 * M7 — shortlists, saved searches and alert gating.
 */

import { describe, it, expect } from 'vitest';
import {
  shortlistCookie, shouldIssueToken, isValidToken, addToShortlist, removeFromShortlist,
  mergeShortlists, markUnavailable, shortlistSummary, describeSearch, createSavedSearch,
  canSendAlert, MAX_SHORTLIST_ITEMS, SHORTLIST_COOKIE,
  type Shortlist, type SavedSearch,
} from './shortlist.js';
import { EMPTY_QUERY, type SearchQuery, type MultiDimension } from './search.js';

const T = 't-kennington';
const list = (items: Shortlist['items'] = []): Shortlist =>
  ({ tenantId: T, token: 'A'.repeat(43), contactId: null, items });

const at = (iso: string): Date => new Date(iso);

// ---------------------------------------------------------------- the cookie
describe('the shortlist cookie', () => {
  it('is set only when a car is actually saved', () => {
    // This is the whole basis of the PECR "strictly necessary" exemption: the
    // cookie serves a service the user explicitly requested. Setting it on
    // page load would make it a tracking cookie needing consent.
    expect(shouldIssueToken(null, 'view')).toBe(false);
    expect(shouldIssueToken(null, 'save')).toBe(true);
  });

  it('does not mint a second token for someone who already has one', () => {
    expect(shouldIssueToken('A'.repeat(43), 'save')).toBe(false);
  });

  it('is HttpOnly, Secure and Lax', () => {
    const c = shortlistCookie();
    expect(c.name).toBe(SHORTLIST_COOKIE);
    // No script needs to read it, and a token readable by script is a token
    // stealable by an injected one.
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe('Lax');
  });

  it('rejects a guessable token', () => {
    expect(isValidToken('abc123')).toBe(false);
    expect(isValidToken('1')).toBe(false);
    expect(isValidToken('A'.repeat(43))).toBe(true);
    expect(isValidToken('A'.repeat(42))).toBe(false);
  });
});

// ---------------------------------------------------------------- the list
describe('saving and removing', () => {
  it('is idempotent — a double tap must not save twice', () => {
    const once = addToShortlist(list(), 'v1', at('2026-08-01'));
    const twice = addToShortlist(once.shortlist, 'v1', at('2026-08-01'));
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(twice.shortlist.items).toHaveLength(1);
  });

  it('refuses past the cap and says what to do about it', () => {
    const full = list(Array.from({ length: MAX_SHORTLIST_ITEMS }, (_, i) => ({
      vehicleId: `v${i}`, savedAt: at('2026-08-01'), availability: 'available' as const,
    })));
    const result = addToShortlist(full, 'one-more', at('2026-08-01'));
    expect(result.changed).toBe(false);
    expect(result.message).toMatch(/Remove one to save another/);
    expect(result.message).not.toMatch(/error occurred/i);
  });

  it('removes cleanly and reports whether anything changed', () => {
    const saved = addToShortlist(list(), 'v1', at('2026-08-01')).shortlist;
    expect(removeFromShortlist(saved, 'v1').changed).toBe(true);
    expect(removeFromShortlist(saved, 'nope').changed).toBe(false);
  });
});

// ---------------------------------------------------------------- merging
describe('merging an anonymous list into an account', () => {
  it('takes the union — phone saves plus laptop saves', () => {
    const anon = list([
      { vehicleId: 'v1', savedAt: at('2026-07-20'), availability: 'available' },
      { vehicleId: 'v2', savedAt: at('2026-07-21'), availability: 'available' },
    ]);
    const account: Shortlist = {
      tenantId: T, token: null, contactId: 'c-1',
      items: [{ vehicleId: 'v3', savedAt: at('2026-07-10'), availability: 'available' }],
    };
    const merged = mergeShortlists(anon, account);
    expect(merged.items.map((i) => i.vehicleId)).toEqual(['v3', 'v1', 'v2']);
    expect(merged.contactId).toBe('c-1');
  });

  it('keeps the EARLIEST save date for a car saved on both devices', () => {
    // The CRM shows "saved 11 days ago". Resetting it would misrepresent how
    // long this buyer has been deciding, which is the signal a dealer acts on.
    const anon = list([{ vehicleId: 'v1', savedAt: at('2026-07-01'), availability: 'available' }]);
    const account: Shortlist = {
      tenantId: T, token: null, contactId: 'c-1',
      items: [{ vehicleId: 'v1', savedAt: at('2026-07-28'), availability: 'available' }],
    };
    expect(mergeShortlists(anon, account).items[0]!.savedAt).toEqual(at('2026-07-01'));
  });

  it('refuses to merge across dealers', () => {
    const other: Shortlist = { tenantId: 't-other', token: null, contactId: 'c-1', items: [] };
    expect(() => mergeShortlists(list(), other)).toThrow(/across tenants/);
  });
});

// ---------------------------------------------------------------- sold cars
describe('a car that sells while it is on a shortlist', () => {
  it('stays on the list, marked, with somewhere to go next', () => {
    // Deleting it silently makes the buyer think we lost it, and wastes the one
    // moment we know exactly what they wanted.
    const saved = list([
      { vehicleId: 'v1', savedAt: at('2026-07-01'), availability: 'available' },
      { vehicleId: 'v2', savedAt: at('2026-07-02'), availability: 'available' },
    ]);
    const after = markUnavailable(saved, new Map([
      ['v1', { availability: 'sold' as const, replacementPath: '/used-cars/vw/golf/gti-2021-ab21abc' }],
    ]));
    expect(after.items).toHaveLength(2);
    expect(after.items[0]!.availability).toBe('sold');
    expect(after.items[0]!.replacementPath).toContain('/used-cars/');
    expect(after.items[1]!.availability).toBe('available');
    expect(shortlistSummary(after)).toEqual({ saved: 2, available: 1, gone: 1 });
  });
});

// ---------------------------------------------------------------- saved searches
describe('saved searches', () => {
  type QueryOverride = Omit<Partial<SearchQuery>, 'filters'> & {
    filters?: Partial<Record<MultiDimension, string[]>>;
  };
  const q = (over: QueryOverride = {}): SearchQuery => ({
    ...EMPTY_QUERY, ...over,
    filters: { ...EMPTY_QUERY.filters, ...(over.filters ?? {}) },
  });

  it('names itself the way a buyer would say it out loud', () => {
    const name = describeSearch(q({
      filters: { make: ['vw'], model: ['golf'], transmission: ['automatic'] },
      maxPricePence: 1_500_000n,
    }));
    expect(name).toBe('Automatic vw golf under £15,000');
  });

  it('falls back to something meaningful with no filters', () => {
    expect(describeSearch(q())).toBe('All cars');
    expect(describeSearch(q({ keyword: 'estate' }))).toContain('estate');
  });

  it('stores the canonical path, so the alert query is the normalised one', () => {
    const search = createSavedSearch({
      id: 's1', tenantId: T, contactId: null, token: 'A'.repeat(43),
      query: q({ filters: { make: ['vw'] }, sort: 'price-asc', page: 4 }),
      frequency: 'daily', consentId: null, createdAt: at('2026-08-01'),
    });
    expect(search.canonicalPath).toBe('/used-cars/vw');
  });
});

describe('whether an alert may be sent', () => {
  const base: SavedSearch = {
    id: 's1', tenantId: T, contactId: 'c-1', token: null,
    name: 'Automatic Golf', canonicalPath: '/used-cars/vw/golf',
    query: { ...EMPTY_QUERY }, frequency: 'daily',
    consentId: 'consent-1', createdAt: at('2026-06-01'), lastNotifiedAt: null,
  };
  const ctx = {
    now: at('2026-08-02T09:00:00Z'), matchingVehicleCount: 2,
    consentValidAtSendTime: true, suppressed: false,
  };

  it('sends when there is consent and something to say', () => {
    expect(canSendAlert(base, ctx).send).toBe(true);
  });

  it('will not send without a consent record at all', () => {
    const decision = canSendAlert({ ...base, consentId: null }, ctx);
    expect(decision.send).toBe(false);
    expect(decision.reason).toMatch(/M9/);
  });

  it('re-checks consent AT SEND TIME, not at save time', () => {
    // Rule 7. A search saved in March and sent in June must be re-tested
    // against a withdrawal made in May.
    expect(canSendAlert(base, { ...ctx, consentValidAtSendTime: false }).send).toBe(false);
  });

  it('honours the global suppression list', () => {
    expect(canSendAlert(base, { ...ctx, suppressed: true }).send).toBe(false);
  });

  it('never sends an empty alert', () => {
    const decision = canSendAlert(base, { ...ctx, matchingVehicleCount: 0 });
    expect(decision.send).toBe(false);
    expect(decision.reason).toMatch(/unsubscribe/);
  });

  it('respects the frequency the buyer chose', () => {
    const justSent = { ...base, lastNotifiedAt: at('2026-08-02T06:00:00Z') };
    expect(canSendAlert(justSent, ctx).send).toBe(false);
    expect(canSendAlert({ ...justSent, frequency: 'instant' }, ctx).send).toBe(true);
  });
});
