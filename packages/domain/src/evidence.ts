/**
 * M12 — the Deal Evidence Ledger.
 *
 * ⚠️ NOT TO GO LIVE WITHOUT THE RETAINED FCA COMPLIANCE CONSULTANT'S SIGN-OFF.
 *
 * The question a lender, an ombudsman or the FCA actually asks a dealer is not
 * "did you disclose the commission?" — it is "show me what the customer saw,
 * on the day, in the order they saw it." A dealer who can produce that has a
 * defence. One who cannot is assessed on the assumption they did not, which is
 * the shape of the roughly £9bn problem the industry is currently paying for.
 *
 * So the ledger is append-only AND hash-chained:
 *
 *   - Append-only stops casual mutation. A trigger refuses UPDATE and DELETE.
 *   - The chain makes tampering PROVABLE. Each entry hashes its own content
 *     together with the previous entry's hash, so removing or altering an
 *     entry breaks verification for every entry after it.
 *
 * The distinction matters. Append-only is a promise about our own code. The
 * chain is a property of the data itself: it survives a database restore, a
 * migration, a rogue superuser and an export sent to a third party, and it can
 * be verified by someone who does not trust us — which is precisely the person
 * who will be checking.
 */

import { createHash } from 'node:crypto';

export type EvidenceKind =
  | 'initial_disclosure' | 'quote_presented' | 'quote_selected' | 'commission_disclosure'
  | 'demands_and_needs' | 'affordability' | 'adequate_explanation' | 'vulnerability_screen'
  | 'fair_value_confirmation' | 'addon_offered' | 'addon_accepted' | 'addon_declined'
  | 'document_shown' | 'document_signed' | 'contract_formed' | 'delivery'
  | 'cancellation_requested' | 'rejection_requested' | 'repair_attempt' | 'note';

export interface EvidenceEntry {
  dealId: string;
  /** Position in this deal's chain, starting at 1. */
  sequence: number;
  kind: EvidenceKind;
  payload: Readonly<Record<string, unknown>>;
  documentVersion: string | null;
  wordingVersion: number | null;
  occurredAt: Date;
  actorId: string | null;
  /** Null on the first entry — nothing precedes it. */
  previousHash: string | null;
  entryHash: string;
}

export type EvidenceInput = Omit<EvidenceEntry, 'previousHash' | 'entryHash' | 'sequence'>;

/**
 * Canonical JSON: keys sorted, recursively.
 *
 * The hash must be reproducible by somebody else, years later, in another
 * language. `JSON.stringify` alone is not — key order follows insertion order,
 * so the same evidence hashed twice by two code paths would produce two
 * different hashes and the chain would appear broken when nothing was wrong.
 */
export function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash of one entry, covering its content AND its predecessor.
 *
 * Including `previousHash` is what makes it a chain rather than a list of
 * independently-hashed rows: alter entry 3 and entries 4, 5 and 6 all stop
 * verifying, so a tamperer must rewrite the entire remainder — and if the
 * bundle was ever exported, the export still carries the original hashes.
 */
export function hashEntry(
  entry: Omit<EvidenceEntry, 'entryHash'>,
): string {
  const material = canonicalise({
    dealId: entry.dealId,
    sequence: entry.sequence,
    kind: entry.kind,
    payload: entry.payload,
    documentVersion: entry.documentVersion,
    wordingVersion: entry.wordingVersion,
    occurredAt: entry.occurredAt,
    actorId: entry.actorId,
    previousHash: entry.previousHash,
  });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Append an entry to a deal's chain.
 *
 * Takes the whole existing chain rather than just the last hash, so it cannot
 * be called with a stale tip and silently fork the sequence. That has to be
 * refused rather than accommodated: two entries at position 4 is exactly the
 * ambiguity the ledger exists to prevent.
 */
export function appendEvidence(
  chain: readonly EvidenceEntry[],
  input: EvidenceInput,
): EvidenceEntry {
  const last = chain.at(-1);
  const partial: Omit<EvidenceEntry, 'entryHash'> = {
    ...input,
    sequence: (last?.sequence ?? 0) + 1,
    previousHash: last?.entryHash ?? null,
  };
  return { ...partial, entryHash: hashEntry(partial) };
}

export interface VerificationResult {
  valid: boolean;
  entriesChecked: number;
  /** Every problem found, in chain order. */
  problems: { sequence: number; problem: string }[];
}

/**
 * Verify a chain end to end.
 *
 * Reports EVERY problem rather than stopping at the first, because the pattern
 * matters: one broken hash in the middle is an edit, a broken hash at the tip
 * plus a missing sequence number is a deletion, and everything broken from
 * position N onward means N is where someone started.
 */
export function verifyChain(chain: readonly EvidenceEntry[]): VerificationResult {
  const problems: { sequence: number; problem: string }[] = [];
  const sorted = [...chain].sort((a, b) => a.sequence - b.sequence);

  let expectedPrevious: string | null = null;

  for (const [i, entry] of sorted.entries()) {
    const expectedSequence = i + 1;

    if (entry.sequence !== expectedSequence) {
      problems.push({
        sequence: entry.sequence,
        problem: `expected sequence ${expectedSequence} but found ${entry.sequence} — an entry is missing`,
      });
    }

    if (entry.previousHash !== expectedPrevious) {
      problems.push({
        sequence: entry.sequence,
        problem: entry.previousHash === null
          ? 'entry claims to be first but follows another'
          : 'does not follow the previous entry — the chain was broken here',
      });
    }

    const recomputed = hashEntry({
      dealId: entry.dealId, sequence: entry.sequence, kind: entry.kind,
      payload: entry.payload, documentVersion: entry.documentVersion,
      wordingVersion: entry.wordingVersion, occurredAt: entry.occurredAt,
      actorId: entry.actorId, previousHash: entry.previousHash,
    });
    if (recomputed !== entry.entryHash) {
      problems.push({
        sequence: entry.sequence,
        problem: 'content does not match its hash — this entry was altered after it was written',
      });
    }

    expectedPrevious = entry.entryHash;
  }

  return { valid: problems.length === 0, entriesChecked: sorted.length, problems };
}

// ------------------------------------------------------ completeness

/**
 * The evidence a financed deal must carry, per `compliance-rules.md` §2.
 *
 * Held here as a list rather than scattered through the deal flow so that
 * "what is missing?" is one function call — and so that when the FCA adds a
 * requirement it is one edit with one test, not an audit of every screen.
 */
export const REQUIRED_FOR_FINANCED_DEAL: readonly EvidenceKind[] = [
  'initial_disclosure',
  'quote_presented',
  'commission_disclosure',
  'demands_and_needs',
  'affordability',
  'adequate_explanation',
  'contract_formed',
];

/** A cash deal needs far less — there is no credit broking to evidence. */
export const REQUIRED_FOR_CASH_DEAL: readonly EvidenceKind[] = ['contract_formed'];

export interface CompletenessResult {
  complete: boolean;
  missing: EvidenceKind[];
  /** Plain English, for the deal screen and for a compliance report. */
  summary: string;
}

const KIND_LABELS: Partial<Record<EvidenceKind, string>> = {
  initial_disclosure: 'the initial disclosure',
  quote_presented: 'the finance quotes presented',
  commission_disclosure: 'the commission disclosure',
  demands_and_needs: 'the demands and needs statement',
  affordability: 'the affordability assessment',
  adequate_explanation: 'the adequate explanation',
  contract_formed: 'how the contract was formed',
};

export function assessCompleteness(
  chain: readonly EvidenceEntry[],
  opts: { financed: boolean },
): CompletenessResult {
  const required = opts.financed ? REQUIRED_FOR_FINANCED_DEAL : REQUIRED_FOR_CASH_DEAL;
  const present = new Set(chain.map((e) => e.kind));
  const missing = required.filter((k) => !present.has(k));

  return {
    complete: missing.length === 0,
    missing,
    summary: missing.length === 0
      ? 'Every required record is on file for this deal.'
      : `Missing ${missing.map((k) => KIND_LABELS[k] ?? k).join(', ')}. ` +
        `These are what a lender or the Ombudsman would ask to see.`,
  };
}

// ------------------------------------------------------------- export

export interface EvidenceBundle {
  dealId: string;
  generatedAt: Date;
  entries: readonly EvidenceEntry[];
  verification: VerificationResult;
  /** A hash over the whole bundle, so the export itself is tamper-evident. */
  bundleHash: string;
}

/**
 * The export bundle — what gets sent to a lender, an ombudsman or the customer.
 *
 * It includes its own verification result, INCLUDING a failing one. Exporting
 * only verifiable bundles would mean a tampered ledger silently produces no
 * export, which looks like a technical problem rather than the finding it is.
 * The recipient is entitled to see that the chain does not verify.
 */
export function buildBundle(
  dealId: string,
  chain: readonly EvidenceEntry[],
  generatedAt: Date,
): EvidenceBundle {
  const entries = [...chain].sort((a, b) => a.sequence - b.sequence);
  const verification = verifyChain(entries);
  const bundleHash = createHash('sha256')
    .update(canonicalise({ dealId, entries: entries.map((e) => e.entryHash), generatedAt }), 'utf8')
    .digest('hex');
  return { dealId, generatedAt, entries, verification, bundleHash };
}
