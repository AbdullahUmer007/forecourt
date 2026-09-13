import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql, withSession } from '@/data/db';
import { loadInbox } from '@/data/leads';
import { ensureFixtures, session, T } from './fixtures';
import { submitEnquiry, validateEnquiry, type EnquiryInput } from '../../apps/site/src/data/enquiries';
import { sql as publicSql, withTenant } from '../../apps/site/src/data/db';

const marker = randomUUID();
const vehicleId = randomUUID();
const rival = randomUUID();
const rivalCar = randomUUID();
const rivalSite = randomUUID();
const registration = `EQ${marker.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
const input: EnquiryInput = { name: 'Local Test Buyer', email: `${marker}@example.test`, phone: '', message: marker, vehicle: registration };

beforeAll(async () => {
  await ensureFixtures();
  await sql`INSERT INTO tenants (id, name, legal_name) VALUES (${rival}::uuid, 'Enquiry rival', 'Enquiry rival Ltd')`;
  await sql`INSERT INTO sites (id, tenant_id, name) VALUES (${rivalSite}::uuid, ${rival}::uuid, 'Rival branch')`;
  await sql`INSERT INTO vehicles (id, tenant_id, site_id, registration, stock_number, stock_sequence, make, model, state)
    VALUES (${vehicleId}::uuid, ${T.tenant}::uuid, ${T.site}::uuid, ${registration}, ${marker}, ${parseInt(marker.slice(0, 7), 16) + 1000}, 'Ford', 'Focus', 'live')`;
  await sql`INSERT INTO vehicles (id, tenant_id, site_id, registration, stock_number, stock_sequence, state)
    VALUES (${rivalCar}::uuid, ${rival}::uuid, ${rivalSite}::uuid, 'ZZ99RIV', ${marker}, 1, 'live')`;
});
afterAll(async () => { await publicSql.end(); await sql.end(); });

describe('public enquiry to CRM', () => {
  it('creates a vehicle-linked inbox record, contact, timeline and audit together', async () => {
    expect(await submitEnquiry(T.tenant, input)).toEqual({ ok: true });
    const inbox = await loadInbox(session, { q: marker });
    expect(inbox.rows).toHaveLength(1);
    const lead = inbox.rows[0]!;
    expect(lead.vehicleRegistration).toBe(registration);
    expect(lead.contactEmail).toBe(input.email);
    expect(lead.contactName).toBe('Local Test Buyer');
    expect(lead.source).toBe('website_enquiry');
    const [row] = await withSession(session, tx => tx`
      SELECT l.site_id, extract(epoch FROM (l.due_at-l.received_at))/60 AS minutes,
        (SELECT count(*)::int FROM lead_events e WHERE e.lead_id=l.id AND kind='created') AS events,
        (SELECT count(*)::int FROM audit_events a WHERE a.resource_id=l.id AND action='create') AS audits,
        (SELECT count(*)::int FROM contact_consents c WHERE c.contact_id=l.contact_id) AS consents
      FROM leads l WHERE id=${lead.id}::uuid`);
    expect(row?.['site_id']).toBe(T.site);
    expect(Number(row?.['minutes'])).toBe(30);
    expect(row?.['events']).toBe(1);
    expect(row?.['audits']).toBe(1);
    expect(row?.['consents']).toBe(0);
  });

  it('accepts a general enquiry without attaching a car', async () => {
    expect(await submitEnquiry(T.tenant, { ...input, vehicle: '', message: `${marker}-general` })).toEqual({ ok: true });
    const inbox = await loadInbox(session, { q: `${marker}-general` });
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.rows[0]?.vehicleRegistration).toBeNull();
  });

  it('refuses another dealer’s vehicle and unpublished or deleted stock without inserting contacts', async () => {
    const count = async () => (await sql`SELECT count(*)::int AS n FROM contacts WHERE tenant_id=${T.tenant}::uuid AND email=${input.email}`)[0]!['n'];
    const before = await count();
    expect((await submitEnquiry(T.tenant, { ...input, vehicle: 'ZZ99RIV' })).ok).toBe(false);
    await sql`UPDATE vehicles SET state='in_prep' WHERE id=${vehicleId}::uuid`;
    expect((await submitEnquiry(T.tenant, input)).ok).toBe(false);
    await sql`UPDATE vehicles SET state='live', deleted_at=now() WHERE id=${vehicleId}::uuid`;
    expect((await submitEnquiry(T.tenant, input)).ok).toBe(false);
    expect(await count()).toBe(before);
  });

  it('keeps public access insert-only and rejects cross-tenant audit writes', async () => {
    for (const table of ['contacts', 'leads', 'lead_events', 'audit_events']) {
      await expect(withTenant(T.tenant, tx => tx.unsafe(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
    await expect(withTenant(T.tenant, tx => tx`
      INSERT INTO audit_events (tenant_id, actor_type, resource_type, action)
      VALUES (${rival}::uuid, 'public', 'lead', 'create')`)).rejects.toThrow(/row-level security/);
  });

  it('validates names, contact details, message and reference lengths', () => {
    for (const change of [{ name: '' }, { name: 'x'.repeat(121) }, { email: 'invalid' }, { phone: '123' },
      { message: ' ' }, { message: 'x'.repeat(4001) }, { vehicle: '<script>' }]) {
      expect(validateEnquiry({ ...input, ...change }).ok).toBe(false);
    }
    expect(validateEnquiry({ ...input, vehicle: '', phone: '+44 7700 900000' }).ok).toBe(true);
  });
});
