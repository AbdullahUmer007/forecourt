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
