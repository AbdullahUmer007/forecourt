import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withSession } from '@/data/db';
import { ensureFixtures, T, session } from './fixtures';
import { cashQuotePage, saveCashQuote } from '@/data/cash-quotes';
import { loadDeal } from '@/data/deals';
const customer = randomUUID(),
  car = randomUUID(),
  deal = randomUUID();
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO contacts (id,tenant_id,first_name,last_name,address_line1,postcode) VALUES (${customer}::uuid,${T.tenant}::uuid,'Invoice','Draft test','1 Test Street','MK1 1AA')`;
  await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,vat_scheme,retail_price_pence) VALUES (${car}::uuid,${T.tenant}::uuid,${T.site}::uuid,${car.slice(0, 8)},${car},${parseInt(car.slice(0, 7), 16)},'Ford','Invoice','ready','qualifying',1234567)`;
  await sql`INSERT INTO deals (id,tenant_id,site_id,contact_id,vehicle_id,state,vehicle_price_pence,created_by) VALUES (${deal}::uuid,${T.tenant}::uuid,${T.site}::uuid,${customer}::uuid,${car}::uuid,'building',1234567,${T.user}::uuid)`;
});
afterAll(async () => {
  await sql`UPDATE vehicles SET state='archived' WHERE id=${car}::uuid`;
  await sql.end();
});

it('requires read/update permissions and isolates tenant and branch access', async () => {
  for (const s of [
    { ...session, permissions: [] },
    { ...session, tenantId: randomUUID() },
    { ...session, scope: 'my_sites' as const, siteIds: [randomUUID()] },
  ]) {
    expect(await cashQuotePage(s, deal)).toBeNull();
    expect(
      (await withSession(s, (tx) => saveCashQuote(tx, s, deal, ''))).ok,
    ).toBe(false);
  }
  const readOnly = {
    ...session,
    permissions: ['deal.read', 'vehicle.read', 'contact.read'],
  };
  expect((await cashQuotePage(readOnly, deal))?.canSave).toBe(false);
  expect(
    (await withSession(readOnly, (tx) => saveCashQuote(tx, readOnly, deal, '')))
      .ok,
  ).toBe(false);
});
it('blocks unsupported settlements, discounted prices and contracted deals', async () => {
  await sql`UPDATE deals SET deposit_pence=100 WHERE id=${deal}::uuid`;
  expect((await cashQuotePage(session, deal))?.problem).toContain('cash-only');
  expect(
    (await withSession(session, (tx) => saveCashQuote(tx, session, deal, '')))
      .ok,
  ).toBe(false);
  await sql`UPDATE deals SET deposit_pence=0,vehicle_price_pence=100 WHERE id=${deal}::uuid`;
  expect((await cashQuotePage(session, deal))?.problem).toContain(
    'Discount approval',
  );
  await sql`UPDATE deals SET vehicle_price_pence=1234567,state='contracted',contracted_at=now(),contract_formation='on_premises' WHERE id=${deal}::uuid`;
  expect((await cashQuotePage(session, deal))?.problem).toContain(
    'before contract',
  );
  await sql`UPDATE deals SET state='building' WHERE id=${deal}::uuid`;
});
it('rejects stale review and saves exactly one snapshot under concurrent requests', async () => {
  const old = await cashQuotePage(session, deal);
  await sql`UPDATE contacts SET first_name='Updated',updated_at=clock_timestamp() WHERE id=${customer}::uuid`;
  expect(
    (
      await withSession(session, (tx) =>
        saveCashQuote(tx, session, deal, old!.revision),
      )
    ).ok,
  ).toBe(false);
  const current = await cashQuotePage(session, deal);
  const results = await Promise.all(
    [1, 2].map(() =>
      withSession(session, (tx) =>
        saveCashQuote(tx, session, deal, current!.revision),
      ),
    ),
  );
  expect(results[0]).toEqual(results[1]);
  expect(results[0]!.ok).toBe(true);
  const saved = await cashQuotePage(session, deal);
  expect(saved?.versions).toHaveLength(1);
  expect(saved?.versions[0]?.quote).toMatchObject({
    customer: 'Updated Draft test',
    pricePence: '1234567',
  });
  expect(JSON.stringify(saved?.versions)).not.toContain('cost');
  const [d] = await sql`SELECT state FROM deals WHERE id=${deal}::uuid`;
  expect(d?.['state']).toBe('building');
  expect(
    await sql`SELECT id FROM audit_events WHERE resource_id=${deal}::uuid AND action='cash_quote_saved'`,
  ).toHaveLength(1);
});
it('retains old details across revisions without creating finance presentation evidence', async () => {
  await sql`UPDATE deals SET vehicle_price_pence=1234599,updated_at=clock_timestamp() WHERE id=${deal}::uuid`;
  await sql`UPDATE contacts SET first_name='Another',updated_at=clock_timestamp() WHERE id=${customer}::uuid`;
  const current = await cashQuotePage(session, deal);
  expect(
    (
      await withSession(session, (tx) =>
        saveCashQuote(tx, session, deal, current!.revision),
      )
    ).ok,
  ).toBe(true);
  const saved = await cashQuotePage(session, deal);
  expect(saved?.versions).toHaveLength(2);
  expect(saved?.versions[1]?.quote.customer).toBe('Updated Draft test');
  expect(saved?.versions[1]?.quote.pricePence).toBe('1234567');
  expect(saved?.versions[0]?.quote.pricePence).toBe('1234599');
  const loaded = await loadDeal(session, deal, false);
  expect(loaded?.chain.valid).toBe(true);
  expect(
    await sql`SELECT id FROM deal_evidence WHERE deal_id=${deal}::uuid AND kind='quote_presented'`,
  ).toHaveLength(0);
});
