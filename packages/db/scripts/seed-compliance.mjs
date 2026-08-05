/**
 * Compliance records for the demo tenant.
 *
 * Chosen so every branch the centre renders actually appears:
 *
 *  - a complaint received 50 days ago, unanswered — inside the eight weeks but
 *    close enough to warn
 *  - a complaint received 70 days ago, unanswered — BREACHED, and the
 *    complainant can go to the Ombudsman now
 *  - a complaint answered in week six, WITH the Ombudsman rights recorded.
 *    The obvious demo case would be one answered without them — but the
 *    database refuses that outright (`complaint_final_response_gives_fos_rights`),
 *    which is a stronger guarantee than a warning on a screen. The domain's
 *    `disp_fos_rights_missing` statement stays as belt and braces for data
 *    arriving by import rather than through the app.
 *  - a breach reported to the ICO in time
 *  - a breach discovered 5 days ago, unreported, with NO risk assessment — the
 *    state that used to evaluate as low risk because there was no column
 *  - registers: one expired, one expiring, one valid, one with no expiry
 *
 * Idempotent: fixed ids and guarded inserts throughout.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';
const CONTACT_A = '44444444-0000-4000-8000-00000000000a';
const CONTACT_B = '44444444-0000-4000-8000-00000000000b';

const C = (n) => `99999999-0000-4000-8000-00000000000${n}`;
const B = (n) => `99999999-0000-4000-8000-00000000001${n}`;
const R = (n) => `99999999-0000-4000-8000-00000000002${n}`;

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  process.stdout.write('done\n');
};

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run `pnpm db:seed` and `pnpm db:seed:crm` first.');
    process.exit(1);
  }

  await step('complaints', async () => {
    const rows = [
      // [id, contact, ref, summary, status, days ago, answered after days,
      //  fos rights, acknowledged, outcome]
      //
      // A final response must record an OUTCOME as well as the Ombudsman
      // rights — both are CHECK constraints. "We answered" without saying what
      // we decided is not a final response, and the schema says so.
      [C(1), CONTACT_A, 'CMP-0041',
        'Says the car was described as having full service history and the book has two stamps.',
        'investigating', 50, null, false, true, null],
      [C(2), CONTACT_B, 'CMP-0042',
        'Says the finance commission was never explained before signing.',
        'investigating', 70, null, false, true, null],
      [C(3), CONTACT_A, 'CMP-0039',
        'Air conditioning failed within a fortnight of collection.',
        'final_response_sent', 80, 42, true, true, 'partly_upheld'],
    ];

    for (const [id, contact, ref, summary, status, ago, answered, fos, ack, outcome] of rows) {
      await sql`
        INSERT INTO complaints (id, tenant_id, contact_id, reference, summary, status,
                                received_at, acknowledged_at, final_response_at,
                                fos_rights_given, outcome, created_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${contact}::uuid, ${ref}, ${summary},
                ${status}::complaint_status,
                -- Intervals computed in JS: subtracting two untyped bind
                -- parameters gives "operator is not unique: unknown - unknown".
                now() - (${String(ago)} || ' days')::interval,
                ${ack ? sql`now() - (${String(ago - 1)} || ' days')::interval` : null},
                ${answered === null
    ? null
    : sql`now() - (${String(ago - answered)} || ' days')::interval`},
                ${fos}, ${outcome}::complaint_outcome, ${OWNER}::uuid)
        ON CONFLICT (id) DO NOTHING`;
    }
  });

  await step('data breaches', async () => {
    await sql`
      INSERT INTO data_breaches (id, tenant_id, summary, status, became_aware_at,
                                 reported_to_ico_at, ico_reference, subjects_affected,
                                 high_risk, high_risk_reason, subjects_notified_at,
                                 containment, created_by)
      VALUES (${B(1)}::uuid, ${TENANT}::uuid,
              'A sales enquiry list was emailed to the wrong dealership.',
              'reported_to_ico', now() - interval '30 days',
              now() - interval '29 days', 'ICO-2026-88213', 142,
              false, 'Names and phone numbers only; no financial data and no special categories.',
              NULL, 'Recipient confirmed deletion in writing.', ${OWNER}::uuid)
      ON CONFLICT (id) DO NOTHING`;

    // The state that used to be invisible: nobody has assessed the risk to
    // the people affected, and there was no column to record it in.
    await sql`
      INSERT INTO data_breaches (id, tenant_id, summary, status, became_aware_at,
                                 subjects_affected, containment, created_by)
      VALUES (${B(2)}::uuid, ${TENANT}::uuid,
              'A laptop was taken from the sales office. Full disk encryption not confirmed.',
              'assessing', now() - interval '5 days', NULL,
              'Locks changed, police reference obtained.', ${OWNER}::uuid)
      ON CONFLICT (id) DO NOTHING`;
  });

  await step('registers', async () => {
    const rows = [
      [R(1), 'motor_trade_insurance', 'Motor trade road risk policy', 'Aviva', -12],
      [R(2), 'trade_plate', 'Trade plate 0417 KX', 'DVLA', 18],
      [R(3), 'fca_permission', 'Limited permission — credit broking', 'FCA', 210],
      [R(4), 'aml_policy', 'Anti-money-laundering policy', null, null],
    ];

    for (const [id, kind, description, issuer, daysToExpiry] of rows) {
      await sql`
        INSERT INTO compliance_registers (id, tenant_id, kind, description, issuer,
                                          expires_on, created_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${kind}::register_kind, ${description}, ${issuer},
                -- The offset is cast explicitly: adding an untyped bind
                -- parameter to a date gives "operator is not unique".
                ${daysToExpiry === null
    ? null
    : sql`(current_date + (${String(daysToExpiry)})::int)`},
                ${OWNER}::uuid)
        ON CONFLICT (id) DO NOTHING`;
    }
  });

  console.log('\nCompliance seeded. Open /compliance.');
} finally {
  await sql.end();
}
