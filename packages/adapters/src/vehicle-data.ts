/**
 * M4b — DVLA Vehicle Enquiry Service and DVSA MOT History.
 *
 * Both are FREE and self-serve — no commercial contract, unlike cap hpi and
 * HPI Check. That is why this half of M4 could be built before the data
 * provider conversations conclude.
 *
 * DVLA VES:   REST, `x-api-key` header. Register via DvlaAPIAccess@dvla.gov.uk.
 * DVSA MOT:   REST. Hybrid auth — OAuth2 client credentials (Microsoft Entra,
 *             60-minute tokens) PLUS a separate `X-API-Key` header.
 *             Quota 500,000/day; burst 10; ~15 req/sec average. HTTP 429 on
 *             breach, and the key is locked for 24 hours if the daily quota is
 *             exceeded — so the runner's rate limiting is not optional.
 */

import {
  AdapterRunner, ProviderError, TTL,
  type AdapterResult, type Provider,
} from './framework.js';

// ---------------------------------------------------------------- registration

/**
 * UK registration formats: current `AB12 CDE`, prefix `A123 BCD`,
 * suffix `ABC 123D`, dateless, Northern Ireland `ABC 1234`.
 *
 * Stored normalised (uppercase, no spaces); displayed formatted.
 */
export const normaliseRegistration = (input: string): string =>
  input.toUpperCase().replace(/[\s\-_.]/g, '');

/**
 * A dealer reading a plate off a windscreen types O for 0 and I for 1 — and
 * the reverse. Search must tolerate both, so we generate the candidate set
 * rather than guessing which the dealer meant.
 */
export function registrationCandidates(input: string): string[] {
  const base = normaliseRegistration(input);
  const swaps: Array<[RegExp, string]> = [[/O/g, '0'], [/0/g, 'O'], [/I/g, '1'], [/1/g, 'I'], [/S/g, '5'], [/5/g, 'S']];
  const set = new Set<string>([base]);
  for (const [from, to] of swaps) set.add(base.replace(from, to));
  return [...set];
}

/** Display form: current-style plates get a space before the last three. */
export function formatRegistration(reg: string): string {
  const r = normaliseRegistration(reg);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r)) return `${r.slice(0, 4)} ${r.slice(4)}`;   // AB12 CDE
  if (/^[A-Z]\d{1,3}[A-Z]{3}$/.test(r)) return `${r.slice(0, -3)} ${r.slice(-3)}`;  // A123 BCD
  if (/^[A-Z]{3}\d{1,3}[A-Z]$/.test(r)) return `${r.slice(0, 3)} ${r.slice(3)}`;    // ABC 123D
  if (/^[A-Z]{3}\d{4}$/.test(r)) return `${r.slice(0, 3)} ${r.slice(3)}`;           // NI
  return r;
}

export const isPlausibleRegistration = (input: string): boolean => {
  const r = normaliseRegistration(input);
  return r.length >= 2 && r.length <= 8 && /^[A-Z0-9]+$/.test(r);
};

// ---------------------------------------------------------------- DVLA VES

export interface DvlaVehicle {
  registration: string;
  make: string | null;
  colour: string | null;
  fuelType: string | null;
  engineCc: number | null;
  co2Gkm: number | null;
  euroStatus: string | null;
  yearOfManufacture: number | null;
  firstRegisteredOn: string | null;
  taxStatus: string | null;
  taxDueOn: string | null;
  motStatus: string | null;
  motExpiresOn: string | null;
  wheelplan: string | null;
  revenueWeight: number | null;
  v5cIssuedOn: string | null;
  markedForExport: boolean;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function parseDvla(raw: unknown): DvlaVehicle {
  if (!raw || typeof raw !== 'object') throw new ProviderError('dvla_ves', 'DVLA returned an unreadable response', raw, false);
  const r = raw as Record<string, unknown>;
  if (!str(r['registrationNumber'])) {
    throw new ProviderError('dvla_ves', 'DVLA response has no registration number', raw, false);
  }
  return {
    registration: normaliseRegistration(String(r['registrationNumber'])),
    make: str(r['make']),
    colour: str(r['colour']),
    fuelType: str(r['fuelType']),
    engineCc: num(r['engineCapacity']),
    co2Gkm: num(r['co2Emissions']),
    euroStatus: str(r['euroStatus']),
    yearOfManufacture: num(r['yearOfManufacture']),
    firstRegisteredOn: str(r['monthOfFirstRegistration']),
    taxStatus: str(r['taxStatus']),
    taxDueOn: str(r['taxDueDate']),
    motStatus: str(r['motStatus']),
    motExpiresOn: str(r['motExpiryDate']),
    wheelplan: str(r['wheelplan']),
    revenueWeight: num(r['revenueWeight']),
    v5cIssuedOn: str(r['dateOfLastV5CIssued']),
    markedForExport: r['markedForExport'] === true,
  };
}

// ---------------------------------------------------------------- DVSA MOT

export interface MotTest {
  testDate: string;
  result: 'PASSED' | 'FAILED' | 'UNKNOWN';
  expiryDate: string | null;
  odometer: number | null;
  odometerUnit: 'mi' | 'km' | null;
  odometerResultType: string | null;
  testNumber: string | null;
  defects: Array<{ text: string; type: string; dangerous: boolean }>;
  advisories: string[];
}

export interface MotHistory {
  registration: string;
  tests: MotTest[];
  /** Highest odometer reading ever recorded, normalised to miles. */
  highestMileage: number | null;
  latestExpiry: string | null;
  /** Advisories from the most recent test — these seed the prep checklist. */
  latestAdvisories: string[];
}

const KM_TO_MILES = 0.621371;
const toMiles = (value: number, unit: string | null): number =>
  unit === 'km' ? Math.round(value * KM_TO_MILES) : Math.round(value);

export function parseMotHistory(raw: unknown): MotHistory {
  if (!raw || typeof raw !== 'object') throw new ProviderError('dvsa_mot', 'DVSA returned an unreadable response', raw, false);
  const r = raw as Record<string, unknown>;
  const registration = normaliseRegistration(String(r['registration'] ?? ''));
  const rawTests = Array.isArray(r['motTests']) ? (r['motTests'] as Record<string, unknown>[]) : [];

  const tests: MotTest[] = rawTests.map((t): MotTest => {
    const unitRaw = str(t['odometerUnit'])?.toLowerCase() ?? null;
    const unit: 'mi' | 'km' | null = unitRaw === 'km' ? 'km' : unitRaw === 'mi' ? 'mi' : null;
    const defects = Array.isArray(t['defects']) ? (t['defects'] as Record<string, unknown>[]) : [];
    return {
      testDate: str(t['completedDate']) ?? '',
      result: str(t['testResult'])?.toUpperCase() === 'PASSED' ? 'PASSED'
        : str(t['testResult'])?.toUpperCase() === 'FAILED' ? 'FAILED' : 'UNKNOWN',
      expiryDate: str(t['expiryDate']),
      odometer: num(t['odometerValue']),
      odometerUnit: unit,
      odometerResultType: str(t['odometerResultType']),
      testNumber: str(t['motTestNumber']),
      defects: defects
        .filter((d) => str(d['type'])?.toUpperCase() !== 'ADVISORY')
        .map((d) => ({
          text: str(d['text']) ?? '',
          type: str(d['type']) ?? 'UNKNOWN',
          dangerous: d['dangerous'] === true,
        })),
      advisories: defects
        .filter((d) => str(d['type'])?.toUpperCase() === 'ADVISORY')
        .map((d) => str(d['text']) ?? '')
        .filter(Boolean),
    };
  })
  // Newest first — the order the dealer and the buyer both expect.
  .sort((a, b) => (b.testDate ?? '').localeCompare(a.testDate ?? ''));

  const readings = tests
    .filter((t) => t.odometer !== null && t.odometerResultType !== 'NO_ODOMETER_READING')
    .map((t) => toMiles(t.odometer!, t.odometerUnit));

  return {
    registration,
    tests,
    highestMileage: readings.length ? Math.max(...readings) : null,
    latestExpiry: tests.find((t) => t.expiryDate)?.expiryDate ?? null,
    latestAdvisories: tests[0]?.advisories ?? [],
  };
}

/**
 * Mileage anomalies within the MOT record itself — a reading LOWER than an
 * earlier one. This is the strongest clocking signal available, and it is free.
 *
 * Feeds `vehicles.highest_mot_mileage`, which M3's go-live gate reads.
 */
export function detectMileageAnomalies(history: MotHistory): Array<{ testDate: string; odometer: number; previousHighest: number }> {
  const chronological = [...history.tests]
    .filter((t) => t.odometer !== null && t.odometerResultType !== 'NO_ODOMETER_READING')
    .sort((a, b) => (a.testDate ?? '').localeCompare(b.testDate ?? ''));

  const anomalies: Array<{ testDate: string; odometer: number; previousHighest: number }> = [];
  let highest = 0;
  for (const t of chronological) {
    const miles = toMiles(t.odometer!, t.odometerUnit);
    if (miles < highest) anomalies.push({ testDate: t.testDate, odometer: miles, previousHighest: highest });
    else highest = miles;
  }
  return anomalies;
}

// ---------------------------------------------------------------- lookups

export interface LookupContext {
  runner: AdapterRunner;
  tenantId: string;
}

export const lookupDvla = (
  ctx: LookupContext, registration: string, opts: { forceRefresh?: boolean } = {},
): Promise<AdapterResult<DvlaVehicle>> =>
  ctx.runner.run({
    provider: 'dvla_ves',
    lookupType: 'vehicle',
    key: normaliseRegistration(registration),
    tenantId: ctx.tenantId,
    costPence: 0,          // free, but still metered for volume and rate limits
    ttlSeconds: TTL.dvla,
    parse: parseDvla,
  }, opts);

export const lookupMotHistory = (
  ctx: LookupContext, registration: string, opts: { forceRefresh?: boolean } = {},
): Promise<AdapterResult<MotHistory>> =>
  ctx.runner.run({
    provider: 'dvsa_mot',
    lookupType: 'history',
    key: normaliseRegistration(registration),
    tenantId: ctx.tenantId,
    costPence: 0,
    ttlSeconds: TTL.mot,
    parse: parseMotHistory,
  }, opts);

// ---------------------------------------------------------------- the magic moment

export interface VehicleLookupResult {
  registration: string;
  dvla: DvlaVehicle | null;
  mot: MotHistory | null;
  /** Populates vehicles.highest_mot_mileage, which the go-live gate reads. */
  highestMotMileage: number | null;
  internalMileageAnomalies: ReturnType<typeof detectMileageAnomalies>;
  suggestedPrepItems: string[];
  /** Which sources failed, so the UI can name them rather than say "an error occurred". */
  degraded: Array<{ provider: Provider; message: string }>;
  totalCostPence: number;
}

/**
 * Type a registration, get the car.
 *
 * Deliberately partial-tolerant: if MOT history is unavailable we still return
 * the DVLA data rather than failing the whole lookup. A dealer standing in an
 * auction hall would rather have half the car than an error.
 */
export async function lookupVehicle(ctx: LookupContext, registration: string): Promise<VehicleLookupResult> {
  const reg = normaliseRegistration(registration);
  const degraded: VehicleLookupResult['degraded'] = [];
  let totalCostPence = 0;

  const [dvlaResult, motResult] = await Promise.allSettled([
    lookupDvla(ctx, reg),
    lookupMotHistory(ctx, reg),
  ]);

  let dvla: DvlaVehicle | null = null;
  if (dvlaResult.status === 'fulfilled') {
    dvla = dvlaResult.value.data;
    totalCostPence += dvlaResult.value.costPence;
  } else {
    const err = dvlaResult.reason;
    degraded.push({
      provider: 'dvla_ves',
      message: err instanceof ProviderError ? err.message : 'DVLA vehicle enquiry is unavailable',
    });
  }

  let mot: MotHistory | null = null;
  if (motResult.status === 'fulfilled') {
    mot = motResult.value.data;
    totalCostPence += motResult.value.costPence;
  } else {
    const err = motResult.reason;
    degraded.push({
      provider: 'dvsa_mot',
      message: err instanceof ProviderError ? err.message : 'DVSA MOT history is unavailable',
    });
  }

  return {
    registration: reg,
    dvla,
    mot,
    highestMotMileage: mot?.highestMileage ?? null,
    internalMileageAnomalies: mot ? detectMileageAnomalies(mot) : [],
    // Advisories from the last test become suggested prep work. A small feature
    // that dealers consistently love, built on data we already have.
    suggestedPrepItems: mot?.latestAdvisories ?? [],
    degraded,
    totalCostPence,
  };
}
