import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withSession } from '@/data/db';
import {
  applyCustomer,
  loadCustomer,
  loadCustomers,
  type CustomerInput,
} from '@/data/customers';
import {
  applyAppointment,
  loadAppointment,
  loadAppointments,
  type AppointmentInput,
} from '@/data/appointments';
import { ensureFixtures, session, T } from './fixtures';
const staff = {
  ...session,
  roleKey: 'sales_exec',
  permissions: [
    'contact.read',
    'contact.create',
    'contact.update',
    'lead.read',
    'lead.update',
  ],
};
const customerInput = (): CustomerInput => ({
  id: '',
  revision: '',
  siteId: T.site,
  firstName: 'Booking',
  lastName: 'Integration',
  email: `booking-${randomUUID()}@example.test`,
  phone: '',
  address: '',
  postcode: '',
  notes: '',
});
let customer = '',
  booking = '',
  customer2 = '';
const at = new Date(Date.now() + 10 * 86400000).toISOString();
const input = (): AppointmentInput => ({
  id: '',
  version: '0',
  contactId: customer,
  leadId: '',
  siteId: T.site,
  assignedTo: T.user,
  startsAt: at,
  duration: '60',
  purpose: 'viewing',
  notes: 'Prepare the vehicle',
  operation: 'save',
  outcome: '',
});
const apply = (patch: Partial<AppointmentInput> = {}) =>
  withSession(staff, (tx) =>
    applyAppointment(tx, staff, { ...input(), ...patch }),
  );
beforeAll(async () => {
  await ensureFixtures();
  for (const key of ['first', 'second']) {
    const result = await withSession(staff, (tx) =>
      applyCustomer(tx, staff, customerInput()),
    );
    expect(result.ok).toBe(true);
    if (key === 'first') customer = result.id!;
    else customer2 = result.id!;
  }
});
describe('customer directory and appointments with RLS', () => {
  it('finds and updates customers, writes evidence and rejects stale edits', async () => {
    const c = (await loadCustomer(staff, customer))!;
    expect(
      (await loadCustomers(staff, c.email)).rows.map((x) => x.id),
    ).toContain(customer);
    const change = { ...customerInput(), ...c, notes: 'Updated profile' };
    expect(
      (await withSession(staff, (tx) => applyCustomer(tx, staff, change))).ok,
    ).toBe(true);
    expect(
      (await withSession(staff, (tx) => applyCustomer(tx, staff, change))).ok,
    ).toBe(false);
    expect((await loadCustomer(staff, customer))?.notes).toBe(
      'Updated profile',
    );
    const [audit] =
      await sql`SELECT count(*)::int AS n FROM audit_events WHERE resource_id = ${customer}`;
    expect(audit?.['n']).toBe(2);
  });
  it('rejects duplicate destinations, invalid fields and unauthorized creation', async () => {
    const c = (await loadCustomer(staff, customer))!;
    expect(
      (
        await withSession(staff, (tx) =>
          applyCustomer(tx, staff, { ...customerInput(), email: c.email }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await withSession(staff, (tx) =>
          applyCustomer(tx, staff, { ...customerInput(), email: 'invalid' }),
        )
      ).ok,
    ).toBe(false);
    const reader = { ...staff, permissions: ['contact.read'] };
    expect(
      (
        await withSession(reader, (tx) =>
          applyCustomer(tx, reader, customerInput()),
        )
      ).ok,
    ).toBe(false);
  });
  it('protects permission history and excludes erased profiles', async () => {
    const c = (await loadCustomer(staff, customer2))!;
    await sql`INSERT INTO contact_consents (tenant_id,contact_id,channel,basis,granted,source) VALUES (${T.tenant}::uuid,${customer2}::uuid,'email','explicit',false,'website_form')`;
    const result = await withSession(staff, (tx) =>
      applyCustomer(tx, staff, {
        ...customerInput(),
        ...c,
        email: 'changed@example.test',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('permission history');
    expect(
      (
        await withSession(staff, (tx) =>
          applyCustomer(tx, staff, {
            ...customerInput(),
            ...c,
            notes: 'Other details remain editable',
          }),
        )
      ).ok,
    ).toBe(true);
    const erased = await withSession(staff, (tx) =>
      applyCustomer(tx, staff, customerInput()),
    );
    await sql`UPDATE contacts SET erased_at=now() WHERE id=${erased.id!}::uuid`;
    expect(await loadCustomer(staff, erased.id!)).toBeNull();
  });
  it('books only once under simultaneous requests and exposes the visit on the profile and diary', async () => {
    const results = await Promise.all([apply(), apply()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    booking = results.find((r) => r.ok)!.id!;
    expect(
      (await loadCustomer(staff, customer))?.appointments.map((a) => a.id),
    ).toContain(booking);
    const date = new Date(at).toLocaleDateString('en-CA', {
      timeZone: 'Europe/London',
    });
    expect(
      (await loadAppointments(staff, date, true)).rows.map((a) => a.id),
    ).toContain(booking);
  });
  it('rejects staff conflicts, malformed input and unavailable customers', async () => {
    for (const patch of [
      { contactId: customer2 },
      { startsAt: 'bad' },
      { startsAt: '2020-01-01T12:00:00Z' },
      { duration: '999' },
      { contactId: randomUUID() },
      { assignedTo: randomUUID() },
      { leadId: randomUUID() },
    ])
      expect((await apply(patch)).ok).toBe(false);
  });
  it('allows adjacent bookings, rejects stale edits and keeps closed appointment evidence', async () => {
    const adjacent = await apply({
      contactId: customer2,
      startsAt: new Date(Date.parse(at) + 3600000).toISOString(),
    });
    expect(adjacent.ok).toBe(true);
    expect((await apply({ id: booking, version: '9' })).ok).toBe(false);
    expect(
      (await apply({ id: booking, operation: 'completed', outcome: 'Visited' }))
        .ok,
    ).toBe(false);
    expect(
      (
        await apply({
          id: booking,
          operation: 'cancelled',
          outcome: 'Customer changed plans',
        })
      ).ok,
    ).toBe(true);
    expect((await apply({ id: booking, version: '1' })).ok).toBe(false);
    expect((await loadAppointment(staff, booking))?.outcome).toBe(
      'Customer changed plans',
    );
    await apply({
      id: adjacent.id!,
      operation: 'cancelled',
      outcome: 'Test complete',
    });
  });
  it('isolates reads and writes by tenant, site and permission', async () => {
    for (const other of [
      { ...staff, tenantId: randomUUID() },
      { ...staff, scope: 'my_sites' as const, siteIds: [randomUUID()] },
      { ...staff, permissions: [] },
    ]) {
      expect(await loadCustomer(other, customer)).toBeNull();
      expect(await loadAppointment(other, booking)).toBeNull();
      expect(
        (await withSession(other, (tx) => applyAppointment(tx, other, input())))
          .ok,
      ).toBe(false);
    }
    expect(await loadCustomer(staff, 'bad')).toBeNull();
    expect(await loadAppointment(staff, 'bad')).toBeNull();
  });
  it('database constraints reject hidden-site staff conflicts without leaking details', async () => {
    const site = randomUUID(),
      hiddenCustomer = randomUUID();
    await sql`INSERT INTO sites (id,tenant_id,name) VALUES (${site}::uuid,${T.tenant}::uuid,${'Hidden booking branch ' + site})`;
    await sql`INSERT INTO contacts (id,tenant_id,site_id,first_name) VALUES (${hiddenCustomer}::uuid,${T.tenant}::uuid,${site}::uuid,'Hidden customer')`;
    const [hidden] =
      await sql`INSERT INTO appointments (tenant_id,site_id,contact_id,assigned_to,starts_at,ends_at,purpose)
   VALUES (${T.tenant}::uuid,${site}::uuid,${hiddenCustomer}::uuid,${T.user}::uuid,${at}::timestamptz,${at}::timestamptz+interval '1 hour','meeting') RETURNING id`;
    const local = { ...staff, scope: 'my_sites' as const, siteIds: [T.site] };
    await expect(
      withSession(local, (tx) => applyAppointment(tx, local, input())),
    ).rejects.toMatchObject({ code: '23P01' });
    await sql`UPDATE appointments SET status='cancelled',outcome='Test complete' WHERE id=${hidden!['id']}::uuid`;
  });
  it('completes a started visit with retained outcome and audit', async () => {
    const r = await apply();
    expect(r.ok).toBe(true);
    await sql`UPDATE appointments SET starts_at=now()-interval '1 hour',ends_at=now()-interval '1 minute' WHERE id=${r.id!}::uuid`;
    expect(
      (
        await apply({
          id: r.id!,
          operation: 'completed',
          outcome: 'Viewed car; follow up tomorrow',
        })
      ).ok,
    ).toBe(true);
    expect((await loadAppointment(staff, r.id!))?.status).toBe('completed');
  });
});
