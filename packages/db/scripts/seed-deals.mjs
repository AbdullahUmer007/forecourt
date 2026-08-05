/**
 * Demo deals, with the situations that make the screen worth having.
 *
 *  - a financed deal DELIVERED four days ago on a distance contract, so both
 *    statutory clocks are running and the 14-day cancellation right is live
 *  - the same shape but formed on the forecourt, so there is NO cancellation
 *    right — the pair is the whole point of the contract-formation field
 *  - a delivered deal with an OPEN repair, which pauses the 30-day right to
 *    reject and must show as paused rather than as a date
 *  - a financed deal missing half its evidence, so the gap list has something
 *    in it that a lender would genuinely ask about
 *  - an add-on offered and not yet decided, and one accepted with a proper
 *    demands-and-needs statement
 *
 * Every evidence entry is hash-chained here exactly as the app writes them —
 * the seed imports `appendEvidence` from the domain rather than inventing
 * hashes, so the ledger a developer sees on screen genuinely verifies.
 *
 * Idempotent: fixed ids and guarded inserts throughout.
 */

import postgres from 'postgres';
import { requireDatabaseUrl } from '../../../scripts/load-env.mjs';
import { appendEvidence } from '../../domain/src/evidence.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-0000-4000-8000-000000000001';
const CONTACT_A = '44444444-0000-4000-8000-00000000000a'; // Marie Whitfield
const CONTACT_B = '44444444-0000-4000-8000-00000000000b'; // Owen Brackley
const CONTACT_C = '44444444-0000-4000-8000-00000000000c'; // Priya Raval
const CONTACT_D = '44444444-0000-4000-8000-00000000000d'; // Dean Okonkwo

const D = (n) => `88888888-0000-4000-8000-00000000000${n}`;

const sql = postgres(requireDatabaseUrl(), { max: 1, onnotice: () => {} });

const step = async (label, fn) => {
  process.stdout.write(`  ${label.padEnd(42)}`);
  await fn();
  process.stdout.write('done\n');
};

/** Append entries to a deal's chain, hashed the same way the app hashes them. */
async function ledger(dealId, entries) {
  const existing = await sql`
    SELECT * FROM deal_evidence WHERE deal_id = ${dealId}::uuid ORDER BY sequence`;
  if (existing.length > 0) return; // already seeded

  const chain = [];
  for (const input of entries) {
    const entry = appendEvidence(chain, {
      dealId,
      kind: input.kind,
      payload: input.payload,
      documentVersion: input.documentVersion ?? null,
      wordingVersion: null,
      occurredAt: input.occurredAt,
      actorId: OWNER,
    });
    chain.push(entry);

    await sql`
      INSERT INTO deal_evidence (tenant_id, deal_id, sequence, kind, payload,
                                 document_version, wording_version,
                                 previous_hash, entry_hash, occurred_at, actor_id)
      VALUES (${TENANT}::uuid, ${dealId}::uuid, ${entry.sequence},
              ${entry.kind}::evidence_kind, ${sql.json(entry.payload)},
              ${entry.documentVersion}, ${entry.wordingVersion},
              ${entry.previousHash}, ${entry.entryHash},
              ${entry.occurredAt}, ${OWNER}::uuid)`;
  }
}

const ago = (days) => new Date(Date.now() - days * 86_400_000);

try {
  const [tenant] = await sql`SELECT id FROM tenants WHERE id = ${TENANT}::uuid`;
  if (!tenant) {
    console.error('Run `pnpm db:seed`, `pnpm db:seed:crm` and `pnpm db:seed:leads` first.');
    process.exit(1);
  }

  const [site] = await sql`
    SELECT id FROM sites WHERE tenant_id = ${TENANT}::uuid ORDER BY created_at LIMIT 1`;
  const cars = await sql`
    SELECT id, retail_price_pence FROM vehicles WHERE tenant_id = ${TENANT}::uuid
    ORDER BY created_at LIMIT 4`;
  const car = (i) => cars[i]?.id ?? null;

  // No demo vehicle carried a cost, so every margin panel read as zero and the
  // deal screen could not show the one figure it exists for. A dealer's stock
  // always has a cost; the demo data should too. Roughly 82% of retail, which
  // is a believable bought-well number for a car of this age.
  await step('vehicle costs, so a margin exists at all', async () => {
    for (const c of cars) {
      await sql`
        UPDATE vehicles SET total_cost_pence = round(retail_price_pence * 0.82)
        WHERE id = ${c.id}::uuid AND coalesce(total_cost_pence, 0) = 0`;
    }
  });

  await step('deals', async () => {
    const rows = [
      // 1. Distance sale, delivered 4 days ago. Both clocks running, and a
      //    live 14-day cancellation right.
      [D(1), CONTACT_A, car(0), 'delivered', 'distance', 'KEN-1041',
        2_395_000, 1_200_000, 250_000, 100_000, 1_045_000, 4],
      // 2. Same shape, formed on the forecourt. NO cancellation right — the
      //    pair is the point of the field.
      [D(2), CONTACT_B, car(1), 'delivered', 'on_premises', 'KEN-1042',
        1_849_500, 0, 0, 200_000, 1_649_500, 6],
      // 3. Delivered with a repair still open: the reject clock is PAUSED.
      [D(3), CONTACT_C, car(2), 'delivered', 'distance', 'KEN-1043',
        3_120_000, 0, 0, 500_000, 2_620_000, 11],
      // 4. Contracted, financed, evidence badly incomplete.
      [D(4), CONTACT_D, car(3), 'contracted', 'off_premises', 'KEN-1044',
        1_499_000, 400_000, 120_000, 0, 1_219_000, null],
      // 5. Still being built — no evidence expected, and no gap flagged.
      [D(5), CONTACT_A, car(0), 'building', null, null,
        2_395_000, 0, 0, 0, 0, null],
    ];

    for (const [id, contact, vehicle, state, formation, reference,
      price, px, settlement, deposit, finance, deliveredDaysAgo] of rows) {
      const contracted = state !== 'building' && state !== 'quoted';
      await sql`
        INSERT INTO deals (id, tenant_id, site_id, contact_id, vehicle_id, state,
                           reference, contract_formation,
                           vehicle_price_pence, part_exchange_pence,
                           part_exchange_settlement_pence, deposit_pence,
                           finance_amount_pence,
                           quoted_at, contracted_at, delivered_at, created_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${site?.id ?? null}, ${contact}::uuid,
                ${vehicle}, ${state}::deal_state, ${reference},
                ${formation}::contract_formation,
                ${price}, ${px}, ${settlement}, ${deposit}, ${finance},
                ${contracted ? sql`now() - interval '20 days'` : null},
                ${contracted ? sql`now() - interval '18 days'` : null},
                ${deliveredDaysAgo === null ? null : ago(deliveredDaysAgo)},
                ${OWNER}::uuid)
        ON CONFLICT (id) DO NOTHING`;

      // A deal seeded before the cars had costs kept a null vehicle_id, and a
      // deal with no car shows no margin — which is the figure the screen
      // exists for. `deals` is mutable, so the link is repaired on re-run.
      await sql`
        UPDATE deals SET vehicle_id = ${vehicle}
        WHERE id = ${id}::uuid AND vehicle_id IS NULL`;
    }
  });

  await step('add-ons', async () => {
    const rows = [
      // Accepted, WITH its own demands-and-needs statement.
      [D(1), 'GAP', 'GAP insurance', 39_900, 18_000, ago(19), ago(18),
        'Financing £10,450 over four years on a car losing value faster than the balance falls; '
        + 'they asked what happens if it is written off in year two.'],
      // Offered and not yet decided — the state a screen usually forgets.
      [D(1), 'PAINT', 'Paint and fabric protection', 29_900, 9_000, ago(19), null, null],
      // Accepted on the financed deal that is missing its other evidence.
      [D(4), 'WARRANTY', '24-month warranty', 59_900, 31_000, ago(19), ago(18),
        'Vehicle is out of manufacturer warranty and they drive 22,000 miles a year.'],
    ];

    for (const [dealId, code, name, price, cost, offeredAt, acceptedAt, dn] of rows) {
      await sql`
        INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                                 price_pence, cost_pence, demands_and_needs,
                                 offered_at, accepted_at, created_by)
        SELECT ${TENANT}::uuid, ${dealId}::uuid, ${code}, ${name},
               ${price}, ${cost}, ${dn}, ${offeredAt}, ${acceptedAt}, ${OWNER}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM deal_addons WHERE deal_id = ${dealId}::uuid AND product_code = ${code})`;
    }

    await sql`
      UPDATE deals d SET addons_total_pence = (
        SELECT coalesce(sum(price_pence), 0) FROM deal_addons a
        WHERE a.deal_id = d.id AND a.accepted_at IS NOT NULL)
      WHERE d.tenant_id = ${TENANT}::uuid`;
  });

  await step('an open repair attempt', async () => {
    await sql`
      INSERT INTO deal_repair_attempts (tenant_id, deal_id, fault_reported, started_at, created_by)
      SELECT ${TENANT}::uuid, ${D(3)}::uuid,
             'Engine management light and loss of power above 3,000rpm',
             ${ago(3)}, ${OWNER}::uuid
      WHERE NOT EXISTS (SELECT 1 FROM deal_repair_attempts WHERE deal_id = ${D(3)}::uuid)`;
  });

  await step('evidence ledgers', async () => {
    // A complete financed deal: every kind `REQUIRED_FOR_FINANCED_DEAL` asks for.
    await ledger(D(1), [
      { kind: 'initial_disclosure', occurredAt: ago(20),
        payload: { statement: 'We are a credit broker, not a lender. We work with a panel of lenders.' },
        documentVersion: 'idd-v3' },
      { kind: 'quote_presented', occurredAt: ago(20),
        payload: { lenders: 'Blue Motor Finance, Close Brothers, MotoNovo', quotesShown: 3 } },
      { kind: 'quote_selected', occurredAt: ago(19),
        payload: { lender: 'Close Brothers', reason: 'lowest total amount payable of the three' } },
      { kind: 'commission_disclosure', occurredAt: ago(19),
        payload: {
          commissionType: 'flat fee',
          amount: '£420.00',
          disclosedBefore: 'the customer signed anything',
        },
        documentVersion: 'commission-v2' },
      { kind: 'demands_and_needs', occurredAt: ago(19),
        payload: { summary: 'Wanted a fixed monthly cost over four years with no balloon payment.' } },
      { kind: 'affordability', occurredAt: ago(19),
        payload: { method: 'income and expenditure captured, lender affordability passed' } },
      { kind: 'adequate_explanation', occurredAt: ago(19),
        payload: { covered: 'total payable, consequences of missing a payment, right to withdraw' } },
      { kind: 'addon_accepted', occurredAt: ago(18),
        payload: { productCode: 'GAP', productName: 'GAP insurance', pricePence: '39900' } },
      { kind: 'contract_formed', occurredAt: ago(18),
        payload: {
          contractFormation: 'distance',
          cancellationRight: '14 days from the day after delivery',
        } },
      { kind: 'delivery', occurredAt: ago(4), payload: { deliveredAt: ago(4).toISOString() } },
    ]);

    // A cash deal needs only the contract formation.
    await ledger(D(2), [
      { kind: 'contract_formed', occurredAt: ago(18),
        payload: {
          contractFormation: 'on_premises',
          cancellationRight: 'none — the contract was formed on the forecourt',
        } },
      { kind: 'delivery', occurredAt: ago(6), payload: { deliveredAt: ago(6).toISOString() } },
    ]);

    await ledger(D(3), [
      { kind: 'contract_formed', occurredAt: ago(18),
        payload: { contractFormation: 'distance', cancellationRight: '14 days from the day after delivery' } },
      { kind: 'delivery', occurredAt: ago(11), payload: { deliveredAt: ago(11).toISOString() } },
      { kind: 'repair_attempt', occurredAt: ago(3),
        payload: {
          faultReported: 'Engine management light and loss of power above 3,000rpm',
          startedAt: ago(3).toISOString(),
        } },
    ]);

    // Deliberately incomplete: financed, contracted, and missing four of the
    // seven records a lender would ask to see.
    await ledger(D(4), [
      { kind: 'initial_disclosure', occurredAt: ago(20),
        payload: { statement: 'We are a credit broker, not a lender.' }, documentVersion: 'idd-v3' },
      { kind: 'quote_presented', occurredAt: ago(20), payload: { quotesShown: 2 } },
      { kind: 'contract_formed', occurredAt: ago(18),
        payload: { contractFormation: 'off_premises', cancellationRight: '14 days from the day after delivery' } },
    ]);
  });

  console.log('\nDeals seeded. Open /deals.');
} finally {
  await sql.end();
}
