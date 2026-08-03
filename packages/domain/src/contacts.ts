/**
 * M9 — contacts: matching, merging, vulnerability and data subject rights.
 *
 * A contact record is the only place in this product that holds a named
 * person's data, so three things have to be right:
 *
 *   1. Duplicates are found and merged WITHOUT losing consent history. A merge
 *      that drops a withdrawal re-subscribes someone who unsubscribed, which
 *      is a PECR breach caused by a housekeeping feature.
 *   2. Vulnerability is recorded against the FCA's own four drivers and is
 *      access-controlled separately from ordinary notes.
 *   3. Erasure is honoured, refused only for a stated lawful reason, and never
 *      quietly ignored.
 */

import { normaliseDestination, type ConsentRecord } from './consent.js';

// ---------------------------------------------------------------- types

export type ContactKind = 'individual' | 'business';

/** The FCA's four drivers of vulnerability (FG21/1), not free text. */
export type VulnerabilityDriver = 'health' | 'life_event' | 'resilience' | 'capability';

export interface Contact {
  id: string;
  tenantId: string;
  kind: ContactKind;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  vulnerabilityDrivers: readonly VulnerabilityDriver[];
  vulnerabilityNote: string | null;
  legalHold: boolean;
  legalHoldReason: string | null;
  mergedIntoId: string | null;
  erasedAt: Date | null;
  createdAt: Date;
}

// ------------------------------------------------------------- duplicates

export interface DuplicateMatch {
  contactId: string;
  /** 0–100. Not a probability — a ranking, so the strongest sits at the top. */
  score: number;
  /** Every signal that fired, so a human can see WHY before merging. */
  signals: string[];
  /**
   * Whether this is safe to merge without a human looking at it. Only an exact
   * normalised email or phone match qualifies: a name-and-postcode match is a
   * father and son at the same address often enough that auto-merging them
   * would combine two people's consent — and their finance history.
   */
  autoMergeable: boolean;
}

const norm = (s: string | null): string => (s ?? '').trim().toLowerCase();

/**
 * Find likely duplicates of `candidate` among `existing`.
 *
 * Deliberately conservative. A missed duplicate is an untidy CRM; a wrong
 * merge combines two people's records, and under UK GDPR that is a personal
 * data breach that has to be assessed for reporting. The asymmetry is the
 * whole design.
 */
export function findDuplicates(
  candidate: Pick<Contact, 'email' | 'phone' | 'firstName' | 'lastName' | 'companyName' | 'postcode'>,
  existing: readonly Contact[],
): DuplicateMatch[] {
  const cEmail = candidate.email ? normaliseDestination('email', candidate.email) : null;
  const cPhone = candidate.phone ? normaliseDestination('phone', candidate.phone) : null;

  const matches: DuplicateMatch[] = [];

  for (const other of existing) {
    // A merged-away or erased record is not a duplicate to merge into.
    if (other.mergedIntoId !== null || other.erasedAt !== null) continue;

    const signals: string[] = [];
    let score = 0;
    let strong = false;

    const oEmail = other.email ? normaliseDestination('email', other.email) : null;
    const oPhone = other.phone ? normaliseDestination('phone', other.phone) : null;

    if (cEmail && oEmail && cEmail === oEmail) {
      signals.push('same email address');
      score += 60;
      strong = true;
    }
    if (cPhone && oPhone && cPhone === oPhone) {
      signals.push('same phone number');
      score += 50;
      strong = true;
    }
    if (norm(candidate.lastName) && norm(candidate.lastName) === norm(other.lastName)) {
      signals.push('same surname');
      score += 10;
      if (norm(candidate.firstName) && norm(candidate.firstName) === norm(other.firstName)) {
        signals.push('same first name');
        score += 15;
      }
    }
    if (norm(candidate.companyName) && norm(candidate.companyName) === norm(other.companyName)) {
      signals.push('same company name');
      score += 25;
    }
    if (norm(candidate.postcode) && norm(candidate.postcode).replace(/\s+/g, '')
        === norm(other.postcode).replace(/\s+/g, '')) {
      signals.push('same postcode');
      score += 10;
    }

    if (score === 0) continue;
    matches.push({
      contactId: other.id,
      score: Math.min(100, score),
      signals,
      autoMergeable: strong,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

// ----------------------------------------------------------------- merge

export interface MergePlan {
  winnerId: string;
  loserId: string;
  /** The merged field values, winner-first with the loser filling gaps. */
  fields: Partial<Contact>;
  /**
   * EVERY consent record from both sides, unchanged. A merge never edits,
   * drops or re-dates a consent row — it re-points them at the winner, and
   * `consentPosition` then resolves the combined history the same way it
   * resolves any other history.
   */
  consentIdsToRepoint: string[];
  warnings: string[];
}

/**
 * Plan a merge. Pure — the caller performs it in a transaction.
 *
 * The winner keeps its own non-null values and takes the loser's only where it
 * has a gap. The alternative — letting the newer record win field by field —
 * silently overwrites a corrected spelling with the typo that caused the
 * duplicate in the first place.
 */
export function planMerge(
  winner: Contact,
  loser: Contact,
  consents: readonly ConsentRecord[],
): MergePlan {
  if (winner.id === loser.id) {
    throw new Error('Cannot merge a contact into itself.');
  }
  if (winner.tenantId !== loser.tenantId) {
    // Belt and braces behind RLS. A cross-tenant merge would move one dealer's
    // customer into another's records — the leak this whole codebase is built
    // to prevent, arriving through a housekeeping feature.
    throw new Error('Cannot merge contacts across tenants.');
  }

  const warnings: string[] = [];
  const fields: Partial<Contact> = {};

  const take = <K extends keyof Contact>(key: K): void => {
    if (winner[key] === null && loser[key] !== null) {
      (fields as Record<string, unknown>)[key as string] = loser[key];
    } else if (
      winner[key] !== null && loser[key] !== null &&
      String(winner[key]).trim().toLowerCase() !== String(loser[key]).trim().toLowerCase()
    ) {
      warnings.push(`${String(key)} differs: keeping "${String(winner[key])}", discarding "${String(loser[key])}"`);
    }
  };

  (['firstName', 'lastName', 'companyName', 'email', 'phone', 'postcode'] as const).forEach(take);

  // Vulnerability is a UNION, never a replacement. A flag recorded on either
  // record was recorded because someone observed something, and dropping it
  // because the winning record happened not to carry it is exactly the failure
  // FG21/1 is about.
  const drivers = new Set<VulnerabilityDriver>([
    ...winner.vulnerabilityDrivers, ...loser.vulnerabilityDrivers,
  ]);
  if (drivers.size > 0) fields.vulnerabilityDrivers = [...drivers];

  const notes = [winner.vulnerabilityNote, loser.vulnerabilityNote].filter(Boolean);
  if (notes.length > 0) fields.vulnerabilityNote = notes.join('\n---\n');

  // A legal hold on EITHER side survives the merge. A hold exists because
  // something must not be erased; merging is not a reason to release it.
  if (winner.legalHold || loser.legalHold) {
    fields.legalHold = true;
    fields.legalHoldReason = winner.legalHoldReason ?? loser.legalHoldReason;
    if (!winner.legalHold) warnings.push('legal hold inherited from the merged record');
  }

  const consentIdsToRepoint = consents
    .filter((c) => c.contactId === loser.id)
    .map((c) => c.id);

  return { winnerId: winner.id, loserId: loser.id, fields, consentIdsToRepoint, warnings };
}

// ------------------------------------------------------- vulnerability

/**
 * Whether a principal may see the vulnerability fields.
 *
 * Separate from ordinary contact read because these are special category
 * data in practice — "health" is Article 9 data — and a sales executive
 * browsing the CRM has no need to see them. The check is server-side; hiding
 * the field in the UI is a convenience, not the control.
 */
export const VULNERABILITY_PERMISSION = 'contact.vulnerability.read';

export function redactVulnerability<T extends Pick<Contact, 'vulnerabilityDrivers' | 'vulnerabilityNote'>>(
  contact: T,
  permissions: ReadonlySet<string>,
): T {
  if (permissions.has(VULNERABILITY_PERMISSION) || permissions.has('*')) return contact;
  return { ...contact, vulnerabilityDrivers: [], vulnerabilityNote: null };
}

// ------------------------------------------------- data subject requests

export type DsrKind = 'access' | 'erasure' | 'rectification' | 'portability' | 'objection';

/**
 * UK GDPR Article 12(3): one month from receipt. Extendable by two further
 * months for complex requests, which is a decision a human records rather
 * than something this function assumes.
 */
export const DSR_RESPONSE_DAYS = 30;

export function dsrDueDate(requestedAt: Date, days = DSR_RESPONSE_DAYS): Date {
  const due = new Date(requestedAt);
  due.setDate(due.getDate() + days);
  return due;
}

export interface ErasureDecision {
  erase: boolean;
  /** Which records must be retained even when the rest is erased. */
  retained: string[];
  reason: string;
}

/**
 * Whether an erasure request can be honoured.
 *
 * Article 17(3)(b) and (e): the right is not absolute. A finance introduction
 * under the redress look-back, and a VAT stock-book entry with a statutory
 * six-year retention, both survive an erasure request — and the REFUSAL has to
 * be recorded with its basis, because "we refused under Article 17(3)(b)" and
 * "we ignored it" are indistinguishable in a system that records neither.
 *
 * Note this returns a partial erasure rather than an all-or-nothing answer:
 * marketing data goes, the statutory record stays. Refusing the whole request
 * because one invoice must be kept is over-refusal, and is its own breach.
 */
export function planErasure(input: {
  legalHold: boolean;
  legalHoldReason: string | null;
  hasFinanceIntroduction: boolean;
  hasStockBookEntry: boolean;
}): ErasureDecision {
  const retained: string[] = [];
  if (input.hasFinanceIntroduction) {
    retained.push('finance introduction evidence (retained while the motor finance redress look-back is live)');
  }
  if (input.hasStockBookEntry) {
    retained.push('VAT stock book entry and sales invoice (statutory retention, at least six years)');
  }

  if (input.legalHold) {
    return {
      erase: false,
      retained,
      reason: input.legalHoldReason
        ? `refused under a legal hold: ${input.legalHoldReason}`
        : 'refused under a legal hold',
    };
  }

  return {
    erase: true,
    retained,
    reason: retained.length === 0
      ? 'no retention obligation applies — the contact and its history can be erased in full'
      : 'personal and marketing data erased; the records listed are retained under a legal obligation',
  };
}

/**
 * What an erased contact looks like afterwards.
 *
 * A tombstone, not a DELETE. Deal, invoice and evidence rows reference this
 * id, and a dangling reference inside a compliance record is worse than a
 * scrubbed one — it makes the surviving evidence unexplainable.
 */
export function erasedContact(contact: Contact, erasedAt: Date): Contact {
  return {
    ...contact,
    firstName: null, lastName: null, companyName: null,
    email: null, phone: null, postcode: null,
    vulnerabilityDrivers: [], vulnerabilityNote: null,
    erasedAt,
  };
}
