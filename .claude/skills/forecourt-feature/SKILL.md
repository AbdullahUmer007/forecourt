---
name: forecourt-feature
description: The workflow and engineering rules for building a feature slice in the Forecourt multi-tenant dealer SaaS - spec, schema, tenant isolation, API, jobs, UI, tests and rollout. Use when adding, changing or reviewing any feature, module, endpoint, migration, background job or integration in the Forecourt codebase. Trigger words - new feature, add module, migration, schema change, endpoint, API, background job, integration, multi-tenant, RLS, code review, pull request.
---

# Building a feature in Forecourt

A vertical slice, in this order. Do not start with the UI — the UI is the last thing that is cheap to change and the first thing that is wrong if the model underneath it is wrong.

## The order

### 1. Write the slice spec first (15 minutes, not a document)

Before any code, answer these in the PR description:

- **Who** is the user and where are they standing? (desk / forecourt / workshop / auction hall — this decides the UI)
- **What job** does this do, in the dealer's own words?
- **What data** does it create, read or change? Which existing tables?
- **What is the compliance surface?** Money, VAT, consent, finance, evidence, retention, PII? If yes to any → read the `forecourt-domain` skill and `references/compliance-rules.md` before continuing.
- **What breaks if this is wrong?** A wrong price, a missing consent record, a leaked tenant boundary, an unpublishable feed?
- **How does it degrade** when an external provider is down?
- **What is the acceptance criteria?** Three to six testable statements.

If the feature touches the vehicle lifecycle, the VAT stock book, motor finance or marketing consent, get the spec reviewed before writing code. Those four are where mistakes are expensive.

### 2. Schema

Read `references/tenancy-checklist.md` and follow it exactly. In summary:

- `tenant_id uuid not null` on every tenant-owned table. `site_id` where the record is operational.
- UUID v7 primary keys. `created_at`, `updated_at`, `created_by`, `updated_by` on everything.
- Money as `bigint` minor units with an explicit `currency` column. Never `numeric` for money, never a float, ever.
- Timestamps `timestamptz`, stored UTC, rendered in the tenant's timezone.
- **Financial, invoice, stock-book and evidence tables are append-only.** No `deleted_at`, no updates — corrections create a new versioned or adjusting row.
- Enable **and force** row-level security, with a policy. A table without both fails the CI gate.
- Tenant-first composite indexes on every hot path (`(tenant_id, status, site_id)`, not `(status)`).
- Expand/contract migrations only. Never a destructive migration in the same release as the code that depends on it.

### 3. Domain logic

- Pure functions, no I/O, unit tested. Especially anything computing money, VAT, dates or clocks.
- **Property-based tests for all money arithmetic** — never trust hand-picked examples for currency maths.
- Regulatory constants come from `compliance_rules` keyed on the relevant date (sale date, agreement date, delivery date). **Never a literal threshold in code.**
- All calculations live in `packages/domain` and are importable by both the API and the workers. The browser never computes a customer-facing figure.

### 4. API

- tRPC for first-party app traffic; REST/OpenAPI for the public and partner API.
- Zod schemas at every boundary, shared between client and server.
- **Server-side permission check on every procedure.** UI hiding is a convenience, never the control.
- Field-level permission filtering happens server-side too — if a user can't see cost prices, the payload must not contain them, and no derived value may reveal them (no margin, no "profit" column, no total-cost sorting).
- Every mutation emits a typed domain event.
- Every mutation writes an audit event with a before/after diff.
- Errors are typed and carry a user-facing message that says what to do.

### 5. Jobs

Anything touching an external provider is a job, never a request handler.

- Pick the right queue: `lookup` · `media` · `feed` · `comms` · `document` · `accounting` · `automation` · `maintenance`. They have independent concurrency and dead-letter queues for a reason.
- **Idempotency key on every job.** Feed publishes debounce per vehicle (5s) and deduplicate by payload hash.
- Store the raw provider response alongside the parsed result.
- Circuit breaker per provider. On open, the UI shows a **named, specific** degraded message — never a generic error.
- Meter cost per tenant on anything that costs money per call (all vehicle data lookups).
- **`comms` jobs re-check marketing consent at send time**, not at schedule time. A consent withdrawn between scheduling and sending must stop the send.

### 6. UI

Read the `forecourt-ui` skill. Pick one of the six screen patterns. Build in Storybook first with every state, then wire it up.

### 7. Tests

| Layer | Required |
|---|---|
| Unit | All domain logic, especially money, VAT and clocks |
| Property-based | Every money and rounding path |
| Integration | API + database **with RLS active**, real Postgres |
| **Tenant isolation** | Every new table and endpoint added to the cross-tenant leak suite — **blocking CI gate** |
| Contract | Recorded fixtures for every external provider touched |
| E2E | If it's on a critical journey (add vehicle → publish → lead → deal → invoice → deliver) |
| Golden-file | If it touches an invoice, a finance promotion, or a marketing send (see below) |
| a11y | axe-core on every new page type |
| Performance | Lighthouse budget if it touches a public page |

**The three golden-file tests that must never be deleted:**
1. A margin-scheme invoice never contains a VAT line.
2. A cost-of-credit figure never renders without a valid representative example.
3. A marketing message never dispatches without a valid consent record.

### 8. Rollout

- Behind a feature flag if it's not trivially reversible.
- Migration runs separately from and before the app deploy.
- Changelog entry, published in-app.
- A documented rollback path in the PR.
- If it changes anything a dealer sees daily, tell the design partners before it ships.

---

## Code review checklist

Reject a PR that fails any of these:

- [ ] Every new table has `tenant_id`, RLS enabled **and** forced, a policy, and a leak test
- [ ] No database query without a tenant scope
- [ ] No money as a float or a `number`; no currency arithmetic in the browser
- [ ] No regulatory threshold, VAT rate or scheme date as a literal
- [ ] No hex colour outside the token files
- [ ] Server-side permission checks, not just UI hiding
- [ ] Financial/evidence records appended, never mutated or deleted
- [ ] External calls go through a job with an idempotency key and a circuit breaker
- [ ] Consent re-checked at send time on any comms path
- [ ] Loading, empty and error states exist and are designed
- [ ] Error messages say what to do
- [ ] Audit event written for every mutation
- [ ] Tests at the right layers, including the isolation suite
- [ ] Expand/contract migration, reversible or with a documented forward fix
- [ ] Dealer vocabulary in all user-facing copy (forecourt, part-ex, reg, prep — not lot, trade-in, plate, detailing)

---

## Common mistakes in this codebase

| Mistake | Why it bites |
|---|---|
| Adding a table without an RLS policy | The leak suite catches it, but only if the table is registered — register it |
| Filtering by `tenant_id` in the ORM and assuming that's enough | It isn't. RLS is the last line of defence and must always be there too |
| Computing a price or margin client-side "just for the preview" | It will drift from the server value and a dealer will find it |
| Reading a regulatory value from a constant "for now" | The law is moving. "For now" becomes a production incident |
| A `marketing_opt_in` boolean | Consent is a record with a basis, a source, a timestamp and a wording version |
| Deleting or updating an invoice or evidence row | These are evidence. Append a correction |
| Calling an external API from a request handler | It will time out in front of a user, and it will be called twice |
| Publishing a feed without previewing the payload | Every portal has a different schema and its own idea of what a valid mileage is |
| A generic "Something went wrong" | Name the system, say what still works, say what to do |
| Assuming DVLA gives you the derivative | It usually doesn't. Show a picker; never guess |
