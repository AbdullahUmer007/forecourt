import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '@/data/db';
import { loadStock } from '@/data/stock';
import { ensureFixtures, session, T } from './fixtures';

/**
 * The stock-list budget, measured.
 *
 * CLAUDE.md states it as a build gate — "a 1,000-row stock list filters in
 * < 400ms" — and until now nothing enforced it, because there was no stock
 * list. A budget nobody measures is a wish.
 *
 * This seeds a thousand real vehicles into the integration tenant and times
 * the actual query the screen runs, against the actual indexes, through the
 * actual tenant context. It is not a microbenchmark of a function: the whole
 * point is that RLS, the join to `sites`, the count and the two facet queries
 * are all included, because those are what the dealer waits for.
 */

const TARGET_MS = 400;
const ROWS = 1_000;

const MAKES = ['BMW', 'Audi', 'Ford', 'Volkswagen', 'Vauxhall', 'Mercedes-Benz',
  'Nissan', 'Toyota', 'Kia', 'Hyundai'];
const MODELS = ['3 Series', 'A4', 'Focus', 'Golf', 'Corsa', 'A-Class',
  'Qashqai', 'Yaris', 'Sportage', 'i30'];
const STATES = ['live', 'in_prep', 'ready', 'reserved', 'sold', 'booked_in'];

let ready = false;
let reason = '';

beforeAll(async () => {
  try {
    await ensureFixtures();

    const [existing] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM vehicles
      WHERE tenant_id = ${T.tenant}::uuid AND stock_number LIKE 'PERF-%'`;

    if ((existing?.n ?? 0) < ROWS) {
      // One statement rather than a thousand round trips — seeding is not what
      // is being measured, and a slow seed makes the suite unrunnable.
      await sql`
        INSERT INTO vehicles (tenant_id, site_id, stock_number, stock_sequence,
                              registration, make, model, derivative, colour, mileage,
                              state, retail_price_pence, total_cost_pence,
                              published_photo_count, provenance_checked_at, vat_scheme,
                              booked_in_at)
        SELECT ${T.tenant}::uuid, ${T.site}::uuid,
               'PERF-' || i, 900000 + i,
               -- lpad to 4, not 2: lpad TRUNCATES a longer string, so width 2
               -- mapped i=14 and i=140 to the same '14' and produced only 966
               -- distinct registrations out of a thousand. Caught by asserting
               -- the row count rather than assuming the insert worked.
               'PF' || lpad(i::text, 4, '0'),
               (${MAKES}::text[])[1 + (i % 10)],
               (${MODELS}::text[])[1 + (i % 10)],
               'Derivative ' || (i % 5),
               (ARRAY['Black','White','Grey','Blue','Red'])[1 + (i % 5)],
               10000 + (i * 37) % 120000,
               ((${STATES}::text[])[1 + (i % 6)])::vehicle_state,
               (500000 + (i * 913) % 3000000)::bigint,
               (400000 + (i * 811) % 2500000)::bigint,
               (i % 14),
               CASE WHEN i % 7 = 0 THEN NULL ELSE now() - interval '10 days' END,
               (CASE WHEN i % 3 = 0 THEN 'qualifying' ELSE 'margin' END)::vat_scheme,
               now() - ((i % 200) || ' days')::interval
        FROM generate_series(1, ${ROWS}) AS i
        ON CONFLICT DO NOTHING`;
    }
    ready = true;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
});

afterAll(async () => {
  if (ready) {
    await sql`DELETE FROM vehicles
              WHERE tenant_id = ${T.tenant}::uuid AND stock_number LIKE 'PERF-%'`;
  }
  await sql.end();
});

it('the stock performance fixtures build', () => {
  expect(ready, `Could not seed the stock fixtures: ${reason}`).toBe(true);
});

describe.runIf(process.env['DATABASE_URL'])('the 1,000-row stock list', () => {
  it('actually has a thousand rows to filter', async () => {
    // A performance test against 14 cars proves nothing and passes forever.
    const page = await loadStock(session, { limit: 1 }, true);
    expect(page.total).toBeGreaterThanOrEqual(ROWS);
  });

  /** Runs it a few times and takes the worst — one fast run is not a budget. */
  const worstOf = async (
    runs: number,
    filters: Parameters<typeof loadStock>[1],
  ): Promise<number> => {
    let worst = 0;
    for (let i = 0; i < runs; i += 1) {
      const started = Date.now();
      await loadStock(session, filters, true);
      worst = Math.max(worst, Date.now() - started);
    }
    return worst;
  };

  it(`unfiltered, in under ${TARGET_MS}ms`, async () => {
    const worst = await worstOf(3, { limit: 50 });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it(`filtered by state, in under ${TARGET_MS}ms`, async () => {
    const worst = await worstOf(3, { state: 'live', limit: 50 });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it(`filtered by make, in under ${TARGET_MS}ms`, async () => {
    const worst = await worstOf(3, { make: 'BMW', limit: 50 });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it(`free-text searched, in under ${TARGET_MS}ms`, async () => {
    // The GIN index on search_vector is the one that would silently stop being
    // used if somebody changed the query to ILIKE.
    const worst = await worstOf(3, { q: 'Volkswagen Golf', limit: 50 });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it(`sorted by price with several filters, in under ${TARGET_MS}ms`, async () => {
    const worst = await worstOf(3, {
      state: 'live', make: 'Ford', sort: 'price_high', limit: 50,
    });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it(`deep into the list, in under ${TARGET_MS}ms`, async () => {
    // OFFSET degrades as it grows, and page 15 is where a naive query starts
    // to hurt without anyone noticing on page 1.
    const worst = await worstOf(3, { limit: 50, offset: 700 });
    expect(worst, `${worst}ms against a ${TARGET_MS}ms budget`).toBeLessThan(TARGET_MS);
  });

  it('the page reports its own query time, and it agrees with the wall clock', async () => {
    // The screen renders queryMs. If that number and reality diverged, the
    // budget on screen would be decorative.
    const started = Date.now();
    const page = await loadStock(session, { limit: 50 }, true);
    const wall = Date.now() - started;

    expect(page.queryMs).toBeLessThanOrEqual(wall);
    expect(page.queryMs).toBeLessThan(TARGET_MS);
  });
});

describe.runIf(process.env['DATABASE_URL'])('what the list returns', () => {
  it('withholds cost from a principal who may not see it', async () => {
    // Not hidden in the view — not selected at all. The column is replaced
    // with NULL in SQL, so the data never leaves Postgres.
    const withCost = await loadStock(session, { limit: 5 }, true);
    const without = await loadStock(session, { limit: 5 }, false);

    expect(withCost.rows.some((r) => r.totalCost !== null)).toBe(true);
    expect(without.rows.every((r) => r.totalCost === null)).toBe(true);
  });

  it('facet counts reflect the current filter, not the whole book', async () => {
    const all = await loadStock(session, { limit: 1 }, true);
    const bmwOnly = await loadStock(session, { make: 'BMW', limit: 1 }, true);

    expect(bmwOnly.total).toBeLessThan(all.total);
    // The state counts narrow with the make filter — a list that never changes
    // as you filter tells you nothing about what you are looking at.
    const allLive = all.states.find((s) => s.state === 'live')?.count ?? 0;
    const bmwLive = bmwOnly.states.find((s) => s.state === 'live')?.count ?? 0;
    expect(bmwLive).toBeLessThan(allLive);
  });

  it('a free-text search that matches nothing returns nothing, not everything', async () => {
    // The failure where an empty predicate quietly becomes "no filter".
    const page = await loadStock(session, { q: 'zzzznotamake', limit: 50 }, true);
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });

  it('tolerates punctuation somebody typed on a forecourt', async () => {
    // plainto_tsquery rather than to_tsquery, which throws on a stray
    // ampersand — and the input here is whatever went into the box.
    await expect(loadStock(session, { q: 'BMW & Audi!', limit: 5 }, true)).resolves.toBeDefined();
  });
});
