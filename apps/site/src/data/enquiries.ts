import { DEFAULT_SLA_MINUTES } from '../../../../packages/domain/src/leads.js';
import { withTenant } from './db.js';

export interface EnquiryInput {
  name: string;
  email: string;
  phone: string;
  message: string;
  vehicle: string;
}

export type EnquiryOutcome = { ok: true } | { ok: false; error: string };

export function validateEnquiry(input: EnquiryInput): EnquiryOutcome {
  if (!input.name.trim() || input.name.length > 120) {
    return { ok: false, error: 'Enter your name, using up to 120 characters.' };
  }
  if (input.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    return { ok: false, error: 'Enter a working email address so the dealer can reply.' };
  }
  if (input.phone.trim() && (!/^[+\d\s().-]+$/.test(input.phone) || input.phone.replace(/\D/g, '').length < 8 || input.phone.length > 40)) {
    return { ok: false, error: 'Enter a valid phone number, or leave it blank to hear back by email.' };
  }
  if (!input.message.trim() || input.message.length > 4000) {
    return { ok: false, error: 'Tell the dealer how they can help, using up to 4,000 characters.' };
  }
  if (input.vehicle && !/^[A-Z0-9]{2,8}$/.test(input.vehicle.replace(/\s/g, '').toUpperCase())) {
    return { ok: false, error: 'This vehicle reference is invalid. Open the car from the stock page and try again.' };
  }
  return { ok: true };
}

export async function submitEnquiry(tenantId: string, input: EnquiryInput): Promise<EnquiryOutcome> {
  const validation = validateEnquiry(input);
  if (!validation.ok) return validation;
  try {
    return await withTenant(tenantId, async (tx) => {
      const registration = input.vehicle.replace(/\s/g, '').toUpperCase();
      const [vehicle] = registration ? await tx<{ id: string; site_id: string }[]>`
        SELECT id, site_id FROM vehicles
         WHERE tenant_id = ${tenantId}::uuid AND registration = ${registration}
           AND state IN ('live', 'reserved') AND deleted_at IS NULL` : [];
      if (registration && !vehicle) {
        return { ok: false, error: 'This car is no longer available to enquire about. Browse the current stock or send a general enquiry.' };
      }
      const [site] = vehicle ? [] : await tx<{ id: string }[]>`
        SELECT id FROM sites WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at LIMIT 1`;
      const siteId = vehicle?.site_id ?? site?.id ?? null;
      // INSERT ... RETURNING requires SELECT privileges. Generate IDs here so
      // the public role remains unable to read contacts or the dealer's inbox.
      const [ids] = await tx<{ contact_id: string; lead_id: string }[]>`
        SELECT uuid_generate_v7() AS contact_id, uuid_generate_v7() AS lead_id`;
      if (!ids) throw new Error('Could not allocate enquiry references');
      const contactId = ids.contact_id;
      const leadId = ids.lead_id;
      const [firstName, ...lastName] = input.name.trim().split(/\s+/);
      await tx`
        INSERT INTO contacts (id, tenant_id, site_id, first_name, last_name, email, phone)
        VALUES (${contactId}::uuid, ${tenantId}::uuid, ${siteId}::uuid,
          ${firstName!}, ${lastName.join(' ') || null}, ${input.email.trim().toLowerCase()}, ${input.phone.trim() || null})`;
      await tx`
        INSERT INTO leads (id, tenant_id, site_id, contact_id, vehicle_id, source, message, due_at)
        VALUES (${leadId}::uuid, ${tenantId}::uuid, ${siteId}::uuid, ${contactId}::uuid,
          ${vehicle?.id ?? null}::uuid, 'website_enquiry', ${input.message.trim()},
          now() + ${DEFAULT_SLA_MINUTES.website_enquiry} * interval '1 minute')`;
      await tx`
        INSERT INTO lead_events (tenant_id, lead_id, kind, to_stage, detail)
        VALUES (${tenantId}::uuid, ${leadId}::uuid, 'created', 'new', 'Public website enquiry')`;
      await tx`
        INSERT INTO audit_events (tenant_id, site_id, actor_type, resource_type, resource_id, action, diff)
        VALUES (${tenantId}::uuid, ${siteId}::uuid, 'public', 'lead', ${leadId}::uuid, 'create',
          ${tx.json({ source: 'website_enquiry', contactId, vehicleId: vehicle?.id ?? null })})`;
      return { ok: true };
    });
  } catch {
    return { ok: false, error: 'Your enquiry could not be saved. Please try again or call the dealer using the number above.' };
  }
}
