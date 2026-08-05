/**
 * Deals — the screen where the money and the law meet.
 *
 * Three things here are not negotiable and are worth stating up front:
 *
 * 1. **Every figure is computed server-side, in integer minor units.** The
 *    margin panel, the balance to finance, the VAT position — none of it is
 *    derived in a browser. A browser-computed margin drifts from the server
 *    value, and a dealer who spots that stops trusting the whole screen.
 *
 * 2. **The margin panel is cost data.** A user without `vehicle.cost.read`
 *    does not receive it, and neither do the figures DERIVED from it. The
 *    redaction happens in SQL, so nothing is in the payload to be found.
 *
 * 3. **No cost-of-credit figure is loaded or rendered here.** Rule 5 says a
 *    monthly payment or an APR reaches a screen only through the M8 gate, and
 *    there is no second code path — including an internal one. The deal shows
 *    the amount financed, which is not a cost-of-credit indicator, and links
 *    to the quote for anything that is.
 *
 * The statutory clocks are recomputed on every read from `compliance_rules`
 * keyed on the delivery date. Storing them would be wrong twice over: a repair
 * attempt logged today moves a deadline set weeks ago, and a rule version
 * deployed next year must not silently re-date a deal delivered last year.
 */

import { withSession, toDate, toPence } from './db';
import { consumerRightsRule } from './rules';
import type { Session } from '@/auth/session';
import {
  money, zero, add, subtract, format,
  marginPanel, balanceToFinance, dealClocks, acceptedAddons, isLossMaking,
  assessCompleteness, verifyChain,
  type Deal, type DealAddon, type DealState, type MarginPanel, type DealClocks,
  type ContractFormation, type EvidenceEntry, type EvidenceKind, type Money,
  type CompletenessResult, type VerificationResult, type RepairAttempt, type Currency,
} from '@forecourt/domain';

export interface DealRow {
  id: string;
  reference: string | null;
  state: DealState;
  contractFormation: ContractFormation | null;
  contactName: string;
  vehicleId: string | null;
  registration: string | null;
  vehicleDescription: string | null;
  siteName: string | null;
  totalPrice: Money;
  /** Null when the principal may not see cost, or when nothing is costed. */
  dealGross: Money | null;
  financed: boolean;
  createdAt: Date;
  contractedAt: Date | null;
  deliveredAt: Date | null;
  /** Recomputed, never stored. Null until delivery. */
  clocks: DealClocks | null;
  evidence: CompletenessResult;
}

export interface DealFilters {
  q?: string | undefined;
  state?: string | undefined;
  /** Delivered deals still inside a statutory window. */
  clocksRunningOnly?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface DealsPage {
  rows: DealRow[];
  total: number;
  summary: {
    byState: Record<DealState, number>;
    open: number;
    /** Delivered and still inside the reject window or a cancellation right. */
    clocksRunning: number;
    /** Contracted or later, with a gap in the evidence a lender would ask for. */
    evidenceGaps: number;
    /** Null when the principal may not see cost. */
    grossMonthToDate: Money | null;
    unitsMonthToDate: number;
  };
  queryMs: number;
}

/**
 * The `currency` column is `text`; `Currency` is a union. Narrowed rather than
 * cast, and a value the domain does not know is a THROW rather than a silent
 * fallback to GBP — a deal denominated in something we cannot do arithmetic in
 * is a data problem to be seen, not one to be papered over with the wrong
 * currency symbol on a customer's invoice.
 */
const currencyOf = (v: unknown): Currency => {
  if (v === 'GBP' || v === 'EUR') return v;
  throw new Error(
    `Deal carries an unsupported currency ${JSON.stringify(v)}. ` +
    'Money arithmetic is defined for GBP and EUR only.',
  );
};

const OPEN_STATES: readonly DealState[] = ['building', 'quoted', 'agreed', 'contracted', 'delivered'];

const contactNameOf = (r: Record<string, unknown>): string =>
  [r['first_name'], r['last_name']].filter(Boolean).join(' ')
  || (r['company_name'] as string | null)
  || (r['email'] as string | null)
  || 'No name given';

const addonsFrom = (rows: readonly Record<string, unknown>[], currency: Currency): DealAddon[] =>
  rows.map((a) => ({
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

const dealFrom = (
  r: Record<string, unknown>,
  addons: readonly DealAddon[],
): Deal => {
  const currency = currencyOf(r['currency'] ?? 'GBP');
  return {
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    contactId: String(r['contact_id']),
    vehicleId: r['vehicle_id'] === null ? null : String(r['vehicle_id']),
    state: r['state'] as DealState,
    contractFormation: (r['contract_formation'] as ContractFormation | null) ?? null,
    vehiclePrice: r['vehicle_price_pence'] === null
      ? null : money(toPence(r['vehicle_price_pence'] as string), currency),
    partExchange: money(toPence(r['part_exchange_pence'] as string), currency),
    partExchangeSettlement: money(toPence(r['part_exchange_settlement_pence'] as string), currency),
    deposit: money(toPence(r['deposit_pence'] as string), currency),
    financeAmount: money(toPence(r['finance_amount_pence'] as string), currency),
    addons,
    quotedAt: toDate(r['quoted_at'] as Date | null),
    contractedAt: toDate(r['contracted_at'] as Date | null),
    deliveredAt: toDate(r['delivered_at'] as Date | null),
    cancelledAt: toDate(r['cancelled_at'] as Date | null),
    cancellationReason: (r['cancellation_reason'] as string | null) ?? null,
  };
};

const evidenceFrom = (rows: readonly Record<string, unknown>[]): EvidenceEntry[] =>
  rows.map((e) => ({
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

export async function loadDeals(
  session: Session,
  filters: DealFilters,
  canSeeCost: boolean,
): Promise<DealsPage> {
  const started = Date.now();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const page = await withSession(session, async (tx) => {
    const wState = filters.state ? tx`AND d.state = ${filters.state}::deal_state` : tx``;
    const wClocks = filters.clocksRunningOnly
      ? tx`AND d.delivered_at IS NOT NULL AND d.state <> 'cancelled'`
      : tx``;
    const wSearch = filters.q
      ? tx`AND (
          to_tsvector('english',
            coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') || ' ' ||
            coalesce(c.company_name,'') || ' ' || coalesce(d.reference,''))
            @@ plainto_tsquery('english', ${filters.q})
          OR v.registration ILIKE ${'%' + filters.q.replace(/\s+/g, '') + '%'}
          OR d.reference ILIKE ${'%' + filters.q + '%'}
        )`
      : tx``;

    const rows = await tx`
      SELECT d.*,
             c.first_name, c.last_name, c.company_name, c.email,
             v.registration, v.make, v.model, v.derivative,
             -- Cost is redacted IN SQL. Not hidden in the view: a hidden
             -- field is one view-source away, and the payload must not carry
             -- what the principal may not see.
             ${canSeeCost ? tx`v.total_cost_pence` : tx`NULL::bigint`} AS total_cost_pence,
             s.name AS site_name
      FROM deals d
      JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN sites s ON s.id = d.site_id
      WHERE TRUE ${wState} ${wClocks} ${wSearch}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const [counted] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM deals d
      JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE TRUE ${wState} ${wClocks} ${wSearch}`;

    const ids = rows.map((r) => String(r['id']));
    const [addonRows, evidenceRows, repairRows] = ids.length === 0
      ? [[], [], []]
      : await Promise.all([
        // Latest row per (deal, product) — `deal_addons` is append-only, so a
        // product offered, accepted and then declined has three rows and only
        // the last one is its current position.
        tx`SELECT DISTINCT ON (deal_id, product_code) * FROM deal_addons
           WHERE deal_id = ANY(${ids}::uuid[])
           ORDER BY deal_id, product_code, created_at DESC, id DESC`,
        tx`SELECT deal_id, kind FROM deal_evidence WHERE deal_id = ANY(${ids}::uuid[])`,
        tx`SELECT deal_id, started_at, completed_at FROM deal_repair_attempts
           WHERE deal_id = ANY(${ids}::uuid[])`,
      ]);

    const states = await tx<{ state: DealState; n: number }[]>`
      SELECT state, count(*)::int AS n FROM deals GROUP BY state`;

    // Units and gross this month. Gross needs cost, so it is withheld with it.
    const [mtd] = await tx<{ units: number; gross: string | null }[]>`
      SELECT count(*)::int AS units,
             ${canSeeCost
    ? tx`sum(coalesce(d.vehicle_price_pence, 0) - coalesce(v.total_cost_pence, 0))`
    : tx`NULL::bigint`} AS gross
      FROM deals d LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.state IN ('delivered', 'completed')
        AND d.delivered_at >= date_trunc('month', now())`;

    return { rows, counted, addonRows, evidenceRows, repairRows, states, mtd };
  });

  // Assembled outside the transaction: `consumerRightsRule` reads the platform
  // rules table, and holding a tenant-scoped transaction open across it would
  // widen the window for no reason.
  const byDeal = <T extends { deal_id: unknown }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const key = String(r.deal_id);
      const list = map.get(key);
      if (list) list.push(r); else map.set(key, [r]);
    }
    return map;
  };

  const addonsByDeal = byDeal(page.addonRows as { deal_id: unknown }[]);
  const evidenceByDeal = byDeal(page.evidenceRows as { deal_id: unknown }[]);
  const repairsByDeal = byDeal(page.repairRows as { deal_id: unknown }[]);

  const rows: DealRow[] = [];
  for (const raw of page.rows) {
    const r = raw as Record<string, unknown>;
    const id = String(r['id']);
    const currency = currencyOf(r['currency'] ?? 'GBP');
    const addons = addonsFrom(
      (addonsByDeal.get(id) ?? []) as Record<string, unknown>[], currency);
    const deal = dealFrom(r, addons);

    const financed = deal.financeAmount.amount > 0n;
    const evidenceKinds = (evidenceByDeal.get(id) ?? []) as Record<string, unknown>[];
    // Only the kinds are loaded for the list — the full chain is a detail-page
    // concern, and hashing a hundred chains to render a list would be silly.
    const evidence = assessCompleteness(
      evidenceKinds.map((e) => ({ kind: e['kind'] as EvidenceKind }) as EvidenceEntry),
      { financed },
    );

    let clocks: DealClocks | null = null;
    if (deal.deliveredAt && deal.contractFormation) {
      const rule = await consumerRightsRule(deal.deliveredAt);
      const repairs: RepairAttempt[] = ((repairsByDeal.get(id) ?? []) as Record<string, unknown>[])
        .map((a) => ({
          startedAt: toDate(a['started_at'] as Date) as Date,
          completedAt: toDate(a['completed_at'] as Date | null),
        }));
      clocks = dealClocks(deal, repairs, rule);
    }

    const cost = r['total_cost_pence'];
    const accepted = acceptedAddons(deal);
    const totalPrice = accepted.reduce(
      (acc, a) => add(acc, a.price), deal.vehiclePrice ?? zero(currency));

    // A deal on an uncosted car has no gross — it has a gap. Reporting the
    // whole selling price as profit is a missing figure dressed as the best
    // possible one, the same rule the stock list settled.
    const costed = canSeeCost && cost !== null && toPence(cost as string) > 0n;

    rows.push({
      id,
      reference: (r['reference'] as string | null) ?? null,
      state: deal.state,
      contractFormation: deal.contractFormation,
      contactName: contactNameOf(r),
      vehicleId: deal.vehicleId,
      registration: (r['registration'] as string | null) ?? null,
      vehicleDescription: [r['make'], r['model'], r['derivative']]
        .filter(Boolean).join(' ') || null,
      siteName: (r['site_name'] as string | null) ?? null,
      totalPrice,
      dealGross: costed
        ? subtract(deal.vehiclePrice ?? zero(currency), money(toPence(cost as string), currency))
        : null,
      financed,
      createdAt: toDate(r['created_at'] as Date) as Date,
      contractedAt: deal.contractedAt,
      deliveredAt: deal.deliveredAt,
      clocks,
      evidence,
    });
  }

  const byState = {
    building: 0, quoted: 0, agreed: 0, contracted: 0,
    delivered: 0, completed: 0, cancelled: 0, unwound: 0,
  } as Record<DealState, number>;
  for (const s of page.states) byState[s.state] = s.n;

  const now = new Date();
  const clocksRunning = rows.filter((r) =>
    r.clocks !== null
    && (r.clocks.rejectWindowPaused
      || (r.clocks.rejectWindowEndsAt !== null && r.clocks.rejectWindowEndsAt > now)
      || (r.clocks.cancellationDeadline !== null && r.clocks.cancellationDeadline > now))).length;

  return {
    rows,
    total: page.counted?.n ?? 0,
    summary: {
      byState,
      open: OPEN_STATES.reduce((acc, s) => acc + byState[s], 0),
      clocksRunning,
      evidenceGaps: rows.filter(
        (r) => !r.evidence.complete
          && !['building', 'quoted', 'cancelled'].includes(r.state)).length,
      grossMonthToDate: canSeeCost && page.mtd?.gross != null
        ? money(BigInt(page.mtd.gross), 'GBP')
        : null,
      unitsMonthToDate: page.mtd?.units ?? 0,
    },
    queryMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------- one deal

export interface DealDocument {
  id: string;
  code: string;
  version: number;
  shownAt: Date | null;
  signedAt: Date | null;
  signatureMethod: string | null;
  signerName: string | null;
  contentHash: string;
}

/** A row id alongside the domain shape — the domain's `DealAddon` has no id,
 *  and the accept/decline mutation addresses the ROW, not the product code
 *  (which is not unique across offers of the same product). */
export interface DealAddonRow extends DealAddon {
  id: string;
}

export interface DealDetail {
  deal: Deal;
  addonRows: DealAddonRow[];
  /** Cash price of the accepted add-ons. Not cost data — it is what the
   *  customer pays — so it is shown whatever the role. */
  addonsTotal: Money;
  reference: string | null;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  registration: string | null;
  vehicleDescription: string | null;
  siteName: string | null;
  /** Null unless the principal holds `vehicle.cost.read`. */
  margin: MarginPanel | null;
  balanceToFinance: Money;
  clocks: DealClocks | null;
  /** The rule actually applied, with its source, so a figure is explainable. */
  clocksSource: string | null;
  evidence: EvidenceEntry[];
  completeness: CompletenessResult;
  /** The hash chain, verified on read. A ledger nobody checks is a claim. */
  chain: VerificationResult;
  documents: DealDocument[];
  repairs: { id: string; faultReported: string; startedAt: Date; completedAt: Date | null; outcome: string | null }[];
  /** True when the deal has a finance amount — decides the evidence required. */
  financed: boolean;
  lossMaking: boolean;
}

export async function loadDeal(
  session: Session,
  id: string,
  canSeeCost: boolean,
): Promise<DealDetail | null> {
  const loaded = await withSession(session, async (tx) => {
    const [row] = await tx`
      SELECT d.*,
             c.first_name, c.last_name, c.company_name, c.email, c.phone,
             v.registration, v.make, v.model, v.derivative,
             ${canSeeCost ? tx`v.total_cost_pence` : tx`NULL::bigint`} AS total_cost_pence,
             s.name AS site_name
      FROM deals d
      JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN sites s ON s.id = d.site_id
      WHERE d.id = ${id}::uuid`;

    if (!row) return null;

    const [addons, evidence, documents, repairs] = await Promise.all([
      tx`SELECT DISTINCT ON (product_code) * FROM deal_addons
         WHERE deal_id = ${id}::uuid
         ORDER BY product_code, created_at DESC, id DESC`,
      tx`SELECT * FROM deal_evidence WHERE deal_id = ${id}::uuid ORDER BY sequence`,
      tx`SELECT * FROM deal_documents WHERE deal_id = ${id}::uuid ORDER BY created_at`,
      tx`SELECT * FROM deal_repair_attempts WHERE deal_id = ${id}::uuid ORDER BY started_at`,
    ]);

    return { row, addons, evidence, documents, repairs };
  });

  if (!loaded) return null;

  const r = loaded.row as Record<string, unknown>;
  const currency = currencyOf(r['currency'] ?? 'GBP');
  const addonRaw = loaded.addons as Record<string, unknown>[];
  const addons = addonsFrom(addonRaw, currency);
  const addonRows: DealAddonRow[] = addons.map((a, i) => ({
    ...a, id: String(addonRaw[i]?.['id'] ?? ''),
  }));
  const deal = dealFrom(r, addons);
  const financed = deal.financeAmount.amount > 0n;
  const addonsTotal = acceptedAddons(deal)
    .reduce((acc, a) => add(acc, a.price), zero(currency));

  const chainEntries = evidenceFrom(loaded.evidence as Record<string, unknown>[]);

  let clocks: DealClocks | null = null;
  let clocksSource: string | null = null;
  if (deal.deliveredAt && deal.contractFormation) {
    // Keyed on the DELIVERY date, not on today: a deal delivered in March is
    // governed by the rule in force in March.
    const rule = await consumerRightsRule(deal.deliveredAt);
    clocksSource = rule.sourceUrl;
    clocks = dealClocks(
      deal,
      (loaded.repairs as Record<string, unknown>[]).map((a) => ({
        startedAt: toDate(a['started_at'] as Date) as Date,
        completedAt: toDate(a['completed_at'] as Date | null),
      })),
      rule,
    );
  }

  const cost = r['total_cost_pence'];
  const margin = canSeeCost
    ? marginPanel({
      deal,
      vehicleCost: money(cost === null ? 0n : toPence(cost as string), currency),
    })
    : null;

  return {
    deal,
    addonRows,
    addonsTotal,
    reference: (r['reference'] as string | null) ?? null,
    contactName: contactNameOf(r),
    contactEmail: (r['email'] as string | null) ?? null,
    contactPhone: (r['phone'] as string | null) ?? null,
    registration: (r['registration'] as string | null) ?? null,
    vehicleDescription: [r['make'], r['model'], r['derivative']]
      .filter(Boolean).join(' ') || null,
    siteName: (r['site_name'] as string | null) ?? null,
    margin,
    balanceToFinance: balanceToFinance(deal),
    clocks,
    clocksSource,
    evidence: chainEntries,
    completeness: assessCompleteness(chainEntries, { financed }),
    // Verified on every read. An append-only promise is about our own code;
    // the chain is a property of the data that survives a restore, a migration
    // and an export to a third party — but only if somebody actually checks it.
    chain: verifyChain(chainEntries),
    documents: (loaded.documents as Record<string, unknown>[]).map((d) => ({
      id: String(d['id']),
      code: String(d['code']),
      version: Number(d['version']),
      shownAt: toDate(d['shown_at'] as Date | null),
      signedAt: toDate(d['signed_at'] as Date | null),
      signatureMethod: (d['signature_method'] as string | null) ?? null,
      signerName: (d['signer_name'] as string | null) ?? null,
      contentHash: String(d['content_hash']),
    })),
    repairs: (loaded.repairs as Record<string, unknown>[]).map((a) => ({
      id: String(a['id']),
      faultReported: String(a['fault_reported']),
      startedAt: toDate(a['started_at'] as Date) as Date,
      completedAt: toDate(a['completed_at'] as Date | null),
      outcome: (a['outcome'] as string | null) ?? null,
    })),
    financed,
    lossMaking: margin !== null && isLossMaking(margin),
  };
}

export { format };
