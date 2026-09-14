import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withSession } from '@/data/db';
import { ensureFixtures, T, session } from './fixtures';
import { invoiceDraftReview, applyDealInvoice } from '@/data/deal-invoice';
import { applyCreateDraft } from '@/data/invoice-apply';
import { loadInvoice } from '@/data/invoices';
const customer = randomUUID(),
  car = randomUUID(),
  deal = randomUUID();
beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO contacts (id,tenant_id,first_name,last_name,address_line1,postcode) VALUES (${customer}::uuid,${T.tenant}::uuid,'Invoice','Draft test','1 Test Street','MK1 1AA')`;
  await sql`INSERT INTO vehicles (id,tenant_id,site_id,registration,stock_number,stock_sequence,make,model,state,vat_scheme,retail_price_pence) VALUES (${car}::uuid,${T.tenant}::uuid,${T.site}::uuid,${car.slice(0, 8)},${car},${parseInt(car.slice(0, 7), 16)},'Ford','Invoice','ready','qualifying',1234567)`;
  await sql`INSERT INTO deals (id,tenant_id,site_id,contact_id,vehicle_id,state,vehicle_price_pence,created_by) VALUES (${deal}::uuid,${T.tenant}::uuid,${T.site}::uuid,${customer}::uuid,${car}::uuid,'agreed',1234567,${T.user}::uuid)`;
});
afterAll(async () => {
  await sql`UPDATE vehicles SET state='archived' WHERE id=${car}::uuid`;
  await sql.end();
});
it('requires permissions and isolates tenant and branch previews', async () => {
  expect(
    await invoiceDraftReview({ ...session, permissions: ['deal.read'] }, deal),
  ).toBeNull();
  expect(
    await invoiceDraftReview({ ...session, tenantId: randomUUID() }, deal),
  ).toBeNull();
  expect(
    await invoiceDraftReview(
      { ...session, scope: 'my_sites', siteIds: [randomUUID()] },
      deal,
    ),
  ).toBeNull();
  expect(
    (
      await withSession({ ...session, permissions: ['deal.read'] }, (tx) =>
        applyDealInvoice(
          tx,
          { ...session, permissions: ['deal.read'] },
          deal,
          '',
        ),
      )
    ).ok,
  ).toBe(false);
});
it('requires address and handles complex settlement as an explicit unsupported state', async () => {
  await sql`UPDATE contacts SET address_line1=NULL WHERE id=${customer}::uuid`;
  expect((await invoiceDraftReview(session, deal))?.problem).toContain(
    'street address',
  );
  expect(
    (
      await withSession(session, (tx) =>
        applyDealInvoice(tx, session, deal, ''),
      )
    ).ok,
  ).toBe(false);
  await sql`UPDATE contacts SET address_line1='1 Test Street' WHERE id=${customer}::uuid`;
  await sql`UPDATE deals SET finance_amount_pence=100 WHERE id=${deal}::uuid`;
  expect((await invoiceDraftReview(session, deal))?.problem).toContain(
    'settlement workflow',
  );
  await sql`UPDATE deals SET finance_amount_pence=0 WHERE id=${deal}::uuid`;
});
it('rejects forged associations and VAT scheme at the underlying draft entry point', async () => {
  const input = {
    dealId: deal,
    vehicleId: car,
    contactId: customer,
    buyerName: 'Test',
    buyerAddress: 'Address',
    vatScheme: 'qualifying',
    lines: [{ description: 'Car', unitPricePence: '100' }],
  };
  expect(
    (
      await withSession(session, (tx) =>
        applyCreateDraft(tx, session, { ...input, contactId: T.contact }),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await withSession(session, (tx) =>
        applyCreateDraft(tx, session, { ...input, vatScheme: 'margin' }),
      )
    ).ok,
  ).toBe(false);
});
it('rejects a stale review then creates only one unnumbered invoice concurrently', async () => {
  const before = await invoiceDraftReview(session, deal);
  expect(before?.problem).toBeNull();
  await sql`UPDATE contacts SET updated_at=clock_timestamp(),address_line1='2 Test Street' WHERE id=${customer}::uuid`;
  expect(
    (
      await withSession(session, (tx) =>
        applyDealInvoice(tx, session, deal, before!.revision),
      )
    ).ok,
  ).toBe(false);
  const review = await invoiceDraftReview(session, deal);
  const results = await Promise.all(
    [1, 2].map(() =>
      withSession(session, (tx) =>
        applyDealInvoice(tx, session, deal, review!.revision),
      ),
    ),
  );
  expect(results.every((r) => r.ok)).toBe(true);
  expect(results[0]!.invoiceId).toBe(results[1]!.invoiceId);
  const id = results[0]!.invoiceId!;
  const [invoice] =
    await sql`SELECT status,number,gross_total_pence,buyer_address FROM invoices WHERE id=${id}::uuid`;
  expect(invoice!['status']).toBe('draft');
  expect(invoice!['number']).toBeNull();
  expect(String(invoice!['gross_total_pence'])).toBe('1234567');
  expect(invoice!['buyer_address']).toContain('2 Test Street');
  expect(
    await sql`SELECT id FROM audit_events WHERE resource_id=${id}::uuid`,
  ).toHaveLength(1);
  expect(await loadInvoice(session, id, false)).not.toBeNull();
  expect((await invoiceDraftReview(session, deal))?.invoiceId).toBe(id);
});
