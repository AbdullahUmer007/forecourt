import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@/data/db';
import { ensureFixtures, T } from './fixtures';
import { withTenant, sql as publicSql } from '../../apps/site/src/data/db';
import {
  changeSavedCar,
  loadSavedCars,
  mintVisitorToken,
  tokenDigest,
  withVisitor,
} from '../../apps/site/src/data/shortlist';
import {
  safeBack,
  visitorCookie,
  savedHeaders,
  getSavedCars,
  postSavedCar,
} from '../../apps/site/src/saved-cars';
const hostname = `shortlist-${randomUUID()}.test`,
  brand = randomUUID();
const first = mintVisitorToken(),
  second = mintVisitorToken(),
  car = randomUUID(),
  rival = randomUUID(),
  rivalSite = randomUUID(),
  rivalCar = randomUUID();
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO brands (id,tenant_id,name) VALUES (${brand}::uuid,${T.tenant}::uuid,'Shortlist route fixture')`;
  await sql`INSERT INTO domains (tenant_id,brand_id,hostname,verification_token,verified_at) VALUES (${T.tenant}::uuid,${brand}::uuid,${hostname},${randomUUID()},now())`;

  await sql`INSERT INTO tenants (id,name,legal_name) VALUES (${rival}::uuid,'Shortlist rival','Shortlist rival Ltd')`;
  await sql`INSERT INTO sites (id,tenant_id,name) VALUES (${rivalSite}::uuid,${rival}::uuid,'Rival branch')`;
  for (const [id, tenant, site] of [
    [car, T.tenant, T.site],
    [rivalCar, rival, rivalSite],
  ])
    await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,retail_price_pence)
 VALUES (${id!}::uuid,${tenant!}::uuid,${site!}::uuid,${id!.slice(0, 8).toUpperCase()},${id!},${parseInt(id!.slice(0, 7), 16)},'Ford','Focus','live',1234500)`;
});
afterAll(async () => {
  await publicSql.end();
  await sql.end();
});
describe('public saved cars with visitor and tenant RLS', () => {
  it('does not create a list while browsing without a cookie', async () => {
    expect(await loadSavedCars(T.tenant, null)).toEqual([]);
    expect(await loadSavedCars(T.tenant, 'invalid')).toEqual([]);
    expect(savedHeaders['cache-control']).toBe('private, no-store');
    expect(visitorCookie(new Request('https://example.test'))).toBeNull();
  });
  it('saves once under concurrent requests, stores only a digest and writes one audit', async () => {
    const results = await Promise.all(
      [1, 2].map(() => changeSavedCar(T.tenant, first, car, 'save')),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(
      (await loadSavedCars(T.tenant, first)).map((r) => r.vehicleId),
    ).toEqual([car]);
    const [list] =
      await sql`SELECT id,token FROM shortlists WHERE tenant_id=${T.tenant}::uuid AND token=${tokenDigest(first)}`;
    expect(list?.['token']).not.toBe(first);
    const [n] =
      await sql`SELECT count(*)::int AS n FROM audit_events WHERE resource_id=${list!['id']}::uuid`;
    expect(n?.['n']).toBe(1);
  });
  it('isolates two visitors even within the same dealer and refuses direct item access', async () => {
    expect(await loadSavedCars(T.tenant, second)).toEqual([]);
    const rows = await withVisitor(
      T.tenant,
      second,
      (tx) => tx`SELECT * FROM shortlist_items`,
    );
    expect(rows).toEqual([]);
    const affected = await withVisitor(
      T.tenant,
      second,
      (tx) =>
        tx`UPDATE shortlist_items SET removed_at=now() WHERE vehicle_id=${car}::uuid RETURNING id`,
    );
    expect(affected).toEqual([]);
    expect(
      await withTenant(T.tenant, (tx) => tx`SELECT * FROM shortlists`),
    ).toEqual([]);
    const [owner] =
      await sql`SELECT id FROM shortlists WHERE tenant_id=${T.tenant}::uuid AND token=${tokenDigest(first)}`;
    await expect(
      withVisitor(
        T.tenant,
        second,
        (tx) =>
          tx`INSERT INTO shortlist_items (tenant_id,shortlist_id,vehicle_id) VALUES (${T.tenant}::uuid,${owner!['id']}::uuid,${car}::uuid)`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('refuses foreign stock and cannot use one dealer token to read another', async () => {
    expect((await changeSavedCar(T.tenant, first, rivalCar, 'save')).ok).toBe(
      false,
    );
    expect(await loadSavedCars(rival, first)).toEqual([]);
    expect((await changeSavedCar(rival, second, rivalCar, 'save')).ok).toBe(
      true,
    );
    expect(await loadSavedCars(T.tenant, second)).toEqual([]);
  });
  it('removes idempotently and restores one original item without duplicates', async () => {
    expect((await changeSavedCar(T.tenant, first, car, 'remove')).ok).toBe(
      true,
    );
    expect((await changeSavedCar(T.tenant, first, car, 'remove')).ok).toBe(
      true,
    );
    expect(await loadSavedCars(T.tenant, first)).toEqual([]);
    expect((await changeSavedCar(T.tenant, first, car, 'save')).ok).toBe(true);
    expect(await loadSavedCars(T.tenant, first)).toHaveLength(1);
  });
  it('retains unavailable entries without returning nonpublic vehicle data', async () => {
    await sql`UPDATE vehicles SET state='sold',retail_price_pence=999999999 WHERE id=${car}::uuid`;
    const rows = await loadSavedCars(T.tenant, first);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vehicle).toBeNull();
    expect(JSON.stringify(rows)).not.toContain('999999999');
    expect((await changeSavedCar(T.tenant, first, car, 'save')).ok).toBe(false);
    await sql`UPDATE vehicles SET state='live' WHERE id=${car}::uuid`;
  });
  it('does not expose merged or contact-owned lists to visitor tokens', async () => {
    await sql`UPDATE shortlists SET owner_kind='contact',contact_id=${T.contact}::uuid WHERE token=${tokenDigest(first)} AND tenant_id=${T.tenant}::uuid`;
    expect(await loadSavedCars(T.tenant, first)).toEqual([]);
    await sql`UPDATE shortlists SET owner_kind='anonymous',contact_id=NULL WHERE token=${tokenDigest(first)} AND tenant_id=${T.tenant}::uuid`;
  });
  it('sets a secure private cookie only after a successful same-origin save', async () => {
    const url = `https://${hostname}/saved-cars`;
    const page = await getSavedCars(new Request(url));
    expect(page.status).toBe(200);
    expect(page.headers.has('set-cookie')).toBe(false);
    const post = () =>
      new Request(url, {
        method: 'POST',
        headers: {
          origin: `https://${hostname}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ vehicle: car, action: 'save' }),
      });
    const response = await postSavedCar(post());
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const saved = await getSavedCars(
      new Request(url, { headers: { cookie: cookie.split(';')[0]! } }),
    );
    expect(await saved.text()).toContain('Ford Focus');
    expect(saved.headers.get('vary')).toBe('Cookie');
  });
  it('refuses cross-origin writes and invalid vehicles without issuing cookies', async () => {
    for (const [origin, vehicle, status] of [
      ['https://other.test', car, 403],
      [`https://${hostname}`, 'invalid', 422],
    ] as const) {
      const r = await postSavedCar(
        new Request(`https://${hostname}/saved-cars`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ vehicle, action: 'save' }),
        }),
      );
      expect(r.status).toBe(status);
      expect(r.headers.has('set-cookie')).toBe(false);
    }
  });
  it('compares only the current visitor’s saved public cars', async () => {
    const other = randomUUID();
    await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,retail_price_pence)
   VALUES (${other}::uuid,${T.tenant}::uuid,${T.site}::uuid,${other.slice(0, 8)},${other},${parseInt(other.slice(0, 7), 16)},'Toyota','Yaris','live',1200000)`;
    expect((await changeSavedCar(T.tenant, first, other, 'save')).ok).toBe(
      true,
    );
    const url = `https://${hostname}/saved-cars?compare=${car}&compare=${other}`;
    const good = await getSavedCars(
      new Request(url, { headers: { cookie: `fc_sl=${first}` } }),
    );
    expect(await good.text()).toContain('<table class="sl-table">');
    const wrong = await getSavedCars(
      new Request(url, { headers: { cookie: `fc_sl=${second}` } }),
    );
    expect(await wrong.text()).not.toContain('<table class="sl-table">');
  });
  it('enforces the 50-car limit under concurrent additions', async () => {
    const token = mintVisitorToken(),
      ids = Array.from({ length: 51 }, () => randomUUID());
    const rows = ids.map((id, index) => ({
      id,
      tenant_id: T.tenant,
      site_id: T.site,
      registration: id.slice(0, 8),
      stock_number: id,
      stock_sequence: parseInt(id.slice(0, 7), 16),
      make: 'Capacity',
      model: String(index),
      state: 'live',
    }));
    await sql`INSERT INTO vehicles ${sql(rows)}`;
    expect((await changeSavedCar(T.tenant, token, ids[0]!, 'save')).ok).toBe(
      true,
    );
    const [list] = await withVisitor(
      T.tenant,
      token,
      (tx) => tx`SELECT id FROM shortlists`,
    );
    await sql`INSERT INTO shortlist_items ${sql(ids.slice(1, 49).map((id) => ({ tenant_id: T.tenant, shortlist_id: String(list!['id']), vehicle_id: id })))}`;
    const result = await Promise.all(
      ids.slice(49).map((id) => changeSavedCar(T.tenant, token, id, 'save')),
    );
    expect(result.filter((r) => r.ok)).toHaveLength(1);
    expect(result.find((r) => !r.ok)?.message).toContain('full at 50');
    expect(await loadSavedCars(T.tenant, token)).toHaveLength(50);
    await sql`UPDATE vehicles SET state='archived' WHERE id IN ${sql(ids)}`;
  });
  it('keeps redirect paths local and treats malformed cookie values as absent', () => {
    for (const bad of [
      '//evil.test',
      'https://evil.test',
      '/used-cars\\evil',
      '/used-carsx',
      '/used-cars\nX:1',
    ])
      expect(safeBack(bad)).toBe('/used-cars');
    expect(safeBack('/used-cars?fuel=diesel')).toBe('/used-cars?fuel=diesel');
    expect(
      visitorCookie(
        new Request('https://example.test', {
          headers: { cookie: 'fc_sl=short' },
        }),
      ),
    ).toBeNull();
  });
});
