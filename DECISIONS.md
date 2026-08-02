# Decision log

Append-only. Every decision taken under standing authority (see `docs/09-manager-charter.md` §2),
newest last. Any entry can be overturned by Abdullah at any time — this is a log, not a contract.

Format: `date · decision · rationale · reversible?`

---

**2026-08-01 · Product name "Forecourt" as a working name.** UK trade term, available-sounding, not yet trade-mark checked. Reversible — flagged to Abdullah as an action.

**2026-08-01 · Stack: TypeScript / Next.js App Router / PostgreSQL with forced RLS / Drizzle / Redis+BullMQ / Cloudflare R2 / Stripe Connect.** One language across app, API and workers for a small team; Postgres RLS is the isolation mechanism; R2 chosen over S3 specifically for zero egress on vehicle photography, which is our dominant bandwidth cost. Reversible early, expensive later.

**2026-08-01 · Shared database, shared schema, `tenant_id` on every row, four isolation layers.** Right trade-off at thousands of tenants with tens of thousands of vehicles each. Schema-per-tenant doesn't scale to thousands of migrations; database-per-tenant is over-engineered. The application never assumes co-location, so a large customer can be moved to a dedicated database later. Reversible with effort.

**2026-08-01 · Money as `bigint` minor units with an explicit currency; no floats anywhere.** Property-tested. Not reversible in practice — everything downstream depends on it.

**2026-08-01 · All regulatory values live in a `compliance_rules` table keyed on the relevant date, never as constants.** UK motor finance regulation moved twice during research (AML threshold to sterling on 30 June 2026; redress scheme partially suspended in July 2026). Changing the law must be a data deployment. Not reversible — it's the whole point.

**2026-08-01 · Chart palette adopted from a validated reference palette rather than derived from the brand hue.** It passes the lightness band, chroma floor, colour-vision-deficiency separation, normal-vision separation and contrast against our exact surfaces (#FFFFFF, #16181D). Deriving a palette from "Petrol" would have needed re-validation with no user benefit. Reversible only by re-running the validator.

**2026-08-01 · Brand primary "Petrol" #0E5A6B rather than a conventional dealer blue.** 7.80:1 on white, distinctive in a category of generic blues, reads premium and mechanical. Reversible — it's a token.

**2026-08-01 · Price ABOVE the direct competitor, not below.** DealersHub is £120+VAT; our Pro tier is £189–£319 stock-banded. Undercutting a one-person operation in a commoditised tier signals a worse product and starts a race we cannot win. We sell the gap, not the price. Reversible, but strategically load-bearing.

**2026-08-01 · Build the free Dealer Site Audit tool BEFORE the CRM.** It generates pipeline before the product exists, proves expertise, doubles as the product demo and becomes our own CI regression suite. Reversible, but it would waste the strongest asset we have.

**2026-08-01 · Never name the competitor in public-facing material; never use their tenure discrepancy as an attack line.** Legally risky, makes us the aggressor, and moves the conversation away from the dealer's own broken pages. Compete instead on the verifiable trust signals they structurally lack. Not reversible without my objection on the record.

**2026-08-01 · Crawler ethics fixed: identified user agent with a contact URL, robots.txt respected, rate-limited to ~1 request/700ms, public pages only, no personal data stored, removal requests honoured immediately.** We are selling compliance; we behave accordingly. Not reversible.

**2026-08-01 · Kennington's real public data used for the demo build, marked "Demo — unsolicited".** Agreed with Abdullah. No contact made, no private data used, public sources only.

**2026-08-01 · `users` is global, not tenant-scoped.** One person may work for two dealers and an external accountant may serve several, so the tenant boundary is the membership rather than the user. `users` gets a membership-scoped RLS policy instead of a `tenant_id`. Reversible with effort; would require rewriting every membership lookup.

**2026-08-01 · `domains.hostname` is globally unique — the one deliberate exception to tenant-scoped uniqueness.** A hostname can only ever resolve to a single tenant, and an unknown or unverified host must 404 rather than fall through to a default. Not reversible: the alternative is a routing ambiguity.

**2026-08-01 · `site_scope` RLS policies are RESTRICTIVE, permanently.** Postgres combines multiple permissive policies with OR, so a permissive `site_scope` returned true whenever `scope_all_sites` was set and OR'd away `tenant_isolation` entirely on every table carrying a `site_id`. This leaked `user_sites` and the whole `audit_events` trail across tenants. Found by the hardened isolation suite. Not reversible — reverting reintroduces a cross-tenant data leak.

**2026-08-01 · The isolation suite asserts SQLSTATE 42501 on rejected cross-tenant INSERTs, and asserts rival data exists before testing against it.** A test that fails on NOT NULL rather than on the policy would pass with RLS switched off; a test with no rival rows passes vacuously. Both were true before this change. Not reversible.

**2026-08-01 · Each tenant is seeded its own copy of the nine system roles rather than sharing platform-level rows.** Lets a dealer rename and adjust roles without affecting anyone else. Costs nine rows per tenant, which is nothing. Reversible.

**2026-08-01 · The compliance profile is enforced in three places** — TypeScript validation for the good error message, database CHECK constraints for the guarantee, and the go-live checklist for operational readiness. Deliberate duplication: the database is the guarantee, the code is the explanation. Reversible but inadvisable.

**2026-08-02 · Vehicle registration is `UNIQUE (tenant_id, registration)`, never global.** A global unique index would let one dealer discover another's stock: enter a registration, get a constraint violation, and you have learned a competitor holds that car. Verified behaviourally — two tenants can both hold WN22HNL, one tenant cannot duplicate it. Note this is the OPPOSITE conclusion to `domains.hostname`, where global uniqueness is the safe choice because a hostname can only resolve to one tenant. Not reversible.

**2026-08-02 · `delivered` is NOT a terminal vehicle state.** A customer has a 30-day short-term right to reject under CRA s.22, so a delivered vehicle can come back. Modelling delivery as terminal would leave no lawful path to record a rejection — the exact scenario the Deal Evidence Ledger exists for. Caught by a reachability test. Reversible only by removing the CRA rejection path, which would be wrong.

**2026-08-02 · Days-to-sell is measured from Live, not from purchase.** Time before Live is `daysToLive` and belongs to the prep team. Blending them blames the sales team for time the car spent in the workshop, and a dealer who spots that stops trusting the whole dashboard. Reversible but inadvisable.

**2026-08-02 · Go-live blockers are returned as a list with per-blocker `overridable` flags, not a boolean.** The dealer needs to see exactly what to fix. An incomplete VAT stock book, a missing price and an unacknowledged mileage anomaly are non-overridable; a missing provenance check is overridable with a recorded reason and a named authoriser. Reversible.

**2026-08-02 · M4 was split into a free half and a paid half, and the free half was built immediately.** DVLA VES and DVSA MOT History are free and self-serve; only valuation (cap hpi) and provenance (HPI Check) need commercial contracts. Labelling the whole module "blocked on contracts" was wrong and would have idled work for weeks. The free half also populates `vehicles.highest_mot_mileage`, which M3's go-live gate already reads — that gate was guarding against data nothing produced. Reversible: the paid adapters slot into the same interface.

**2026-08-02 · Adapters are tested against recorded fixtures, never a live provider.** No contract, no network, no flakiness, and provider behaviour (retries, circuit breaking, partial failure) becomes deterministic. A nightly job should later compare live responses against fixture shape and alert on drift — these APIs change without notice. Reversible.

**2026-08-02 · A combined vehicle lookup returns partial data rather than failing.** If MOT history is down we still return the DVLA record, with the failed source NAMED in a `degraded` array. A buyer standing in an auction hall would rather have half the car than an error. Reversible.

**2026-08-02 · Mileage anomaly detection reports EVERY reading below the running highest, not just the first.** Reporting only the first makes a clocked car look like a single clerical error. Caught by my own test expecting one anomaly where the data honestly contained two. Not reversible without weakening a fraud signal.

**2026-08-02 · EXIF stripping is mandatory and unconditional, enforced by a CHECK constraint.** A phone photo carries GPS. Publishing it discloses where the dealer's stock sits overnight and — for a part-exchange appraisal — usually a customer's home address. `vehicle_media_published_requires_ready` makes it impossible to publish an image that has not been stripped. Not reversible: it is a data-protection control, not an optimisation.

**2026-08-02 · Damage photographs shown to a buyer cannot be deleted, only unpublished.** A photograph of declared condition, shown before sale, is a Consumer Rights Act defence. Enforced by a CHECK constraint as well as in domain logic, and the refusal message offers the lawful alternative rather than just saying no. Not reversible.

**2026-08-02 · Damage photographs sort to the END of the published set.** They must be present and visible — that is the defence — but leading a listing with a scuffed bumper loses the click the defence was meant to protect. Reversible; revisit if dealers ask for it.

**2026-08-02 · `vehicles.published_photo_count` is maintained by a database trigger, not application code.** M3's go-live gate reads it, so a missed update would silently block or unblock a vehicle from being advertised. The database owns anything a gate depends on. Reversible but inadvisable.

**2026-08-02 · Uploads are validated by magic bytes, not the content-type header.** The header is caller-supplied and therefore untrustworthy. HEIC and AVIF are exempted from sniffing because they share an ISO-BMFF container signature; the processor rejects them later if they turn out not to be images. Reversible.

**2026-08-02 · A sold vehicle 301s to the closest-priced car of the same model, never to a "Sold Out" page.** Those pages accumulate as near-identical dead ends, waste crawl budget, compete with each other, and drop a real buyer who clicked through from search onto nothing. Verified by property test that every sold URL resolves to a 301 with a destination. Not reversible.

**2026-08-02 · Facet landing pages always render but only index above a stock threshold.** Two failure modes, both observed on the competitor's estate: pages indexed by Google that 404, and thin pages with no stock. Rendering always (never 404 a URL we minted) with `noindex, follow` below three matching vehicles solves both. Reversible; the threshold is a parameter.

**2026-08-02 · Structured data must never contain a finance figure.** A monthly payment or APR in JSON-LD is still a financial promotion under CONC 3.5.3R, and JSON-LD has nowhere to carry the representative example that must accompany it. `assertNoFinanceFigures` enforces this and is asserted in tests. Not reversible.

**2026-08-02 · `aggregateRating` is omitted unless there is a genuine rating with a non-zero review count.** An invented or zero-count rating is a structured-data violation and can earn a manual penalty. Not reversible.

**2026-08-02 · We audit our own generated output with our own tool, as a blocking test.** We sell by auditing competitors' customers' sites; if ours failed the same checks the pitch collapses, and the first dealer to run the free tool on us would find out. `tests/self-audit/generated-site.test.ts` scores ≥85 today, with the finance check deliberately failing until M8 and asserted as a known gap so it flips when M8 lands. Not reversible.

**2026-08-02 · The public site's markup is generated by template functions, not React components.** The VDP must render completely without JavaScript and ship under 120KB of it. React server components would satisfy that today, but template functions make it impossible to regress: no client bundle to grow, no `use client` to slip in during a refactor, no hydration cost. The Next.js routes are thin wrappers that call the render layer and return the string. Interactivity that genuinely needs JS is added as separately-budgeted progressive enhancement. Reversible, but the zero-JS test would have to be weakened to do it.

**2026-08-02 · An unknown or unverified host returns 404 and never falls through to a default tenant.** Falling through would serve one dealer's stock under another dealer's domain. Unverified matters separately: anyone can point a CNAME at us, and serving before the TXT challenge passes would let them impersonate a dealer on a domain they do not control. Not reversible.

**2026-08-02 · Every cache key carries the tenant, enforced by the `cacheKey` helper's signature.** A cache key without a tenant serves the previous tenant's rendered HTML to the next request — a leak that bypasses the database entirely, where no RLS policy can catch it. Not reversible.

**2026-08-02 · The self-audit now runs against real renderer output rather than a hand-built fixture.** A fixture drifts from the renderer silently; real output cannot. Writing it caught a genuine harness error — I had passed the VDP as the home page, so the `vehicle-page-titles` check failed exactly as designed. The check was right and the test was wrong, which is the correct way round. Not reversible.

**2026-08-02 · The Claude Design VDP was reviewed against our own renderer, and where it was better we changed ours.** It used our tokens exactly, so the comparison was purely about substance. Six things it did better and we have adopted: a real GB plate (yellow field, blue UK band) instead of a flat yellow chip; a labelled "Cash price" with the reduction from our own price history beside it; provenance stated as an outcome rather than a bare badge; declared marks counted and *named*, not just photographed; EV battery health given its typical range for context; and mileage drawn as a chart above the MOT table rather than the table alone. The review was worth more than the design: three of the six are data-model changes, not styling.

**2026-08-02 · We did NOT adopt three things from the design, and each omission is deliberate.** The market guide-price comparison ("priced £651 under guide") needs cap hpi valuations, which are contract-blocked — publishing a comparison we cannot evidence is the exact behaviour we audit competitors for, and there is now a test asserting the page makes no guide-price claim. The advisory-to-prep follow-through ("both tyres replaced in prep on 22 Jul, receipt in the history") needs M14's prep records. The finance block is M8: `financeHtml` stays `null` and no payment figure can appear. The design validated all three as targets; none of them ships on a promise.

**2026-08-02 · Provenance fields are tri-state, and an unknown is never rendered as a clear.** `outstandingFinance`, `stolen` and `writtenOff` are each `true | false | null`. Only an explicit `false` produces "no outstanding finance"; `null` produces silence. Rendering a missing field as good news is how a provenance badge becomes a misrepresentation. Not reversible.

**2026-08-02 · An adverse provenance result is disclosed on the public page, not suppressed.** A vehicle with recorded outstanding finance renders "Provenance — declared" with what was found, and cannot render "Provenance clear". A dealer who wants to hide it is the dealer we are selling against, and it is a Consumer Protection from Unfair Trading Regulations problem as well as a moral one. Not reversible.

**2026-08-02 · The mileage chart's y-axis starts at zero, and no chart is drawn from a single reading.** A truncated axis exaggerates every step on a chart whose entire job is to be trusted, and a one-point "trend" is a lie with a line through it. Both are asserted by test. The MOT table below is the chart's table view, satisfying the design-system rule. Not reversible.

**2026-08-02 · The provenance badge was removed from the trust block and now appears once, above the fold.** It was rendering twice — once as a fact and once as a badge further down. Saying it in two places made neither instance read as a fact. Reversible.
