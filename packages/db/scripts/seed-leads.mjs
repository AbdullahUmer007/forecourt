/**
 * Demo leads for the CRM inbox.
 *
 * Deliberately not a tidy set. The inbox is only worth looking at if it shows
 * the situations a dealer actually has on a Tuesday morning:
 *
 *  - a marketplace lead that came in ninety minutes ago and nobody has touched
 *    (fifteen-minute target, badly overdue — the one that costs money)
 *  - one answered inside the target, and one answered outside it
 *  - a buyer with TWO open enquiries, because ringing them twice is how you
 *    lose them and the screen has to say so
 *  - somebody who has withdrawn email marketing consent but can still lawfully
 *    be replied to, which is the distinction the consent panel exists to make
 *  - somebody on the suppression list
 *  - a lead lost with a reason, so the loss report has something in it
 *
 * Idempotent: fixed ids and ON CONFLICT DO NOTHING throughout.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';
const EXEC = '22222222-0000-4000-8000-000000000002';
const CONTACT_A = '44444444-0000-4000-8000-00000000000a'; // Marie Whitfield
const CONTACT_B = '44444444-0000-4000-8000-00000000000b'; // Owen Brackley
const CONTACT_C = '44444444-0000-4000-8000-00000000000c';
const CONTACT_D = '44444444-0000-4000-8000-00000000000d';
const WORDING = '66666666-0000-4000-8000-000000000001';

const L = (n) => `77777777-0000-4000-8000-00000000000${n}`;

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  process.stdout.write('done\n');
};

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run `pnpm db:seed` and `pnpm db:seed:crm` first — this builds on their world.');
    process.exit(1);
  }

  const [site] = await sql`SELECT id FROM sites WHERE tenant_id = ${TENANT}::uuid ORDER BY created_at LIMIT 1`;
  const cars = await sql`
    SELECT id, registration FROM vehicles
    WHERE tenant_id = ${TENANT}::uuid AND state IN ('live','ready','reserved')
    ORDER BY created_at LIMIT 3`;

  await step('extra contacts', async () => {
    await sql`
      INSERT INTO contacts (id, tenant_id, kind, first_name, last_name, email, phone, postcode) VALUES
        (${CONTACT_C}::uuid, ${TENANT}::uuid, 'individual', 'Priya', 'Raval',
         'p.raval@example.co.uk', '+447700900103', 'MK9 3AB'),
        (${CONTACT_D}::uuid, ${TENANT}::uuid, 'individual', 'Dean', 'Okonkwo',
         'd.okonkwo@example.co.uk', '+447700900104', 'MK6 1XY')
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('consent wording', async () => {
    await sql`
      INSERT INTO consent_wordings (id, tenant_id, version, channel, basis, body, opt_out_text)
      VALUES (${WORDING}::uuid, ${TENANT}::uuid, 1, 'email', 'explicit',
        'Tick here if you would like to hear from Kennington Car Sales about cars matching what you are looking for.',
        'You can unsubscribe at any time using the link in any email, or by replying STOP.')
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('consent records', async () => {
    // Marie granted email marketing and then WITHDREW it. Both rows exist —
    // a withdrawal is a new record, never an edit — so the screen has to
    // derive the position rather than read a flag, and the answer is "no
    // marketing, but you may still reply to her enquiry".
    await sql`
      INSERT INTO contact_consents (tenant_id, contact_id, channel, basis, granted, source, wording_id, evidence, recorded_at)
      SELECT ${TENANT}::uuid, ${CONTACT_A}::uuid, 'email', 'explicit', true, 'website_form',
             ${WORDING}::uuid, 'enquiry form, box ticked', now() - interval '40 days'
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_consents
        WHERE contact_id = ${CONTACT_A}::uuid AND channel = 'email')`;
    await sql`
      INSERT INTO contact_consents (tenant_id, contact_id, channel, basis, granted, source, evidence, recorded_at)
      SELECT ${TENANT}::uuid, ${CONTACT_A}::uuid, 'email', 'explicit', false, 'website_form',
             'unsubscribe link clicked', now() - interval '3 days'
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_consents
        WHERE contact_id = ${CONTACT_A}::uuid AND channel = 'email' AND granted = false)`;

    await sql`
      INSERT INTO contact_consents (tenant_id, contact_id, channel, basis, granted, source, wording_id, evidence, recorded_at)
      SELECT ${TENANT}::uuid, ${CONTACT_C}::uuid, 'email', 'explicit', true, 'website_form',
             ${WORDING}::uuid, 'enquiry form, box ticked', now() - interval '2 days'
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_consents WHERE contact_id = ${CONTACT_C}::uuid)`;
  });

  await step('a suppression', async () => {
    // Dean is on the do-not-contact list for email regardless of any consent
    // record. The gate must refuse marketing on that channel and say why.
    await sql`
      INSERT INTO suppressions (tenant_id, channel, destination, reason, active)
      SELECT ${TENANT}::uuid, 'email', 'd.okonkwo@example.co.uk',
             'asked to be removed by phone', true
      WHERE NOT EXISTS (
        SELECT 1 FROM suppressions
        WHERE tenant_id = ${TENANT}::uuid AND destination = 'd.okonkwo@example.co.uk')`;
  });

  await step('leads', async () => {
    const car = (i) => cars[i]?.id ?? null;

    const rows = [
      // 1. THE one. Auto Trader, fifteen-minute target, ninety minutes old,
      //    nobody assigned, nobody has replied.
      [L(1), CONTACT_C, car(0), 'autotrader', 'new', null, '90 minutes', null, null,
        'Is this still available? Can I come and see it Saturday morning?'],
      // 2. Same buyer, second car. One buyer, two enquiries.
      [L(2), CONTACT_C, car(1), 'website_enquiry', 'new', null, '75 minutes', null, null,
        'Also interested in this one — what would you give me for a 2018 Fiesta in part-ex?'],
      // 3. Answered inside the target.
      [L(3), CONTACT_A, car(0), 'website_test_drive', 'appointment', EXEC, '3 days', '6 minutes', null,
        'Would like to book a test drive, weekday evening if possible.'],
      // 4. Answered, but outside it — the badge has to say so without shouting.
      [L(4), CONTACT_B, car(2), 'website_callback', 'negotiating', EXEC, '5 days', '2 hours', null,
        'Please call me about the finance on this.'],
      // 5. Lost, with a reason, so the loss report has something in it.
      [L(5), CONTACT_D, car(1), 'facebook', 'lost', OWNER, '12 days', '9 minutes', 'part_ex_valuation',
        'What can you do on price if I part-ex my Astra?'],
      // 6. A walk-in, won.
      [L(6), CONTACT_B, car(2), 'walk_in', 'won', OWNER, '20 days', '1 minute', null,
        'Came in on the forecourt Saturday.'],
    ];

    for (const [id, contact, vehicle, source, stage, assigned, ago, respondedAfter, loss, message] of rows) {
      const closed = stage === 'won' || stage === 'lost';
      await sql`
        INSERT INTO leads (id, tenant_id, site_id, contact_id, vehicle_id, source, stage,
                           assigned_to, message, received_at, first_response_at, due_at,
                           closed_at, loss_reason, created_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${site?.id ?? null}, ${contact}::uuid,
                ${vehicle}, ${source}::lead_source, ${stage}::lead_stage,
                ${assigned}, ${message},
                now() - ${ago}::interval,
                ${respondedAfter === null ? null : sql`now() - ${ago}::interval + ${respondedAfter}::interval`},
                NULL,
                ${closed ? sql`now() - interval '1 day'` : null},
                ${loss}, ${OWNER}::uuid)
        ON CONFLICT (id) DO NOTHING`;

      await sql`
        INSERT INTO lead_events (tenant_id, lead_id, kind, to_stage, detail, occurred_at, actor_id)
        SELECT ${TENANT}::uuid, ${id}::uuid, 'created', ${stage}::lead_stage,
               ${`arrived from ${source}`}, now() - ${ago}::interval, ${OWNER}::uuid
        WHERE NOT EXISTS (SELECT 1 FROM lead_events WHERE lead_id = ${id}::uuid)`;
    }
  });

  await step('messages', async () => {
    // The reply that stopped the clock on lead 3. Service, not marketing —
    // so no consent record is cited, and none is required.
    await sql`
      INSERT INTO messages (tenant_id, lead_id, contact_id, direction, channel, destination,
                            subject, body, is_marketing, status, sent_at, occurred_at, created_by)
      SELECT ${TENANT}::uuid, ${L(3)}::uuid, ${CONTACT_A}::uuid, 'outbound', 'email',
             'm.whitfield@example.co.uk',
             'Your test drive — Kennington Car Sales',
             'Hello Marie, thanks for your enquiry. Thursday at 6pm works — I have put it in the diary and the car is reserved for you until then.',
             false, 'sent', now() - interval '3 days', now() - interval '3 days', ${EXEC}::uuid
      WHERE NOT EXISTS (SELECT 1 FROM messages WHERE lead_id = ${L(3)}::uuid)`;

    // A marketing email to Marie that was BLOCKED after she withdrew consent.
    // Kept rather than discarded: "we did not send this, and here is why" is
    // the record that demonstrates the gate works.
    await sql`
      INSERT INTO messages (tenant_id, lead_id, contact_id, direction, channel, destination,
                            subject, body, is_marketing, status, blocked_reason, occurred_at, created_by)
      SELECT ${TENANT}::uuid, ${L(3)}::uuid, ${CONTACT_A}::uuid, 'outbound', 'email',
             'm.whitfield@example.co.uk',
             'Three cars we think you will like',
             'Since you were looking at the Tesla, here are three similar cars that have just arrived.',
             true, 'blocked', 'consent for email was withdrawn on the unsubscribe link',
             now() - interval '2 days', ${EXEC}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM messages WHERE lead_id = ${L(3)}::uuid AND is_marketing = true)`;
  });

  console.log('\nLead inbox seeded. Open /leads.');
} finally {
  await sql.end();
}
