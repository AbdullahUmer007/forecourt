import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AdapterRunner, InMemoryCache, InMemoryCostMeter, CircuitBreaker,
  ProviderError, CircuitOpenError, idempotencyKey, PROVIDER_LABELS,
  type Fetcher, type Provider,
} from './framework.js';
import {
  normaliseRegistration, formatRegistration, registrationCandidates, isPlausibleRegistration,
  parseDvla, parseMotHistory, detectMileageAnomalies, lookupVehicle, lookupDvla, lookupMotHistory,
} from './vehicle-data.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), 'utf8'));

const FIXTURES: Record<string, string> = {
  'dvla_ves:vehicle:WN22HNL': 'dvla-wn22hnl',
  'dvsa_mot:history:WN22HNL': 'mot-wn22hnl',
  'dvsa_mot:history:CL05KED': 'mot-clocked',
  'dvsa_mot:history:KM11IMP': 'mot-km',
};

/** Replaces the network. This is how provider behaviour is tested without a contract. */
const fixtureFetcher = (calls?: string[]): Fetcher => async (c) => {
  const id = idempotencyKey(c);
  calls?.push(id);
  const name = FIXTURES[id];
  if (!name) throw new ProviderError(c.provider, `No fixture for ${id}`, undefined, false);
  return fixture(name);
};

const makeCtx = (over: { fetcher?: Fetcher; meter?: InMemoryCostMeter; breaker?: CircuitBreaker } = {}) => {
  const meter = over.meter ?? new InMemoryCostMeter();
  const runner = new AdapterRunner({
    fetcher: over.fetcher ?? fixtureFetcher(),
    cache: new InMemoryCache(),
    meter,
    breaker: over.breaker,
  });
  return { ctx: { runner, tenantId: 't1' }, meter };
};

// ---------------------------------------------------------------------------
describe('registration handling', () => {
  it('normalises to uppercase without separators', () => {
    expect(normaliseRegistration('wn22 hnl')).toBe('WN22HNL');
    expect(normaliseRegistration(' Wn22-Hnl ')).toBe('WN22HNL');
  });

  it('formats UK plate styles for display', () => {
    expect(formatRegistration('WN22HNL')).toBe('WN22 HNL');   // current
    expect(formatRegistration('A123BCD')).toBe('A123 BCD');   // prefix
    expect(formatRegistration('ABC123D')).toBe('ABC 123D');   // suffix
    expect(formatRegistration('ABC1234')).toBe('ABC 1234');   // Northern Ireland
  });

  it('generates candidates for the O/0 and I/1 confusions a dealer actually makes', () => {
    // Reading a plate off a windscreen, O and 0 are indistinguishable.
    const candidates = registrationCandidates('BO12ABC');
    expect(candidates).toContain('BO12ABC');
    expect(candidates).toContain('B012ABC');
  });

  it('round-trips: formatting then normalising is the identity', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/), (reg) => {
        expect(normaliseRegistration(formatRegistration(reg))).toBe(reg);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects implausible input', () => {
    expect(isPlausibleRegistration('WN22HNL')).toBe(true);
    expect(isPlausibleRegistration('')).toBe(false);
    expect(isPlausibleRegistration('THIS-IS-FAR-TOO-LONG')).toBe(false);
    expect(isPlausibleRegistration('WN22!!!')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('DVLA parsing', () => {
  it('parses the Kennington Tesla', () => {
    const v = parseDvla(fixture('dvla-wn22hnl'));
    expect(v.registration).toBe('WN22HNL');
    expect(v.make).toBe('TESLA');
    expect(v.fuelType).toBe('ELECTRICITY');
    expect(v.yearOfManufacture).toBe(2022);
    expect(v.motExpiresOn).toBe('2027-02-17');
    expect(v.markedForExport).toBe(false);
  });

  it('tolerates a null engine capacity — an EV has none', () => {
    expect(parseDvla(fixture('dvla-wn22hnl')).engineCc).toBeNull();
  });

  it('refuses a response with no registration, and does not retry it', () => {
    try {
      parseDvla({ make: 'FORD' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).retryable, 'a malformed body will not fix itself on retry').toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('MOT history parsing', () => {
  const mot = () => parseMotHistory(fixture('mot-wn22hnl'));

  it('parses tests newest first', () => {
    const h = mot();
    expect(h.tests).toHaveLength(3);
    expect(h.tests[0]!.testDate).toBe('2026-02-14');
    expect(h.tests[0]!.result).toBe('PASSED');
  });

  it('separates advisories from defects', () => {
    const latest = mot().tests[0]!;
    expect(latest.advisories).toHaveLength(2);
    expect(latest.defects).toHaveLength(0);
    const failed = mot().tests.find((t) => t.result === 'FAILED')!;
    expect(failed.defects.map((d) => d.type)).toContain('MAJOR');
    expect(failed.advisories).toHaveLength(1);
  });

  it('extracts the highest mileage — the value the go-live gate reads', () => {
    expect(mot().highestMileage).toBe(38_940);
  });

  it('surfaces the latest advisories to seed the prep checklist', () => {
    expect(mot().latestAdvisories.join(' ')).toMatch(/tyre/i);
  });

  it('normalises kilometre readings to miles before comparing', () => {
    // 100,000 km ≈ 62,137 miles, which must beat the 5,000-mile reading.
    const h = parseMotHistory(fixture('mot-km'));
    expect(h.highestMileage).toBe(62_137);
  });

  it('ignores tests with no odometer reading', () => {
    const h = parseMotHistory({
      registration: 'AB12CDE',
      motTests: [
        { completedDate: '2026-01-01', testResult: 'PASSED', odometerValue: null,
          odometerResultType: 'NO_ODOMETER_READING', defects: [] },
        { completedDate: '2025-01-01', testResult: 'PASSED', odometerValue: 30000,
          odometerUnit: 'mi', odometerResultType: 'READ', defects: [] },
      ],
    });
    expect(h.highestMileage).toBe(30_000);
  });

  it('returns an empty history rather than throwing when a vehicle has no MOTs', () => {
    const h = parseMotHistory({ registration: 'NEW26CAR', motTests: [] });
    expect(h.tests).toEqual([]);
    expect(h.highestMileage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// This is the free fraud signal, and it feeds M3's go-live gate.
// ---------------------------------------------------------------------------
describe('mileage anomaly detection', () => {
  it('detects every reading lower than the running highest', () => {
    // The fixture reads 91,000 (2024) → 48,000 (2025) → 62,000 (2026).
    // BOTH later readings are anomalous: once a car has shown 91,000 miles,
    // any subsequent lower reading is suspect, not just the first one. An
    // implementation that reported only the first would let a clocked car
    // look like a single clerical error.
    const anomalies = detectMileageAnomalies(parseMotHistory(fixture('mot-clocked')));
    expect(anomalies).toHaveLength(2);
    expect(anomalies[0]).toMatchObject({ testDate: '2025-01-15', odometer: 48_000, previousHighest: 91_000 });
    expect(anomalies[1]).toMatchObject({ testDate: '2026-01-20', odometer: 62_000, previousHighest: 91_000 });
  });

  it('finds nothing in an honest record', () => {
    expect(detectMileageAnomalies(parseMotHistory(fixture('mot-wn22hnl')))).toEqual([]);
  });

  it('never reports an anomaly on a monotonically increasing record', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 2, maxLength: 12 }), (raw) => {
        const ascending = [...raw].sort((a, b) => a - b);
        const tests = ascending.map((odometer, i) => ({
          completedDate: `20${String(10 + i).padStart(2, '0')}-01-01`,
          testResult: 'PASSED', odometerValue: odometer, odometerUnit: 'mi',
          odometerResultType: 'READ', defects: [],
        }));
        expect(detectMileageAnomalies(parseMotHistory({ registration: 'AB12CDE', motTests: tests }))).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
describe('the adapter framework', () => {
  it('serves the second identical lookup from cache, without a provider call', async () => {
    const calls: string[] = [];
    const { ctx, meter } = makeCtx({ fetcher: fixtureFetcher(calls) });

    const first = await lookupDvla(ctx, 'WN22HNL');
    const second = await lookupDvla(ctx, 'wn22 hnl');   // same car, typed differently

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
    expect(meter.callCount('dvla_ves')).toBe(1);
  });

  it('forceRefresh bypasses the cache — but only when explicitly asked', async () => {
    const calls: string[] = [];
    const { ctx } = makeCtx({ fetcher: fixtureFetcher(calls) });
    await lookupDvla(ctx, 'WN22HNL');
    await lookupDvla(ctx, 'WN22HNL', { forceRefresh: true });
    expect(calls).toHaveLength(2);
  });

  it('meters every call per tenant, including cache hits, for volume tracking', async () => {
    const meter = new InMemoryCostMeter();
    const { ctx } = makeCtx({ meter });
    await lookupDvla(ctx, 'WN22HNL');
    await lookupDvla(ctx, 'WN22HNL');
    expect(meter.entries).toHaveLength(2);
    expect(meter.entries.filter((e) => e.cached)).toHaveLength(1);
    // A cache hit costs nothing, so it must not be billed.
    expect(meter.totalPence('t1')).toBe(0);   // DVLA is free
  });

  it('collapses concurrent identical calls into one provider request', async () => {
    const calls: string[] = [];
    let resolve!: (v: unknown) => void;
    const gate = new Promise((r) => { resolve = r; });
    const slow: Fetcher = async (c) => {
      calls.push(idempotencyKey(c));
      await gate;
      return fixture('dvla-wn22hnl');
    };
    const { ctx } = makeCtx({ fetcher: slow });

    const both = Promise.all([lookupDvla(ctx, 'WN22HNL'), lookupDvla(ctx, 'WN22HNL')]);
    resolve(null);
    await both;
    // Two callers, one paid request.
    expect(calls).toHaveLength(1);
  });

  it('retries a retryable failure', async () => {
    let attempts = 0;
    const flaky: Fetcher = async (c) => {
      attempts += 1;
      if (attempts < 3) throw new ProviderError(c.provider, 'timeout', undefined, true);
      return fixture('dvla-wn22hnl');
    };
    const { ctx } = makeCtx({ fetcher: flaky });
    const result = await lookupDvla(ctx, 'WN22HNL');
    expect(attempts).toBe(3);
    expect(result.data.make).toBe('TESLA');
  });

  it('does not retry an unretryable failure', async () => {
    let attempts = 0;
    const bad: Fetcher = async (c) => {
      attempts += 1;
      throw new ProviderError(c.provider, 'malformed', undefined, false);
    };
    const { ctx } = makeCtx({ fetcher: bad });
    await expect(lookupDvla(ctx, 'WN22HNL')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('opens the circuit after repeated failures and names the provider', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 60_000 });
    const down: Fetcher = async (c) => { throw new ProviderError(c.provider, '503', undefined, true); };
    const { ctx } = makeCtx({ fetcher: down, breaker });

    await expect(lookupDvla(ctx, 'AA11AAA')).rejects.toThrow();

    let opened: unknown;
    try { await lookupDvla(ctx, 'BB22BBB'); } catch (e) { opened = e; }
    expect(opened).toBeInstanceOf(CircuitOpenError);
    // Never "An error occurred" — name the system, say what still works.
    const message = (opened as Error).message;
    expect(message).toContain(PROVIDER_LABELS.dvla_ves);
    expect(message).toMatch(/Everything else is working/);
    expect(message).toMatch(/retry automatically/);
  });

  it('stores the raw response alongside the parsed result', async () => {
    const { ctx } = makeCtx();
    const result = await lookupDvla(ctx, 'WN22HNL');
    // A parser bug must be fixable without re-paying for the call.
    expect(result.raw).toMatchObject({ registrationNumber: 'WN22HNL' });
  });
});

// ---------------------------------------------------------------------------
describe('the combined lookup — the magic moment', () => {
  it('returns the car from a registration', async () => {
    const { ctx } = makeCtx();
    const r = await lookupVehicle(ctx, 'wn22 hnl');
    expect(r.registration).toBe('WN22HNL');
    expect(r.dvla?.make).toBe('TESLA');
    expect(r.mot?.tests).toHaveLength(3);
    expect(r.highestMotMileage).toBe(38_940);
    expect(r.degraded).toEqual([]);
  });

  it('suggests prep items from the latest MOT advisories', async () => {
    const { ctx } = makeCtx();
    const r = await lookupVehicle(ctx, 'WN22HNL');
    expect(r.suggestedPrepItems).toHaveLength(2);
    expect(r.suggestedPrepItems.join(' ')).toMatch(/tyre/i);
  });

  it('returns partial data when one source is down, naming which', async () => {
    // A dealer in an auction hall would rather have half the car than an error.
    const partial: Fetcher = async (c) => {
      if (c.provider === 'dvsa_mot') throw new ProviderError('dvsa_mot', 'DVSA is unavailable', undefined, false);
      return fixture('dvla-wn22hnl');
    };
    const { ctx } = makeCtx({ fetcher: partial });
    const r = await lookupVehicle(ctx, 'WN22HNL');

    expect(r.dvla?.make).toBe('TESLA');
    expect(r.mot).toBeNull();
    expect(r.degraded).toHaveLength(1);
    expect(r.degraded[0]!.provider).toBe('dvsa_mot');
    expect(r.highestMotMileage, 'must not invent a mileage when MOT data is missing').toBeNull();
  });

  it('flags a clocked vehicle so the go-live gate can block it', async () => {
    const { ctx } = makeCtx();
    const r = await lookupVehicle(ctx, 'CL05KED');
    expect(r.internalMileageAnomalies).toHaveLength(2);
    expect(r.highestMotMileage).toBe(91_000);
    // M3's gate compares the vehicle's recorded mileage against this figure.
  });
});
