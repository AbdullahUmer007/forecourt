import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  appendEvidence, verifyChain, hashEntry, canonicalise, assessCompleteness,
  buildBundle, REQUIRED_FOR_FINANCED_DEAL,
  type EvidenceEntry, type EvidenceInput, type EvidenceKind,
} from './evidence.js';

const AUG = (d: number, h = 12): Date => new Date(Date.UTC(2026, 7, d, h));

const input = (kind: EvidenceKind, over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  dealId: 'deal-1',
  kind,
  payload: { note: `${kind} recorded` },
  documentVersion: null,
  wordingVersion: null,
  occurredAt: AUG(3),
  actorId: 'u1',
  ...over,
});

/** A realistic financed-deal chain, in the order it actually happens. */
function buildChain(): EvidenceEntry[] {
  const chain: EvidenceEntry[] = [];
  const kinds: EvidenceKind[] = [
    'initial_disclosure', 'quote_presented', 'quote_selected', 'commission_disclosure',
    'demands_and_needs', 'affordability', 'adequate_explanation', 'contract_formed',
  ];
  for (const [i, kind] of kinds.entries()) {
    chain.push(appendEvidence(chain, input(kind, { occurredAt: AUG(3, 9 + i) })));
  }
  return chain;
}

// ---------------------------------------------------------------- chaining
describe('the evidence chain', () => {
  it('starts with no predecessor and numbers from 1', () => {
    const first = appendEvidence([], input('initial_disclosure'));
    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBeNull();
    expect(first.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links each entry to the one before it', () => {
    const chain = buildChain();
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.previousHash).toBe(chain[i - 1]!.entryHash);
      expect(chain[i]!.sequence).toBe(i + 1);
    }
  });

  it('verifies a clean chain', () => {
    const result = verifyChain(buildChain());
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.entriesChecked).toBe(8);
  });

  it('gives two identical entries different hashes at different positions', () => {
    // Otherwise a whole entry could be relocated in the chain undetected.
    const a = appendEvidence([], input('note'));
    const chain = buildChain();
    const b = appendEvidence(chain, input('note'));
    expect(a.entryHash).not.toBe(b.entryHash);
  });
});

// ---------------------------------------------------------------- tampering
describe('tamper detection — the whole point of the ledger', () => {
  it('detects an ALTERED payload', () => {
    // The realistic scenario: someone edits what the commission disclosure
    // said, after a complaint arrives.
    const chain = buildChain();
    const tampered = [...chain];
    tampered[3] = { ...tampered[3]!, payload: { note: 'something more convenient' } };

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.problem.includes('altered after it was written'))).toBe(true);
  });

  it('detects a DELETED entry', () => {
    const chain = buildChain();
    const tampered = chain.filter((e) => e.sequence !== 4);
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.problem.includes('missing'))).toBe(true);
  });

  it('detects a REORDERED chain', () => {
    // Shuffling the array proves nothing — `verifyChain` sorts by sequence
    // first, because row order out of a database is not meaningful. The real
    // attack is swapping the SEQUENCE NUMBERS, which is what would reorder
    // the record: "the affordability check came before the quote."
    const chain = buildChain();
    const tampered = [...chain];
    tampered[2] = { ...tampered[2]!, sequence: chain[5]!.sequence };
    tampered[5] = { ...tampered[5]!, sequence: chain[2]!.sequence };
    expect(verifyChain(tampered).valid).toBe(false);
  });

  it('is unaffected by the order rows come back from the database', () => {
    // The corollary: a shuffled result set is normal and must still verify.
    const chain = buildChain();
    const shuffled = [...chain].reverse();
    expect(verifyChain(shuffled).valid).toBe(true);
  });

  it('detects an entry INSERTED with a plausible hash', () => {
    // A tamperer who recomputes the inserted entry's own hash still cannot
    // make the following entry point at it.
    const chain = buildChain();
    const forged = appendEvidence(chain.slice(0, 3), input('note', { payload: { note: 'forged' } }));
    const tampered = [...chain.slice(0, 3), forged, ...chain.slice(3)];
    expect(verifyChain(tampered).valid).toBe(false);
  });

  it('detects a re-dated entry', () => {
    // Back-dating an affordability check to before the agreement is a
    // specific and well-known fabrication.
    const chain = buildChain();
    const tampered = [...chain];
    tampered[5] = { ...tampered[5]!, occurredAt: AUG(1) };
    expect(verifyChain(tampered).valid).toBe(false);
  });

  it('is NOT fooled by re-hashing the altered entry alone', () => {
    // The chain's actual strength: fixing one hash breaks its successor.
    const chain = buildChain();
    const tampered = [...chain];
    const altered = { ...tampered[3]!, payload: { note: 'rewritten' } };
    tampered[3] = { ...altered, entryHash: hashEntry(altered) };

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    // Entry 4 now verifies against itself, but entry 5 no longer follows it.
    expect(result.problems.some((p) => p.sequence === 5)).toBe(true);
  });

  it('requires a tamperer to rewrite the ENTIRE remainder', () => {
    // And even then, any bundle exported earlier still carries the originals.
    const chain = buildChain();
    const rebuilt: EvidenceEntry[] = chain.slice(0, 3);
    for (const original of chain.slice(3)) {
      rebuilt.push(appendEvidence(rebuilt, {
        dealId: original.dealId, kind: original.kind,
        payload: original.sequence === 4 ? { note: 'rewritten' } : original.payload,
        documentVersion: original.documentVersion, wordingVersion: original.wordingVersion,
        occurredAt: original.occurredAt, actorId: original.actorId,
      }));
    }
    // A full rewrite does verify — the chain proves internal consistency, not
    // authenticity on its own. What defeats it is that the earlier export
    // carries different hashes for the same positions.
    expect(verifyChain(rebuilt).valid).toBe(true);
    expect(rebuilt[3]!.entryHash).not.toBe(chain[3]!.entryHash);
  });

  it('reports EVERY problem, not just the first', () => {
    const chain = buildChain();
    const tampered = [...chain];
    tampered[2] = { ...tampered[2]!, payload: { note: 'x' } };
    tampered[6] = { ...tampered[6]!, payload: { note: 'y' } };
    expect(verifyChain(tampered).problems.length).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------- canonical
describe('canonical hashing', () => {
  it('is independent of key order', () => {
    // A hash that depends on insertion order would break the chain whenever
    // two code paths built the same payload differently.
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
  });

  it('is stable for nested objects and arrays', () => {
    const x = { outer: { z: 1, a: [3, { q: 1, b: 2 }] } };
    const y = { outer: { a: [3, { b: 2, q: 1 }], z: 1 } };
    expect(canonicalise(x)).toBe(canonicalise(y));
  });

  it('handles dates and bigints reproducibly', () => {
    expect(canonicalise({ d: new Date('2026-08-03T00:00:00Z') })).toContain('2026-08-03T00:00:00.000Z');
    expect(canonicalise({ n: 12345678901234567890n })).toContain('12345678901234567890');
  });

  it('ignores undefined but keeps null', () => {
    // null is a recorded absence; undefined is a field that was never set.
    expect(canonicalise({ a: 1, b: undefined })).toBe(canonicalise({ a: 1 }));
    expect(canonicalise({ a: 1, b: null })).not.toBe(canonicalise({ a: 1 }));
  });
});

// ---------------------------------------------------------- completeness
describe('completeness', () => {
  it('passes a complete financed deal', () => {
    const r = assessCompleteness(buildChain(), { financed: true });
    expect(r.complete).toBe(true);
  });

  it('names what is missing in words a dealer understands', () => {
    const partial = buildChain().filter((e) => e.kind !== 'affordability');
    const r = assessCompleteness(partial, { financed: true });
    expect(r.complete).toBe(false);
    expect(r.summary).toContain('affordability assessment');
    expect(r.summary).toContain('Ombudsman');
  });

  it('does not demand credit-broking evidence on a cash deal', () => {
    const cash = [appendEvidence([], input('contract_formed'))];
    expect(assessCompleteness(cash, { financed: false }).complete).toBe(true);
    expect(assessCompleteness(cash, { financed: true }).complete).toBe(false);
  });

  it('requires the commission disclosure on every financed deal', () => {
    // The finding at the centre of the post-Hopcraft liability.
    expect(REQUIRED_FOR_FINANCED_DEAL).toContain('commission_disclosure');
  });
});

// --------------------------------------------------------------- bundle
describe('the export bundle', () => {
  it('carries its own verification and a bundle hash', () => {
    const b = buildBundle('deal-1', buildChain(), AUG(10));
    expect(b.verification.valid).toBe(true);
    expect(b.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.entries).toHaveLength(8);
  });

  it('EXPORTS a failing verification rather than refusing', () => {
    // Refusing would make a tampered ledger look like a technical problem.
    // The recipient is entitled to see that the chain does not verify.
    const chain = buildChain();
    const tampered = [...chain];
    tampered[2] = { ...tampered[2]!, payload: { note: 'x' } };

    const b = buildBundle('deal-1', tampered, AUG(10));
    expect(b.verification.valid).toBe(false);
    expect(b.entries).toHaveLength(8);
  });

  it('changes its bundle hash if any entry changes', () => {
    const a = buildBundle('deal-1', buildChain(), AUG(10));
    const chain = buildChain();
    const altered = [...chain];
    altered[1] = { ...altered[1]!, entryHash: 'deadbeef'.repeat(8) };
    expect(buildBundle('deal-1', altered, AUG(10)).bundleHash).not.toBe(a.bundleHash);
  });
});

// ------------------------------------------------------------ properties
describe('chain properties', () => {
  it('any chain built by appending always verifies', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom<EvidenceKind>(
        'initial_disclosure', 'quote_presented', 'commission_disclosure',
        'demands_and_needs', 'note', 'delivery',
      ), { minLength: 1, maxLength: 30 }),
      (kinds) => {
        const chain: EvidenceEntry[] = [];
        for (const k of kinds) chain.push(appendEvidence(chain, input(k)));
        expect(verifyChain(chain).valid).toBe(true);
      },
    ), { numRuns: 200 });
  });

  it('altering ANY entry in ANY position breaks verification', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 7 }),
      (index) => {
        const chain = buildChain();
        const tampered = [...chain];
        tampered[index] = { ...tampered[index]!, payload: { note: 'tampered' } };
        expect(verifyChain(tampered).valid).toBe(false);
      },
    ), { numRuns: 50 });
  });

  it('removing ANY entry breaks verification', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 7 }),
      (index) => {
        const chain = buildChain();
        const tampered = chain.filter((_, i) => i !== index);
        // Removing the LAST entry leaves a shorter but internally consistent
        // chain — that is a real limit of a chain without an anchor, and it is
        // why the bundle hash and its export date matter.
        if (index === 7) {
          expect(verifyChain(tampered).valid).toBe(true);
        } else {
          expect(verifyChain(tampered).valid).toBe(false);
        }
      },
    ), { numRuns: 50 });
  });
});
