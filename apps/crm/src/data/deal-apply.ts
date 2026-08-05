/**
 * Deal mutations, as functions that take a transaction.
 *
 * Out of the `'use server'` file for the reason recorded in `prep-move.ts`.
 *
 * The evidence ledger is written through `appendEvidence`, which takes the
 * WHOLE existing chain rather than the last hash — so it cannot be called with
 * a stale tip and silently fork the sequence. Two entries at position 4 is
 * exactly the ambiguity the ledger exists to prevent, so the read of the chain
 * and the write of the next entry happen inside one transaction, and the
 * unique index on `(tenant_id, deal_id, sequence)` is the backstop if two
 * requests race.
 */

import type { Tx } from './db';
import { toDate, toPence } from './db';
import type { Session } from '@/auth/session';
import { writeAudit } from './audit';
import {
  transition, acceptAddon, declineAddon, appendEvidence, money,
  type Deal, type DealState, type DealAddon, type ContractFormation,
  type EvidenceEntry, type EvidenceKind, type EvidenceInput, type Currency,
} from '@forecourt/domain';

export interface DealOutcome {
  ok: boolean;
  error?: string;
  message?: string;
}

const CONTRACT_FORMATIONS: readonly ContractFormation[] = ['on_premises', 'distance', 'off_premises'];
const isFormation = (v: string): v is ContractFormation =>
  (CONTRACT_FORMATIONS as readonly string[]).includes(v);

const currencyOf = (v: unknown): Currency => (v === 'EUR' ? 'EUR' : 'GBP');

async function readDeal(tx: Tx, id: string): Promise<Deal | null> {
  const [row] = await tx`SELECT * FROM deals WHERE id = ${id}::uuid`;
  if (!row) return null;

  // The CURRENT position of each product — the latest row per product code.
  // `deal_addons` is append-only, so a product that was offered, accepted and
  // then declined has three rows, and only the last one is true.
  const addonRows = await tx`
    SELECT DISTINCT ON (product_code) * FROM deal_addons
    WHERE deal_id = ${id}::uuid
    ORDER BY product_code, created_at DESC, id DESC`;
  const currency = currencyOf(row['currency']);

  const addons: DealAddon[] = addonRows.map((a) => ({
    productCode: String(a['product_code']),
    productName: String(a['product_name']),
    price: money(toPence(a['price_pence'] as string), currency),
    cost: a['cost_pence'] === null ? null : money(toPence(a['cost_pence'] as string), currency),
    demandsAndNeeds: (a['demands_and_needs'] as string | null) ?? null,
    fairValueReference: (a['fair_value_reference'] as string | null) ?? null,
    offeredAt: toDate(a['offered_at'] as Date) as Date,
    acceptedAt: toDate(a['accepted_at'] as Date | null),
    declinedAt: toDate(a['declined_at'] as Date | null),
  }));

  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    contactId: String(row['contact_id']),
    vehicleId: row['vehicle_id'] === null ? null : String(row['vehicle_id']),
    state: row['state'] as DealState,
    contractFormation: (row['contract_formation'] as ContractFormation | null) ?? null,
    vehiclePrice: row['vehicle_price_pence'] === null
      ? null : money(toPence(row['vehicle_price_pence'] as string), currency),
    partExchange: money(toPence(row['part_exchange_pence'] as string), currency),
    partExchangeSettlement: money(toPence(row['part_exchange_settlement_pence'] as string), currency),
    deposit: money(toPence(row['deposit_pence'] as string), currency),
    financeAmount: money(toPence(row['finance_amount_pence'] as string), currency),
    addons,
    quotedAt: toDate(row['quoted_at'] as Date | null),
    contractedAt: toDate(row['contracted_at'] as Date | null),
    deliveredAt: toDate(row['delivered_at'] as Date | null),
    cancelledAt: toDate(row['cancelled_at'] as Date | null),
    cancellationReason: (row['cancellation_reason'] as string | null) ?? null,
  };
}

async function readChain(tx: Tx, dealId: string): Promise<EvidenceEntry[]> {
  const rows = await tx`
    SELECT * FROM deal_evidence WHERE deal_id = ${dealId}::uuid ORDER BY sequence`;
  return rows.map((e) => ({
    dealId: String(e['deal_id']),
    sequence: Number(e['sequence']),
    kind: e['kind'] as EvidenceKind,
    payload: (e['payload'] ?? {}) as Record<string, unknown>,
    documentVersion: (e['document_version'] as string | null) ?? null,
    wordingVersion: e['wording_version'] === null ? null : Number(e['wording_version']),
    occurredAt: toDate(e['occurred_at'] as Date) as Date,
    actorId: e['actor_id'] === null ? null : String(e['actor_id']),
    previousHash: (e['previous_hash'] as string | null) ?? null,
    entryHash: String(e['entry_hash']),
  }));
}

/**
 * Append one entry to a deal's evidence chain.
 *
 * Exported because every mutation that produces evidence uses it, and because
 * the integration suite verifies the chain it builds.
 */
export async function appendToLedger(
  tx: Tx,
  session: Session,
  dealId: string,
  input: Omit<EvidenceInput, 'dealId' | 'actorId'>,
): Promise<EvidenceEntry> {
  const chain = await readChain(tx, dealId);
  const entry = appendEvidence(chain, {
    ...input,
    dealId,
    actorId: session.userId,
  });

  await tx`
    INSERT INTO deal_evidence (tenant_id, deal_id, sequence, kind, payload,
                               document_version, wording_version,
                               previous_hash, entry_hash, occurred_at, actor_id)
    VALUES (${session.tenantId}::uuid, ${dealId}::uuid, ${entry.sequence},
            ${entry.kind}::evidence_kind, ${tx.json(entry.payload as never)},
            ${entry.documentVersion}, ${entry.wordingVersion},
            ${entry.previousHash}, ${entry.entryHash},
            ${entry.occurredAt}, ${entry.actorId}::uuid)`;

  return entry;
}

export interface TransitionInput {
  dealId: string;
  to: string;
  contractFormation: string;
  cancellationReason: string;
}

/**
 * Move a deal to a new state.
 *
 * The gate that matters is `contracted`: it cannot happen without contract
 * formation, because that one field decides whether a 14-day cancellation
 * right exists. There is no safe default. Assume on-premises and you deny a
 * customer a statutory right; assume distance and you grant a cancellation
 * window on a showroom sale and unwind deals that were final.
 */
export async function applyTransition(
  tx: Tx,
  session: Session,
  input: TransitionInput,
): Promise<DealOutcome> {
  const before = await readDeal(tx, input.dealId);
  if (!before) return { ok: false, error: 'That deal no longer exists.' };

  const to = input.to as DealState;
  const at = new Date();
  const formation = input.contractFormation.trim();

  // Recorded BEFORE the transition is attempted, because `transition` refuses
  // a contracted deal that has none — and asking the user to set it in a
  // separate step first is a worse screen for the same outcome.
  let contractFormation = before.contractFormation;
  if (to === 'contracted' && contractFormation === null) {
    if (!isFormation(formation)) {
      return {
        ok: false,
        error: 'Record where this contract was formed. It decides whether the customer has a '
          + '14-day right to cancel, and there is no safe way to guess it.',
      };
    }
    contractFormation = formation;
  }

  const result = transition(
    { ...before, contractFormation }, to, at,
    input.cancellationReason.trim()
      ? { cancellationReason: input.cancellationReason.trim() }
      : {},
  );

  if (!result.ok) return { ok: false, error: result.error ?? 'That change is not allowed.' };
  if (result.deal.state === before.state) return { ok: true, message: 'No change.' };

  const after = result.deal;

  await tx`
    UPDATE deals SET
      state = ${after.state}::deal_state,
      contract_formation = ${after.contractFormation},
      contracted_at = ${after.contractedAt},
      delivered_at = ${after.deliveredAt},
      cancelled_at = ${after.cancelledAt},
      cancellation_reason = ${after.cancellationReason},
      completed_at = ${after.state === 'completed' ? at : null},
      updated_at = now(), updated_by = ${session.userId}::uuid
    WHERE id = ${input.dealId}::uuid`;

  // Two states produce evidence a lender or the Ombudsman would ask for.
  if (after.state === 'contracted' && after.contractFormation) {
    await appendToLedger(tx, session, input.dealId, {
      kind: 'contract_formed',
      payload: {
        contractFormation: after.contractFormation,
        // Recorded in words as well as as an enum: the consequence is the
        // point, and an enum alone needs this system to explain it years later.
        cancellationRight: after.contractFormation === 'on_premises'
          ? 'none — the contract was formed on the forecourt'
          : '14 days from the day after delivery',
      },
      documentVersion: null,
      wordingVersion: null,
      occurredAt: at,
    });
  }

  if (after.state === 'delivered') {
    await appendToLedger(tx, session, input.dealId, {
      kind: 'delivery',
      payload: { deliveredAt: at.toISOString() },
      documentVersion: null,
      wordingVersion: null,
      occurredAt: at,
    });
  }

  await writeAudit({
    tx, session, resourceType: 'deal', resourceId: input.dealId, action: 'state_changed',
    before: { state: before.state, contractFormation: before.contractFormation },
    after: { state: after.state, contractFormation: after.contractFormation },
  });

  return { ok: true, message: `Moved to ${after.state}.` };
}

export interface AddonDecisionInput {
  addonId: string;
  dealId: string;
  accept: boolean;
  demandsAndNeeds: string;
  fairValueReference: string;
}

/**
 * Accept or decline an add-on.
 *
 * PRIN 2A requires a demands-and-needs statement PER PRODUCT, not one covering
 * the bundle, so accepting without one is refused here, by the domain, and by
 * a CHECK constraint. `offered_at` and `accepted_at` stay separate columns
 * because a row with an acceptance and no offer is what a pre-ticked box looks
 * like in data — and the database refuses that shape outright.
 */
export async function applyAddonDecision(
  tx: Tx,
  session: Session,
  input: AddonDecisionInput,
): Promise<DealOutcome> {
  const [row] = await tx`SELECT * FROM deal_addons WHERE id = ${input.addonId}::uuid`;
  if (!row) return { ok: false, error: 'That add-on is no longer on this deal.' };
  if (String(row['deal_id']) !== input.dealId) {
    return { ok: false, error: 'That add-on belongs to a different deal.' };
  }

  const currency = currencyOf(row['currency']);
  const addon: DealAddon = {
    productCode: String(row['product_code']),
    productName: String(row['product_name']),
    price: money(toPence(row['price_pence'] as string), currency),
    cost: row['cost_pence'] === null ? null : money(toPence(row['cost_pence'] as string), currency),
    demandsAndNeeds: (row['demands_and_needs'] as string | null) ?? null,
    fairValueReference: (row['fair_value_reference'] as string | null) ?? null,
    offeredAt: toDate(row['offered_at'] as Date) as Date,
    acceptedAt: toDate(row['accepted_at'] as Date | null),
    declinedAt: toDate(row['declined_at'] as Date | null),
  };

  const at = new Date();

  // `deal_addons` is APPEND-ONLY. A decision is therefore a new row carrying
  // the original offer date, not an update to the offer — which is the same
  // shape M9 uses for consent, and for the same reason: the history of what
  // was offered and what was decided is the evidence, and an update destroys
  // half of it. `offered_at` is copied forward so the CHECK that an
  // acceptance cannot predate its offer still means what it says.
  const insert = async (
    acceptedAt: Date | null,
    declinedAt: Date | null,
    demandsAndNeeds: string | null,
    fairValueReference: string | null,
  ): Promise<void> => {
    await tx`
      INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                               price_pence, cost_pence, demands_and_needs,
                               fair_value_reference, offered_at, accepted_at,
                               declined_at, created_by)
      VALUES (${session.tenantId}::uuid, ${input.dealId}::uuid,
              ${addon.productCode}, ${addon.productName},
              -- bigint over the wire as a string; the column is bigint and
              -- Postgres parses it exactly. Passing a JS number would lose
              -- precision above 2^53 and silently round somebody's money.
              ${addon.price.amount.toString()}, ${addon.cost?.amount.toString() ?? null},
              ${demandsAndNeeds}, ${fairValueReference},
              ${addon.offeredAt}, ${acceptedAt}, ${declinedAt},
              ${session.userId}::uuid)`;
  };

  // Derived from the CURRENT position of every product — the latest row per
  // product code — not from a running total. An increment drifts the first
  // time anything is accepted and then declined.
  const recomputeTotal = async (): Promise<void> => {
    await tx`
      UPDATE deals SET addons_total_pence = (
        SELECT coalesce(sum(price_pence), 0) FROM (
          SELECT DISTINCT ON (product_code) price_pence, accepted_at
          FROM deal_addons WHERE deal_id = ${input.dealId}::uuid
          ORDER BY product_code, created_at DESC, id DESC
        ) current WHERE accepted_at IS NOT NULL
      ), updated_at = now(), updated_by = ${session.userId}::uuid
      WHERE id = ${input.dealId}::uuid`;
  };

  if (!input.accept) {
    const declined = declineAddon(addon, at);
    await insert(null, declined.declinedAt, addon.demandsAndNeeds, addon.fairValueReference);
    await recomputeTotal();

    await appendToLedger(tx, session, input.dealId, {
      kind: 'addon_declined',
      payload: { productCode: addon.productCode, productName: addon.productName },
      documentVersion: null, wordingVersion: null, occurredAt: at,
    });
    await writeAudit({
      tx, session, resourceType: 'deal_addon', resourceId: input.addonId, action: 'declined',
      before: { acceptedAt: addon.acceptedAt, declinedAt: addon.declinedAt },
      after: { acceptedAt: null, declinedAt: declined.declinedAt },
    });
    return { ok: true, message: `${addon.productName} declined.` };
  }

  // The statement is passed explicitly rather than read off the addon: PRIN 2A
  // wants the words recorded at the moment of ACCEPTANCE, and a statement
  // inherited from whenever the product was first set up is not that.
  const result = acceptAddon(addon, at, input.demandsAndNeeds.trim());
  if (!result.ok || !result.addon) {
    return { ok: false, error: result.error ?? 'That add-on cannot be accepted.' };
  }
  const accepted = result.addon;

  await insert(
    accepted.acceptedAt,
    null,
    accepted.demandsAndNeeds,
    input.fairValueReference.trim() || accepted.fairValueReference,
  );
  await recomputeTotal();

  await appendToLedger(tx, session, input.dealId, {
    kind: 'addon_accepted',
    payload: {
      productCode: addon.productCode,
      productName: addon.productName,
      pricePence: addon.price.amount.toString(),
      demandsAndNeeds: accepted.demandsAndNeeds,
      fairValueReference: accepted.fairValueReference,
    },
    documentVersion: null, wordingVersion: null, occurredAt: at,
  });

  await writeAudit({
    tx, session, resourceType: 'deal_addon', resourceId: input.addonId, action: 'accepted',
    before: { acceptedAt: addon.acceptedAt, demandsAndNeeds: addon.demandsAndNeeds },
    after: { acceptedAt: accepted.acceptedAt, demandsAndNeeds: accepted.demandsAndNeeds },
  });

  return { ok: true, message: `${addon.productName} accepted.` };
}

export interface RepairInput {
  dealId: string;
  repairId: string;
  faultReported: string;
  outcome: string;
}

/**
 * Open or close a repair attempt.
 *
 * Each one PAUSES the 30-day right to reject, and on resumption at least seven
 * days must remain (CRA s.22(6)–(7)). Nothing is stored about the deadline —
 * `dealClocks` recomputes it from the attempts every time the deal is read,
 * because a stored deadline is wrong from the moment a repair opens.
 */
export async function applyRepair(
  tx: Tx,
  session: Session,
  input: RepairInput,
): Promise<DealOutcome> {
  const deal = await readDeal(tx, input.dealId);
  if (!deal) return { ok: false, error: 'That deal no longer exists.' };
  if (deal.deliveredAt === null) {
    return {
      ok: false,
      error: 'A repair attempt only pauses the clock after delivery. Record the delivery first.',
    };
  }

  const at = new Date();

  if (input.repairId) {
    const outcome = input.outcome.trim();
    if (!outcome) {
      return { ok: false, error: 'Say what the outcome was. It is what closes the pause.' };
    }
    const [existing] = await tx`
      SELECT * FROM deal_repair_attempts WHERE id = ${input.repairId}::uuid`;
    if (!existing) return { ok: false, error: 'That repair attempt no longer exists.' };
    if (existing['completed_at'] !== null) {
      return { ok: false, error: 'That repair attempt is already closed.' };
    }

    await tx`
      UPDATE deal_repair_attempts SET completed_at = ${at}, outcome = ${outcome}
      WHERE id = ${input.repairId}::uuid`;

    await appendToLedger(tx, session, input.dealId, {
      kind: 'repair_attempt',
      payload: {
        faultReported: String(existing['fault_reported']),
        outcome,
        closedAt: at.toISOString(),
      },
      documentVersion: null, wordingVersion: null, occurredAt: at,
    });

    await writeAudit({
      tx, session, resourceType: 'deal_repair_attempt', resourceId: input.repairId,
      action: 'closed', before: { completedAt: null }, after: { completedAt: at, outcome },
    });

    return { ok: true, message: 'Repair closed — the right-to-reject clock resumes.' };
  }

  const fault = input.faultReported.trim();
  if (!fault) {
    return { ok: false, error: 'Describe the fault the customer reported.' };
  }

  const [open] = await tx`
    SELECT 1 FROM deal_repair_attempts
    WHERE deal_id = ${input.dealId}::uuid AND completed_at IS NULL`;
  if (open) {
    return {
      ok: false,
      error: 'A repair is already open on this deal. Close it before opening another.',
    };
  }

  const [created] = await tx<{ id: string }[]>`
    INSERT INTO deal_repair_attempts (tenant_id, deal_id, fault_reported, started_at, created_by)
    VALUES (${session.tenantId}::uuid, ${input.dealId}::uuid, ${fault}, ${at},
            ${session.userId}::uuid)
    RETURNING id`;

  await appendToLedger(tx, session, input.dealId, {
    kind: 'repair_attempt',
    payload: { faultReported: fault, startedAt: at.toISOString() },
    documentVersion: null, wordingVersion: null, occurredAt: at,
  });

  await writeAudit({
    tx, session, resourceType: 'deal_repair_attempt', resourceId: created?.id ?? null,
    action: 'opened', after: { faultReported: fault, startedAt: at },
  });

  return { ok: true, message: 'Repair opened — the 30-day right to reject is paused.' };
}
