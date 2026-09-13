import { withTenant } from './db.js';

export type PxOutcome = { ok: true } | { ok: false; error: string };

const REG = /^[A-Z0-9]{5,8}$/;

/**
 * A public part-exchange is a lead plus a draft appraisal. We do not invent
 * a figure on this path.
 */
export async function submitPartExchange(
  tenantId: string,
  input: { registration: string; mileage: string; name: string; phone: string; email: string },
): Promise<PxOutcome> {
  const registration = input.registration.replace(/\s+/g, '').toUpperCase();
  if (!REG.test(registration)) {
    return { ok: false, error: 'Enter the registration as it appears on the plate.' };
  }
  const mileageText = input.mileage.replace(/,/g, '').trim();
  const mileage = Number(mileageText);
  if (!/^\d+$/.test(mileageText) || !Number.isInteger(mileage) || mileage < 0 || mileage > 500_000) {
    return { ok: false, error: 'Enter the mileage as a whole number of miles.' };
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a working email address so we can write if we cannot reach you.' };
  }
  const phone = input.phone.trim();
  if (phone.length < 8) {
    return { ok: false, error: 'Enter a phone number we can ring.' };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Tell us who to ask for.' };
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(' ') || null;

  try {
    await withTenant(tenantId, async (tx) => {
      const [site] = await tx<{ id: string }[]>`
        SELECT id FROM sites ORDER BY created_at LIMIT 1`;
      const siteId = site?.id ?? null;
      const givenName = firstName ?? name;

      const [ids] = await tx<{ contact_id: string; lead_id: string }[]>`
        SELECT uuid_generate_v7() AS contact_id, uuid_generate_v7() AS lead_id`;
      if (!ids) throw new Error('Could not allocate part-exchange references');
      const contactId = ids.contact_id;
      const leadId = ids.lead_id;
      await tx`
        INSERT INTO contacts (id, tenant_id, site_id, first_name, last_name, email, phone)
        VALUES (
          ${contactId}::uuid, ${tenantId}::uuid, ${siteId}::uuid,
          ${givenName}, ${lastName}, ${email}, ${phone}
        )`;

      await tx`
        INSERT INTO leads (id, tenant_id, site_id, contact_id, source, message, due_at)
        VALUES (
          ${leadId}::uuid, ${tenantId}::uuid, ${siteId}::uuid, ${contactId}::uuid,
          'website_part_ex',
          ${`Part-exchange enquiry: ${registration}, ${mileage.toLocaleString('en-GB')} miles.`},
          now() + interval '1 hour'
        )`;

      await tx`
        INSERT INTO lead_events (tenant_id, lead_id, kind, to_stage, detail)
        VALUES (
          ${tenantId}::uuid, ${leadId}::uuid, 'created', 'new',
          'Public part-exchange form'
        )`;

      await tx`
        INSERT INTO appraisals (
          tenant_id, site_id, contact_id, lead_id, state,
          seller_type, registration, mileage
        ) VALUES (
          ${tenantId}::uuid, ${siteId}::uuid, ${contactId}::uuid,
          ${leadId}::uuid, 'draft', 'private_individual', ${registration}, ${mileage}
        )`;
      await tx`
        INSERT INTO audit_events (tenant_id, site_id, actor_type, resource_type, resource_id, action, diff)
        VALUES (${tenantId}::uuid, ${siteId}::uuid, 'public', 'lead', ${leadId}::uuid, 'create',
          ${tx.json({ source: 'website_part_ex', contactId })})`;
    });
  } catch {
    return { ok: false, error: 'We could not take that just now. Ring us and we will take it down.' };
  }
  return { ok: true };
}
