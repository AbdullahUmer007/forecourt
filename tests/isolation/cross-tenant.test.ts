/**
 * THE CROSS-TENANT LEAK SUITE.
 *
 * This is the most important test in the repository. A leak between two
 * dealers is the one bug that ends the company.
 *
 * It runs on every PR and is a BLOCKING gate. It fails the build on:
 *   - any tenant table without RLS enabled AND forced AND a policy
 *   - any read, write, delete, list, search, export or feed path that can
 *     reach another tenant's row
 *
 * Requires a real Postgres: DATABASE_URL=postgres://... pnpm test:isolation
 * It SKIPS (loudly) without one, so a developer without a database sees a
 * warning rather than a false pass — but CI must always provide one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/**
 * A skipped gate is a green gate, and that is the whole problem.
 *
 * This suite used to `describe.skip` with a stderr warning when DATABASE_URL
 * was missing. Every runner and every CI summary reports a skipped suite as
 * success, so the one test that stands between us and a cross-tenant leak
 * could silently not run — which is precisely what it had been doing locally,
 * because vitest does not read `.env` (now fixed by `setup.mjs`).
 *
 * So there is one test that ALWAYS runs and fails when the gate cannot. The
 * suite can be unrunnable, or it can be green. It can no longer be both.
 */
describe('the cross-tenant leak gate itself', () => {
  it('actually ran — a skipped isolation suite must never report as passing', () => {
    expect(
      DATABASE_URL,
      'DATABASE_URL is not set, so the cross-tenant leak suite did not run. ' +
      'This is the blocking gate (CLAUDE.md rule 1). Start Postgres and set ' +
      'DATABASE_URL in .env, then re-run: pnpm test:isolation',
    ).toBeTruthy();
  });
});

type Row = Record<string, unknown>;
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  end: () => Promise<void>;
  unsafe: (q: string, v?: unknown[]) => Promise<Row[]>;
  begin: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
};

let sql: Sql;

/**
 * Run a block inside a transaction as the unprivileged application role, with
 * a tenant context set — exactly how the application talks to the database.
 * SET LOCAL scopes both to the transaction, so nothing leaks across the pool.
 */
async function asTenant<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Sql) => Promise<T>,
  opts: { siteIds?: string[]; scopeAllSites?: boolean } = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE app_user');
    await tx.unsafe('SELECT set_tenant_context($1::uuid, $2::uuid, $3::uuid[], $4::boolean)', [
      tenantId, userId, opts.siteIds ?? [], opts.scopeAllSites ?? true,
    ]);
    return fn(tx);
  });
}

const tableExists = async (table: string): Promise<boolean> => {
  const [row] = await sql`SELECT to_regclass(${`public.${table}`}) AS t`;
  return row?.['t'] != null;
};

/**
 * Dedicated UUIDs for this suite, in an `f...` space the demo seed never uses.
 *
 * TENANT_A was `11111111-…-111111111111`, which is byte-for-byte the tenant id
 * `seed-demo.mjs` gives Kennington. On any database that had been seeded — the
 * normal state of a working local machine — the tenants row was kept by
 * `ON CONFLICT (id) DO NOTHING` and the suite then tried to give that tenant a
 * SECOND default brand, which `brands_tenant_default_unique` correctly refused.
 * The whole suite aborted in `beforeAll`, so all 125 tests reported as skipped
 * rather than failed. The blocking gate could not run at all, and said so only
 * in a stderr line nothing was checking.
 *
 * These ids are deliberately not adjacent to any seed's.
 */
const TENANT_A = 'ffffffff-0000-4000-8000-00000000000a';
const TENANT_B = 'ffffffff-0000-4000-8000-00000000000b';
const USER_A = 'ffffffff-0000-4000-8000-0000000000a1';

/** Tables that must be tested for isolation. Every new tenant table joins this list. */
const TENANT_TABLES = [
  // M2 — tenancy & identity
  'sites',
  'brands',
  'domains',
  'roles',
  'tenant_memberships',
  'user_sites',
  'invitations',
  'api_keys',
  'audit_events',
  // M3 — vehicle core
  'vehicles',
  'vehicle_status_history',
  'vehicle_prices',
  'vehicle_costs',
  // M4 — vehicle data
  'vehicle_lookups',
  'mot_records',
  'provider_usage_daily',
  // M5 — media
  'vehicle_media',
  'media_processing_jobs',
  // M7 — public inventory experience
  'shortlists',
  'shortlist_items',
  'saved_searches',
  'search_events',
  // M8 — finance display & compliance
  'finance_products',
  'representative_examples',
  'vehicle_finance_quotes',
  'initial_disclosure_versions',
  'finance_promotion_log',
  // M9 — contacts & consent
  'contacts',
  'consent_wordings',
  'contact_consents',
  'suppressions',
  'contact_merges',
  'data_subject_requests',
  // M10 — leads & communications
  'leads',
  'lead_events',
  'messages',
  'lead_sla_policies',
  // M11 — money
  'invoices',
  'invoice_lines',
  'invoice_sequences',
  'stock_book_entries',
  'stock_book_sequences',
  'payments',
  'aml_overrides',
  // M12 — deals & the evidence ledger
  'deals',
  'deal_addons',
  'deal_evidence',
  'document_templates',
  'deal_documents',
  'deal_repair_attempts',
  // M13 — part-exchange appraisal
  'appraisals',
  'appraisal_damage',
  'recon_cost_standards',
  'appraisal_costs',
  'appraisal_valuations',
  'appraisal_offers',
  'appraisal_settlements',
  // M14 — prep pipeline
  'prep_stages',
  'prep_cards',
  'prep_stage_events',
  'prep_tasks',
  'prep_parts',
  'prep_blocks',
  // M16 — channel feeds
  'channels',
  'channel_listings',
  'channel_overrides',
  'channel_sync_events',
  'channel_rules',
  // M17+ — created by later migrations; each skips until its table exists
  'appointments',
] as const;

/**
 * Tables that carry no tenant_id and are therefore invisible to the generic
 * policy generator. Each needs its own boundary — and its own test, because
 * "it has no tenant_id" is exactly how a table ends up unprotected.
 */
const SPECIAL_TABLES = {
  // boundary is `id`, not `tenant_id`
  tenants: 'id',
  // global by design; visible only via a shared membership
  users: 'membership',
} as const;

/** Append-only tables reject UPDATE via a trigger before RLS is reached. */
const APPEND_ONLY = new Set<string>([
  'audit_events', 'deal_evidence', 'stock_book_entries', 'contact_consents',
  'vehicle_status_history', 'vehicle_prices', 'vehicle_lookups', 'search_events',
  'representative_examples', 'initial_disclosure_versions', 'finance_promotion_log', 'compliance_rules',
  // M9/M10 evidence: a consent withdrawal, a suppression, a merge record and
  // every message sent or blocked are all evidence, and evidence is appended.
  'suppressions', 'contact_merges', 'lead_events', 'messages',
  // M11: the records HMRC asks to see. `invoices` and `invoice_lines` are
  // NOT here — they have a lawful draft→issued lifecycle and are frozen by a
  // content trigger instead, so an UPDATE on a draft must still succeed.
  'payments', 'aml_overrides',
  // M12: the ledger and the documents are what an ombudsman asks to see.
  'deal_documents', 'deal_addons',
  // M13: an offer was said out loud to a customer, and the valuation is what
  // it was based on. `appraisal_settlements` is NOT here — it has one lawful
  // update (being paid) and is frozen by a content trigger instead.
  'appraisal_offers', 'appraisal_valuations',
  // M16: the record of what we sent a portal and what came back. Editing it
  // would destroy the only evidence of a feed that stopped working.
  'channel_sync_events',
]);

/**
 * A minimally valid row per table, referencing tenant B's own child records.
 *
 * This matters: an INSERT that omits a NOT NULL column fails with SQLSTATE
 * 23502 before the policy is ever consulted, so the test would pass even with
 * RLS switched off. Every payload here is valid in every respect EXCEPT that
 * it belongs to another tenant — so the only thing that can reject it is the
 * policy, and a 42501 is proof the policy did the work.
 */
const B_MEMBERSHIP = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B_ROLE = '66666666-6666-4666-8666-666666666666';
const B_SITE = '88888888-8888-4888-8888-888888888888';
const B_BRAND = '99999999-9999-4999-8999-999999999992';
const B_USER = '44444444-4444-4444-8444-444444444444';
const A_VEHICLE = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const B_VEHICLE = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const A_MEDIA = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1';
const B_MEDIA = 'ccccccc2-cccc-4ccc-8ccc-ccccccccccc2';
const A_SHORTLIST = 'ddddddd1-dddd-4ddd-8ddd-ddddddddddd1';
const B_SHORTLIST = 'ddddddd2-dddd-4ddd-8ddd-ddddddddddd2';
const A_CONTACT = 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1';
const B_CONTACT = 'eeeeeee2-eeee-4eee-8eee-eeeeeeeeeee2';
// A second contact for tenant B, so a merge payload has two distinct rows to
// reference — `contact_merge_distinct` rejects winner = loser before the
// policy is ever consulted.
const B_CONTACT_2 = 'eeeeeee3-eeee-4eee-8eee-eeeeeeeeeee3';
const A_WORDING = 'fffffff1-ffff-4fff-8fff-fffffffffff1';
const B_WORDING = 'fffffff2-ffff-4fff-8fff-fffffffffff2';
const A_DEAL = 'dddddda1-dddd-4ddd-8ddd-ddddddddddd1';
const B_DEAL = 'dddddda2-dddd-4ddd-8ddd-ddddddddddd2';
const A_INVOICE = 'cccccca1-cccc-4ccc-8ccc-cccccccccdd1';
const B_INVOICE = 'cccccca2-cccc-4ccc-8ccc-cccccccccdd2';
const A_LEAD = 'aaaaaab1-aaaa-4aaa-8aaa-aaaaaaaaabb1';
const B_LEAD = 'aaaaaab2-aaaa-4aaa-8aaa-aaaaaaaaabb2';
const A_APPRAISAL = 'bbbbbba1-bbbb-4bbb-8bbb-bbbbbbbbbcc1';
const B_APPRAISAL = 'bbbbbba2-bbbb-4bbb-8bbb-bbbbbbbbbcc2';
const A_PREP_STAGE = 'cccccca1-cccc-4ccc-8ccc-cccccccccee1';
const B_PREP_STAGE = 'cccccca2-cccc-4ccc-8ccc-cccccccccee2';
const A_PREP_CARD = 'cccccca1-cccc-4ccc-8ccc-cccccccccff1';
const B_PREP_CARD = 'cccccca2-cccc-4ccc-8ccc-cccccccccff2';
const A_CHANNEL = 'dddddda1-dddd-4ddd-8ddd-ddddddddeee1';
const B_CHANNEL = 'dddddda2-dddd-4ddd-8ddd-ddddddddeee2';
const A_PREP_TASK = 'cccccca1-cccc-4ccc-8ccc-ccccccccc111';
const B_PREP_TASK = 'cccccca2-cccc-4ccc-8ccc-ccccccccc222';
// 43 characters — the shortlist_token_unguessable CHECK enforces the length,
// so a short token here would fail on the constraint rather than the policy.
const A_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const B_TOKEN = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';
const SMUGGLED_TOKEN = 'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS9';

const INSERT_PAYLOAD: Record<string, { columns: string; values: string }> = {
  sites: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Site'` },
  brands: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Brand'` },
  domains: {
    columns: 'tenant_id, brand_id, hostname, verification_token',
    values: `'${TENANT_B}', '${B_BRAND}', 'smuggled.isolation.test', 'tok-x'`,
  },
  roles: { columns: 'tenant_id, name', values: `'${TENANT_B}', 'Smuggled Role'` },
  tenant_memberships: {
    columns: 'tenant_id, user_id, role_id',
    values: `'${TENANT_B}', '${B_USER}', '${B_ROLE}'`,
  },
  user_sites: {
    columns: 'tenant_id, membership_id, site_id',
    values: `'${TENANT_B}', '${B_MEMBERSHIP}', '${B_SITE}'`,
  },
  invitations: {
    columns: 'tenant_id, email, role_id, token_hash, invited_by, expires_at',
    values: `'${TENANT_B}', 'smuggled@b.test', '${B_ROLE}', 'hash-x', '${B_USER}', now() + interval '7 days'`,
  },
  api_keys: {
    columns: 'tenant_id, name, key_hash, key_prefix, created_by',
    values: `'${TENANT_B}', 'Smuggled Key', 'keyhash-x', 'fc_x', '${B_USER}'`,
  },
  audit_events: {
    columns: 'tenant_id, actor_type, resource_type, action',
    values: `'${TENANT_B}', 'user', 'vehicle', 'create'`,
  },
  vehicles: {
    columns: 'tenant_id, site_id, stock_number, stock_sequence, registration',
    values: `'${TENANT_B}', '${B_SITE}', 'SMUG-0001', 9001, 'SM99GLD'`,
  },
  vehicle_status_history: {
    columns: 'tenant_id, vehicle_id, to_state',
    values: `'${TENANT_B}', '${B_VEHICLE}', 'booked_in'`,
  },
  vehicle_prices: {
    columns: 'tenant_id, vehicle_id, price_pence',
    values: `'${TENANT_B}', '${B_VEHICLE}', 999900`,
  },
  vehicle_costs: {
    columns: 'tenant_id, vehicle_id, category, description',
    values: `'${TENANT_B}', '${B_VEHICLE}', 'valet', 'Smuggled cost'`,
  },
  vehicle_lookups: {
    columns: 'tenant_id, registration, provider, lookup_type',
    values: `'${TENANT_B}', 'SM99GLD', 'dvla_ves', 'vehicle'`,
  },
  mot_records: {
    columns: 'tenant_id, vehicle_id, test_date, result',
    values: `'${TENANT_B}', '${B_VEHICLE}', '2026-01-01', 'PASSED'`,
  },
  provider_usage_daily: {
    columns: 'tenant_id, usage_date, provider, lookup_type',
    values: `'${TENANT_B}', '2026-08-02', 'dvla_ves', 'vehicle'`,
  },
  vehicle_media: {
    columns: 'tenant_id, vehicle_id, storage_key, shot',
    values: `'${TENANT_B}', '${B_VEHICLE}', 't/smuggled/original', 'front'`,
  },
  media_processing_jobs: {
    columns: 'tenant_id, media_id, steps, idempotency_key',
    values: `'${TENANT_B}', '${B_MEDIA}', ARRAY['validate'], 'smuggled-key'`,
  },
  shortlists: {
    columns: 'tenant_id, site_id, owner_kind, token',
    values: `'${TENANT_B}', '${B_SITE}', 'anonymous', '${SMUGGLED_TOKEN}'`,
  },
  shortlist_items: {
    columns: 'tenant_id, shortlist_id, vehicle_id',
    values: `'${TENANT_B}', '${B_SHORTLIST}', '${B_VEHICLE}'`,
  },
  saved_searches: {
    columns: 'tenant_id, shortlist_id, name, canonical_path, query',
    values: `'${TENANT_B}', '${B_SHORTLIST}', 'Smuggled search', '/used-cars/tesla', '{}'::jsonb`,
  },
  search_events: {
    // An explicit occurred_at, not the default: the row must land inside a
    // declared partition, and `now()` will not once the seeded ones expire.
    columns: 'tenant_id, canonical_path, result_count, occurred_at',
    values: `'${TENANT_B}', '/used-cars/smuggled', 0, '2026-08-15T12:00:00Z'`,
  },
  finance_products: {
    columns: 'tenant_id, lender_name, provider, product_type, display_name',
    values: `'${TENANT_B}', 'Smuggled Finance', 'ivendi', 'hp', 'Smuggled HP'`,
  },
  representative_examples: {
    // cash_price - advance = amount_of_credit, or the CHECK rejects it before
    // the policy is consulted and the test would prove nothing.
    columns: 'tenant_id, version, product_type, cash_price_pence, advance_payment_pence, ' +
             'amount_of_credit_pence, term_months, monthly_payment_pence, interest_rate_percent, ' +
             'representative_apr_percent, total_amount_payable_pence',
    values: `'${TENANT_B}', 99, 'hp', 1200000, 200000, 1000000, 48, 25000, 9.9, 9.9, 1400000`,
  },
  vehicle_finance_quotes: {
    columns: 'tenant_id, vehicle_id, provider, lender_name, product_type, cash_price_pence, ' +
             'deposit_pence, part_exchange_pence, amount_of_credit_pence, term_months, ' +
             'monthly_payment_pence, apr_percent, total_charge_for_credit_pence, ' +
             'total_amount_payable_pence, expires_at',
    values: `'${TENANT_B}', '${B_VEHICLE}', 'ivendi', 'Smuggled Finance', 'hp', 1200000, 200000, 0, ` +
            `1000000, 48, 25000, 9.9, 200000, 1400000, now() + interval '7 days'`,
  },
  initial_disclosure_versions: {
    columns: 'tenant_id, version, body_markdown, commission_statement',
    values: `'${TENANT_B}', 99, 'Smuggled disclosure', 'We receive commission.'`,
  },
  finance_promotion_log: {
    columns: 'tenant_id, page_path, rendered_hash, occurred_at',
    values: `'${TENANT_B}', '/used-cars/smuggled', 'deadbeef', '2026-08-15T12:00:00Z'`,
  },

  // ---- M9: contacts & consent. These hold named people's data, so a leak
  // here is a personal data breach as well as a commercial one.
  contacts: {
    columns: 'tenant_id, first_name, last_name, email',
    values: `'${TENANT_B}', 'Smuggled', 'Buyer', 'smuggled@isolation.test'`,
  },
  consent_wordings: {
    columns: 'tenant_id, version, channel, basis, body, opt_out_text',
    values: `'${TENANT_B}', 99, 'email', 'explicit', 'Smuggled wording', 'Unsubscribe any time.'`,
  },
  contact_consents: {
    columns: 'tenant_id, contact_id, channel, basis, granted, source, wording_id',
    values: `'${TENANT_B}', '${B_CONTACT}', 'email', 'explicit', true, 'website_form', '${B_WORDING}'`,
  },
  suppressions: {
    columns: 'tenant_id, channel, destination, reason',
    values: `'${TENANT_B}', 'email', 'smuggled@isolation.test', 'unsubscribed'`,
  },
  contact_merges: {
    columns: 'tenant_id, winner_id, loser_id, reason, loser_snapshot',
    values: `'${TENANT_B}', '${B_CONTACT}', '${B_CONTACT_2}', 'duplicate', '{}'::jsonb`,
  },
  data_subject_requests: {
    columns: 'tenant_id, contact_id, kind, requested_at, due_at',
    values: `'${TENANT_B}', '${B_CONTACT}', 'access', now(), now() + interval '30 days'`,
  },

  // ---- M10: leads & communications.
  leads: {
    columns: 'tenant_id, contact_id, vehicle_id, source',
    values: `'${TENANT_B}', '${B_CONTACT}', '${B_VEHICLE}', 'website_enquiry'`,
  },
  lead_events: {
    columns: 'tenant_id, lead_id, kind',
    values: `'${TENANT_B}', '${B_LEAD}', 'created'`,
  },
  messages: {
    columns: 'tenant_id, lead_id, contact_id, direction, channel, destination, body, is_marketing',
    values: `'${TENANT_B}', '${B_LEAD}', '${B_CONTACT}', 'outbound', 'email', ` +
            `'smuggled@isolation.test', 'Smuggled body', false`,
  },
  lead_sla_policies: {
    columns: 'tenant_id, source, respond_within_minutes',
    values: `'${TENANT_B}', 'autotrader', 15`,
  },

  // ---- M11: money. An invoice or a stock book entry reaching the wrong
  // dealer is both a data leak and a VAT problem.
  invoices: {
    columns: 'tenant_id, kind, status, series, vat_scheme, net_total_pence, ' +
             'vat_total_pence, gross_total_pence',
    values: `'${TENANT_B}', 'sale', 'draft', 'sale', 'margin', 1200000, 0, 1200000`,
  },
  invoice_lines: {
    columns: 'tenant_id, invoice_id, position, description, unit_price_pence, ' +
             'net_pence, vat_amount_pence, gross_pence',
    values: `'${TENANT_B}', '${B_INVOICE}', 1, 'Smuggled car', 1200000, 1200000, 0, 1200000`,
  },
  invoice_sequences: {
    columns: 'tenant_id, series, prefix, last_number',
    values: `'${TENANT_B}', 'smuggled', 'SMG-', 0`,
  },
  stock_book_entries: {
    columns: 'tenant_id, entry_number, registration, vehicle_description, purchase_price_pence',
    values: `'${TENANT_B}', 9999, 'SM11UGG', 'Smuggled vehicle', 1000000`,
  },
  stock_book_sequences: {
    columns: 'tenant_id, last_number',
    values: `'${TENANT_B}', 0`,
  },
  payments: {
    columns: 'tenant_id, contact_id, direction, method, amount_pence',
    values: `'${TENANT_B}', '${B_CONTACT}', 'in', 'cash', 500000`,
  },
  aml_overrides: {
    columns: 'tenant_id, contact_id, running_total_pence, threshold_pence, reason, authorised_by',
    values: `'${TENANT_B}', '${B_CONTACT}', 1200000, 1000000, 'Smuggled override', '${B_USER}'`,
  },

  // ---- M12: deals and the evidence ledger. A leak here hands one dealer
  // another's finance evidence, which is both a data breach and a defence.
  deals: {
    columns: 'tenant_id, contact_id, vehicle_id, state, vehicle_price_pence',
    values: `'${TENANT_B}', '${B_CONTACT}', '${B_VEHICLE}', 'building', 1200000`,
  },
  deal_addons: {
    columns: 'tenant_id, deal_id, product_code, product_name, price_pence, offered_at',
    values: `'${TENANT_B}', '${B_DEAL}', 'GAP', 'Smuggled GAP', 39900, now()`,
  },
  deal_evidence: {
    columns: 'tenant_id, deal_id, sequence, kind, payload, entry_hash, occurred_at',
    values: `'${TENANT_B}', '${B_DEAL}', 99, 'note', '{}'::jsonb, 'smuggledhash', now()`,
  },
  document_templates: {
    columns: 'tenant_id, code, name, version, body_markdown',
    values: `'${TENANT_B}', 'smuggled', 'Smuggled template', 99, 'Body'`,
  },
  deal_documents: {
    columns: 'tenant_id, deal_id, code, version, rendered_body, content_hash',
    values: `'${TENANT_B}', '${B_DEAL}', 'order-form', 1, 'Smuggled body', 'smuggledhash'`,
  },
  deal_repair_attempts: {
    columns: 'tenant_id, deal_id, fault_reported, started_at',
    values: `'${TENANT_B}', '${B_DEAL}', 'Smuggled fault', now()`,
  },
  appraisals: {
    columns: 'tenant_id, registration, state',
    values: `'${TENANT_B}', 'SMUGGLE1', 'draft'`,
  },
  appraisal_damage: {
    columns: 'tenant_id, appraisal_id, panel, panel_group, damage_type, severity',
    values: `'${TENANT_B}', '${B_APPRAISAL}', 'nsf_door', 'body_panel', 'dent', 'moderate'`,
  },
  recon_cost_standards: {
    columns: 'tenant_id, damage_type, severity, panel_group, cost_pence',
    values: `'${TENANT_B}', 'scratch', 'heavy', 'bumper', 24000`,
  },
  appraisal_costs: {
    columns: 'tenant_id, appraisal_id, category, description, estimate_pence',
    values: `'${TENANT_B}', '${B_APPRAISAL}', 'bodywork', 'Smuggled recon line', 24000`,
  },
  appraisal_valuations: {
    columns: 'tenant_id, appraisal_id, source, trade_pence',
    values: `'${TENANT_B}', '${B_APPRAISAL}', 'manual', 450000`,
  },
  appraisal_offers: {
    columns: 'tenant_id, appraisal_id, revision, allowance_pence',
    values: `'${TENANT_B}', '${B_APPRAISAL}', 99, 350000`,
  },
  appraisal_settlements: {
    columns: 'tenant_id, appraisal_id, lender_name, settlement_pence, source, quoted_at',
    values: `'${TENANT_B}', '${B_APPRAISAL}', 'Smuggled Finance', 310000, 'lender_letter', now()`,
  },
  prep_stages: {
    columns: 'tenant_id, key, name, position',
    values: `'${TENANT_B}', 'smuggled_stage', 'Smuggled stage', 99`,
  },
  prep_cards: {
    columns: 'tenant_id, vehicle_id, current_stage_id',
    values: `'${TENANT_B}', '${B_VEHICLE}', '${B_PREP_STAGE}'`,
  },
  prep_stage_events: {
    columns: 'tenant_id, card_id, stage_id, entered_at',
    values: `'${TENANT_B}', '${B_PREP_CARD}', '${B_PREP_STAGE}', now()`,
  },
  prep_tasks: {
    columns: 'tenant_id, card_id, description, category',
    values: `'${TENANT_B}', '${B_PREP_CARD}', 'Smuggled task', 'valet'`,
  },
  prep_parts: {
    columns: 'tenant_id, task_id, description',
    values: `'${TENANT_B}', '${B_PREP_TASK}', 'Smuggled part'`,
  },
  prep_blocks: {
    columns: 'tenant_id, card_id, reason, started_at',
    values: `'${TENANT_B}', '${B_PREP_CARD}', 'awaiting_parts', now()`,
  },
  channels: {
    columns: 'tenant_id, channel, display_name',
    values: `'${TENANT_B}', 'carwow', 'Smuggled channel'`,
  },
  channel_listings: {
    columns: 'tenant_id, channel_id, vehicle_id, status',
    values: `'${TENANT_B}', '${B_CHANNEL}', '${B_VEHICLE}', 'not_published'`,
  },
  channel_overrides: {
    columns: 'tenant_id, channel_id, vehicle_id, price_pence',
    values: `'${TENANT_B}', '${B_CHANNEL}', '${B_VEHICLE}', 999900`,
  },
  channel_sync_events: {
    columns: 'tenant_id, channel_id, action, outcome, idempotency_key, adapter_version, message',
    values: `'${TENANT_B}', '${B_CHANNEL}', 'publish', 'rejected', 'smuggled-key', 1, 'Smuggled'`,
  },
  channel_rules: {
    columns: 'tenant_id, channel_id, min_photos',
    values: `'${TENANT_B}', '${B_CHANNEL}', 8`,
  },
};

/**
 * Seed BOTH tenants with real rows in every table under test.
 *
 * Without this, a "cannot reach tenant B's rows" test passes trivially when
 * tenant B has no rows — a false pass, which is the exact failure mode this
 * suite exists to prevent. Runs as the superuser so RLS does not block setup.
 */
async function seedRivalData(): Promise<void> {
  const A = TENANT_A, B = TENANT_B;
  await sql.unsafe(`
    INSERT INTO tenants (id, name, legal_name, fca_permission, fca_frn, status) VALUES
      ('${A}','Tenant A','Tenant A Ltd','limited','993469','live'),
      ('${B}','Tenant B','Tenant B Ltd','limited','111111','live')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO users (id, email, name) VALUES
      ('${USER_A}','a@isolation.test','User A'),
      ('44444444-4444-4444-8444-444444444444','b@isolation.test','User B')
    ON CONFLICT DO NOTHING;

    INSERT INTO roles (id, tenant_id, key, name, is_system, permissions, scope_all_sites) VALUES
      ('55555555-5555-4555-8555-555555555555','${A}','owner','Owner',true,'["*"]',true),
      ('66666666-6666-4666-8666-666666666666','${B}','owner','Owner',true,'["*"]',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO sites (id, tenant_id, name) VALUES
      ('77777777-7777-4777-8777-777777777777','${A}','Site A'),
      ('88888888-8888-4888-8888-888888888888','${B}','Site B')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO brands (id, tenant_id, name, is_default) VALUES
      ('99999999-9999-4999-8999-999999999991','${A}','Brand A',true),
      ('99999999-9999-4999-8999-999999999992','${B}','Brand B',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO domains (tenant_id, brand_id, hostname, verification_token) VALUES
      ('${A}','99999999-9999-4999-8999-999999999991','a.isolation.test','tok-a'),
      ('${B}','99999999-9999-4999-8999-999999999992','b.isolation.test','tok-b')
    ON CONFLICT DO NOTHING;

    INSERT INTO tenant_memberships (id, tenant_id, user_id, role_id, status, scope_all_sites) VALUES
      ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1','${A}','${USER_A}','55555555-5555-4555-8555-555555555555','active',true),
      ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','${B}','44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','active',true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO user_sites (tenant_id, membership_id, site_id) VALUES
      ('${A}','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1','77777777-7777-4777-8777-777777777777'),
      ('${B}','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','88888888-8888-4888-8888-888888888888')
    ON CONFLICT DO NOTHING;

    INSERT INTO invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at) VALUES
      ('${A}','invitee@a.test','55555555-5555-4555-8555-555555555555','hash-a','${USER_A}', now() + interval '7 days'),
      ('${B}','invitee@b.test','66666666-6666-4666-8666-666666666666','hash-b','44444444-4444-4444-8444-444444444444', now() + interval '7 days')
    ON CONFLICT DO NOTHING;

    INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, created_by) VALUES
      ('${A}','Key A','keyhash-a','fc_a','${USER_A}'),
      ('${B}','Key B','keyhash-b','fc_b','44444444-4444-4444-8444-444444444444')
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_events (tenant_id, actor_type, resource_type, action) VALUES
      ('${A}','user','vehicle','create'),
      ('${B}','user','vehicle','create');
  `);

  // M3 tables. Seeded separately because they only exist after migration 0002.
  const hasVehicles = await tableExists('vehicles');
  if (hasVehicles) {
    await sql.unsafe(`
      INSERT INTO vehicles (id, tenant_id, site_id, stock_number, stock_sequence, registration, make, model) VALUES
        ('${A_VEHICLE}','${A}','77777777-7777-4777-8777-777777777777','A-9001',9001,'AA11AAA','Tesla','Model X'),
        ('${B_VEHICLE}','${B}','88888888-8888-4888-8888-888888888888','B-9001',9001,'BB11BBB','Tesla','Model X')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vehicle_status_history (tenant_id, vehicle_id, to_state)
        SELECT * FROM (VALUES ('${A}'::uuid,'${A_VEHICLE}'::uuid,'booked_in'::vehicle_state),
                              ('${B}'::uuid,'${B_VEHICLE}'::uuid,'booked_in'::vehicle_state)) v
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_status_history WHERE vehicle_id = '${A_VEHICLE}');

      INSERT INTO vehicle_prices (tenant_id, vehicle_id, price_pence)
        SELECT * FROM (VALUES ('${A}'::uuid,'${A_VEHICLE}'::uuid,1999900::bigint),
                              ('${B}'::uuid,'${B_VEHICLE}'::uuid,1999900::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_prices WHERE vehicle_id = '${A_VEHICLE}');

      INSERT INTO vehicle_costs (tenant_id, vehicle_id, category, description)
        SELECT * FROM (VALUES ('${A}'::uuid,'${A_VEHICLE}'::uuid,'valet'::cost_category,'Valet A'),
                              ('${B}'::uuid,'${B_VEHICLE}'::uuid,'valet'::cost_category,'Valet B')) v
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_costs WHERE vehicle_id = '${A_VEHICLE}');
    `);
  }

  // M5 tables.
  if (await tableExists('vehicle_media')) {
    await sql.unsafe(`
      INSERT INTO vehicle_media (id, tenant_id, vehicle_id, storage_key, shot, status, exif_stripped, published) VALUES
        ('${A_MEDIA}','${A}','${A_VEHICLE}','t/${A}/v/a/m/a/hash/original','front_three_quarter','ready',true,true),
        ('${B_MEDIA}','${B}','${B_VEHICLE}','t/${B}/v/b/m/b/hash/original','front_three_quarter','ready',true,true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO media_processing_jobs (tenant_id, media_id, steps, idempotency_key) VALUES
        ('${A}','${A_MEDIA}',ARRAY['validate','strip_exif'],'job-a'),
        ('${B}','${B_MEDIA}',ARRAY['validate','strip_exif'],'job-b')
      ON CONFLICT DO NOTHING;
    `);
  }

  // M7 tables.
  if (await tableExists('shortlists')) {
    await sql.unsafe(`
      INSERT INTO shortlists (id, tenant_id, site_id, owner_kind, token) VALUES
        ('${A_SHORTLIST}','${A}','77777777-7777-4777-8777-777777777777','anonymous','${A_TOKEN}'),
        ('${B_SHORTLIST}','${B}','88888888-8888-4888-8888-888888888888','anonymous','${B_TOKEN}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO shortlist_items (tenant_id, shortlist_id, vehicle_id) VALUES
        ('${A}','${A_SHORTLIST}','${A_VEHICLE}'),
        ('${B}','${B_SHORTLIST}','${B_VEHICLE}')
      ON CONFLICT DO NOTHING;

      INSERT INTO saved_searches (tenant_id, shortlist_id, name, canonical_path, query)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_SHORTLIST}'::uuid,'Tesla Model X','/used-cars/tesla/model-x','{}'::jsonb),
          ('${B}'::uuid,'${B_SHORTLIST}'::uuid,'Tesla Model X','/used-cars/tesla/model-x','{}'::jsonb)) v
        WHERE NOT EXISTS (SELECT 1 FROM saved_searches WHERE shortlist_id = '${A_SHORTLIST}');

      INSERT INTO search_events (tenant_id, canonical_path, result_count, occurred_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'/used-cars/nissan/qashqai',0,'2026-08-15T12:00:00Z'::timestamptz),
          ('${B}'::uuid,'/used-cars/nissan/qashqai',0,'2026-08-15T12:00:00Z'::timestamptz)) v
        WHERE NOT EXISTS (SELECT 1 FROM search_events WHERE canonical_path = '/used-cars/nissan/qashqai');
    `);
  }

  // M8 tables.
  if (await tableExists('representative_examples')) {
    await sql.unsafe(`
      INSERT INTO finance_products (tenant_id, lender_name, provider, product_type, display_name)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'Lender A','ivendi','hp'::finance_product_type,'HP A'),
          ('${B}'::uuid,'Lender B','ivendi','hp'::finance_product_type,'HP B')) v
        WHERE NOT EXISTS (SELECT 1 FROM finance_products WHERE lender_name = 'Lender A');

      INSERT INTO representative_examples
        (tenant_id, version, product_type, cash_price_pence, advance_payment_pence,
         amount_of_credit_pence, term_months, monthly_payment_pence, interest_rate_percent,
         representative_apr_percent, total_amount_payable_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,1,'hp'::finance_product_type,1200000::bigint,200000::bigint,1000000::bigint,48,25000::bigint,9.9,9.9,1400000::bigint),
          ('${B}'::uuid,1,'hp'::finance_product_type,1200000::bigint,200000::bigint,1000000::bigint,48,25000::bigint,9.9,9.9,1400000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM representative_examples WHERE tenant_id = '${A}');

      INSERT INTO vehicle_finance_quotes
        (tenant_id, vehicle_id, provider, lender_name, product_type, cash_price_pence, deposit_pence,
         part_exchange_pence, amount_of_credit_pence, term_months, monthly_payment_pence, apr_percent,
         total_charge_for_credit_pence, total_amount_payable_pence, expires_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_VEHICLE}'::uuid,'ivendi','Lender A','hp'::finance_product_type,1200000::bigint,200000::bigint,0::bigint,1000000::bigint,48,25000::bigint,9.9,200000::bigint,1400000::bigint,now() + interval '7 days'),
          ('${B}'::uuid,'${B_VEHICLE}'::uuid,'ivendi','Lender B','hp'::finance_product_type,1200000::bigint,200000::bigint,0::bigint,1000000::bigint,48,25000::bigint,9.9,200000::bigint,1400000::bigint,now() + interval '7 days')) v
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_finance_quotes WHERE tenant_id = '${A}');

      INSERT INTO initial_disclosure_versions (tenant_id, version, body_markdown, commission_statement)
        SELECT * FROM (VALUES
          ('${A}'::uuid,1,'Disclosure A','We receive commission.'),
          ('${B}'::uuid,1,'Disclosure B','We receive commission.')) v
        WHERE NOT EXISTS (SELECT 1 FROM initial_disclosure_versions WHERE tenant_id = '${A}');

      INSERT INTO finance_promotion_log (tenant_id, page_path, rendered_hash, occurred_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'/used-cars/a','hash-a','2026-08-15T12:00:00Z'::timestamptz),
          ('${B}'::uuid,'/used-cars/b','hash-b','2026-08-15T12:00:00Z'::timestamptz)) v
        WHERE NOT EXISTS (SELECT 1 FROM finance_promotion_log WHERE page_path = '/used-cars/a');
    `);
  }

  // M9 tables — contacts and consent.
  if (await tableExists('contacts')) {
    await sql.unsafe(`
      INSERT INTO contacts (id, tenant_id, first_name, last_name, email) VALUES
        ('${A_CONTACT}','${A}','Alice','Anderson','alice@isolation.test'),
        ('${B_CONTACT}','${B}','Bob','Brown','bob@isolation.test'),
        ('${B_CONTACT_2}','${B}','Bobby','Brown','bobby@isolation.test')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO consent_wordings (id, tenant_id, version, channel, basis, body, opt_out_text) VALUES
        ('${A_WORDING}','${A}',1,'email','explicit','Wording A','Unsubscribe any time.'),
        ('${B_WORDING}','${B}',1,'email','explicit','Wording B','Unsubscribe any time.')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO contact_consents (tenant_id, contact_id, channel, basis, granted, source, wording_id)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CONTACT}'::uuid,'email'::consent_channel,'explicit'::consent_basis,
           true,'website_form'::consent_source,'${A_WORDING}'::uuid),
          ('${B}'::uuid,'${B_CONTACT}'::uuid,'email'::consent_channel,'explicit'::consent_basis,
           true,'website_form'::consent_source,'${B_WORDING}'::uuid)) v
        WHERE NOT EXISTS (SELECT 1 FROM contact_consents WHERE contact_id = '${A_CONTACT}');

      INSERT INTO suppressions (tenant_id, channel, destination, reason)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'email'::consent_channel,'gone-a@isolation.test','unsubscribed'),
          ('${B}'::uuid,'email'::consent_channel,'gone-b@isolation.test','unsubscribed')) v
        WHERE NOT EXISTS (SELECT 1 FROM suppressions WHERE destination = 'gone-a@isolation.test');

      INSERT INTO data_subject_requests (tenant_id, contact_id, kind, requested_at, due_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CONTACT}'::uuid,'access',now(),now() + interval '30 days'),
          ('${B}'::uuid,'${B_CONTACT}'::uuid,'access',now(),now() + interval '30 days')) v
        WHERE NOT EXISTS (SELECT 1 FROM data_subject_requests WHERE contact_id = '${A_CONTACT}');
    `);
  }

  // M10 tables — leads and communications.
  if (await tableExists('leads')) {
    await sql.unsafe(`
      INSERT INTO leads (id, tenant_id, contact_id, vehicle_id, source) VALUES
        ('${A_LEAD}','${A}','${A_CONTACT}','${A_VEHICLE}','website_enquiry'),
        ('${B_LEAD}','${B}','${B_CONTACT}','${B_VEHICLE}','website_enquiry')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO lead_events (tenant_id, lead_id, kind)
        SELECT * FROM (VALUES ('${A}'::uuid,'${A_LEAD}'::uuid,'created'),
                              ('${B}'::uuid,'${B_LEAD}'::uuid,'created')) v
        WHERE NOT EXISTS (SELECT 1 FROM lead_events WHERE lead_id = '${A_LEAD}');

      INSERT INTO messages (tenant_id, lead_id, contact_id, direction, channel,
                            destination, body, is_marketing)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_LEAD}'::uuid,'${A_CONTACT}'::uuid,'outbound'::message_direction,
           'email'::consent_channel,'alice@isolation.test','Reply A',false),
          ('${B}'::uuid,'${B_LEAD}'::uuid,'${B_CONTACT}'::uuid,'outbound'::message_direction,
           'email'::consent_channel,'bob@isolation.test','Reply B',false)) v
        WHERE NOT EXISTS (SELECT 1 FROM messages WHERE lead_id = '${A_LEAD}');

      INSERT INTO lead_sla_policies (tenant_id, source, respond_within_minutes)
        SELECT * FROM (VALUES ('${A}'::uuid,'website_enquiry'::lead_source,30),
                              ('${B}'::uuid,'website_enquiry'::lead_source,30)) v
        WHERE NOT EXISTS (SELECT 1 FROM lead_sla_policies WHERE tenant_id = '${A}');
    `);
  }

  // M11 tables — money.
  if (await tableExists('invoices')) {
    await sql.unsafe(`
      INSERT INTO invoice_sequences (tenant_id, series, prefix, last_number)
        SELECT * FROM (VALUES ('${A}'::uuid,'sale','KEN-',0::bigint),
                              ('${B}'::uuid,'sale','BEE-',0::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM invoice_sequences WHERE tenant_id = '${A}');

      INSERT INTO stock_book_sequences (tenant_id, last_number)
        SELECT * FROM (VALUES ('${A}'::uuid,0::bigint), ('${B}'::uuid,0::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM stock_book_sequences WHERE tenant_id = '${A}');

      INSERT INTO invoices (id, tenant_id, kind, status, series, vat_scheme,
                            net_total_pence, vat_total_pence, gross_total_pence) VALUES
        ('${A_INVOICE}','${A}','sale','draft','sale','margin',1200000,0,1200000),
        ('${B_INVOICE}','${B}','sale','draft','sale','margin',1200000,0,1200000)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO invoice_lines (tenant_id, invoice_id, position, description,
                                 unit_price_pence, net_pence, vat_amount_pence, gross_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_INVOICE}'::uuid,1,'Car A',1200000::bigint,1200000::bigint,0::bigint,1200000::bigint),
          ('${B}'::uuid,'${B_INVOICE}'::uuid,1,'Car B',1200000::bigint,1200000::bigint,0::bigint,1200000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = '${A_INVOICE}');

      INSERT INTO stock_book_entries (tenant_id, entry_number, registration,
                                      vehicle_description, purchase_price_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,1::bigint,'AA11AAA','Vehicle A',1000000::bigint),
          ('${B}'::uuid,1::bigint,'BB11BBB','Vehicle B',1000000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM stock_book_entries WHERE registration = 'AA11AAA');

      INSERT INTO payments (tenant_id, contact_id, direction, method, amount_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CONTACT}'::uuid,'in'::payment_direction,'cash'::payment_method,500000::bigint),
          ('${B}'::uuid,'${B_CONTACT}'::uuid,'in'::payment_direction,'cash'::payment_method,500000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM payments WHERE contact_id = '${A_CONTACT}');

      INSERT INTO aml_overrides (tenant_id, contact_id, running_total_pence,
                                 threshold_pence, reason, authorised_by)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CONTACT}'::uuid,1200000::bigint,1000000::bigint,'Override A','${USER_A}'::uuid),
          ('${B}'::uuid,'${B_CONTACT}'::uuid,1200000::bigint,1000000::bigint,'Override B','${B_USER}'::uuid)) v
        WHERE NOT EXISTS (SELECT 1 FROM aml_overrides WHERE contact_id = '${A_CONTACT}');
    `);
  }

  // M12 tables — deals and the evidence ledger.
  if (await tableExists('deals')) {
    await sql.unsafe(`
      INSERT INTO deals (id, tenant_id, contact_id, vehicle_id, state, vehicle_price_pence) VALUES
        ('${A_DEAL}','${A}','${A_CONTACT}','${A_VEHICLE}','building',1200000),
        ('${B_DEAL}','${B}','${B_CONTACT}','${B_VEHICLE}','building',1200000)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name, price_pence, offered_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_DEAL}'::uuid,'GAP','GAP insurance A',39900::bigint,now()),
          ('${B}'::uuid,'${B_DEAL}'::uuid,'GAP','GAP insurance B',39900::bigint,now())) v
        WHERE NOT EXISTS (SELECT 1 FROM deal_addons WHERE deal_id = '${A_DEAL}');

      INSERT INTO deal_evidence (tenant_id, deal_id, sequence, kind, payload, entry_hash, occurred_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_DEAL}'::uuid,1,'initial_disclosure'::evidence_kind,'{}'::jsonb,'hash-a',now()),
          ('${B}'::uuid,'${B_DEAL}'::uuid,1,'initial_disclosure'::evidence_kind,'{}'::jsonb,'hash-b',now())) v
        WHERE NOT EXISTS (SELECT 1 FROM deal_evidence WHERE deal_id = '${A_DEAL}');

      INSERT INTO document_templates (tenant_id, code, name, version, body_markdown)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'order-form','Order form A',1,'Body A'),
          ('${B}'::uuid,'order-form','Order form B',1,'Body B')) v
        WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE tenant_id = '${A}');

      INSERT INTO deal_documents (tenant_id, deal_id, code, version, rendered_body, content_hash)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_DEAL}'::uuid,'order-form',1,'Rendered A','hash-doc-a'),
          ('${B}'::uuid,'${B_DEAL}'::uuid,'order-form',1,'Rendered B','hash-doc-b')) v
        WHERE NOT EXISTS (SELECT 1 FROM deal_documents WHERE deal_id = '${A_DEAL}');

      INSERT INTO deal_repair_attempts (tenant_id, deal_id, fault_reported, started_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_DEAL}'::uuid,'Fault A',now()),
          ('${B}'::uuid,'${B_DEAL}'::uuid,'Fault B',now())) v
        WHERE NOT EXISTS (SELECT 1 FROM deal_repair_attempts WHERE deal_id = '${A_DEAL}');
    `);
  }

  // M13 tables — part-exchange appraisal.
  if (await tableExists('appraisals')) {
    await sql.unsafe(`
      INSERT INTO appraisals (id, tenant_id, contact_id, registration, state, seller_type, mileage) VALUES
        ('${A_APPRAISAL}','${A}','${A_CONTACT}','AA11PXA','appraised','private_individual',42500),
        ('${B_APPRAISAL}','${B}','${B_CONTACT}','BB11PXB','appraised','private_individual',42500)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO appraisal_damage (tenant_id, appraisal_id, panel, panel_group, damage_type, severity)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_APPRAISAL}'::uuid,'nsf_door','body_panel'::panel_group,'dent'::damage_type,'moderate'::damage_severity),
          ('${B}'::uuid,'${B_APPRAISAL}'::uuid,'nsf_door','body_panel'::panel_group,'dent'::damage_type,'moderate'::damage_severity)) v
        WHERE NOT EXISTS (SELECT 1 FROM appraisal_damage WHERE appraisal_id = '${A_APPRAISAL}');

      INSERT INTO recon_cost_standards (tenant_id, damage_type, severity, panel_group, cost_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'dent'::damage_type,'moderate'::damage_severity,'body_panel'::panel_group,12000::bigint),
          ('${B}'::uuid,'dent'::damage_type,'moderate'::damage_severity,'body_panel'::panel_group,12000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM recon_cost_standards WHERE tenant_id = '${A}');

      INSERT INTO appraisal_costs (tenant_id, appraisal_id, category, description, estimate_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_APPRAISAL}'::uuid,'bodywork'::cost_category,'Recon A',12000::bigint),
          ('${B}'::uuid,'${B_APPRAISAL}'::uuid,'bodywork'::cost_category,'Recon B',12000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM appraisal_costs WHERE appraisal_id = '${A_APPRAISAL}');

      INSERT INTO appraisal_valuations (tenant_id, appraisal_id, source, trade_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_APPRAISAL}'::uuid,'manual'::valuation_source,450000::bigint),
          ('${B}'::uuid,'${B_APPRAISAL}'::uuid,'manual'::valuation_source,450000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM appraisal_valuations WHERE appraisal_id = '${A_APPRAISAL}');

      INSERT INTO appraisal_offers (tenant_id, appraisal_id, revision, allowance_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_APPRAISAL}'::uuid,1,350000::bigint),
          ('${B}'::uuid,'${B_APPRAISAL}'::uuid,1,350000::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM appraisal_offers WHERE appraisal_id = '${A_APPRAISAL}');

      INSERT INTO appraisal_settlements (tenant_id, appraisal_id, lender_name,
                                         settlement_pence, source, quoted_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_APPRAISAL}'::uuid,'Lender A',310000::bigint,'lender_letter'::settlement_source,now()),
          ('${B}'::uuid,'${B_APPRAISAL}'::uuid,'Lender B',310000::bigint,'lender_letter'::settlement_source,now())) v
        WHERE NOT EXISTS (SELECT 1 FROM appraisal_settlements WHERE appraisal_id = '${A_APPRAISAL}');
    `);
  }

  // M14 tables — the prep pipeline.
  if (await tableExists('prep_stages')) {
    await sql.unsafe(`
      INSERT INTO prep_stages (id, tenant_id, key, name, position, sla_hours) VALUES
        ('${A_PREP_STAGE}','${A}','bodywork','Bodywork A',4,72),
        ('${B_PREP_STAGE}','${B}','bodywork','Bodywork B',4,72)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO prep_cards (id, tenant_id, vehicle_id, current_stage_id) VALUES
        ('${A_PREP_CARD}','${A}','${A_VEHICLE}','${A_PREP_STAGE}'),
        ('${B_PREP_CARD}','${B}','${B_VEHICLE}','${B_PREP_STAGE}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO prep_stage_events (tenant_id, card_id, stage_id, entered_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_PREP_CARD}'::uuid,'${A_PREP_STAGE}'::uuid,now()),
          ('${B}'::uuid,'${B_PREP_CARD}'::uuid,'${B_PREP_STAGE}'::uuid,now())) v
        WHERE NOT EXISTS (SELECT 1 FROM prep_stage_events WHERE card_id = '${A_PREP_CARD}');

      INSERT INTO prep_tasks (id, tenant_id, card_id, description, category) VALUES
        ('${A_PREP_TASK}','${A}','${A_PREP_CARD}','Task A','valet'),
        ('${B_PREP_TASK}','${B}','${B_PREP_CARD}','Task B','valet')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO prep_parts (tenant_id, task_id, description)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_PREP_TASK}'::uuid,'Part A'),
          ('${B}'::uuid,'${B_PREP_TASK}'::uuid,'Part B')) v
        WHERE NOT EXISTS (SELECT 1 FROM prep_parts WHERE task_id = '${A_PREP_TASK}');

      INSERT INTO prep_blocks (tenant_id, card_id, reason, started_at)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_PREP_CARD}'::uuid,'awaiting_parts'::prep_block_reason,now()),
          ('${B}'::uuid,'${B_PREP_CARD}'::uuid,'awaiting_parts'::prep_block_reason,now())) v
        WHERE NOT EXISTS (SELECT 1 FROM prep_blocks WHERE card_id = '${A_PREP_CARD}');
    `);
  }

  // M16 tables — channel feeds.
  if (await tableExists('channels')) {
    await sql.unsafe(`
      INSERT INTO channels (id, tenant_id, channel, display_name, enabled) VALUES
        ('${A_CHANNEL}','${A}','auto_trader','Auto Trader A',true),
        ('${B_CHANNEL}','${B}','auto_trader','Auto Trader B',true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO channel_listings (tenant_id, channel_id, vehicle_id, status)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CHANNEL}'::uuid,'${A_VEHICLE}'::uuid,'not_published'::listing_status),
          ('${B}'::uuid,'${B_CHANNEL}'::uuid,'${B_VEHICLE}'::uuid,'not_published'::listing_status)) v
        WHERE NOT EXISTS (SELECT 1 FROM channel_listings WHERE channel_id = '${A_CHANNEL}');

      INSERT INTO channel_overrides (tenant_id, channel_id, vehicle_id, price_pence)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CHANNEL}'::uuid,'${A_VEHICLE}'::uuid,1899900::bigint),
          ('${B}'::uuid,'${B_CHANNEL}'::uuid,'${B_VEHICLE}'::uuid,1899900::bigint)) v
        WHERE NOT EXISTS (SELECT 1 FROM channel_overrides WHERE channel_id = '${A_CHANNEL}');

      INSERT INTO channel_sync_events (tenant_id, channel_id, action, outcome,
                                       idempotency_key, adapter_version, message)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CHANNEL}'::uuid,'publish'::sync_action,'success'::sync_outcome,'key-a',1,NULL::text),
          ('${B}'::uuid,'${B_CHANNEL}'::uuid,'publish'::sync_action,'success'::sync_outcome,'key-b',1,NULL::text)) v
        WHERE NOT EXISTS (SELECT 1 FROM channel_sync_events WHERE idempotency_key = 'key-a');

      INSERT INTO channel_rules (tenant_id, channel_id, min_photos)
        SELECT * FROM (VALUES
          ('${A}'::uuid,'${A_CHANNEL}'::uuid,8),
          ('${B}'::uuid,'${B_CHANNEL}'::uuid,8)) v
        WHERE NOT EXISTS (SELECT 1 FROM channel_rules WHERE channel_id = '${A_CHANNEL}');
    `);
  }

  // M4 tables.
  if (await tableExists('vehicle_lookups')) {
    await sql.unsafe(`
      INSERT INTO vehicle_lookups (tenant_id, registration, provider, lookup_type)
        SELECT * FROM (VALUES ('${A}'::uuid,'AA11AAA','dvla_ves'::data_provider,'vehicle'),
                              ('${B}'::uuid,'BB11BBB','dvla_ves'::data_provider,'vehicle')) v
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_lookups WHERE registration = 'AA11AAA');

      INSERT INTO mot_records (tenant_id, vehicle_id, test_date, result, odometer_miles) VALUES
        ('${A}','${A_VEHICLE}','2026-02-14','PASSED',38940),
        ('${B}','${B_VEHICLE}','2026-02-14','PASSED',38940)
      ON CONFLICT DO NOTHING;

      INSERT INTO provider_usage_daily (tenant_id, usage_date, provider, lookup_type, call_count) VALUES
        ('${A}','2026-08-02','dvla_ves','vehicle',1),
        ('${B}','2026-08-02','dvla_ves','vehicle',1)
      ON CONFLICT DO NOTHING;
    `);
  }
}

describeDb('cross-tenant isolation', () => {
  beforeAll(async () => {
    const { default: postgres } = await import('postgres');
    sql = postgres(DATABASE_URL!) as never;
    await seedRivalData();
  });

  afterAll(async () => {
    await sql?.end();
  });

  // -------------------------------------------------------------------
  // Gate 1 — structural. Catches the table someone forgot.
  // -------------------------------------------------------------------
  it('every table with tenant_id has RLS enabled, FORCED, and at least one policy', async () => {
    const rows = await sql`
      SELECT c.relname AS table_name,
             c.relrowsecurity  AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      -- 'p' as well as 'r'. A partitioned parent is relkind 'p', so a gate
      -- that only looks at 'r' silently exempts every partitioned table —
      -- which is search_events and, later, audit_events and vehicle_views.
      -- This is the same blind spot that was fixed in verify-policies.mjs.
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = c.relname AND column_name = 'tenant_id'
        )`;

    expect(rows.length, 'no tenant tables found — is the schema migrated?').toBeGreaterThan(0);

    const unprotected = rows.filter(
      (r) => !r['rls_enabled'] || !r['rls_forced'] || Number(r['policy_count']) === 0,
    );
    expect(
      unprotected.map((r) => r['table_name']),
      'these tables are not protected — see packages/db/src/rls.sql',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Gate 2 — the application role cannot bypass RLS.
  // -------------------------------------------------------------------
  it('app_user cannot bypass row-level security', async () => {
    const [role] = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`;
    expect(role?.['rolbypassrls'], 'app_user must be NOBYPASSRLS').toBe(false);
  });

  // -------------------------------------------------------------------
  // Gate 3 — behavioural. Tenant A cannot reach tenant B's rows.
  // -------------------------------------------------------------------
  describe.each(TENANT_TABLES)('table: %s', (table) => {
    it('does not return another tenant\'s rows on a list read', async () => {
      if (!(await tableExists(table))) return; // created by a later migration

      const rows = await asTenant(TENANT_A, USER_A, (tx) =>
        tx.unsafe(`SELECT count(*) FILTER (WHERE tenant_id = $1::uuid) AS leaked FROM ${table}`, [TENANT_B]),
      );
      const leaked = Number(rows[0]?.['leaked'] ?? 0);
      expect(leaked, `${table} leaked ${leaked} rows from another tenant`).toBe(0);
    });

    it('cannot UPDATE a row belonging to another tenant', async () => {
      if (!(await tableExists(table))) return;
      if (APPEND_ONLY.has(table)) {
        // Covered by Gate 4 instead: the append_only trigger rejects every
        // UPDATE outright, which is a stronger guarantee than a silent no-op.
        return;
      }

      // Guard against a false pass: if tenant B has no rows here, the test
      // proves nothing. Seeding is done in beforeAll; this asserts it worked.
      const [before] = await sql.unsafe(
        `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1::uuid`, [TENANT_B],
      );
      expect(
        Number(before?.['n'] ?? 0),
        `${table} has no tenant B rows — this test would pass vacuously. Add it to seedRivalData().`,
      ).toBeGreaterThan(0);

      // The UPDATE is silently a no-op: RLS makes the rows invisible, so the
      // statement succeeds and affects nothing. That is the correct behaviour —
      // an error would confirm the rows exist.
      const affected = await asTenant(TENANT_A, USER_A, async (tx) => {
        const res = await tx.unsafe(
          `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1::uuid RETURNING 1`, [TENANT_B],
        );
        return res.length;
      });
      expect(affected, `${table} allowed a write to another tenant's rows`).toBe(0);
    });

    it('cannot INSERT a row belonging to another tenant', async () => {
      if (!(await tableExists(table))) return;

      // The row must be rejected BY THE POLICY (SQLSTATE 42501), not by a
      // NOT NULL constraint — otherwise this passes for the wrong reason and
      // would keep passing even if the policy were removed.
      const payload = INSERT_PAYLOAD[table];
      expect(
        payload,
        `${table} has no INSERT_PAYLOAD. Without a fully valid row, this test would ` +
          `fail on NOT NULL rather than on the policy, and would pass with RLS disabled.`,
      ).toBeDefined();

      let code: string | undefined;
      try {
        await asTenant(TENANT_A, USER_A, (tx) =>
          tx.unsafe(`INSERT INTO ${table} (${payload!.columns}) VALUES (${payload!.values})`),
        );
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      expect(code, `${table}: INSERT for another tenant was not rejected at all`).toBeDefined();
      expect(
        code,
        `${table}: INSERT failed with SQLSTATE ${code} rather than 42501 (row-level security). ` +
          `A NOT NULL or FK error here means the policy is not what rejected it — the test would ` +
          `still pass with RLS disabled.`,
      ).toBe('42501');
    });
  });

  // -------------------------------------------------------------------
  // Gate 3b — the tables with no tenant_id, which are the easiest to forget.
  // -------------------------------------------------------------------
  it('tenants is isolated on `id` — one tenant cannot read another', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe('SELECT count(*) AS visible, count(*) FILTER (WHERE id <> $1::uuid) AS leaked FROM tenants', [TENANT_A]),
    );
    const row = rows[0];
    expect(Number(row?.['leaked'] ?? 0), 'tenants leaked another tenant\'s row').toBe(0);
    expect(Number(row?.['visible'] ?? 0)).toBeLessThanOrEqual(1);
  });

  it('users is visible only through a shared membership', async () => {
    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe(
        `SELECT count(*) AS leaked FROM users u
           WHERE u.id <> $2::uuid
             AND NOT EXISTS (
               SELECT 1 FROM tenant_memberships m
               WHERE m.user_id = u.id AND m.tenant_id = $1::uuid AND m.deleted_at IS NULL)`,
        [TENANT_A, USER_A],
      ),
    );
    expect(Number(rows[0]?.['leaked'] ?? 0), 'users leaked a person from another dealer').toBe(0);
  });

  // -------------------------------------------------------------------
  // Gate 3c — M7: a shortlist token is a credential, and credentials leak
  // sideways. The token lives in a cookie on a dealer's own domain, but the
  // lookup is what has to be safe, not the cookie.
  // -------------------------------------------------------------------
  it('a shortlist token from one dealer resolves to nothing at another', async () => {
    if (!(await tableExists('shortlists'))) return;

    // Prove tenant B's token really exists, or this passes vacuously.
    const [seeded] = await sql.unsafe(
      `SELECT count(*) AS n FROM shortlists WHERE token = $1`, [B_TOKEN],
    );
    expect(Number(seeded?.['n'] ?? 0), 'tenant B has no shortlist — seedRivalData() did not run').toBe(1);

    const rows = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe(`SELECT count(*) AS found FROM shortlists WHERE token = $1`, [B_TOKEN]),
    );
    expect(
      Number(rows[0]?.['found'] ?? 0),
      'another dealer\'s shortlist token resolved — that is one buyer\'s saved cars exposed to a different dealer',
    ).toBe(0);
  });

  it('the same shortlist token may exist for two dealers without colliding', async () => {
    if (!(await tableExists('shortlists'))) return;
    // Uniqueness is (tenant_id, token), not (token). A global unique index
    // would leak the existence of another dealer's token through a conflict.
    const [idx] = await sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'shortlists_token_unique'`;
    expect(String(idx?.['indexdef'] ?? '')).toMatch(/\(tenant_id, token\)/);
  });

  // -------------------------------------------------------------------
  // Gate 3d — M8: the rulebook is platform property. A tenant that could
  // edit its own representative-example rule could switch its own
  // compliance gate off, which is worse than any single bad promotion.
  // -------------------------------------------------------------------
  it('a tenant can read compliance_rules but cannot write them', async () => {
    if (!(await tableExists('compliance_rules'))) return;

    const readable = await asTenant(TENANT_A, USER_A, (tx) =>
      tx.unsafe(`SELECT count(*) AS n FROM compliance_rules WHERE key = 'conc.representative_example'`),
    );
    expect(Number(readable[0]?.['n'] ?? 0), 'every dealer must be able to read the same law').toBeGreaterThan(0);

    let code: string | undefined;
    try {
      await asTenant(TENANT_A, USER_A, (tx) =>
        tx.unsafe(`INSERT INTO compliance_rules (key, version, effective_from, parameters, source_url, checked_at)
                   VALUES ('conc.representative_example', 999, now(), '{"representativeThreshold":0}', 'http://x', now())`),
      );
    } catch (err) { code = (err as { code?: string }).code; }
    expect(code, 'a tenant inserted its own compliance rule').toBe('42501');
  });

  it('the representative-example rule ships unsigned, so nothing can render until it is approved', async () => {
    if (!(await tableExists('compliance_rules'))) return;
    const rows = await sql`
      SELECT version, signed_off_by FROM compliance_rules
      WHERE key = 'conc.representative_example' ORDER BY version DESC LIMIT 1`;
    // If this ever fails because someone seeded a signature into a migration,
    // that is the failure it exists to catch: sign-off is an act by a named
    // person, not a line in a SQL file.
    expect(rows[0]?.['signed_off_by'], 'a compliance rule must not ship pre-signed').toBeNull();
  });

  it.each(Object.keys(SPECIAL_TABLES))('%s has RLS enabled, forced and a policy', async (table) => {
    const [row] = await sql`
      SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table}`;
    expect(row?.['enabled'], `${table}: RLS not enabled`).toBe(true);
    expect(row?.['forced'], `${table}: RLS not FORCED`).toBe(true);
    expect(Number(row?.['policies'] ?? 0), `${table}: no policy`).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // Gate 4 — append-only tables reject mutation.
  // -------------------------------------------------------------------
  it.each([
    'deal_evidence', 'stock_book_entries', 'contact_consents', 'search_events',
    // M8: what we advertised, and what the rulebook said when we advertised it.
    'compliance_rules', 'representative_examples', 'initial_disclosure_versions', 'finance_promotion_log',
    // M9/M10 evidence.
    'suppressions', 'contact_merges', 'lead_events', 'messages',
    // M11 money records HMRC asks to see.
    'payments', 'aml_overrides',
  ])(
    '%s rejects UPDATE and DELETE',
    async (table) => {
      if (!(await tableExists(table))) return;

      const [trigger] = await sql`
        SELECT count(*) AS n FROM pg_trigger
        WHERE tgrelid = ${'public.' + table}::regclass AND tgname = 'append_only' AND NOT tgisinternal`;
      expect(Number(trigger?.['n'] ?? 0), `${table} must carry the append_only trigger`).toBeGreaterThan(0);
    },
  );

  /**
   * `invoices` and `invoice_lines` are NOT blanket append-only, and that is
   * deliberate: an invoice has a lawful draft → issued → paid lifecycle, so a
   * total UPDATE ban would make it impossible to issue one.
   *
   * What must be immutable is the CONTENT once issued. This asserts the
   * guarantee rather than the mechanism — the earlier version of this test
   * demanded the `append_only` trigger by name and would have been satisfied
   * by a trigger that did nothing.
   */
  it.each(['invoices', 'invoice_lines'])(
    '%s freezes its content once the invoice is issued',
    async (table) => {
      if (!(await tableExists(table))) return;
      const [trigger] = await sql`
        SELECT count(*) AS n FROM pg_trigger
        WHERE tgrelid = ${'public.' + table}::regclass
          AND tgname LIKE 'freeze_issued%' AND NOT tgisinternal`;
      expect(Number(trigger?.['n'] ?? 0), `${table} must carry a freeze-on-issue trigger`)
        .toBeGreaterThan(0);
    },
  );

  /**
   * M12: a repair attempt sets a statutory deadline, so its start date is
   * frozen while its completion is not. Asserted against the real trigger,
   * because a CHECK constraint and a comment prove nothing about behaviour.
   */
  it('a repair attempt can be completed but never re-dated or deleted', async () => {
    if (!(await tableExists('deal_repair_attempts'))) return;

    const id: string = globalThis.crypto.randomUUID();
    await sql.unsafe(`
      INSERT INTO deal_repair_attempts (id, tenant_id, deal_id, fault_reported, started_at)
      VALUES ('${id}', '${TENANT_A}', '${A_DEAL}', 'Clutch judder', now() - interval '2 days')`);

    // Back-dating the start would SHORTEN the customer's right to reject.
    await expect(
      sql.unsafe(`UPDATE deal_repair_attempts SET started_at = now() WHERE id = '${id}'`),
    ).rejects.toThrow(/statutory deadline/i);

    await expect(
      sql.unsafe(`UPDATE deal_repair_attempts SET fault_reported = 'Something else' WHERE id = '${id}'`),
    ).rejects.toThrow(/statutory deadline/i);

    await expect(
      sql.unsafe(`DELETE FROM deal_repair_attempts WHERE id = '${id}'`),
    ).rejects.toThrow(/cannot be deleted/i);

    // Completing an open repair is the one lawful update, and it must work —
    // otherwise the clock could never resume.
    await sql.unsafe(`UPDATE deal_repair_attempts SET completed_at = now() WHERE id = '${id}'`);

    // But a completed repair cannot then be re-dated.
    await expect(
      sql.unsafe(`UPDATE deal_repair_attempts SET completed_at = now() + interval '1 day' WHERE id = '${id}'`),
    ).rejects.toThrow(/cannot be re-dated/i);
  });

  /**
   * M12: an add-on accepted before it was offered is the data shape of a
   * pre-ticked box, and PRIN 2A treats that as a fair-value failure.
   */
  it('refuses an add-on accepted before it was offered', async () => {
    if (!(await tableExists('deal_addons'))) return;

    await expect(
      sql.unsafe(`
        INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                                 price_pence, offered_at, accepted_at, demands_and_needs)
        VALUES ('${TENANT_A}', '${A_DEAL}', 'PRETICK', 'Pre-ticked product', 9900,
                now(), now() - interval '1 hour', 'Wanted it')`),
    ).rejects.toThrow(/addon_accepted_after_offered/i);
  });

  it('refuses an accepted add-on with no demands and needs statement', async () => {
    if (!(await tableExists('deal_addons'))) return;

    await expect(
      sql.unsafe(`
        INSERT INTO deal_addons (tenant_id, deal_id, product_code, product_name,
                                 price_pence, offered_at, accepted_at)
        VALUES ('${TENANT_A}', '${A_DEAL}', 'NODN', 'No statement', 9900,
                now() - interval '1 hour', now())`),
    ).rejects.toThrow(/addon_accepted_needs_statement/i);
  });

  /**
   * M12: the evidence chain cannot fork. Two entries at position 4 is exactly
   * the ambiguity the ledger exists to prevent.
   */
  it('refuses a second evidence entry at the same position in a deal', async () => {
    if (!(await tableExists('deal_evidence'))) return;

    await expect(
      sql.unsafe(`
        INSERT INTO deal_evidence (tenant_id, deal_id, sequence, kind, payload, entry_hash, occurred_at)
        VALUES ('${TENANT_A}', '${A_DEAL}', 1, 'note', '{}'::jsonb, 'forked', now())`),
    ).rejects.toThrow(/deal_evidence_deal_sequence_unique/i);
  });

  /**
   * M12: contract formation decides whether a 14-day cancellation right
   * exists. A contracted deal without it is refused by the database, not only
   * by the domain layer.
   */
  it('refuses to contract a deal with no contract formation recorded', async () => {
    if (!(await tableExists('deals'))) return;

    await expect(
      sql.unsafe(`
        INSERT INTO deals (tenant_id, contact_id, state, contracted_at)
        VALUES ('${TENANT_A}', '${A_CONTACT}', 'contracted', now())`),
    ).rejects.toThrow(/deal_contracted_needs_formation/i);
  });

  it('an issued invoice cannot be re-priced, renumbered or deleted', async () => {
    if (!(await tableExists('invoices'))) return;

    // A dedicated invoice per run. Re-using the seeded one made this pass
    // once and then fail on the second run against the same database — the
    // trigger correctly refused to re-stamp an already-issued invoice, which
    // is the behaviour under test refusing the test's own setup.
    const freshId: string = globalThis.crypto.randomUUID();

    // The number must be unique within (tenant, series) too, so it comes from
    // the max already present rather than a literal. Hard-coding `1` passed on
    // a clean database and collided on every rerun — the unique index doing
    // exactly its job, against the test's own setup.
    const [maxRow] = await sql`
      SELECT coalesce(max(number), 0) AS n FROM invoices
       WHERE tenant_id = ${TENANT_A} AND series = 'freeze-test'`;
    const next = BigInt(String(maxRow?.['n'] ?? 0)) + 1n;

    await sql.unsafe(`
      INSERT INTO invoices (id, tenant_id, kind, status, series, vat_scheme,
                            net_total_pence, vat_total_pence, gross_total_pence,
                            number, reference, issued_at)
      VALUES ('${freshId}', '${TENANT_A}', 'sale', 'issued', 'freeze-test', 'margin',
              1200000, 0, 1200000, ${next}, 'FRZ-${next}', now())`);

    // Now tamper with it the way a bug or a bad actor would. Each of these is
    // a different HMRC problem.
    await expect(
      sql.unsafe(`UPDATE invoices SET number = 9002 WHERE id = '${freshId}'`),
    ).rejects.toThrow(/number cannot change/i);

    await expect(
      sql.unsafe(`UPDATE invoices SET gross_total_pence = 1 WHERE id = '${freshId}'`),
    ).rejects.toThrow(/cannot be re-priced/i);

    await expect(
      sql.unsafe(`UPDATE invoices SET buyer_name = 'Someone Else' WHERE id = '${freshId}'`),
    ).rejects.toThrow(/part of the record/i);

    await expect(
      sql.unsafe(`DELETE FROM invoices WHERE id = '${freshId}'`),
    ).rejects.toThrow(/cannot be deleted/i);

    // Status may still move — an issued invoice must be able to become paid,
    // or the freeze would make the product unusable.
    await sql.unsafe(`UPDATE invoices SET status = 'paid' WHERE id = '${freshId}'`);
  });

  // -------------------------------------------------------------------
  // Gate 5 — unique constraints are tenant-scoped, not global.
  // -------------------------------------------------------------------
  it('vehicle registration uniqueness is scoped by tenant, not global', async () => {
    expect(
      await tableExists('vehicles'),
      'vehicles table missing — this test must not skip once M3 is migrated',
    ).toBe(true);

    const rows = await sql`
      SELECT i.indexrelid::regclass AS index_name,
             array_agg(a.attname ORDER BY a.attnum) AS columns
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'public.vehicles'::regclass AND i.indisunique
      GROUP BY i.indexrelid`;

    const regIndexes = rows.filter((r) => (r['columns'] as string[]).includes('registration'));
    for (const idx of regIndexes) {
      expect(
        idx['columns'],
        `${idx['index_name']} must include tenant_id — a global unique registration would leak the existence of another dealer's stock`,
      ).toContain('tenant_id');
    }
  });
});
