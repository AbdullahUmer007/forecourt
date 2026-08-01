# Forecourt — Module Build Plan & Build Protocol

**Version:** 1.0 — August 2026
**Purpose:** the ordered backlog an autonomous session works through, and the protocol it follows to ship a module without supervision.

---

## Part 1 — The build protocol

Every autonomous build session follows this, in order. No exceptions.

### Step 0 — Orient (always first)
1. Read `STATE.md` in the project. It is the single source of truth for what is done, what is in flight, and what is blocked.
2. Read `DECISIONS.md` for anything decided since the module was specified.
3. Pick the **next module whose dependencies are all `done`**. If several qualify, take the lowest number.
4. If nothing qualifies, work the blocked list, or do a research/quality pass, and say so in the report.

### Step 1 — Spec the slice (15 minutes, in the PR description, not a document)
- Who is the user and where are they standing? (desk / forecourt / workshop / auction hall — this decides the UI)
- What data does it create, read or change?
- **What is the compliance surface?** Money, VAT, consent, finance, evidence, retention, PII? If yes to any → read `forecourt-domain` and `references/compliance-rules.md` before writing code.
- What breaks if this is wrong?
- How does it degrade when a provider is down?
- Three to six testable acceptance criteria.

### Step 2 — Build, in this order
`schema → domain logic → API → jobs → UI → tests`

Never start with the UI. Follow the `forecourt-feature` skill.

### Step 3 — The gates (all must pass before a module is `done`)
- [ ] Every new table: `tenant_id`, RLS **enabled and forced**, a policy, registered in `TENANT_TABLES` in the isolation suite
- [ ] `pnpm test` green, including property tests on any money path
- [ ] `pnpm test:isolation` green against a real Postgres
- [ ] No money as float, no currency arithmetic in the browser
- [ ] No regulatory threshold, VAT rate or scheme date as a literal — all from `compliance_rules`
- [ ] No hex colour outside `tokens.json`
- [ ] Server-side permission checks, not UI hiding
- [ ] Loading, empty and error states designed
- [ ] Error messages say what to do
- [ ] Audit event on every mutation
- [ ] Expand/contract migration with a documented rollback
- [ ] Dealer vocabulary in all user-facing copy
- [ ] If it touches a public page: Lighthouse budget still met
- [ ] If it can display a payment or APR: it goes through `<FinancePromotion>`

### Step 4 — Report and record
1. Update `STATE.md`: module status, what shipped, what's next, any new blockers.
2. Append to `DECISIONS.md` anything decided under standing authority.
3. Deliver the code (see "Where code lives" below).
4. Write the standup or weekly report per `09-manager-charter.md` §5.

### Where code lives — the one open dependency

Cloud sessions are ephemeral: the container is reclaimed and each scheduled run starts fresh. So:

- **The project is the persistent store** for specs, `STATE.md`, `DECISIONS.md` and reports. That works today.
- **Code needs a git remote.** Until one exists, each session delivers the module as a downloadable archive and records the diff summary in `STATE.md` — workable, but it means the codebase is reassembled by hand each time and modules cannot build on each other cleanly.

**The ask:** create a private GitHub repository and grant access. Once it exists, autonomous sessions clone, branch, build, test and open a pull request, and the module-by-module plan runs properly end to end. This is the single highest-value unblock in the whole programme.

---

## Part 2 — The module backlog

Status: `done` · `in-progress` · `ready` (dependencies met) · `blocked` · `todo`

### M0 — Dealer Site Audit tool — **done**
The wedge. Ships before the product because it generates the pipeline that funds it.

Delivered: polite crawler (identifies itself, respects robots.txt, rate-limited, public pages only, no personal data stored), 16 weighted checks, scored markdown + JSON report, fixture replay mode for CI and offline testing, Kennington fixture reproducing the verified live findings (scores 16/100).

Remaining before public launch: a web front end at `/audit`, PDF output, Core Web Vitals via a headless render, email capture, and the platform-fingerprint prospecting list.

### M1 — Foundation — **done**
pnpm workspace · `tokens.json` as the single source of truth · `@forecourt/domain` (money as integer pence with property tests, VAT margin scheme, CRA/CCR clocks) · `@forecourt/db` (RLS policy generator, append-only triggers, session-context helper, policy verification gate) · the cross-tenant leak suite · CLAUDE.md and the three skills committed alongside the code.

**11 domain tests passing**, including: HMRC's worked margin example (£500 margin → £83.33 VAT), negative margins never offset, half-up penny rounding, no float drift, and allocation never losing a penny.

### M2 — Tenancy & identity — **ready**
*Depends on: M1*

Tenants, sites, brands, users, memberships, roles, the permission matrix, invitations, auth (password + passkeys + TOTP, mandatory MFA for Owner and any `finance.*` or `contact.export` permission), sessions and device management, the tenant onboarding wizard, and platform-admin tenant provisioning.

**Acceptance:** a tenant can be created and reach "live" without engineering involvement · a Sales Executive without `vehicle.cost.read` sees no derived value that reveals cost · every permission denial is logged · the leak suite covers every new table.

### M3 — Vehicle core — **todo**
*Depends on: M2*

The vehicle record and its full field set · lifecycle state machine with the hard rules (nothing goes Live without stock-book fields, a photo, a price, a VAT scheme and a provenance check) · status and price history · the stock list (virtualised, saved views, filters as URL state, bulk actions, health-flag chips) · the vehicle detail page with the merged History timeline · duplicate and mileage-anomaly controls.

**Acceptance:** 1,000 vehicles filter in <400ms p95 · every filter combination is URL-addressable · bulk price change writes one history row per vehicle attributed to the actor and the bulk operation.

### M4 — Vehicle data & provenance — **todo**
*Depends on: M3*

DVLA VES, DVSA MOT History, spec decode via an aggregator, valuation feed, provenance check. The lookup queue with per-provider rate limits, aggressive caching, raw-response storage and per-tenant cost metering. Derivative picker for ambiguous decodes. MOT timeline with mileage chart. Adverse-marker blocking.

**Acceptance:** reg → populated vehicle in <4s with progressive fill · a paid lookup never re-runs without a cache miss or explicit user action · an ambiguous derivative always prompts, never guesses · an adverse provenance marker blocks Live until a manager acknowledges with a reason.

### M5 — Media pipeline — **todo**
*Depends on: M3*

Bulk and mobile upload, guided capture overlays, drag reorder, hero selection, EXIF strip, responsive AVIF/WebP/JPEG generation, plate blur, background replacement, damage-photo tagging as disclosure evidence, AI descriptions with the "never invent a feature" guardrail, advert strength score.

### M6 — Public website engine — **todo** ← *acquisition-critical*
*Depends on: M3, M5*

Multi-tenant renderer resolving by Host header · three themes with validated dealer-editable tokens · block editor · **real slug URLs** · automatic JSON-LD (`Vehicle`, `Product`, `Offer`, `AutoDealer`, `LocalBusiness`, `BreadcrumbList`) · self-regenerating sitemaps · **sold-vehicle redirects to similar live stock** · make/model/location landing pages that actually resolve · redirect manager preserving migrated URLs · consent-aware analytics · Lighthouse budget as a build gate.

**Acceptance:** every one of the 16 audit checks passes on a site we build · LCP <2.0s p75 mobile · a vehicle change is live within 20 seconds · the site keeps serving from cache when the API is degraded.

### M7 — Public inventory experience — **todo**
*Depends on: M6*

Faceted search (<300ms, counts always shown, zero-count disabled) · vehicle detail page per the design brief · shortlists with anonymous-to-account persistence · saved searches and notify-me · enquiry, callback, test-drive, part-ex and reserve forms with versioned consent capture · zero-result handling that logs demand signals · sticky mobile CTA bar.

### M8 — Finance display & compliance — **todo** ← *acquisition-critical*
*Depends on: M7*

The `<FinancePromotion>` primitive that cannot mount without a valid, in-date representative example · the representative-example record and its admin · cost-of-credit language detection blocking publish · monthly-payment search facet from nightly precomputed indicative payments · initial disclosure as a versioned page · representative-APR governance report (the 51% test).

**Acceptance:** there is no code path, in any renderer, that produces a bare payment figure — asserted by a golden-file test that fails the build.

### M9 — Contacts & consent — **todo**
*Depends on: M2*

Contact records · **consent as an append-only record** with channel, basis, source, timestamp and wording version · vulnerability flags with restricted access · deduplication and merge · data subject rights tooling with legal-hold override · suppression list honoured globally.

### M10 — Leads & communications — **todo**
*Depends on: M9, M7*

Unified lead inbox with interleaved channels · marketplace lead parsers with a manual-triage fallback · pipeline with mandatory structured loss reasons · SLA countdown and escalation · automation sequences with consent re-checked **at send time** · email (per-tenant sending domain), SMS, WhatsApp, click-to-dial, video walkaround.

### M11 — Money — **todo**
*Depends on: M3*

Invoicing with scheme-driven VAT presentation · gapless sequential numbering · **the VAT margin stock book with all 12 mandatory fields enforced and a health report** · deposits and payments via Stripe Connect · cash threshold monitoring against `compliance_rules` · refunds with reason codes · purchase ledger and per-vehicle true cost.

### M12 — Deals & the Evidence Ledger — **todo**
*Depends on: M11, M8, M9*

Deal builder with the live margin panel · **contract-formation capture driving the CCR clock** · CRA clocks with repair-attempt pausing · document templates with version control · e-signature · **the append-only hash-chained Deal Evidence Ledger** and its export bundle · add-on products with separate demands-and-needs and no pre-ticking.

### M13 — Part-exchange appraisal — **todo**
*Depends on: M4, M12*

Mobile appraisal with the tap-to-mark damage map · recon estimate builder from tenant standard costs · valuation panel · offer with internal breakdown · outstanding finance and settlement tracking · **conversion to a stock record with zero re-keying**.

### M14 — Prep pipeline — **todo**
*Depends on: M3*

Configurable stage board · job cards with internal and external costs · parts tracking with blocked-time reported separately from working time · SLAs and escalation · MOT advisories auto-suggested as work items · photography stage gate · mobile single-column mode.

### M15 — Pricing intelligence — **todo**
*Depends on: M4*

Price position vs market · comparables · forecast days to sell · aging price ladder with bulk apply and margin-impact preview · stock health dashboard · demand signals from site search.

### M16 — Channel feeds — **todo**
*Depends on: M6*

One canonical vehicle model, one versioned adapter per channel. Auto Trader Connect, eBay Motors Group, CarGurus, Meta catalogue, Google Vehicle Ads. Publish preview, feed health monitor, per-vehicle publish status, one-click retry, automatic delisting on sale.

### M17 — Accounting sync — **todo**
*Depends on: M11*

Xero then QuickBooks, then Sage. Account and tax-rate mapping UI, dry-run mode, error queue with per-record retry, CSV fallback.

### M18 — Reporting & Channel P&L — **todo**
*Depends on: M10, M11, M16*

Role-based dashboards · report library with scheduling and export · **the Channel P&L table** · every figure drilling through to its records.

### M19 — Compliance centre — **todo**
*Depends on: M12*

Compliance dashboard and completeness scoring · document version control surfaced · registers (trade plates, insurance, permissions, training, complaints, breaches, DPIAs, sub-processors) · AML and ID verification · historic finance introduction register · the disclaimer and source links on every compliance surface.

### M20 — Platform administration & billing — **todo**
*Depends on: M2*

Tenant directory and health · Stripe subscriptions, dunning, plan changes, usage add-ons · feature flags · **audited, time-limited, consented support impersonation** · integration credential and quota management · platform observability · tenant export and deletion · reseller mode.

---

## Part 3 — Sequencing rationale

The order is not the order of the functional spec. It is the order that gets us **sellable soonest**:

1. **M0 first** because it generates pipeline before the product exists.
2. **M1–M3** because tenancy and the vehicle record are the spine, and getting isolation wrong later is unrecoverable.
3. **M6, M7, M8 next** — the public website, the inventory experience and compliant finance display. These are the four things that win the meeting (`07-competitive-strategy-dealershub.md` §4.3). A dealer can switch to us on M1–M8 alone.
4. **M11, M12** — money and evidence. These are what stop them leaving.
5. **Everything else** deepens the product and raises ARPU, but does not win or lose the first fifty customers.

**The demo-able milestone is the end of M8:** Kennington's real stock, live, on a site that passes all 16 audit checks, with a compliant payment on every car. That is the meeting.
