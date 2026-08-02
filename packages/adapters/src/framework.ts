/**
 * M4a — the provider adapter framework.
 *
 * Every external provider goes through this. The rules it enforces come from
 * CLAUDE.md rule 8 and the integration engineering rules in
 * `docs/05-integrations-and-compliance.md` §5:
 *
 *  - Never call a third party from a request handler. Adapters are invoked
 *    from jobs, and this framework is what a job calls.
 *  - Store the RAW response alongside the parsed result, so a parser bug is
 *    fixable without re-paying for the call.
 *  - Cache aggressively, with a per-source TTL. Vehicle data lookups are our
 *    dominant marginal cost.
 *  - Meter cost per tenant, per provider.
 *  - Circuit-break per provider, and degrade with a NAMED message — never a
 *    generic error.
 *  - Idempotency key on every call.
 *
 * The framework is deliberately transport-agnostic: an adapter supplies a
 * `fetcher`, which the tests replace with a fixture reader. That is how we
 * test provider behaviour without a network or a contract.
 */

export type Provider = 'dvla_ves' | 'dvsa_mot' | 'cap_hpi' | 'hpi_check' | 'percayso' | 'jato' | 'aggregator';

export interface ProviderCall<TParsed> {
  provider: Provider;
  lookupType: string;
  /** Natural key for caching — usually a normalised registration. */
  key: string;
  tenantId: string;
  /** Cost in pence. Free providers are 0 and still metered, for volume tracking. */
  costPence: number;
  /** How long a successful response stays fresh. */
  ttlSeconds: number;
  parse: (raw: unknown) => TParsed;
}

export interface CachedResponse {
  raw: unknown;
  fetchedAt: Date;
  provider: Provider;
  lookupType: string;
  key: string;
}

export interface AdapterResult<TParsed> {
  data: TParsed;
  /** True when served from cache — no cost incurred, no provider call made. */
  cached: boolean;
  fetchedAt: Date;
  costPence: number;
  raw: unknown;
}

export type Fetcher = (call: { provider: Provider; lookupType: string; key: string }) => Promise<unknown>;

export interface Cache {
  get(provider: Provider, lookupType: string, key: string): Promise<CachedResponse | null>;
  set(entry: CachedResponse, ttlSeconds: number): Promise<void>;
}

export interface CostMeter {
  record(entry: {
    tenantId: string; provider: Provider; lookupType: string;
    key: string; costPence: number; cached: boolean; at: Date;
  }): Promise<void>;
}

// ---------------------------------------------------------------- errors

export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    message: string,
    readonly cause?: unknown,
    /** Retrying an identical request may succeed (timeout, 5xx, rate limit). */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class CircuitOpenError extends ProviderError {
  constructor(provider: Provider, readonly retryAt: Date) {
    super(
      provider,
      // Named and specific. Never "An error occurred."
      `${PROVIDER_LABELS[provider]} is not responding. Everything else is working. ` +
        `We'll retry automatically at ${retryAt.toISOString().slice(11, 16)} UTC.`,
      undefined,
      true,
    );
    this.name = 'CircuitOpenError';
  }
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  dvla_ves: 'DVLA vehicle enquiry',
  dvsa_mot: 'DVSA MOT history',
  cap_hpi: 'cap hpi',
  hpi_check: 'HPI Check',
  percayso: 'Percayso',
  jato: 'JATO',
  aggregator: 'the vehicle data service',
};

// ---------------------------------------------------------------- circuit breaker

export interface CircuitOptions {
  failureThreshold: number;
  resetAfterMs: number;
}

const DEFAULT_CIRCUIT: CircuitOptions = { failureThreshold: 5, resetAfterMs: 5 * 60_000 };

interface CircuitState {
  failures: number;
  openedAt: Date | null;
}

export class CircuitBreaker {
  private readonly state = new Map<Provider, CircuitState>();

  constructor(private readonly options: CircuitOptions = DEFAULT_CIRCUIT) {}

  private get(provider: Provider): CircuitState {
    let s = this.state.get(provider);
    if (!s) { s = { failures: 0, openedAt: null }; this.state.set(provider, s); }
    return s;
  }

  isOpen(provider: Provider, now: Date): boolean {
    const s = this.get(provider);
    if (!s.openedAt) return false;
    if (now.getTime() - s.openedAt.getTime() >= this.options.resetAfterMs) {
      // Half-open: allow one probe through.
      s.openedAt = null;
      s.failures = 0;
      return false;
    }
    return true;
  }

  retryAt(provider: Provider): Date {
    const s = this.get(provider);
    return new Date((s.openedAt?.getTime() ?? Date.now()) + this.options.resetAfterMs);
  }

  recordSuccess(provider: Provider): void {
    const s = this.get(provider);
    s.failures = 0;
    s.openedAt = null;
  }

  recordFailure(provider: Provider, now: Date): void {
    const s = this.get(provider);
    s.failures += 1;
    if (s.failures >= this.options.failureThreshold && !s.openedAt) s.openedAt = now;
  }
}

// ---------------------------------------------------------------- in-memory defaults

export class InMemoryCache implements Cache {
  private readonly store = new Map<string, { entry: CachedResponse; expiresAt: number }>();
  private id(p: Provider, t: string, k: string): string { return `${p}:${t}:${k}`; }

  async get(provider: Provider, lookupType: string, key: string): Promise<CachedResponse | null> {
    const hit = this.store.get(this.id(provider, lookupType, key));
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) { this.store.delete(this.id(provider, lookupType, key)); return null; }
    return hit.entry;
  }

  async set(entry: CachedResponse, ttlSeconds: number): Promise<void> {
    this.store.set(this.id(entry.provider, entry.lookupType, entry.key), {
      entry,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

export class InMemoryCostMeter implements CostMeter {
  readonly entries: Array<Parameters<CostMeter['record']>[0]> = [];
  async record(entry: Parameters<CostMeter['record']>[0]): Promise<void> { this.entries.push(entry); }

  totalPence(tenantId?: string): number {
    return this.entries
      .filter((e) => !tenantId || e.tenantId === tenantId)
      .reduce((sum, e) => sum + (e.cached ? 0 : e.costPence), 0);
  }
  callCount(provider?: Provider): number {
    return this.entries.filter((e) => (!provider || e.provider === provider) && !e.cached).length;
  }
}

// ---------------------------------------------------------------- the runner

export interface RunnerOptions {
  fetcher: Fetcher;
  cache?: Cache;
  meter?: CostMeter;
  breaker?: CircuitBreaker;
  now?: () => Date;
  /** Attempts per call, including the first. */
  maxAttempts?: number;
}

/** Idempotency key — identical calls collapse to one. */
export const idempotencyKey = (c: { provider: Provider; lookupType: string; key: string }): string =>
  `${c.provider}:${c.lookupType}:${c.key}`;

export class AdapterRunner {
  private readonly cache: Cache;
  private readonly meter: CostMeter | undefined;
  private readonly breaker: CircuitBreaker;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  /** Collapses concurrent identical calls so we never pay twice for one lookup. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly options: RunnerOptions) {
    this.cache = options.cache ?? new InMemoryCache();
    this.meter = options.meter;
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async run<T>(call: ProviderCall<T>, opts: { forceRefresh?: boolean } = {}): Promise<AdapterResult<T>> {
    const now = this.now();

    // 1. Cache. A paid lookup is never re-run without a miss or an explicit refresh.
    if (!opts.forceRefresh) {
      const hit = await this.cache.get(call.provider, call.lookupType, call.key);
      if (hit) {
        await this.meter?.record({
          tenantId: call.tenantId, provider: call.provider, lookupType: call.lookupType,
          key: call.key, costPence: call.costPence, cached: true, at: now,
        });
        return { data: call.parse(hit.raw), cached: true, fetchedAt: hit.fetchedAt, costPence: 0, raw: hit.raw };
      }
    }

    // 2. Circuit breaker.
    if (this.breaker.isOpen(call.provider, now)) {
      throw new CircuitOpenError(call.provider, this.breaker.retryAt(call.provider));
    }

    // 3. Collapse concurrent identical calls.
    const idem = idempotencyKey(call);
    const existing = this.inFlight.get(idem);
    const raw = existing
      ? await existing
      : await this.dispatch(call, idem, now);

    // 4. Store raw alongside parsed, so a parser bug is fixable without re-paying.
    await this.cache.set(
      { raw, fetchedAt: now, provider: call.provider, lookupType: call.lookupType, key: call.key },
      call.ttlSeconds,
    );
    await this.meter?.record({
      tenantId: call.tenantId, provider: call.provider, lookupType: call.lookupType,
      key: call.key, costPence: call.costPence, cached: false, at: now,
    });

    return { data: call.parse(raw), cached: false, fetchedAt: now, costPence: call.costPence, raw };
  }

  private async dispatch<T>(call: ProviderCall<T>, idem: string, now: Date): Promise<unknown> {
    const attempt = (async (): Promise<unknown> => {
      let lastError: unknown;
      for (let i = 0; i < this.maxAttempts; i++) {
        try {
          const raw = await this.options.fetcher({
            provider: call.provider, lookupType: call.lookupType, key: call.key,
          });
          this.breaker.recordSuccess(call.provider);
          return raw;
        } catch (err) {
          lastError = err;
          this.breaker.recordFailure(call.provider, now);
          if (err instanceof ProviderError && !err.retryable) break;
        }
      }
      throw lastError instanceof ProviderError
        ? lastError
        : new ProviderError(call.provider, `${PROVIDER_LABELS[call.provider]} request failed`, lastError);
    })();

    this.inFlight.set(idem, attempt);
    try {
      return await attempt;
    } finally {
      this.inFlight.delete(idem);
    }
  }
}

// ---------------------------------------------------------------- TTLs

/**
 * Cache lifetimes, from `docs/05-integrations-and-compliance.md`.
 * Specification never changes for a given vehicle, so it is cached
 * effectively forever. Everything else moves.
 */
export const TTL = {
  spec: 365 * 24 * 3600,
  dvla: 24 * 3600,
  mot: 24 * 3600,
  valuation: 24 * 3600,
  provenance: 30 * 24 * 3600,
} as const;
