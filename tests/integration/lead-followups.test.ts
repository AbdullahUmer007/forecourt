import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withSession } from '@/data/db';
import { applyCreateLead, applyFollowUp } from '@/data/lead-apply';
import { loadInbox, loadLead } from '@/data/leads';
import { ensureFixtures, session, T } from './fixtures';
const staff = { ...session, roleKey: 'sales_exec', permissions: ['lead.read', 'lead.create', 'lead.update', 'contact.create'] };
let id = '';
const create = { siteId: T.site, contactId: T.contact, firstName: '', lastName: '', email: '', phone: '', source: 'phone', message: 'Follow-up integration enquiry' };
const at = () => new Date(Date.now() + 86400000).toISOString();
const change = (version: number, operation = 'schedule') => ({ leadId: id, version: String(version), operation, at: at(), note: 'Call about a viewing' });
beforeAll(async () => {
  await ensureFixtures();
  const result = await withSession(staff, tx => applyCreateLead(tx, staff, create));
  expect(result.ok).toBe(true); id = result.leadId!;
});
describe('sales enquiry workflow with RLS', () => {
  it('creates a lead linked to an existing customer and records ownership and evidence', async () => {
    const lead = await loadLead(staff, id);
    expect(lead?.contactId).toBe(T.contact);
    expect(lead?.assignedTo).toBe(T.user);
    expect(lead?.events.some(e => e.kind === 'created')).toBe(true);
    const [audit] = await sql`SELECT count(*)::int AS n FROM audit_events WHERE resource_id = ${id}`;
    expect(audit?.['n']).toBe(1);
  });
  it('schedules once under concurrent requests and rejects a stale completion', async () => {
    const results = await Promise.all([1, 2].map(() => withSession(staff, tx => applyFollowUp(tx, staff, change(0)))));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect((await withSession(staff, tx => applyFollowUp(tx, staff, change(0, 'complete')))).ok).toBe(false);
    expect((await loadLead(staff, id))?.followUpVersion).toBe(1);
  });
  it('filters scheduled and due work and completes with an outcome without stopping the response clock', async () => {
    expect((await loadInbox(staff, { followUp: 'scheduled', q: 'Follow-up integration' })).rows.map(r => r.id)).toContain(id);
    expect((await loadInbox(staff, { followUp: 'due', q: 'Follow-up integration' })).rows.map(r => r.id)).not.toContain(id);
    await sql`UPDATE leads SET follow_up_at = now() - interval '1 minute' WHERE id = ${id}::uuid`;
    expect((await loadInbox(staff, { followUp: 'due', q: 'Follow-up integration' })).rows.map(r => r.id)).toContain(id);
    expect((await withSession(staff, tx => applyFollowUp(tx, staff, change(1, 'complete')))).ok).toBe(true);
    const lead = await loadLead(staff, id);
    expect(lead?.followUpAt).toBeNull(); expect(lead?.firstResponseAt).toBeNull();
    expect(lead?.events.some(e => e.detail?.includes('Follow-up completed'))).toBe(true);
  });
  it('rejects invalid dates, oversized notes and malformed identifiers', async () => {
    for (const patch of [{ at: 'invalid' }, { at: '2020-01-01T00:00:00Z' }, { at: '2030-01-01T12:00:00' }, { note: 'x'.repeat(2001) }, { leadId: 'invalid' }]) {
      expect((await withSession(staff, tx => applyFollowUp(tx, staff, { ...change(2), ...patch }))).ok).toBe(false);
    }
  });
  it('rejects unauthorised, cross-tenant and out-of-site follow-up writes', async () => {
    for (const other of [{ ...staff, permissions: ['lead.read'] }, { ...staff, tenantId: randomUUID() }, { ...staff, scope: 'my_sites' as const, siteIds: [randomUUID()] }]) {
      expect((await withSession(other, tx => applyFollowUp(tx, other, change(2)))).ok).toBe(false);
    }
  });
  it('does not schedule work on a closed lead', async () => {
    await sql`UPDATE leads SET stage = 'won', closed_at = now() WHERE id = ${id}::uuid`;
    expect((await withSession(staff, tx => applyFollowUp(tx, staff, change(2)))).ok).toBe(false);
  });
  it('handles malformed inbox filters and task cancellation safely', async () => {
    expect((await loadInbox(staff, { stage: 'bad', assigned: 'bad', source: 'bad', offset: Infinity, limit: NaN, receivedFrom: 'bad' })).total).toBe(0);
    expect(await loadLead(staff, 'not-a-uuid')).toBeNull();
    const created = await withSession(staff, tx => applyCreateLead(tx, staff, create));
    const task = { ...change(0), leadId: created.leadId! };
    expect((await withSession(staff, tx => applyFollowUp(tx, staff, task))).ok).toBe(true);
    expect((await withSession(staff, tx => applyFollowUp(tx, staff, { ...task, version: '1', operation: 'cancel', note: 'Customer requested no callback' }))).ok).toBe(true);
    expect((await loadLead(staff, created.leadId!))?.followUpAt).toBeNull();
  });
  it('validates create permission, customer scope and site scope', async () => {
    expect((await withSession({ ...staff, permissions: ['lead.read'] }, tx => applyCreateLead(tx, { ...staff, permissions: ['lead.read'] }, create))).ok).toBe(false);
    expect((await withSession(staff, tx => applyCreateLead(tx, staff, { ...create, contactId: randomUUID() }))).ok).toBe(false);
    const restricted = { ...staff, scope: 'my_sites' as const, siteIds: [randomUUID()] };
    expect((await withSession(restricted, tx => applyCreateLead(tx, restricted, create))).ok).toBe(false);
    expect((await withSession(staff, tx => applyCreateLead(tx, staff, { ...create, source: 'invalid' }))).ok).toBe(false);
  });
  it('creates a customer without adding consent and rejects duplicate contact details', async () => {
    const input = { ...create, contactId: '', firstName: 'Integration', email: `lead-${randomUUID()}@example.test` };
    const result = await withSession(staff, tx => applyCreateLead(tx, staff, input));
    expect(result.ok).toBe(true);
    const lead = await loadLead(staff, result.leadId!);
    const [count] = await sql`SELECT count(*)::int AS n FROM contact_consents WHERE contact_id = ${lead!.contactId}::uuid`;
    expect(count?.['n']).toBe(0);
    expect((await withSession(staff, tx => applyCreateLead(tx, staff, input))).ok).toBe(false);
  });
});
