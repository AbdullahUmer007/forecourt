import { authorize, holds } from '@forecourt/domain';
import { withSession, type Tx } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
export const validId = (id: string) =>
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export type CustomerOutcome = {
  ok: boolean;
  error?: string;
  id?: string;
  message?: string;
};
export interface CustomerInput {
  id: string;
  revision: string;
  siteId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  notes: string;
}
export interface Customer {
  id: string;
  siteId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  notes: string;
  revision: string;
}
const mapCustomer = (r: Record<string, unknown>): Customer => ({
  id: String(r['id']),
  siteId: String(r['site_id'] ?? ''),
  name:
    [r['first_name'], r['last_name']].filter(Boolean).join(' ') ||
    String(r['company_name'] || r['email'] || r['phone'] || 'Customer'),
  firstName: String(r['first_name'] ?? ''),
  lastName: String(r['last_name'] ?? ''),
  email: String(r['email'] ?? ''),
  phone: String(r['phone'] ?? ''),
  address: String(r['address_line1'] ?? ''),
  postcode: String(r['postcode'] ?? ''),
  notes: String(r['notes'] ?? ''),
  revision: String(r['revision']),
});
const fields = (tx: Tx) =>
  tx`id, site_id, first_name, last_name, company_name, email, phone, address_line1, postcode, notes, updated_at::text AS revision`;
export async function loadCustomers(session: Session, query = '', offset = 0) {
  if (!holds(session, 'contact.read'))
    return { rows: [] as Customer[], total: 0 };
  const q = query.trim().toLowerCase().slice(0, 200);
  const pageOffset = Number.isFinite(offset)
    ? Math.max(0, Math.floor(offset))
    : 0;
  return withSession(session, async (tx) => {
    const where = tx`erased_at IS NULL AND merged_into_id IS NULL AND strpos(lower(concat_ws(' ', first_name, last_name, company_name, email, phone, postcode)), ${q}) > 0`;
    const rows =
      await tx`SELECT ${fields(tx)} FROM contacts WHERE ${where} ORDER BY last_name NULLS LAST, first_name NULLS LAST, id LIMIT 40 OFFSET ${pageOffset}`;
    const [count] =
      await tx`SELECT count(*)::int AS n FROM contacts WHERE ${where}`;
    return { rows: rows.map(mapCustomer), total: Number(count?.['n'] ?? 0) };
  });
}
export async function loadCustomer(session: Session, id: string) {
  if (!validId(id) || !holds(session, 'contact.read')) return null;
  return withSession(session, async (tx) => {
    const [r] =
      await tx`SELECT ${fields(tx)} FROM contacts WHERE id = ${id}::uuid AND erased_at IS NULL AND merged_into_id IS NULL`;
    if (!r) return null;
    const leads = holds(session, 'lead.read')
      ? await tx`SELECT id, stage, message FROM leads WHERE contact_id = ${id}::uuid ORDER BY received_at DESC LIMIT 30`
      : [];
    const appointments = holds(session, 'lead.read')
      ? await tx`SELECT id, purpose, starts_at, status FROM appointments WHERE contact_id = ${id}::uuid ORDER BY starts_at DESC LIMIT 30`
      : [];
    return {
      ...mapCustomer(r),
      leads: leads.map((l) => ({
        id: String(l['id']),
        stage: String(l['stage']),
        message: String(l['message'] ?? ''),
      })),
      appointments: appointments.map((a) => ({
        id: String(a['id']),
        purpose: String(a['purpose']),
        startsAt: new Date(a['starts_at'] as string).toISOString(),
        status: String(a['status']),
      })),
    };
  });
}
export async function applyCustomer(
  tx: Tx,
  session: Session,
  input: CustomerInput,
): Promise<CustomerOutcome> {
  const decision = authorize(
    session,
    input.id ? 'contact.update' : 'contact.create',
  );
  if (!decision.allowed) return { ok: false, error: decision.reason };
  const text = Object.fromEntries(
    (
      [
        'id',
        'revision',
        'siteId',
        'firstName',
        'lastName',
        'email',
        'phone',
        'address',
        'postcode',
        'notes',
      ] as const
    ).map((k) => [k, input[k].trim()]),
  ) as unknown as CustomerInput;
  for (const [key, limit] of Object.entries({
    firstName: 100,
    lastName: 100,
    email: 254,
    phone: 40,
    address: 200,
    postcode: 12,
    notes: 2000,
  })) {
    if (text[key as keyof CustomerInput].length > limit)
      return { ok: false, error: `Keep ${key} to ${limit} characters.` };
  }
  if (!text.firstName && !text.lastName && !text.email && !text.phone)
    return { ok: false, error: 'Add a name, email or phone number.' };
  if (text.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.email))
    return { ok: false, error: 'Enter a valid email address.' };
  if (text.id && !validId(text.id))
    return { ok: false, error: 'That customer is unavailable.' };
  const [before] = text.id
    ? await tx`SELECT *, updated_at::text AS revision FROM contacts WHERE id = ${text.id}::uuid FOR UPDATE`
    : [];
  if (text.id && (!before || before['erased_at'] || before['merged_into_id']))
    return { ok: false, error: 'That customer is unavailable.' };
  if (before && before['revision'] !== text.revision)
    return {
      ok: false,
      error:
        'This customer was updated elsewhere. Refresh and review their details before saving.',
    };
  if (!before) {
    if (
      !validId(text.siteId) ||
      (session.scope !== 'all_sites' && !session.siteIds.includes(text.siteId))
    )
      return { ok: false, error: 'Choose an accessible dealership site.' };
    const [site] =
      await tx`SELECT id FROM sites WHERE id = ${text.siteId}::uuid`;
    if (!site) return { ok: false, error: 'That site is unavailable.' };
  }
  const emailChanged = before && String(before['email'] ?? '') !== text.email;
  const phoneChanged = before && String(before['phone'] ?? '') !== text.phone;
  if (emailChanged || phoneChanged) {
    const [history] =
      await tx`SELECT id FROM contact_consents WHERE contact_id = ${text.id}::uuid AND
    ((${Boolean(emailChanged)} AND channel = 'email') OR (${Boolean(phoneChanged)} AND channel IN ('phone','sms','whatsapp'))) LIMIT 1`;
    if (history)
      return {
        ok: false,
        error:
          'These contact details have communication-permission history. Keep the existing email/phone while updating this profile; a verified contact-change workflow is required for those details.',
      };
  }
  const [duplicate] =
    await tx`SELECT id FROM contacts WHERE erased_at IS NULL AND merged_into_id IS NULL
  AND id::text <> ${text.id} AND ((${text.email} <> '' AND lower(email) = lower(${text.email})) OR (${text.phone} <> '' AND phone = ${text.phone})) LIMIT 1`;
  if (duplicate && (!before || emailChanged || phoneChanged))
    return {
      ok: false,
      error:
        'These contact details already belong to a customer. Search the directory to use their existing record.',
    };
  const values = {
    first_name: text.firstName || null,
    last_name: text.lastName || null,
    email: text.email || null,
    phone: text.phone || null,
    address_line1: text.address || null,
    postcode: text.postcode || null,
    notes: text.notes || null,
  };
  let id = text.id;
  if (before)
    await tx`UPDATE contacts SET ${tx(values)}, updated_at = now(), updated_by = ${session.userId}::uuid WHERE id = ${id}::uuid`;
  else {
    const [created] =
      await tx`INSERT INTO contacts ${tx({ ...values, tenant_id: session.tenantId, site_id: text.siteId, created_by: session.userId, updated_by: session.userId })} RETURNING id`;
    id = String(created?.['id']);
  }
  const oldValues = before
    ? Object.fromEntries(Object.keys(values).map((k) => [k, before[k]]))
    : null;
  await writeAudit({
    tx,
    session,
    resourceType: 'contact',
    resourceId: id,
    action: before ? 'profile_updated' : 'created',
    before: oldValues,
    after: values,
    siteId: before ? (before['site_id'] as string | null) : text.siteId,
  });
  return {
    ok: true,
    id,
    message: before ? 'Customer details saved.' : 'Customer created.',
  };
}
