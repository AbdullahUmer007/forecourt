import { authorize, holds } from '@forecourt/domain';
import { withSession, type Tx } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import { validId, type CustomerOutcome } from './customers';
export interface AppointmentInput {
  id: string;
  version: string;
  contactId: string;
  leadId: string;
  siteId: string;
  assignedTo: string;
  startsAt: string;
  duration: string;
  purpose: string;
  notes: string;
  operation: string;
  outcome: string;
}
export interface Appointment {
  id: string;
  contactId: string;
  leadId: string;
  siteId: string;
  assignedTo: string;
  startsAt: string;
  endsAt: string;
  purpose: string;
  status: string;
  notes: string;
  outcome: string;
  version: number;
  customer: string;
  staff: string;
  site: string;
}
export const ukDate = (date = new Date()) =>
  date.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const appointmentStamp = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const fields = (tx: Tx) =>
  tx`a.*, concat_ws(' ', c.first_name, c.last_name) AS customer_name, c.company_name, c.email, c.phone, u.name AS staff_name, s.name AS site_name`;
const joins = (tx: Tx) =>
  tx`FROM appointments a JOIN contacts c ON c.id = a.contact_id JOIN users u ON u.id = a.assigned_to JOIN sites s ON s.id = a.site_id`;
const map = (r: Record<string, unknown>): Appointment => ({
  id: String(r['id']),
  contactId: String(r['contact_id']),
  leadId: String(r['lead_id'] ?? ''),
  siteId: String(r['site_id']),
  assignedTo: String(r['assigned_to']),
  startsAt: new Date(r['starts_at'] as string).toISOString(),
  endsAt: new Date(r['ends_at'] as string).toISOString(),
  purpose: String(r['purpose']),
  status: String(r['status']),
  notes: String(r['notes']),
  outcome: String(r['outcome'] ?? ''),
  version: Number(r['version']),
  customer: String(
    r['customer_name'] ||
      r['company_name'] ||
      r['email'] ||
      r['phone'] ||
      'Customer',
  ),
  staff: String(r['staff_name']),
  site: String(r['site_name']),
});
export async function loadAppointments(
  session: Session,
  day: string,
  mine = false,
) {
  const parsed = new Date(day + 'T00:00:00Z');
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day
      ? day
      : ukDate();
  if (!holds(session, 'lead.read')) return { date, rows: [] as Appointment[] };
  return withSession(session, async (tx) => ({
    date,
    rows: (
      await tx`SELECT ${fields(tx)} ${joins(tx)}
  WHERE a.starts_at >= (${date}::date::timestamp AT TIME ZONE 'Europe/London') AND a.starts_at < ((${date}::date + 1)::timestamp AT TIME ZONE 'Europe/London')
  ${mine ? tx`AND a.assigned_to = ${session.userId}::uuid` : tx``} ORDER BY a.starts_at, a.id`
    ).map(map),
  }));
}
export async function loadAppointment(session: Session, id: string) {
  if (!validId(id) || !holds(session, 'lead.read')) return null;
  return withSession(session, async (tx) => {
    const [row] =
      await tx`SELECT ${fields(tx)} ${joins(tx)} WHERE a.id = ${id}::uuid`;
    return row ? map(row) : null;
  });
}
export async function appointmentOptions(session: Session) {
  return withSession(session, async (tx) => {
    const sites = await tx`SELECT id, name FROM sites ORDER BY name`;
    const people =
      await tx`SELECT u.id, u.name FROM users u JOIN tenant_memberships m ON m.user_id = u.id WHERE m.status = 'active' ORDER BY u.name`;
    return {
      sites: sites
        .filter(
          (s) =>
            session.scope === 'all_sites' ||
            session.siteIds.includes(String(s['id'])),
        )
        .map((s) => ({ id: String(s['id']), name: String(s['name']) })),
      people: people.map((p) => ({
        id: String(p['id']),
        name: String(p['name']),
      })),
    };
  });
}
export async function applyAppointment(
  tx: Tx,
  session: Session,
  input: AppointmentInput,
): Promise<CustomerOutcome> {
  const allowed = authorize(session, 'lead.update');
  if (!allowed.allowed) return { ok: false, error: allowed.reason };
  if (!['save', 'completed', 'cancelled', 'no_show'].includes(input.operation))
    return { ok: false, error: 'Choose a valid appointment action.' };
  if (input.id && !validId(input.id))
    return { ok: false, error: 'That appointment is unavailable.' };
  const [before] = input.id
    ? await tx`SELECT * FROM appointments WHERE id = ${input.id}::uuid FOR UPDATE`
    : [];
  if (input.id && !before)
    return { ok: false, error: 'That appointment is unavailable.' };
  if (
    before &&
    (!/^\d+$/.test(input.version) ||
      Number(before['version']) !== Number(input.version))
  )
    return {
      ok: false,
      error:
        'This appointment changed elsewhere. Refresh and review it before saving.',
    };
  if (before && before['status'] !== 'scheduled')
    return {
      ok: false,
      error:
        'This appointment is already closed. Book a new appointment if needed.',
    };
  if (
    before &&
    !authorize(session, 'lead.update', {
      ownerId: String(before['assigned_to']),
    }).allowed
  )
    return { ok: false, error: 'You can only change your own appointments.' };
  if (input.operation !== 'save') {
    const outcome = input.outcome.trim();
    if (!before || !outcome || outcome.length > 2000)
      return {
        ok: false,
        error:
          'Record an outcome or cancellation reason of up to 2,000 characters.',
      };
    if (
      input.operation !== 'cancelled' &&
      new Date(before['starts_at'] as string).getTime() > Date.now()
    )
      return {
        ok: false,
        error:
          'The appointment has not started yet. Reschedule or cancel it instead.',
      };
    await tx`UPDATE appointments SET status = ${input.operation}, outcome = ${outcome}, version = version + 1, updated_at = now(), updated_by = ${session.userId}::uuid WHERE id = ${input.id}::uuid`;
    await writeAudit({
      tx,
      session,
      resourceType: 'appointment',
      resourceId: input.id,
      action: input.operation,
      before: { status: 'scheduled' },
      after: { status: input.operation, outcome },
      siteId: String(before['site_id']),
    });
    return { ok: true, id: input.id, message: 'Appointment outcome saved.' };
  }
  if (session.scope === 'own_records' && input.assignedTo !== session.userId)
    return { ok: false, error: 'You can only book your own appointments.' };
  if (
    ![input.contactId, input.siteId, input.assignedTo].every(validId) ||
    (input.leadId && !validId(input.leadId))
  )
    return { ok: false, error: 'Choose a customer, site and staff member.' };
  if (
    before &&
    (before['contact_id'] !== input.contactId ||
      String(before['lead_id'] ?? '') !== input.leadId)
  )
    return {
      ok: false,
      error: 'An appointment must keep its original customer and enquiry.',
    };
  const start = new Date(input.startsAt),
    minutes = Number(input.duration);
  if (
    !/(Z|[+-]\d{2}:\d{2})$/.test(input.startsAt) ||
    !Number.isFinite(start.getTime()) ||
    start.getTime() <= Date.now() ||
    ![15, 30, 45, 60, 90, 120].includes(minutes)
  )
    return {
      ok: false,
      error:
        'Choose a future time and a duration between 15 minutes and two hours.',
    };
  if (
    !['viewing', 'test_drive', 'collection', 'meeting'].includes(
      input.purpose,
    ) ||
    input.notes.length > 2000
  )
    return {
      ok: false,
      error: 'Choose an appointment type and keep notes to 2,000 characters.',
    };
  if (session.scope !== 'all_sites' && !session.siteIds.includes(input.siteId))
    return { ok: false, error: 'Choose a site you have access to.' };
  // Serialize bookings for a customer and staff member before checking conflicts.
  const [contact] =
    await tx`SELECT id FROM contacts WHERE id = ${input.contactId}::uuid AND erased_at IS NULL AND merged_into_id IS NULL FOR UPDATE`;
  if (!contact) return { ok: false, error: 'That customer is unavailable.' };
  const [site] =
    await tx`SELECT id FROM sites WHERE id = ${input.siteId}::uuid`;
  if (!site) return { ok: false, error: 'That site is unavailable.' };
  const [member] =
    await tx`SELECT m.id FROM tenant_memberships m JOIN roles r ON r.id = m.role_id WHERE m.user_id = ${input.assignedTo}::uuid AND m.status = 'active'
  AND (m.scope_all_sites OR r.scope_all_sites OR EXISTS (SELECT 1 FROM user_sites us WHERE us.membership_id = m.id AND us.site_id = ${input.siteId}::uuid)) FOR UPDATE OF m`;
  if (!member)
    return {
      ok: false,
      error: 'Choose an active staff member with access to this site.',
    };
  if (input.leadId) {
    const [lead] =
      await tx`SELECT id FROM leads WHERE id = ${input.leadId}::uuid AND contact_id = ${input.contactId}::uuid AND (site_id IS NULL OR site_id = ${input.siteId}::uuid) AND closed_at IS NULL`;
    if (!lead)
      return {
        ok: false,
        error: 'Choose an open enquiry for this customer and site.',
      };
  }
  const end = new Date(start.getTime() + minutes * 60000);
  const [conflict] =
    await tx`SELECT id FROM appointments WHERE status = 'scheduled' AND id::text <> ${input.id}
  AND (assigned_to = ${input.assignedTo}::uuid OR contact_id = ${input.contactId}::uuid) AND starts_at < ${end} AND ends_at > ${start} LIMIT 1`;
  if (conflict)
    return {
      ok: false,
      error:
        'This staff member or customer already has an appointment at that time. Choose another slot.',
    };
  const values = {
    tenant_id: session.tenantId,
    site_id: input.siteId,
    contact_id: input.contactId,
    lead_id: input.leadId || null,
    assigned_to: input.assignedTo,
    starts_at: start,
    ends_at: end,
    purpose: input.purpose,
    notes: input.notes.trim(),
  };
  let id = input.id;
  if (before)
    await tx`UPDATE appointments SET ${tx(values)}, version = version + 1, updated_at = now(), updated_by = ${session.userId}::uuid WHERE id = ${id}::uuid`;
  else {
    const [row] =
      await tx`INSERT INTO appointments ${tx({ ...values, created_by: session.userId, updated_by: session.userId })} RETURNING id`;
    id = String(row?.['id']);
  }
  await writeAudit({
    tx,
    session,
    resourceType: 'appointment',
    resourceId: id,
    action: before ? 'rescheduled' : 'booked',
    before: before
      ? Object.fromEntries(Object.keys(values).map((k) => [k, before[k]]))
      : null,
    after: values,
    siteId: input.siteId,
  });
  return {
    ok: true,
    id,
    message: before ? 'Appointment updated.' : 'Appointment booked.',
  };
}
