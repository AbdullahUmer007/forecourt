# Forecourt — Technical Architecture & Data Model

**Version:** 1.0 — August 2026
**Companion docs:** `01-product-strategy.md`, `02-functional-spec.md`, `04-design-system.md`, `05-integrations-and-compliance.md`

---

## 1. Architectural principles

1. **One canonical vehicle record.** Every surface — CRM, website, feeds, invoices, stock book — reads the same row. Channel-specific data lives in adapters, never in duplicate vehicle tables.
2. **Tenant isolation is enforced in the database, not in application code.** Postgres row-level security is the last line of defence and it must never be the only one, but it must always be there.
3. **The public website must survive the CRM being down.** Static generation + edge cache. A dealer's shopfront going dark because our API is slow is unacceptable.
4. **Financial and compliance data is append-only.** Corrections create new versions. Nothing that could ever be evidence is ever mutated or hard-deleted.
5. **Every external call is a job, not a request.** Lookups, feed pushes, emails, accounting syncs all go through a queue with retries, idempotency keys and dead-letter handling. Third-party APIs in this sector are unreliable and sales-gated.
6. **Boring, well-understood technology.** A small team shipping a large surface area cannot also be researching infrastructure.
7. **Cost-aware by design.** Vehicle data lookups cost real money per call. Caching and quota control are product features, not optimisations.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language across app, API, workers and shared validation. Small team, maximum reuse. |
| App framework | **Next.js (App Router)** on Node | Server components for fast, SEO-critical public pages; React Server Actions for the CRM; one framework for both products. |
| UI | **React + Tailwind CSS + shadcn/ui (Radix primitives)** | Accessible primitives we own the source of; fast to build a large component set; see `04-design-system.md`. |
| API | **tRPC** for first-party app traffic + **REST (OpenAPI)** for the public/partner API | tRPC gives end-to-end types internally with zero schema drift; REST is what partners and integrators expect. |
| Database | **PostgreSQL 16+** (managed — Neon, Supabase, or RDS) | RLS, JSONB, full-text search, partitioning, `pg_trgm` for fuzzy reg/name search, PostGIS for radius search. |
| ORM | **Drizzle ORM** | Typed SQL that stays close to the database, essential when RLS and raw SQL matter. (Prisma is acceptable if the team prefers it, but RLS ergonomics are worse.) |
| Cache / queue | **Redis** + **BullMQ** | Job queues, rate limiting, session/lookup caching, feed debouncing. |
| Search | Postgres FTS + trigram in v1; **Typesense/Meilisearch** when public faceted search outgrows it | Don't add a search cluster before you need one. |
| Object storage | **S3-compatible** (Cloudflare R2 preferred — no egress fees) + **Cloudflare Images** or an imgproxy service | Vehicle photography is the bulk of our storage and bandwidth. Egress cost matters a lot here. |
| Auth | **Auth.js (NextAuth)** or **WorkOS/Clerk** for enterprise SSO | Passkeys, TOTP, OAuth, SAML for the Group tier. |
| Email | **Postmark** (transactional) + **Resend/SES** (bulk) with per-tenant sending domains | Deliverability is a product feature; separate transactional from marketing reputation. |
| Payments | **Stripe** (subscriptions + dealer deposits via Connect) + **GoCardless** | Stripe Connect lets dealer deposits settle to the dealer, not to us — important for money-transmission scope. |
| Hosting | **Vercel** (app + public sites) or containers on **Fly.io/AWS ECS**; workers separately | Start on Vercel for velocity; the worker fleet and Postgres are separate regardless. |
| Files/PDF | **React-pdf** or Gotenberg/Chromium service for documents | Invoices, evidence bundles, handover packs. |
| Observability | **Sentry** + **OpenTelemetry** → Grafana/Datadog; **PostHog** for product analytics | |
| IaC | **Terraform** | |
| CI/CD | **GitHub Actions** — lint, typecheck, unit, integration, **cross-tenant leak tests**, Lighthouse budget, migration dry-run | |

**Region:** all primary data in the UK (London) or EU-West, with a documented sub-processor list. UK dealers will ask, and the DPA needs it.

---

## 3. System topology

```
                    ┌─────────────────────────────────────────┐
   Dealer staff ───▶│  CRM App (Next.js, authenticated)        │
                    │  - React Server Components + tRPC       │
                    └───────────────┬─────────────────────────┘
                                    │
   Car buyers  ────▶┌───────────────▼─────────────────────────┐
                    │  Public Site Renderer (Next.js, multi-  │
                    │  tenant by Host header, ISR + edge CDN) │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │  Core API layer (tRPC + REST/OpenAPI)   │
                    │  Tenant context middleware → RLS GUC    │
                    └───┬───────────────┬──────────────┬──────┘
                        │               │              │
              ┌─────────▼───┐   ┌───────▼──────┐  ┌────▼─────────┐
              │ PostgreSQL  │   │ Redis + Bull │  │ Object store │
              │ (RLS)       │   │ (queues)     │  │ (R2/S3)      │
              └─────────────┘   └───────┬──────┘  └──────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │  Worker fleet (isolated queues)          │
                    │  lookups · feeds · media · email/SMS ·   │
                    │  accounting · documents · retention      │
                    └───────────────────┬──────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────┐
                    │  Integration adapters (one per provider) │
                    │  DVLA · MOT · cap hpi · HPI · AutoTrader │
                    │  Motors · CarGurus · Meta · Google ·     │
                    │  iVendi · Stripe · Xero · Twilio · ...   │
                    └──────────────────────────────────────────┘

   Us ──────────────▶ Admin App (separate deployment, separate auth)
```

**Why the public renderer is a separate deployment:** different scaling profile, different cache strategy, different security posture (unauthenticated, public internet), and it must stay up when the CRM does not. It reads from a read replica and from pre-rendered content.

---

## 4. Multi-tenancy

### 4.1 Model: shared database, shared schema, row-level security

Every tenant-owned table carries `tenant_id uuid not null`. This is the right trade-off for our scale (thousands of tenants, tens of thousands of vehicles each at most): operationally simple, cheap, and easy to query across for platform analytics. Schema-per-tenant does not scale to thousands of migrations; database-per-tenant is over-engineered for this data volume.

**For Group-tier or enterprise tenants that demand it**, we can later move an individual tenant to a dedicated database with the same schema, because the application never assumes co-location.

### 4.2 The four layers of isolation

Defence in depth. Any one of these failing must not cause a leak.

**Layer 1 — Request context.** Auth middleware resolves the session → user → tenant memberships → the active tenant and the site scope. This is set once per request into an AsyncLocalStorage context. There is no code path that reaches the database without a tenant context (enforced by a lint rule and a runtime assertion).

**Layer 2 — Database session variable.** Every connection checkout runs:
```sql
SET LOCAL app.tenant_id = '<uuid>';
SET LOCAL app.user_id   = '<uuid>';
SET LOCAL ROLE app_user;   -- non-superuser, RLS-enforced
```
The application connects as a role that **cannot bypass RLS**. Migrations and platform jobs use a separate, clearly-named role.

**Layer 3 — Row-level security policies.** On every tenant table:
```sql
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vehicles
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```
`FORCE ROW LEVEL SECURITY` matters — without it, the table owner bypasses the policy.

**Layer 4 — Query builder guard.** A thin repository layer that injects `tenant_id` on every write and asserts its presence on every read. Belt and braces: RLS catches what the code misses, the code catches what a policy migration forgot.

### 4.3 Site-level scoping
`site_id` on operational rows. Access is a user↔site membership list; a policy extension restricts non-privileged roles to their sites:
```sql
CREATE POLICY site_scope ON vehicles
  USING (
    current_setting('app.scope_all_sites', true)::boolean
    OR site_id = ANY (string_to_array(current_setting('app.site_ids', true), ',')::uuid[])
  );
```

### 4.4 Cross-tenant leak testing (non-negotiable CI gate)
An automated suite that, for **every** table and **every** API endpoint:
1. Seeds two tenants with identical-looking data
2. Authenticates as tenant A
3. Attempts to read, update and delete every tenant B record by ID, by list, by search, by export, by feed, by public route and by API
4. Fails the build on any leak, and fails on any *new* table added without a corresponding policy and test

This test is the single most important thing in the repository. It runs on every PR.

### 4.5 Public site tenant resolution
Incoming `Host` header → `domains` table → brand → tenant. Cached at the edge. A domain must be verified (DNS TXT challenge) before it will resolve. Unknown hosts return a branded 404, never a default tenant.

---

## 5. Data model

Below is the core schema. Conventions: `uuid` v7 primary keys (time-sortable), `tenant_id` on everything tenant-owned, `created_at`/`updated_at`/`created_by`/`updated_by` on everything, soft delete via `deleted_at` **except** on financial and compliance tables which are never deleted, money stored as `bigint` minor units (pence) with an explicit `currency` column, all timestamps `timestamptz` in UTC.

### 5.1 Platform & identity

```
tenants(id, name, legal_name, companies_house_no, vat_number, fca_frn,
        fca_permission_type, ar_principal_name, ar_principal_frn,
        vat_scheme_default, hvd_registered, hvd_number,
        plan, status, trial_ends_at, settings jsonb, created_at)

sites(id, tenant_id, name, address jsonb, lat, lng, phone, email,
      opening_hours jsonb, timezone, settings jsonb, is_active)

users(id, email, name, phone, password_hash, mfa_secret, passkeys jsonb,
      last_login_at, status)

tenant_memberships(id, tenant_id, user_id, role, permissions jsonb,
                   scope_all_sites bool, invited_by, accepted_at, status)

user_sites(user_id, site_id, tenant_id)

roles(id, tenant_id, name, is_system, permissions jsonb)

api_keys(id, tenant_id, name, key_hash, scopes[], last_used_at, expires_at)

audit_events(id, tenant_id, site_id, actor_type, actor_id, resource_type,
             resource_id, action, diff jsonb, ip, user_agent, request_id,
             occurred_at)   -- partitioned monthly, never deleted

notifications(id, tenant_id, user_id, category, title, body, link,
              read_at, channels[], created_at)
```

### 5.2 Inventory

```
vehicles(id, tenant_id, site_id, stock_number, registration, vin,
         previous_registrations[], make, model, derivative, body_style,
         doors, seats, transmission, drivetrain, fuel_type, engine_cc,
         power_bhp, co2_gkm, euro_status, ulez_compliant,
         first_registered_on, model_year, colour, paint_type,
         mileage, mileage_unit, mot_expires_on, tax_band, insurance_group,
         former_keepers, service_history_type, last_service_date,
         last_service_mileage, key_count, v5c_present, v5c_reference,
         spec jsonb,                     -- full provider payload
         options jsonb,                  -- factory options
         features text[],                -- normalised searchable features
         status, status_changed_at, on_hold_reason,
         vat_scheme,                     -- 'margin' | 'qualifying' | 'non_qualifying'
         vat_scheme_locked_at,
         purchase_price, purchase_date, purchase_source, supplier_id,
         purchase_invoice_ref, funding_method, funder_id,
         retail_price, target_price, minimum_price, price_changed_at,
         total_cost_cached, projected_margin_cached,
         advert_headline, advert_description, advert_highlights[],
         attention_grabber, video_url, spin_url,
         booked_in_at, ready_at, live_at, reserved_at, sold_at, delivered_at,
         days_in_stock_cached, advert_strength_cached,
         search_vector tsvector, deleted_at)

vehicle_status_history(id, tenant_id, vehicle_id, from_status, to_status,
                       reason, actor_id, occurred_at)

vehicle_prices(id, tenant_id, vehicle_id, price, previous_price, reason,
               source, actor_id, effective_from)

vehicle_media(id, tenant_id, vehicle_id, kind, storage_key, variants jsonb,
              position, caption, tags[], is_hero, is_disclosure_evidence,
              width, height, bytes, processed_at, created_at)

vehicle_lookups(id, tenant_id, vehicle_id, provider, lookup_type,
                request jsonb, response jsonb, cost_pence, cached,
                performed_by, performed_at)

provenance_checks(id, tenant_id, vehicle_id, provider, reference,
                  outstanding_finance jsonb, write_off_category, stolen bool,
                  mileage_anomaly bool, plate_changes jsonb, imported bool,
                  exported bool, scrapped bool, raw jsonb, document_key,
                  adverse bool, acknowledged_by, acknowledged_reason,
                  checked_at)

mot_records(id, tenant_id, vehicle_id, test_date, result, expiry_date,
            odometer, odometer_unit, defects jsonb, advisories jsonb,
            test_number)

valuations(id, tenant_id, vehicle_id, provider, trade_value, retail_value,
           private_value, part_ex_value, forecast_days_to_sell,
           price_position_pct, comparables jsonb, valued_at, expires_at)

vehicle_costs(id, tenant_id, vehicle_id, category, description, supplier_id,
              estimated_amount, actual_amount, vat_amount, vat_treatment,
              status, approved_by, purchase_invoice_id, incurred_on)

prep_jobs(id, tenant_id, vehicle_id, stage, assigned_to, started_at,
          completed_at, sla_hours, is_blocked, blocked_reason,
          blocked_since, notes)

prep_job_items(id, tenant_id, prep_job_id, description, type, supplier_id,
               estimated_cost, actual_cost, status, part_number,
               ordered_at, eta, received_at, assigned_to, due_at)
```

### 5.3 Publishing & website

```
brands(id, tenant_id, name, logo_light_key, logo_dark_key, theme jsonb,
       tone_of_voice, is_default)

domains(id, tenant_id, brand_id, hostname, is_primary, verification_token,
        verified_at, ssl_status)

site_pages(id, tenant_id, brand_id, slug, type, title, meta jsonb,
           blocks jsonb, status, published_at, version, created_by)

site_page_versions(id, tenant_id, site_page_id, version, blocks jsonb,
                   created_by, created_at)

channels(id, tenant_id, provider, credentials_encrypted, config jsonb,
         status, last_sync_at, last_error, is_enabled)

channel_listings(id, tenant_id, vehicle_id, channel_id, external_id,
                 status, published_at, unpublished_at, last_pushed_at,
                 last_error, payload_hash, price_override,
                 description_override)

vehicle_views(id, tenant_id, vehicle_id, brand_id, session_hash, source,
              referrer, occurred_at)   -- partitioned monthly

saved_vehicles(id, tenant_id, brand_id, contact_id, session_hash,
               vehicle_id, created_at)

saved_searches(id, tenant_id, contact_id, criteria jsonb, alert_frequency,
               last_alerted_at)

search_events(id, tenant_id, brand_id, criteria jsonb, result_count,
              session_hash, occurred_at)   -- powers demand signals
```

### 5.4 CRM

```
contacts(id, tenant_id, type, title, first_name, last_name, company_name,
         emails jsonb, phones jsonb, addresses jsonb, date_of_birth,
         preferred_channel, preferred_times, tags[], custom jsonb,
         is_suppressed, suppressed_reason, source, owner_id,
         search_vector tsvector, deleted_at)

contact_consents(id, tenant_id, contact_id, channel, basis, granted bool,
                 wording_version_id, source, evidence jsonb,
                 recorded_by, recorded_at, expires_at)   -- append-only

contact_vulnerability(id, tenant_id, contact_id, category, note,
                      recorded_by, recorded_at, review_due_at,
                      resolved_at)   -- restricted access

leads(id, tenant_id, site_id, contact_id, vehicle_id, source, channel,
      campaign, stage, status, assigned_to, first_response_at,
      sla_due_at, next_action_at, next_action_note, loss_reason,
      loss_note, value_estimate, created_at, closed_at)

lead_events(id, tenant_id, lead_id, type, direction, channel, subject,
            body, metadata jsonb, actor_id, occurred_at)

messages(id, tenant_id, contact_id, lead_id, channel, direction,
         from_address, to_address, subject, body, body_html,
         attachments jsonb, provider_id, status, delivered_at, read_at,
         consent_check jsonb, sent_by, created_at)

calls(id, tenant_id, contact_id, lead_id, direction, from_number,
      to_number, duration_seconds, recording_key, recording_consent,
      outcome, notes, provider_id, occurred_at)

appointments(id, tenant_id, site_id, contact_id, vehicle_id, lead_id,
             type, starts_at, ends_at, assigned_to, status,
             location, notes, reminder_sent_at, outcome, no_show bool)

test_drives(id, tenant_id, appointment_id, vehicle_id, contact_id,
            licence_document_key, licence_check_code, licence_verified_by,
            insurance_confirmed, mileage_out, mileage_in, departed_at,
            returned_at, accompanied_by, condition_before jsonb,
            condition_after jsonb, signature_key, trade_plate_id)

automations(id, tenant_id, name, trigger jsonb, conditions jsonb,
            actions jsonb, is_enabled, quiet_hours jsonb,
            frequency_cap jsonb, created_by)

automation_runs(id, tenant_id, automation_id, subject_type, subject_id,
                status, step, consent_result, error, started_at, ended_at)
```

### 5.5 Deals, finance & compliance

```
appraisals(id, tenant_id, site_id, contact_id, registration, vin,
           make, model, derivative, mileage, spec jsonb,
           condition jsonb, damage_marks jsonb, media jsonb,
           trade_value, recon_estimate, offer_value, offer_expires_at,
           outstanding_finance jsonb, settlement_amount,
           settlement_expires_at, appraised_by, status,
           converted_vehicle_id, created_at)

deals(id, tenant_id, site_id, deal_number, contact_id, vehicle_id,
      salesperson_id, business_manager_id, status,
      vehicle_price, discount, admin_fee, delivery_charge, accessories jsonb,
      part_ex_appraisal_id, part_ex_value, part_ex_settlement,
      deposit_amount, deposit_paid_at, balance_due,
      contract_formation,            -- 'on_premises'|'distance'|'off_premises'
      contract_formed_at, contract_formed_location,
      cancellation_right_applies bool, cancellation_deadline,
      delivery_method, delivery_date, delivered_at,
      reject_window_ends_at, burden_of_proof_ends_at,
      total_gross_profit_cached, created_at, completed_at, cancelled_at)

deal_items(id, tenant_id, deal_id, kind, product_id, description,
           cost, price, vat_treatment, vat_amount,
           demands_and_needs jsonb, fair_value_ref, opted_in_at,
           opted_in_by)

finance_agreements(id, tenant_id, deal_id, lender, lender_frn, product_type,
                   term_months, apr, flat_rate, cash_price, deposit,
                   part_ex_contribution, amount_of_credit, balloon_gfv,
                   monthly_payment, total_charge_for_credit, total_payable,
                   annual_mileage, commission_type, commission_amount,
                   commission_disclosed bool, commission_disclosed_at,
                   application_reference, status, submitted_at,
                   decision_at, paid_out_at, conditions jsonb)

finance_quotes(id, tenant_id, deal_id, lender, product_type, apr,
               term_months, monthly_payment, total_payable,
               commission_amount, was_selected bool, presented_at)

affordability_assessments(id, tenant_id, deal_id, contact_id,
                          income jsonb, expenditure jsonb, dependants,
                          employment jsonb, address_history jsonb,
                          result, provider_reference, assessed_at)

deal_evidence(id, tenant_id, deal_id, sequence, event_type, payload jsonb,
              payload_hash, previous_hash, document_version_ids[],
              actor_id, occurred_at)
              -- append-only, hash-chained; NEVER updated or deleted

document_templates(id, tenant_id, kind, name, content, is_active)

document_versions(id, tenant_id, template_id, version, content,
                  effective_from, effective_to, approved_by, created_at)

documents(id, tenant_id, deal_id, vehicle_id, contact_id, kind,
          document_version_id, storage_key, signed bool,
          signature_provider, signature_envelope_id, signed_at,
          certificate_key, created_at)

historic_finance_introductions(id, tenant_id, agreement_date, lender,
        customer_name_hash, vehicle_registration, amount_of_credit,
        total_charge_for_credit, commission_amount, commission_type,
        had_dca bool, had_exclusivity bool, apr,
        scheme_flags jsonb, imported_from, created_at)
```

### 5.6 Money

```
invoices(id, tenant_id, site_id, deal_id, vehicle_id, contact_id,
         kind,                   -- 'sale'|'purchase'|'deposit'|'credit_note'
         number, number_sequence, issue_date, due_date,
         vat_scheme,             -- copied from vehicle, frozen
         subtotal, vat_amount, total, margin_amount, margin_vat,
         status, pdf_key, accounting_ref, accounting_synced_at,
         created_at)             -- immutable once issued

invoice_lines(id, tenant_id, invoice_id, description, quantity,
              unit_price, vat_rate, vat_amount, total, nominal_code)

stock_book_entries(id, tenant_id, entry_number, vehicle_id,
        purchase_date, purchase_invoice_ref, purchase_price,
        seller_name, seller_address, registration, vehicle_description,
        sale_date, sale_invoice_number, buyer_name, buyer_address,
        selling_price, margin, vat_due, adjustment_of_id,
        adjustment_reason, created_at)
        -- append-only; corrections create a new adjusting entry

payments(id, tenant_id, deal_id, invoice_id, contact_id, direction,
         method, amount, currency, reference, provider, provider_id,
         status, received_at, reconciled_at, refunded_amount,
         refund_reason)

cash_ledger(id, tenant_id, contact_id, deal_id, amount, currency,
            running_total, threshold_key, threshold_breached bool,
            override_by, override_reason, received_at)

purchase_invoices(id, tenant_id, supplier_id, vehicle_id, reference,
                  invoice_date, net, vat, gross, vat_recoverable,
                  status, document_key, accounting_ref)

suppliers(id, tenant_id, name, type, contact jsonb, account_number,
          payment_terms, rates jsonb, is_active)
```

### 5.7 Aftercare, people, compliance registers

```
cases(id, tenant_id, deal_id, vehicle_id, contact_id, type, channel,
      description, status, is_fca_complaint, opened_at,
      acknowledged_at, final_response_due_at, final_response_at,
      outcome, redress_amount, fos_referred, closed_at)

repair_attempts(id, tenant_id, case_id, deal_id, description,
                started_at, completed_at, pauses_reject_clock bool,
                cost, outcome)

staff_targets(id, tenant_id, user_id, site_id, period, units_target,
              gp_target, finance_penetration_target, addon_target)

commission_rules(id, tenant_id, name, rules jsonb, is_active)
commission_statements(id, tenant_id, user_id, period, lines jsonb,
                      total, approved_by, approved_at)

training_records(id, tenant_id, user_id, topic, provider, completed_at,
                 expires_at, certificate_key)

trade_plates(id, tenant_id, site_id, plate_number, licence_type,
             issued_on, expires_on, mid_registered bool, insurer,
             policy_number, status)

compliance_tasks(id, tenant_id, kind, subject_type, subject_id,
                 due_at, assigned_to, status, completed_at,
                 completed_by, evidence_key)

data_requests(id, tenant_id, contact_id, kind, received_at, due_at,
              status, legal_hold_reason, completed_at, export_key)

compliance_rules(id, key, version, effective_from, parameters jsonb,
                 source_url, notes)   -- PLATFORM-level, not tenant
```

> **`compliance_rules` is deliberately platform-level and data-driven.** The redress-scheme thresholds, the HVD cash threshold, VAT fractions, CRA windows and CONC triggers all live here as versioned parameters with a source URL, never as constants in code. When the law moves — and it is moving right now — we ship a data change, not a release.

### 5.8 Key indexes

```sql
-- tenant-first composite indexes on every hot path
CREATE INDEX ON vehicles (tenant_id, status, site_id);
CREATE INDEX ON vehicles (tenant_id, booked_in_at);
CREATE UNIQUE INDEX ON vehicles (tenant_id, registration) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ON vehicles (tenant_id, stock_number);
CREATE INDEX ON vehicles USING gin (search_vector);
CREATE INDEX ON vehicles USING gin (features);
CREATE INDEX ON vehicles (tenant_id, make, model, retail_price);

CREATE INDEX ON leads (tenant_id, stage, assigned_to, next_action_at);
CREATE INDEX ON leads (tenant_id, sla_due_at) WHERE first_response_at IS NULL;

CREATE INDEX ON contacts USING gin (search_vector);
CREATE INDEX ON contacts USING gin ((emails) jsonb_path_ops);

CREATE UNIQUE INDEX ON deal_evidence (tenant_id, deal_id, sequence);
CREATE UNIQUE INDEX ON invoices (tenant_id, kind, number);
CREATE UNIQUE INDEX ON stock_book_entries (tenant_id, entry_number);

CREATE INDEX ON channel_listings (tenant_id, channel_id, status);
CREATE INDEX ON vehicle_views (tenant_id, vehicle_id, occurred_at);
```

`audit_events`, `vehicle_views` and `search_events` are partitioned monthly and archived to object storage after 24 months (audit metadata retained 7 years).

---

## 6. Public site rendering

### 6.1 Strategy
- **Static generation with on-demand revalidation.** Vehicle pages and search facets are pre-rendered. Any change to a vehicle emits a `vehicle.updated` event → a job revalidates that vehicle's page, the search index, the sitemap and any listing page it appears on. Target: live on the dealer's own site within 20 seconds of the change in the CRM.
- **Edge caching** with stale-while-revalidate. If the origin is unavailable, the CDN keeps serving. The dealer's shopfront does not go dark.
- **Zero-JS baseline.** Search results, VDP content, specs and MOT history render server-side. JavaScript enhances (gallery, filters, calculator) but is never required to see a car or find a phone number.
- **Image pipeline**: original → AVIF/WebP/JPEG at 5 breakpoints, served from R2/Cloudflare Images with long cache lifetimes and content-hashed URLs.

### 6.2 Search implementation
v1: Postgres with a materialised `vehicle_search` view per brand, GIN indexes, and `pg_trgm` for keyword. Facet counts computed with grouping sets in a single query. When a tenant exceeds ~5,000 live vehicles or facet latency exceeds 150ms, switch that tenant to Typesense behind the same interface.

### 6.3 Monthly-payment search
The "search by monthly payment" facet is a major conversion feature — and a compliance minefield. Implementation: precompute an indicative payment per vehicle nightly from the tenant's representative finance parameters, store as `indicative_monthly_payment`, and render it **only** through the `<FinancePromotion>` component, which will not mount without a valid, in-date representative example record. Filtering by payment band is allowed; displaying a payment without the example is impossible by construction.

---

## 7. Jobs and eventing

### 7.1 Queues (isolated, with independent concurrency and DLQs)

| Queue | Jobs | Notes |
|---|---|---|
| `lookup` | DVLA, MOT, spec, valuation, provenance | Strict per-provider rate limits; cost accounting per job; aggressive caching |
| `media` | Resize, AVIF/WebP, plate blur, background removal, EXIF strip, spin processing | CPU heavy; separate worker pool |
| `feed` | Per-channel publish/unpublish/update | Debounced per vehicle (5s), batched per channel, idempotent by payload hash |
| `comms` | Email, SMS, WhatsApp, push | Consent check re-evaluated **at send time**, not at schedule time |
| `document` | PDF generation, e-sign envelopes, evidence bundles | |
| `accounting` | Xero/QBO/Sage push, retries, reconciliation | Idempotency keys mandatory |
| `automation` | Sequence steps, reminders, retention triggers | |
| `maintenance` | Cache warming, revalidation, aging recalcs, retention/erasure, report scheduling | |

### 7.2 Domain events
The application emits typed domain events (`vehicle.created`, `vehicle.price_changed`, `vehicle.status_changed`, `lead.created`, `deal.completed`, `payment.received`, `consent.changed`…) onto an internal bus. Subscribers handle revalidation, feed sync, automation triggers, analytics and webhooks. This keeps the write path fast and makes new integrations additive.

Events are persisted (`domain_events` table) so we can replay, debug and, later, offer webhooks to tenants without re-plumbing.

### 7.3 Rules for external calls
- Every adapter implements a common interface: `execute()`, `healthCheck()`, `costPerCall()`, `rateLimit()`.
- Circuit breaker per provider; on open, the UI degrades gracefully with a named, specific message.
- Every job carries an idempotency key. Every response is stored raw alongside the parsed result, so a parser bug is recoverable without re-paying for the call.
- Provider credentials are per-tenant where the tenant holds the contract (Auto Trader, accounting, finance) and platform-level where we hold it (DVLA, MOT, aggregators). Both encrypted at rest with envelope encryption (KMS).

---

## 8. Security

| Control | Implementation |
|---|---|
| Transport | TLS 1.3 everywhere; HSTS preload on all domains |
| At rest | Full-disk encryption; column-level encryption (AES-GCM via KMS) for DOB, licence numbers, bank details, provider credentials, recording keys |
| Secrets | Cloud secret manager; no secrets in env files in the repo; rotation runbook |
| AuthN | Argon2id password hashing, passkeys, TOTP; mandatory MFA for Owner and finance/export permissions |
| AuthZ | Server-side permission checks on every resolver/route; UI hiding is never the control |
| Step-up auth | Re-authentication for contact export, bank detail changes, commission edits, bulk delete, impersonation |
| Input | Zod validation at every boundary; parameterised queries only; strict CSP with nonces; no `dangerouslySetInnerHTML` outside a sanitised rich-text renderer |
| Uploads | Type and magic-byte validation, size limits, virus scan, stored outside the web root, served via signed URLs |
| Rate limiting | Per IP, per tenant, per user, per endpoint; stricter on auth, lookup and export |
| PII in logs | Structured logging with an automatic redaction layer; never log request bodies containing PII |
| Impersonation | Time-limited, reason-required, tenant-consented, banner-visible, fully audited, finance data excluded without second approval |
| Backups | Continuous WAL archiving + daily snapshots, 35-day PITR, quarterly restore drills that are actually performed and documented |
| Pen testing | Annual third-party test before the first enterprise/Group customer; automated dependency and container scanning in CI |
| Incident response | Documented runbook, 72-hour ICO breach notification path, breach register (§5.7) |

### 8.1 GDPR posture
We are the **processor**; each dealer is the **controller** of their customers' data. Required: a per-tenant DPA (Art. 28), a published and versioned sub-processor list with change notification, documented UK/EU-only processing locations, TOMs documentation, DSR tooling (§13.2 of the functional spec), and a clear boundary where we act as **controller** in our own right — our own dealer-facing marketing, product analytics, and any anonymised benchmarking product. That boundary must be explicit in both the DPA and our privacy notice; blurring it is a common and serious SaaS failure.

---

## 9. Testing strategy

| Layer | What |
|---|---|
| Unit | Pure logic: VAT margin calculation, CRA/CCR clock arithmetic, commission rules, price ladders, feed mappers, consent evaluation |
| Property-based | Money arithmetic and VAT rounding (fast-check) — never trust hand-picked examples for currency maths |
| Integration | API + database with RLS active, against a real Postgres in Docker |
| **Tenant isolation** | The automated cross-tenant leak suite (§4.4) — **blocking CI gate** |
| Contract | Recorded fixtures for every external provider; adapters tested against them; a nightly job checks live provider responses against the fixture shape and alerts on drift |
| E2E | Playwright over the critical journeys: onboard tenant, add vehicle by reg, publish, receive lead, build deal, invoice, deliver |
| Performance | k6 load tests; Lighthouse CI with a **failing** budget on public pages |
| Accessibility | axe-core in CI on every page type; manual keyboard and screen-reader pass before each release |
| Compliance | Golden-file tests: a margin-scheme invoice must never contain a VAT line; a finance promotion must never render without a representative example; a marketing send must never dispatch without a valid consent record. These are tests, not conventions. |

---

## 10. Environments and delivery

`local` (Docker Compose: Postgres, Redis, MinIO, Mailpit) → `preview` (per-PR, seeded demo tenant) → `staging` (production-shaped, anonymised data, all integrations in sandbox) → `production`.

- Trunk-based development, short-lived branches, feature flags for anything unfinished.
- **Expand/contract migrations only** — never a destructive migration in the same release as the code that depends on it. Every migration reversible or paired with a documented forward fix.
- Blue/green or rolling deploys; database migrations gated and run separately from app deploys.
- Every release: changelog published in-app, and a documented rollback path.

---

## 11. Onboarding a new dealer — technical sequence

1. `POST /admin/tenants` → creates tenant, default site, default brand, default roles, seeds document templates from the platform library, seeds `compliance_rules` references.
2. Provision: Stripe customer + subscription, sending subdomain (DKIM/SPF/DMARC records generated), object storage prefix, search index namespace.
3. Import: stock (CSV/named importer/reg-list), contacts, media. Each import creates an `import_batch` with per-row results and a 24-hour single-click undo.
4. Enrich: queue lookup jobs for every imported registration; populate spec, MOT and valuation; flag ambiguous derivatives for human confirmation.
5. Website: apply theme, generate default pages, verify domain, issue TLS, warm the cache, run a Lighthouse and structured-data pre-flight and show the dealer the score.
6. Channels: per-channel OAuth/credential capture, validation publish of one vehicle, then bulk enable.
7. Go-live checks: stock > 0, hero images present, mandatory stock-book fields complete, one successful feed push, one test lead end-to-end, one test invoice generated and voided.
8. Flip `tenants.status = 'live'`, start the trial/billing clock, notify the CSM.

**Target: fully automated except for the human confirmation steps. No engineering involvement, ever.**

---

## 12. Scale plan and cost model

Assume 500 tenants × 45 vehicles average = ~22,500 live vehicles; ~15 vehicle photos each = ~340,000 images; ~5,000 leads/month across the platform at launch scale.

That is a **small** dataset. Postgres handles it on a modest instance for years. The costs that actually matter, in order:

1. **Vehicle data lookups** — the dominant marginal cost. Cache indefinitely for spec, 24h for DVLA/MOT/valuation. Meter per tenant, include a generous allowance in the plan, charge for overage. Negotiate volume pricing early (note: cap hpi and HPI Check share a parent in Solera — negotiate valuation + provenance together).
2. **Image storage and egress** — use R2 (zero egress) rather than S3. This decision alone is worth thousands a year at scale.
3. **Public site bandwidth and compute** — mitigated by static generation and edge caching.
4. Everything else (Postgres, Redis, workers) is rounding error at this scale.

**Scale-out order when it's needed:** read replica for the public renderer → dedicated search cluster → partition the hot event tables → separate the media pipeline onto its own infrastructure → per-tenant database for the largest Group customers. Do none of these before the metrics demand them.
