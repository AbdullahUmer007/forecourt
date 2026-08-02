/**
 * M7 — shortlists, saved searches and notify-me.
 *
 * The shortlist is the quietest lead source a dealer has. A buyer who has
 * saved three cars is further down the funnel than one who has filled in a
 * form, and today that signal is thrown away by every platform in this market.
 * The CRM shows it as "this contact has saved 3 cars, viewed the Golf 6 times"
 * (`02-functional-spec.md` §12.3).
 *
 * COOKIE POSITION, stated once so it is not re-litigated in review:
 *
 * The shortlist cookie is exempt from PECR consent because it is strictly
 * necessary for a service the user has *explicitly requested* — they clicked
 * "save this car". That exemption only holds if the cookie is set WHEN THEY
 * SAVE, never on page load. `shouldIssueToken` enforces exactly that, and no
 * shortlist token is minted for a visitor who is only browsing.
 *
 * Sending a saved-search alert is a different thing entirely: that is direct
 * marketing and needs a consent record from M9, re-checked at send time. Until
 * M9 lands, `canSendAlert` returns false and says why.
 */

import { canonicalSearchPath, type SearchQuery } from './search.js';

// ---------------------------------------------------------------- tokens

export const SHORTLIST_COOKIE = 'fc_sl';
export const SHORTLIST_TOKEN_BYTES = 32;
export const MAX_SHORTLIST_ITEMS = 50;

export interface CookieSpec {
  name: string;
  maxAgeSeconds: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  path: string;
}

/**
 * `HttpOnly` because the server renders the shortlist — no script needs to read
 * it, and a token readable by script is a token stealable by an injected one.
 * `Lax` so a shortlist survives arriving from Google but is not sent on a
 * cross-site POST.
 */
export const shortlistCookie = (): CookieSpec => ({
  name: SHORTLIST_COOKIE,
  maxAgeSeconds: 365 * 24 * 60 * 60,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
});

/**
 * A token is minted only by an explicit save. Browsing mints nothing.
 *
 * This is the whole basis of the consent exemption above, so it is a function
 * with a test rather than a comment in a route handler.
 */
export const shouldIssueToken = (existingToken: string | null, action: 'view' | 'save'): boolean =>
  action === 'save' && !existingToken;

/**
 * Tokens must be unguessable. A sequential or short token lets anyone read
 * another buyer's shortlist — which is a list of what they can afford, when
 * they were looking, and which dealer they were looking at.
 */
export function isValidToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43,}$/.test(token);   // 32 bytes base64url = 43 chars
}

// ---------------------------------------------------------------- shortlist

export type ItemAvailability = 'available' | 'reserved' | 'sold' | 'withdrawn';

export interface ShortlistItem {
  vehicleId: string;
  savedAt: Date;
  availability: ItemAvailability;
  /** Where to send them if this one has gone. Supplied by the sold-vehicle resolver. */
  replacementPath?: string | null;
}

export interface Shortlist {
  tenantId: string;
  token: string | null;
  contactId: string | null;
  items: readonly ShortlistItem[];
}

export interface SaveResult {
  shortlist: Shortlist;
  changed: boolean;
  message: string | null;
}

/** Add a vehicle. Idempotent — a double tap on a phone must not create two rows. */
export function addToShortlist(list: Shortlist, vehicleId: string, at: Date): SaveResult {
  if (list.items.some((i) => i.vehicleId === vehicleId)) {
    return { shortlist: list, changed: false, message: null };
  }
  if (list.items.length >= MAX_SHORTLIST_ITEMS) {
    return {
      shortlist: list,
      changed: false,
      // Says what happened, why, and what to do — never "An error occurred".
      message: `Your saved cars list is full at ${MAX_SHORTLIST_ITEMS}. Remove one to save another.`,
    };
  }
  return {
    shortlist: { ...list, items: [...list.items, { vehicleId, savedAt: at, availability: 'available' }] },
    changed: true,
    message: null,
  };
}

export function removeFromShortlist(list: Shortlist, vehicleId: string): SaveResult {
  const items = list.items.filter((i) => i.vehicleId !== vehicleId);
  return { shortlist: { ...list, items }, changed: items.length !== list.items.length, message: null };
}

/**
 * Merge an anonymous shortlist into an identified contact's.
 *
 * Union, never replace. Someone who saved two cars on their phone and three on
 * a laptop expects five. Keeping the EARLIEST save date matters because the CRM
 * shows "saved 11 days ago" and resetting it would misrepresent how long they
 * have been deciding.
 *
 * Cross-tenant merges are refused outright. A shortlist is dealer-scoped, and
 * a token from one dealer's site must never attach to a contact at another.
 */
export function mergeShortlists(anonymous: Shortlist, account: Shortlist): Shortlist {
  if (anonymous.tenantId !== account.tenantId) {
    throw new Error(
      `Refusing to merge shortlists across tenants (${anonymous.tenantId} → ${account.tenantId}). ` +
      `A shortlist belongs to one dealer.`,
    );
  }
  const byVehicle = new Map<string, ShortlistItem>();
  for (const item of [...account.items, ...anonymous.items]) {
    const existing = byVehicle.get(item.vehicleId);
    if (!existing || item.savedAt < existing.savedAt) byVehicle.set(item.vehicleId, item);
  }
  const items = [...byVehicle.values()]
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime())
    .slice(0, MAX_SHORTLIST_ITEMS);
  return { ...account, token: anonymous.token ?? account.token, items };
}

/**
 * A sold car stays on the list, marked, with somewhere to go next.
 *
 * Silently deleting it makes the buyer think we lost it, and it wastes the one
 * moment we know exactly what they wanted.
 */
export function markUnavailable(
  list: Shortlist,
  status: ReadonlyMap<string, { availability: ItemAvailability; replacementPath: string | null }>,
): Shortlist {
  return {
    ...list,
    items: list.items.map((i) => {
      const s = status.get(i.vehicleId);
      return s ? { ...i, availability: s.availability, replacementPath: s.replacementPath } : i;
    }),
  };
}

export const shortlistSummary = (list: Shortlist): { saved: number; available: number; gone: number } => {
  const gone = list.items.filter((i) => i.availability === 'sold' || i.availability === 'withdrawn').length;
  return { saved: list.items.length, available: list.items.length - gone, gone };
};

// ---------------------------------------------------------------- saved searches

export type AlertFrequency = 'instant' | 'daily' | 'weekly';

export interface SavedSearch {
  id: string;
  tenantId: string;
  contactId: string | null;
  token: string | null;
  name: string;
  canonicalPath: string;
  query: SearchQuery;
  frequency: AlertFrequency;
  /** The M9 consent record permitting marketing on this channel. Null until M9. */
  consentId: string | null;
  createdAt: Date;
  lastNotifiedAt: Date | null;
}

/**
 * Name a saved search the way the buyer would describe it out loud —
 * "Automatic Golf under £15,000" — because a list of URLs is unusable.
 */
export function describeSearch(
  q: SearchQuery,
  labelFor: (dimension: string, value: string) => string = (_, v) => v,
): string {
  const parts: string[] = [];
  if (q.filters.transmission.length === 1) parts.push(labelFor('transmission', q.filters.transmission[0]!));
  if (q.filters.fuel.length === 1) parts.push(labelFor('fuel', q.filters.fuel[0]!));
  if (q.filters.make.length === 1) parts.push(labelFor('make', q.filters.make[0]!));
  if (q.filters.model.length === 1) parts.push(labelFor('model', q.filters.model[0]!));
  if (parts.length === 0) parts.push(q.keyword ? `“${q.keyword}”` : 'All cars');
  let name = parts.join(' ');
  if (q.maxPricePence !== null) name += ` under £${(Number(q.maxPricePence) / 100).toLocaleString('en-GB')}`;
  if (q.maxMileage !== null) name += ` under ${q.maxMileage.toLocaleString('en-GB')} miles`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createSavedSearch(input: {
  id: string; tenantId: string; contactId: string | null; token: string | null;
  query: SearchQuery; frequency: AlertFrequency; consentId: string | null; createdAt: Date;
  name?: string;
}): SavedSearch {
  return {
    id: input.id, tenantId: input.tenantId, contactId: input.contactId, token: input.token,
    name: input.name ?? describeSearch(input.query),
    canonicalPath: canonicalSearchPath({ ...input.query, page: 1 }),
    query: input.query,
    frequency: input.frequency,
    consentId: input.consentId,
    createdAt: input.createdAt,
    lastNotifiedAt: null,
  };
}

export interface SendDecision { send: boolean; reason: string }

/**
 * Whether an alert may be sent, decided AT SEND TIME.
 *
 * Rule 7: consent is a record, not a boolean, and it is re-checked when we
 * send rather than when we schedule. A search saved in March and sent in June
 * must be re-tested against a withdrawal made in May.
 */
export function canSendAlert(
  search: SavedSearch,
  ctx: {
    now: Date;
    matchingVehicleCount: number;
    consentValidAtSendTime: boolean;
    suppressed: boolean;
  },
): SendDecision {
  if (search.consentId === null) {
    return { send: false, reason: 'no consent record — saved-search alerts require M9 consent capture' };
  }
  if (!ctx.consentValidAtSendTime) {
    return { send: false, reason: 'consent withdrawn or expired since the search was saved' };
  }
  if (ctx.suppressed) {
    return { send: false, reason: 'contact is on the global suppression list' };
  }
  if (ctx.matchingVehicleCount === 0) {
    return { send: false, reason: 'nothing new matches — an empty alert trains people to unsubscribe' };
  }
  const minGapMs = search.frequency === 'instant' ? 60 * 60 * 1000
    : search.frequency === 'daily' ? 20 * 60 * 60 * 1000
    : 6 * 24 * 60 * 60 * 1000;
  if (search.lastNotifiedAt && ctx.now.getTime() - search.lastNotifiedAt.getTime() < minGapMs) {
    return { send: false, reason: `too soon after the last alert for a ${search.frequency} search` };
  }
  return { send: true, reason: `${ctx.matchingVehicleCount} new matching vehicles` };
}
