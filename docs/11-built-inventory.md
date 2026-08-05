# 11 — What is actually built

**As at 5 August 2026.** A complete inventory of the product as it stands: what
works, what is half-built and why, and what is not started.

This document is deliberately conservative. Where something is schema and
domain logic with no screen, it says so. Where a module is split because half
of it needs a commercial contract, it says which half. "Built" here means
tested and running against a real database, not designed.

**Totals:** 4 applications · 22 migrations · 98 tables, every one with row-level
security enabled *and* forced · 1,651 tests across 48 files, of which 302 are
the cross-tenant isolation suite · 31 domain modules.

---

## 1. The applications

| App | Port | What it is | State |
|---|---|---|---|
| `apps/crm` | 3002 | The authenticated dealer application | **Every screen built** — 17 routes |
| `apps/site` | 3000 | The public multi-tenant dealer website | Renderers, SEO core and data layer built; block editor and domain-verification flow outstanding |
| `apps/admin` | 3003 | Platform administration, separate deployment and separate auth | **Partial** — see M20 |
| `apps/audit` | — | The dealer-site audit tool, 16 checks | Built; no web front end |

Four database roles enforce the separation: `app_user` (CRM, `NOBYPASSRLS`),
`app_public` (site, read-only, `NOBYPASSRLS`), `app_platform` (admin,
`BYPASSRLS`, **column-level grants only**) and `app_migrator`.

---

## 2. Tenant isolation — the thing everything else rests on

Four layers, in this order:

1. **Row-level security, enabled and forced** on all 98 tables. A table without
   both fails `pnpm db:policies`, which is a CI gate.
2. **`SET LOCAL ROLE`** inside every transaction, so the connection is never a
   superuser and the policies are actually consulted. This was added after a
   real leak: `withSession` and `withTenant` set a tenant context but never a
   role, and local development connects as `postgres`, for which policies are
   not consulted at all — so every CRM screen read across every tenant. It
   surfaced because the VAT stock book showed nine entries for a dealership
   with six.
3. **A single door per application** — `withSession` (CRM), `withTenant`
   (site), `acrossTenants` (admin). No other module hands out a tenant id.
4. **The isolation suite**, 302 tests, blocking. `cross-tenant.test.ts` proves
   the policies are right; `app-doors.test.ts` proves the application actually
   arrives at them, by going through the real doors and the real loaders while
   connected as a superuser. Verified to fail 8 of 10 with the role fix removed.

---

## 3. Module by module

### M0 — Dealer site audit tool ✅
16 checks against a live dealer website, fixture mode for offline runs. Our own
generated site scores **100/100**; the benchmarked competitor scores 16. The
generated-site self-audit is a build gate, run against real rendered HTML.
*Outstanding: a web front end.*

### M1 — Foundation ✅
Workspace, design tokens, the domain package, the database and RLS generator,
the isolation suite.

### M2 — Tenancy and identity ✅ · 13 tables
Tenants, sites, users, memberships, 9 roles, permissions with **derived-value
protection** (a figure computed *from* cost is withheld from a role without
`vehicle.cost.read`, not just the cost itself), provisioning and a go-live
checklist.

### M3 — Vehicle core ✅ · 4 tables
The 15-state lifecycle — sourcing → purchased → in transit → booked in → in prep
→ ready → live → reserved → sold → delivered, plus on hold, returned, trade
disposal, written off, archived. Go-live gating (mandatory stock-book fields, a
published photo, a price, a VAT scheme, a completed provenance check), days
metrics, advert strength. Registration is unique per tenant among non-archived
vehicles — two dealers can hold the same plate.

### M4 — Vehicle data and provenance 🟨 half
**Built:** the adapter framework (cache, per-tenant cost metering, circuit
breaker, idempotency, raw-response storage, fixture replay), DVLA VES and DVSA
MOT History adapters, registration normalisation and formatting, mileage
anomaly detection. 3 tables.
**Blocked:** valuation (cap hpi) and provenance (HPI Check) need commercial
contracts. The interface and the columns are ready.

### M5 — Media pipeline ✅ · 2 tables
Guided capture plan (15 shots, 5 required), ordering and hero rules, responsive
variants (AVIF/WebP/JPEG × 5 breakpoints), tenant-prefixed content-hashed
storage keys, **mandatory EXIF stripping**, upload validation by magic bytes.
`published_photo_count` is maintained by a database trigger because M3's
go-live gate depends on it.

### M6 — Public website engine ✅
Slugs, canonical URLs, a sitemap built from live stock, robots.txt, sold-vehicle
301 resolution, per-vehicle titles and descriptions, JSON-LD (Car, Offer,
AutoDealer, BreadcrumbList, ItemList). Host-to-tenant resolution where an
unknown or unverified host **404s rather than falling through**. Theme tokens as
CSS custom properties, the vehicle detail page, the home page, the masthead with
server-computed opening status. Zero-JS and page-weight budgets enforced by
test.
*Outstanding: block editor, domain verification flow, analytics with consent mode.*

### M7 — Public inventory experience ✅ · 4 tables
Faceted search with **crawl control as a first-class feature** — a small
allow-list of indexable URL shapes and `rel="nofollow"` on the rest, so ten
facets do not become millions of near-duplicate URLs. A zero-JS results page:
facets, sorting, pagination and saving all work without a script. Zero-result
relaxation ladder, demand-signal capture (append-only, partitioned), shortlists
with anonymous→account merge, saved searches that send.

### M8 — Finance display and compliance ✅ built · ⛔ **not live**
The `ApprovedPromotion` gate: a cost-of-credit figure cannot reach a screen
without a signed-off rule, an approved in-date representative example and
reconciling arithmetic — enforced by the type system, the renderer, the database
and a golden-file test. APR verification by the CCD formula. A cost-of-credit
language scanner that blocks publish. The 51% representative-APR governance
report. 5 tables.
**The seeded rule ships unsigned and nothing renders until the retained FCA
consultant signs it.** This is the single gate on a live Kennington site.

### M9 — Contacts and consent ✅ · 6 tables
Consent as an **append-only record derived at a point in time**, never a
boolean: `consentPosition(channel, history, asAt)` with `asAt` required, so
nobody gets the scheduling-time answer to a send-time question. PECR reg. 22
soft opt-in as a four-part test reporting every failure. Legitimate interest
refused for email, SMS and WhatsApp. Suppression append-only with an `active`
flag. Dedupe that will not auto-merge a name-and-postcode match. Merge
re-points consent and unions vulnerability flags. Partial erasure with a stated
basis for anything retained.

### M10 — Leads and communications ✅ · 4 tables
Lead inbox, pipeline with **mandatory structured loss reasons** (refused in the
domain, in the server action and by CHECK constraint), SLA measured from the
first outbound message rather than a button, marketplace parsers that triage
instead of throwing. The outbound gate delegates to M9's `canSend`, so there is
one implementation of "may we contact this person?". `messages` cites the
consent record by id, enforced by a CHECK.

### M11 — Money ✅ built · ⚠️ needs VAT specialist sign-off · 7 tables
Invoicing with **gapless numbering from a locked counter row** — a Postgres
SEQUENCE cannot be used because it does not roll back, and an aborted
transaction would leave exactly the gap the rule prevents. Cancellation is a
credit note with its own number, never a released one. Invoices are
content-frozen on issue rather than blanket append-only, because an invoice has
a lawful draft→issued→paid lifecycle. **The margin-scheme rule is enforced at
four layers** — construction, guard, two CHECK constraints, and a golden test
that renders a document and greps it. The VAT stock book with all 12 mandatory
fields, a severity-graded health report, and period VAT summed per entry so a
loss on one car never offsets another. AML cash threshold read from
`compliance_rules` keyed on the receipt date.

### M12 — Deals and the Evidence Ledger ✅ built · ⚠️ needs FCA sign-off · 6 tables
**The append-only, hash-chained evidence ledger** — each entry hashes its
predecessor, so tampering is provable by someone who does not trust us, which is
the person who will be checking. Canonical JSON so the hash is reproducible in
another language years later. `verifyChain` reports every problem rather than
the first. The export bundle carries a *failing* verification rather than
refusing to produce one. Contract formation is mandatory before contracting,
because it decides the 14-day cancellation right and is wrong in both
directions if defaulted. Add-ons refused if accepted before offered — that is
the data shape of a pre-ticked box. Repair start dates frozen, completion
permitted.

### M13 — Part-exchange appraisal ✅ · 7 tables
Tap-to-mark damage map (46 panels → 8 costing groups), recon estimate from
versioned tenant standard costs, valuation panel, offer with an internal
breakdown, settlement tracking, conversion to stock with no re-keying. **A mark
with no standard cost is reported, never priced at zero** — a silent zero makes
a damaged car look clean and inflates the allowance by exactly the repair bill.
**The purchase price that reaches the stock book is the allowance, not the
market value.** `customerFacingOffer` is built rather than filtered, so cost
data has nowhere to leak from.

### M14 — Prep pipeline ✅ · 6 tables
Configurable stage board, job cards linked to M3 vehicle costs rather than
duplicating money, parts tracking, SLAs, MOT advisories as suggested work, the
photography gate. **The module turns on one distinction: blocked time reported
separately from working time, with overlapping blocks merged** — a car waiting
on a part and an approval at once sat for one day, not two, and an unmerged
total can exceed the time the car has been in stock. Property-tested three ways.

### M15 — Pricing intelligence ⬜ not started
Contract-blocked on cap hpi.

### M16 — Channel feeds 🟨 half · 5 tables
**Built:** one canonical vehicle, eight versioned adapters (Auto Trader, eBay
Motors Group, CarGurus, Carwow, Meta, Google Vehicle Ads, XML, CSV) with
per-channel validation, publish preview, publish rules, delisting deadlines,
feed health, retry policy, and a status screen. **A cost-of-credit figure
cannot reach a feed** — a portal renders our payload on their page with nowhere
to attach the representative example, so `assertNoFinanceInFeed` runs inside a
wrapper every adapter is constructed with. Delisting is a stored deadline with a
partial index, so a sold car still advertised is a query rather than a job
somebody hopes ran.
**Blocked:** pushing to Auto Trader needs partner status.

### M17 — Accounting sync 🟨 half · 4 tables
**Built:** a canonical chart of 12 account keys, double-entry postings for
invoices, credit notes and payments, account and tax-rate mapping with a
recorded agreement, dry run, error queue with retry policy, CSV fallback, and a
screen. **A margin sale posts no output VAT on the invoice *and* a separate
journal for the VAT on the margin** — both mandatory, each wrong without the
other, and `postingsFor` returns the pair or refuses. Nothing posts to an
unmapped account and every unmapped one is reported at once. A credit note
reverses by swapping sides, never by negating. Refunds are excluded and counted
rather than posted, because reversing them is *probably* right and probably is
not good enough for somebody else's books. **The CSV fallback needs no
integration at all.**
**Blocked:** Xero, QuickBooks and Sage need OAuth applications.

### M18 — Reporting and the Channel P&L ✅ · 3 tables
The Channel P&L, attribution, owner dashboard tiles, drill-through, CSV export.
**A deal with no lead is unattributed, never credited to the website** — the
tempting wrong answer, and the one that would flatter us specifically. A sale is
credited to the lead it was worked from, with assisting channels named beside
it; deliberately not a weighted multi-touch model, because a dealer doing thirty
cars a month cannot audit fractional credit. No figure is ever `Infinity` or
`NaN` (property-tested). Below six sales the ROI is not stated at all.

### M19 — Compliance centre ✅ · 4 tables
Compliance scoring, DISP complaint clocks, the 72-hour ICO breach clock,
registers with expiry, evidence completeness per deal. **A compliance statement
cannot be constructed without a source citation** — an FCA Handbook reference,
an HMRC notice or legislation — so a dealer's own adviser can check our
interpretation. **The score never counts an unassessable area as a pass**, which
is how every flattering compliance dashboard reads 100% for a dealer who has
recorded nothing. The DISP clock runs from receipt; the breach clock runs from
*awareness*, so a laptop taken in March and noticed in June gives 72 hours from
June. A breach's Article 34 risk has three states, and "not assessed" is a
finding rather than a low-risk answer.

### M20 — Platform admin and billing 🟨 **partial** · 7 tables
**Built:** subscriptions with dunning, stock-band plans, feature flags,
per-tenant usage quotas, support impersonation logic, `platform_operators` and
`operator_sessions`, operator authentication with unconditional MFA, sign-in,
and the tenant directory. `app_platform` has **column-level** grants, so the
database refuses `vehicles.registration` and every customer-data table outright.
Impersonation's safeguards are all refusals: a live tenant grant, a real reason,
a window capped at four hours, and a second person for commission data —
enforced by a CHECK constraint, not only in code. Dunning never withholds the
stock book or the VAT records, because those are the dealer's statutory records
and not ours to hold hostage.
**Not built:** the tenant detail page, the impersonation request and approval
flow, the billing actions, an admin seed and admin integration tests.

---

## 4. The CRM's screens

| Route | What a dealer does there |
|---|---|
| `/` | The owner dashboard — stock at cost, units this month against target, average gross, days to sell with trend, overage, leads waiting, and where the sales came from. Every tile opens the records behind it. |
| `/stock`, `/stock/[id]` | The stock list and vehicle detail. Filters are a plain GET form: no JavaScript, state in the URL, works with the back button. Budgeted and measured at 1,000 rows filtering in under 400ms; the query time renders on the page. Cost is redacted **in SQL**, so the figure never leaves Postgres for a role that may not see it. |
| `/leads`, `/leads/[id]` | The lead inbox, ordered by who is closest to being lost rather than who arrived last. Every SLA figure renders as a clock time as well as a countdown. The consent panel answers twice per channel — service messages need no consent, marketing does — because a screen showing only "no consent" teaches staff not to reply at all. |
| `/deals`, `/deals/[id]` | Deals, the statutory clocks and the evidence ledger, which is **verified on every read** and whose failure renders above everything it would undermine. Consumer Rights Act windows are read from `compliance_rules` keyed on the delivery date; a missing parameter throws rather than defaulting. |
| `/invoices`, `/invoices/[id]` | Invoicing, credit notes, payments. |
| `/vat/stock-book` | The margin-scheme record HMRC asks to see, all 12 fields, with a health report. |
| `/reports/channels` | The Channel P&L and its CSV export. |
| `/compliance` | Complaint clocks, breach clocks, registers, evidence gaps, and the score with its workings. |
| `/channels` | Where your stock actually is — what published, what a portal rejected and in its own words, what is sold and still advertised. |
| `/accounting` | The dry run: exactly what would be posted, and why nothing is. |
| `/prep` | The stage board, with blocked time reported separately from working time. |
| `/appraisals`, `/appraisals/new`, `/appraisals/[id]` | Part-exchange appraisal, damage map, offer. |
| `/sign-in`, `/mfa`, `/reset/[token]` | Authentication. |

**Authentication:** Argon2id passwords, opaque session tokens stored as SHA-256,
absolute and idle lifetimes, account lockout, **per-IP rate limiting** (the hole
lockout cannot close — one password sprayed across five hundred accounts trips
nothing per-account), MFA enrolment and enforcement on the read path of the
`(app)` route group, ten single-use recovery codes issued at enrolment, and
admin-initiated password reset.
*Outstanding: self-service "email me a reset link" needs an email adapter, and
there is none — the token machinery is real, the delivery is the gap.*

---

## 5. Cross-cutting guarantees

- **Money is `bigint` minor units with an explicit currency**, never a float,
  never arithmetic in the browser. Every rounding path is property-tested.
- **Regulatory values are data**, read from `compliance_rules` keyed on the
  relevant date. No literal thresholds.
- **Financial, invoice, stock-book and evidence records are append-only.**
  Corrections create a new versioned or adjusting row.
- **Every mutation writes an audit event** with a before/after diff, in the same
  transaction as the mutation.
- **Both colour modes are AA-clean**, measured against the rendered pages rather
  than asserted.
- **Every list has a designed empty state and an error state that says what to
  do.** "An error occurred" is banned and enforced in review.

### The golden-file gates that must never be deleted

1. A margin-scheme invoice never contains a VAT line — rendered and grepped
   through the one real renderer, not a fixture.
2. A cost-of-credit figure never renders without a valid representative example.
3. A marketing message never dispatches without a valid consent record — 14
   adversarial tests enumerating every route to an unlawful send.

---

## 6. Known gaps, ranked

1. **The FCA compliance consultant's sign-off** — the only thing between us and
   a live Kennington site. What they approve is one reviewable data row, not a
   codebase.
2. **A VAT specialist for M11** and an FCA review for M12, both before go-live.
3. **Commercial contracts** — cap hpi and HPI Check gate M4 and M15; Auto Trader
   partner status gates M16's wire half; OAuth applications gate M17's.
4. **M20's remaining pieces** — tenant detail, impersonation flow, billing actions.
5. **No email adapter**, so self-service password reset cannot deliver.
6. **`pnpm tokens:build` does not exist** — `packages/tokens/build.mjs` was
   never written, so the CRM's `@theme` block is hand-copied from `tokens.json`
   and can drift.
7. **`good` (#0CA30C) measures 3.35:1 on white** in a 12px badge, short of AA.
   It is a published design-system value, so changing it is a designer's call.
8. **A £0.00 purchase price satisfies the stock book's mandatory-field check.**
   The screen now names it as missing; whether the domain should treat a zero as
   absent is a question for the VAT specialist.
9. **The lead conversion rate is stated from any sample size** — "50%, 1 won of
   2 closed" — where the same product refuses an average below 5 sales and an
   ROI below 6. The existing behaviour is deliberately tested, so changing the
   floor is a product decision rather than a bug fix.
