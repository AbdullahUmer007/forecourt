import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withSession } from '@/data/db';
import { ensureFixtures, T, session } from './fixtures';
import {
  discountPage,
  applyDiscount,
  approvedDiscount,
} from '@/data/discount-approvals';
import { cashQuotePage, saveCashQuote } from '@/data/cash-quotes';
import { invoiceDraftReview } from '@/data/deal-invoice';
const customer = randomUUID(),
  car = randomUUID(),
  deal = randomUUID(),
  role = randomUUID(),
  user = randomUUID(),
  membership = randomUUID();
const reviewer = {
  ...session,
  userId: user,
  membershipId: membership,
  roleKey: 'manager',
  permissions: ['deal.read', 'vehicle.read', 'deal.discount.approve'],
};
async function action(
  s = session,
  kind = 'request',
  reason = 'Customer requested a price match',
) {
  const c = await discountPage(s, deal);
  return withSession(s, (tx) =>
    applyDiscount(tx, s, {
      id: deal,
      binding: c!.binding,
      action: kind,
      reason,
      sequence: String(c!.requestSequence ?? ''),
    }),
  );
}
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO contacts(id,tenant_id,first_name,last_name,address_line1,postcode) VALUES(${customer}::uuid,${T.tenant}::uuid,'Discount','Customer','1 Test Street','MK1 1AA')`;
  await sql`INSERT INTO users(id,email,name) VALUES(${user}::uuid,${user + '@example.test'},'Discount reviewer')`;
  await sql`INSERT INTO roles(id,tenant_id,name,permissions,discount_limit_pence) VALUES(${role}::uuid,${T.tenant}::uuid,${role},${sql.json(['deal.read', 'vehicle.read', 'deal.discount.approve'])},10000)`;
  await sql`INSERT INTO tenant_memberships(id,tenant_id,user_id,role_id,status,scope_all_sites) VALUES(${membership}::uuid,${T.tenant}::uuid,${user}::uuid,${role}::uuid,'active',true)`;
  await sql`INSERT INTO vehicles(id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,retail_price_pence,vat_scheme) VALUES(${car}::uuid,${T.tenant}::uuid,${T.site}::uuid,${car.slice(0, 8)},${car},${parseInt(car.slice(0, 7), 16)},'Ford','Discount test','ready',1000000,'qualifying')`;
  await sql`INSERT INTO deals(id,tenant_id,site_id,contact_id,vehicle_id,state,vehicle_price_pence,created_by) VALUES(${deal}::uuid,${T.tenant}::uuid,${T.site}::uuid,${customer}::uuid,${car}::uuid,'building',975000,${T.user}::uuid)`;
});
afterAll(async () => {
  await sql`UPDATE vehicles SET state='archived' WHERE id=${car}::uuid`;
  await sql.end();
});
it('isolates read and write scopes and refuses missing permission or reason', async () => {
  for (const s of [
    { ...session, permissions: [] },
    { ...session, tenantId: randomUUID() },
    { ...session, scope: 'my_sites' as const, siteIds: [randomUUID()] },
  ]) {
    expect(await discountPage(s, deal)).toBeNull();
    expect(
      (
        await withSession(s, (tx) =>
          applyDiscount(tx, s, {
            id: deal,
            binding: '',
            action: 'request',
            reason: 'Valid reason',
            sequence: '',
          }),
        )
      ).ok,
    ).toBe(false);
  }
  expect((await action(session, 'request', 'no')).ok).toBe(false);
});
it('deduplicates requests and enforces separation of duties and the saved role limit', async () => {
  expect(await action()).toEqual({ ok: true });
  expect(await action()).toEqual({ ok: true });
  expect((await discountPage(session, deal))?.history).toHaveLength(1);
  expect((await action(session, 'approved')).ok).toBe(false);
  expect((await action(reviewer, 'approved')).ok).toBe(false);
  await sql`UPDATE roles SET discount_limit_pence=25000 WHERE id=${role}::uuid`;
  expect((await discountPage(reviewer, deal))?.canDecide).toBe(true);
  const results = await Promise.all([
    action(reviewer, 'approved'),
    action(reviewer, 'approved'),
  ]);
  expect(results).toEqual([{ ok: true }, { ok: true }]);
  expect(await withSession(session, (tx) => approvedDiscount(tx, deal))).toBe(
    true,
  );
  expect((await discountPage(session, deal))?.history).toHaveLength(2);
  expect((await cashQuotePage(session, deal))?.problem).toBeNull();
  const q = await cashQuotePage(session, deal);
  expect(
    (
      await withSession(session, (tx) =>
        saveCashQuote(tx, session, deal, q!.revision),
      )
    ).ok,
  ).toBe(true);
});
it('invalidates approval on repricing and rejects stale decisions before accepting a new decline', async () => {
  const before = await discountPage(session, deal);
  await sql`UPDATE deals SET vehicle_price_pence=974999,updated_at=clock_timestamp() WHERE id=${deal}::uuid`;
  expect(await withSession(session, (tx) => approvedDiscount(tx, deal))).toBe(
    false,
  );
  expect((await cashQuotePage(session, deal))?.problem).toContain(
    'Discount approval',
  );
  expect(
    (
      await withSession(reviewer, (tx) =>
        applyDiscount(tx, reviewer, {
          id: deal,
          binding: before!.binding,
          action: 'approved',
          reason: 'Still acceptable price',
          sequence: String(before!.requestSequence),
        }),
      )
    ).ok,
  ).toBe(false);
  expect(await action()).toEqual({ ok: true });
  await sql`UPDATE roles SET discount_limit_pence=30000 WHERE id=${role}::uuid`;
  expect(
    await action(reviewer, 'declined', 'Keep the advertised price'),
  ).toEqual({ ok: true });
  expect((await action(reviewer, 'approved')).ok).toBe(false);
  expect(await withSession(session, (tx) => approvedDiscount(tx, deal))).toBe(
    false,
  );
});
it('does not let a missing or reduced role limit approve a pending request', async () => {
  expect(await action()).toEqual({ ok: true });
  await sql`UPDATE roles SET discount_limit_pence=NULL WHERE id=${role}::uuid`;
  expect((await action(reviewer, 'approved')).ok).toBe(false);
  await sql`UPDATE roles SET discount_limit_pence=100 WHERE id=${role}::uuid`;
  expect((await action(reviewer, 'approved')).ok).toBe(false);
  const c = await discountPage(session, deal);
  await sql`UPDATE vehicles SET retail_price_pence=1000001 WHERE id=${car}::uuid`;
  expect(
    (
      await withSession(reviewer, (tx) =>
        applyDiscount(tx, reviewer, {
          id: deal,
          binding: c!.binding,
          action: 'approved',
          reason: 'Reviewed figures',
          sequence: String(c!.requestSequence),
        }),
      )
    ).ok,
  ).toBe(false);
  // Moving a discounted deal to agreed does not bypass the simple invoice gate.
  await sql`UPDATE deals SET state='agreed' WHERE id=${deal}::uuid`;
  const review = await invoiceDraftReview(session, deal);
  expect(review?.problem).toContain('Discount approval');
});
