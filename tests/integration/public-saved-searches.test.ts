import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from '@/data/db';
import { ensureFixtures, T } from './fixtures';
import { sql as publicSql, withTenant } from '../../apps/site/src/data/db';
import {
  withVisitor,
  mintVisitorToken,
  tokenDigest,
} from '../../apps/site/src/data/shortlist';
import {
  loadSavedSearches,
  changeSavedSearch,
} from '../../apps/site/src/data/saved-searches';
import { parseBookmark } from '../../apps/site/src/search-bookmark';
import {
  getSavedSearches,
  postSavedSearch,
} from '../../apps/site/src/saved-searches';
const hostname = `search-${randomUUID()}.test`,
  brand = randomUUID(),
  rival = randomUUID();
const token = mintVisitorToken(),
  other = mintVisitorToken();
const change = (
  visitor: string,
  action = 'save',
  search = '/used-cars/ford?fuel=petrol&price_max=15000&sort=newest',
  id = '',
  name = '',
) => changeSavedSearch(T.tenant, visitor, { action, search, id, name });
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO brands (id,tenant_id,name) VALUES (${brand}::uuid,${T.tenant}::uuid,'Saved search fixture')`;
  await sql`INSERT INTO domains (tenant_id,brand_id,hostname,verification_token,verified_at) VALUES (${T.tenant}::uuid,${brand}::uuid,${hostname},${randomUUID()},now())`;
  await sql`INSERT INTO tenants (id,name,legal_name) VALUES (${rival}::uuid,'Search rival','Search rival Ltd')`;
});
afterAll(async () => {
  await publicSql.end();
  await sql.end();
});
describe('browser-private saved searches', () => {
  it('preserves every supported filter and sort, normalising only the page and duplicate values', () => {
    const b = parseBookmark(
      '/used-cars?make=ford,ford&model=focus&fuel=petrol&transmission=automatic&body=hatchback&colour=blue&doors=5&seats=5&price_min=3000&price_max=15000&year_min=2015&mileage_max=60000&q=heated%20seats&site=main&sort=price-desc&page=4',
    );
    expect(b.query.page).toBe(1);
    expect(b.query.maxPricePence).toBe(1500000n);
    expect(parseBookmark(b.path).query).toEqual(b.query);
    expect(b.path).toContain('sort=price-desc');
    expect(b.path).not.toContain('page=');
    for (const bad of [
      'https://evil.test/used-cars',
      '//evil.test/used-cars',
      '/used-cars/ford/focus/car',
      '/used-cars?monthly=100',
      '/used-cars?unknown=x',
      '/used-cars#x',
      '/used-cars/../contact',
    ])
      expect(() => parseBookmark(bad)).toThrow();
  });
  it('creates no visitor records on GET without a valid cookie', async () => {
    expect(await loadSavedSearches(T.tenant, null)).toEqual([]);
    const res = await getSavedSearches(
      new Request(`https://${hostname}/saved-searches`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await res.text()).toContain('A shortcut to the cars you want');
  });
  it('deduplicates concurrent saves and appends one audit with no identity or consent enrolment', async () => {
    expect(
      (await Promise.all([change(token), change(token)])).every((r) => r.ok),
    ).toBe(true);
    const rows = await loadSavedSearches(T.tenant, token);
    expect(rows).toHaveLength(1);
    const [row] =
      await sql`SELECT * FROM saved_searches WHERE id=${rows[0]!.id}::uuid`;
    expect(row!['consent_id']).toBeNull();
    expect(row!['contact_id']).toBeNull();
    expect(row!['query'].maxPricePence).toBe('1500000');
    const audits =
      await sql`SELECT diff FROM audit_events WHERE resource_id=${rows[0]!.id}::uuid`;
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(token);
  });
  it('isolates anonymous visitors, tenants and direct forged writes', async () => {
    const [own] = await loadSavedSearches(T.tenant, token);
    expect(await loadSavedSearches(T.tenant, other)).toEqual([]);
    expect(await loadSavedSearches(rival, token)).toEqual([]);
    expect(
      await withTenant(T.tenant, (tx) => tx`SELECT * FROM saved_searches`),
    ).toEqual([]);
    expect((await change(other, 'rename', '', own!.id, 'Forged')).ok).toBe(
      false,
    );
    expect(
      await withVisitor(
        T.tenant,
        other,
        (tx) =>
          tx`UPDATE saved_searches SET name='Forged' WHERE id=${own!.id}::uuid RETURNING id`,
      ),
    ).toEqual([]);
    const [list] =
      await sql`SELECT id FROM shortlists WHERE tenant_id=${T.tenant}::uuid AND token=${tokenDigest(token)}`;
    await expect(
      withVisitor(
        T.tenant,
        other,
        (tx) =>
          tx`INSERT INTO saved_searches (tenant_id,shortlist_id,name,canonical_path,query) VALUES (${T.tenant}::uuid,${list!['id']}::uuid,'Forged','/used-cars','{}')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withVisitor(
        T.tenant,
        token,
        (tx) =>
          tx`UPDATE saved_searches SET consent_version='invented' WHERE id=${own!.id}::uuid`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('hides contact-owned searches even when they reference the anonymous parent', async () => {
    const [contact] =
      await sql`SELECT id FROM contacts WHERE tenant_id=${T.tenant}::uuid LIMIT 1`;
    const [list] =
      await sql`SELECT id FROM shortlists WHERE tenant_id=${T.tenant}::uuid AND token=${tokenDigest(token)}`;
    const id = randomUUID();
    await sql`INSERT INTO saved_searches (id,tenant_id,shortlist_id,contact_id,name,canonical_path,query) VALUES (${id}::uuid,${T.tenant}::uuid,${list!['id']}::uuid,${contact!['id']}::uuid,'Private customer','/used-cars','{}')`;
    expect(
      (await loadSavedSearches(T.tenant, token)).some((r) => r.id === id),
    ).toBe(false);
  });
  it('renames safely, audits removal, then allows saving the same criteria again', async () => {
    const [own] = await loadSavedSearches(T.tenant, token);
    expect(
      (await change(token, 'rename', '', own!.id, '<script>alert(1)</script>'))
        .ok,
    ).toBe(true);
    const res = await getSavedSearches(
      new Request(`https://${hostname}/saved-searches`, {
        headers: { cookie: `fc_sl=${token}` },
      }),
    );
    const html = await res.text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)');
    expect((await change(token, 'rename', '', own!.id, ' ')).ok).toBe(false);
    expect((await change(token, 'remove', '', own!.id)).ok).toBe(true);
    expect(await loadSavedSearches(T.tenant, token)).toEqual([]);
    expect((await change(token)).ok).toBe(true);
    const audits =
      await sql`SELECT action FROM audit_events WHERE resource_id=${own!.id}::uuid ORDER BY occurred_at`;
    expect(audits.map((r) => r['action']).sort()).toEqual([
      'remove',
      'rename',
      'save',
    ]);
  });
  it('enforces the cap across concurrent saves and frees a place on removal', async () => {
    const visitor = mintVisitorToken();
    for (let i = 0; i < 19; i++)
      expect(
        (await change(visitor, 'save', `/used-cars?q=search${i}`)).ok,
      ).toBe(true);
    const results = await Promise.all([
      change(visitor, 'save', '/used-cars?q=last1'),
      change(visitor, 'save', '/used-cars?q=last2'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rows = await loadSavedSearches(T.tenant, visitor);
    expect(rows).toHaveLength(20);
    await change(visitor, 'remove', '', rows[0]!.id);
    expect((await change(visitor, 'save', '/used-cars?q=replacement')).ok).toBe(
      true,
    );
  });
  it('counts only current public matching stock and updates after publication changes', async () => {
    const visitor = mintVisitorToken(),
      car = randomUUID(),
      keyword = `ss${randomUUID().slice(0, 8)}`;
    await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,retail_price_pence) VALUES (${car}::uuid,${T.tenant}::uuid,${T.site}::uuid,${keyword},${car},${parseInt(car.slice(0, 7), 16)},'Ford','Focus','live',1000000)`;
    await change(visitor, 'save', `/used-cars?q=${keyword}`);
    expect((await loadSavedSearches(T.tenant, visitor))[0]!.count).toBe(1);
    await sql`UPDATE vehicles SET state='sold' WHERE id=${car}::uuid`;
    expect((await loadSavedSearches(T.tenant, visitor))[0]!.count).toBe(0);
  });
  it('checks origin and issues a secure cookie only for a successful save', async () => {
    const req = (
      body: Record<string, string>,
      origin = `https://${hostname}`,
    ) =>
      new Request(`https://${hostname}/saved-searches`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(body),
      });
    expect(
      (
        await postSavedSearch(
          req({ action: 'save', search: '/used-cars' }, 'https://other.test'),
        )
      ).status,
    ).toBe(403);
    const invalid = await postSavedSearch(
      req({ action: 'save', search: 'https://evil.test' }),
    );
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get('set-cookie')).toBeNull();
    const res = await postSavedSearch(
      req({ action: 'save', search: '/used-cars' }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/saved-searches?notice=save');
    expect(res.headers.get('set-cookie')).toMatch(
      /fc_sl=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure/,
    );
  });
});
