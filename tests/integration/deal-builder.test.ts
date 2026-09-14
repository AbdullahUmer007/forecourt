import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { sql, withSession } from '@/data/db';
import { ensureFixtures, T, session } from './fixtures';
import {
  cashPence,
  applyDraftDeal,
  applyDraftPrice,
  draftPriceEditor,
  dealBuilderOptions,
  type DraftDealInput,
} from '@/data/deal-builder';
import { loadDeal } from '@/data/deals';
const car = randomUUID(),
  otherCar = randomUUID(),
  lead = randomUUID(),
  otherSite = randomUUID();
const input: DraftDealInput = {
  contactId: T.contact,
  vehicleId: car,
  leadId: lead,
  price: '12345.67',
};
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO sites (id,tenant_id,name) VALUES (${otherSite}::uuid,${T.tenant}::uuid,${'Deal branch '+otherSite})`;
  for (const [id, site] of [
    [car, T.site],
    [otherCar, otherSite],
  ])
    await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,retail_price_pence) VALUES (${id!}::uuid,${T.tenant}::uuid,${site!}::uuid,${id!.slice(0, 8)},${id!},${parseInt(id!.slice(0, 7), 16)},'Ford','Draft','ready',1234567)`;
  await sql`INSERT INTO leads (id,tenant_id,site_id,contact_id,vehicle_id,source,stage) VALUES (${lead}::uuid,${T.tenant}::uuid,${T.site}::uuid,${T.contact}::uuid,${car}::uuid,'walk_in','new')`;
});
afterAll(async () => {
  await sql`UPDATE vehicles SET state='archived' WHERE id IN (${car}::uuid,${otherCar}::uuid)`;
  await sql.end();
});
it('parses pence exactly and rejects invalid cash prices', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 999999999 }),
      fc.integer({ min: 0, max: 99 }),
      (p, c) => {
        expect(cashPence(`${p}.${c.toString().padStart(2, '0')}`)).toBe(
          BigInt(p) * 100n + BigInt(c),
        );
      },
    ),
  );
  for (const s of ['', '0', '-1', '1e4', 'NaN', '12.345', '1000000000'])
    expect(cashPence(s)).toBeNull();
});
it('refuses missing permissions and another branch before creating records', async () => {
  expect(
    await dealBuilderOptions({ ...session, permissions: ['deal.create'] }, ''),
  ).toBeNull();
  expect(
    (
      await withSession({ ...session, permissions: ['deal.read'] }, (tx) =>
        applyDraftDeal(tx, { ...session, permissions: ['deal.read'] }, input),
      )
    ).ok,
  ).toBe(false);
  const restricted = {
    ...session,
    scope: 'my_sites' as const,
    siteIds: [T.site],
  };
  expect(
    (
      await withSession(restricted, (tx) =>
        applyDraftDeal(tx, restricted, {
          ...input,
          vehicleId: otherCar,
          leadId: '',
        }),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftDeal(tx, session, { ...input, contactId: randomUUID() }),
      )
    ).ok,
  ).toBe(false);
});
it('refuses a mismatched enquiry and invalid IDs without writes', async () => {
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftDeal(tx, session, { ...input, vehicleId: otherCar }),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftDeal(tx, session, { ...input, vehicleId: 'bad' }),
      )
    ).ok,
  ).toBe(false);
});
it('creates one draft, audit and valid evidence chain under concurrent submission', async () => {
  const results = await Promise.all(
    [1, 2].map(() =>
      withSession(session, (tx) => applyDraftDeal(tx, session, input)),
    ),
  );
  expect(results.every((r) => r.ok)).toBe(true);
  if (!results[0]!.ok || !results[1]!.ok) throw new Error('Draft failed');
  expect(results[0]!.id).toBe(results[1]!.id);
  const id = results[0]!.id;
  const [row] = await sql`SELECT * FROM deals WHERE id=${id}::uuid`;
  expect(String(row!['vehicle_price_pence'])).toBe('1234567');
  expect(row!['state']).toBe('building');
  expect(row!['contract_formation']).toBeNull();
  expect(row!['invoice_id']).toBeNull();
  const audits =
    await sql`SELECT id FROM audit_events WHERE resource_id=${id}::uuid`;
  expect(audits).toHaveLength(1);
  const detail = await loadDeal(session, id, false);
  expect(detail?.chain.valid).toBe(true);
  expect(detail?.margin).toBeNull();
  const [v] = await sql`SELECT state FROM vehicles WHERE id=${car}::uuid`;
  expect(v!['state']).toBe('ready');
  const [l] = await sql`SELECT stage FROM leads WHERE id=${lead}::uuid`;
  expect(l!['stage']).toBe('new');
});
it('selectors preserve chosen records and do not expose private costs', async () => {
  const opts = await dealBuilderOptions(session, 'no match', car, T.contact);
  expect(opts?.vehicles.map((v) => v.id)).toContain(car);
  expect(opts?.contacts.map((c) => c.id)).toContain(T.contact);
  expect(JSON.stringify(opts)).not.toMatch(/purchase_price|cost_pence|margin/);
  const foreign = { ...session, tenantId: randomUUID() };
  expect((await dealBuilderOptions(foreign, ''))?.vehicles).toEqual([]);
  expect(
    (await withSession(foreign, (tx) => applyDraftDeal(tx, foreign, input))).ok,
  ).toBe(false);
});
it('rejects erased customers and unavailable stock', async () => {
  const contact = randomUUID();
  await sql`INSERT INTO contacts (id,tenant_id,first_name,erased_at) VALUES (${contact}::uuid,${T.tenant}::uuid,'Erased',now())`;
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftDeal(tx, session, {
          ...input,
          contactId: contact,
          leadId: '',
          vehicleId: otherCar,
        }),
      )
    ).ok,
  ).toBe(false);
  await sql`UPDATE vehicles SET state='sold' WHERE id=${otherCar}::uuid`;
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftDeal(tx, session, {
          ...input,
          vehicleId: otherCar,
          leadId: '',
        }),
      )
    ).ok,
  ).toBe(false);
});
it('refuses a competing customer without leaking the existing customer identity', async () => {
  const contact = randomUUID();
  await sql`INSERT INTO contacts (id,tenant_id,first_name) VALUES (${contact}::uuid,${T.tenant}::uuid,'Competing')`;
  const r = await withSession(session, (tx) =>
    applyDraftDeal(tx, session, { ...input, contactId: contact, leadId: '' }),
  );
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain(T.contact);
});

it('retains price history, rejects stale edits and freezes repricing after quotation', async () => {
  const [d] =
    await sql`SELECT id FROM deals WHERE vehicle_id=${car}::uuid ORDER BY created_at DESC LIMIT 1`;
  const id = String(d!['id']);
  const editor = await draftPriceEditor(session, id);
  expect(editor).not.toBeNull();
  const r = await withSession(session, (tx) =>
    applyDraftPrice(tx, session, {
      id,
      revision: editor!.revision,
      price: '12400.01',
    }),
  );
  expect(r.ok).toBe(true);
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftPrice(tx, session, {
          id,
          revision: editor!.revision,
          price: '12500',
        }),
      )
    ).ok,
  ).toBe(false);
  const detail = await loadDeal(session, id, false);
  expect(detail?.chain.valid).toBe(true);
  expect(detail?.deal.vehiclePrice?.amount).toBe(1240001n);
  await sql`UPDATE deals SET state='quoted' WHERE id=${id}::uuid`;
  expect(await draftPriceEditor(session, id)).toBeNull();
  expect(
    (
      await withSession(session, (tx) =>
        applyDraftPrice(tx, session, {
          id,
          revision: editor!.revision,
          price: '5',
        }),
      )
    ).ok,
  ).toBe(false);
});
