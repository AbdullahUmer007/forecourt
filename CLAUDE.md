# CLAUDE.md — Forecourt

Repository conventions for AI assistants and humans. Keep this file short enough that it is always read.

## What this is

**Forecourt** is a multi-tenant SaaS platform for UK independent used-car dealers. Two products, one dataset:

1. **Office CRM** — stock, prep, pricing, leads, deals, finance, compliance, accounting
2. **Public dealer website** — a fast, brandable shopfront per dealer, driven by the same inventory

Market: UK. Primary customer: single-site independent, 25–60 cars, 2–8 staff.

## Read these before you write code

| Situation | Read |
|---|---|
| Anything touching vehicles, VAT, finance, consent, dealer terminology | the `forecourt-domain` skill |
| Any UI, screen, component, chart, email template | the `forecourt-ui` skill |
| Any new feature, table, endpoint, job, migration | the `forecourt-feature` skill |
| Multi-tenancy, RLS, isolation | `forecourt-feature/references/tenancy-checklist.md` |
| Regulatory detail and sources | `forecourt-domain/references/compliance-rules.md` |
| Formulas | `forecourt-domain/references/calculations.md` |

Full specs live in `/docs`: product strategy, functional spec, architecture, design system, integrations and compliance.

## Repository layout

```
apps/crm/          authenticated dealer application (Next.js App Router)
apps/site/         public multi-tenant website renderer (Next.js, ISR + edge cache)
apps/admin/        platform administration (separate deployment, separate auth)
packages/ui/       design system: tokens.json, primitives, domain components
packages/domain/   pure business logic — money, VAT, clocks, pricing, commission
packages/db/       Drizzle schema, migrations, RLS policies, repository layer
packages/adapters/ one module per external provider
workers/           BullMQ job processors
docs/              specifications
```

## Stack

TypeScript · Next.js (App Router) · React · Tailwind + shadcn/ui (Radix) · tRPC internally, REST/OpenAPI for partners · PostgreSQL 16 with row-level security · Drizzle ORM · Redis + BullMQ · Cloudflare R2 · Stripe (Connect) · Postmark/Resend · Sentry + OpenTelemetry.

## The ten rules

1. **Never a database query without a tenant scope.** RLS is enabled *and forced* on every tenant table, plus a repository guard, plus a request context. Four layers. A leak between two dealers is the one bug that ends the company.
2. **Money is `bigint` minor units with an explicit currency.** Never a float, never a `number`, never currency arithmetic in the browser. Property-test every rounding path.
3. **Regulatory values are data, not code.** Thresholds, rates, dates and windows come from the `compliance_rules` table, keyed on the relevant date. No literal thresholds. UK motor finance regulation is actively moving.
4. **Financial, invoice, stock-book and evidence records are append-only.** Corrections create a new versioned or adjusting row. Nothing that could be evidence is ever mutated or deleted.
5. **A cost-of-credit figure only renders through `<FinancePromotion>`**, which cannot mount without a valid, in-date representative example. There is no other code path. (CONC 3.5.3R.)
6. **A margin-scheme invoice never shows VAT separately.** Golden-file test; showing it makes the whole sale standard-rated.
7. **Consent is a record, never a boolean** — channel, basis, source, timestamp, wording version — and is re-checked **at send time**, not at schedule time.
8. **External calls are jobs**, with an idempotency key, a circuit breaker, a stored raw response and per-tenant cost metering. Never from a request handler.
9. **No hex codes outside `tokens.json`.** No colour carrying meaning without an icon and a label beside it.
10. **Speak the trade's language**: forecourt, part-exchange, reg, MOT, V5C, prep, HPI check, unit, gross. Never lot, trade-in, license plate, detailing, inventory (in dealer-facing copy).

## Performance budgets (build gates, not aspirations)

Public vehicle detail page: LCP < 2.0s p75 mobile · INP < 200ms · CLS < 0.1 · JS < 120KB gzipped · Lighthouse Performance ≥ 92, Accessibility 100.
CRM: p95 interaction < 500ms · global search < 200ms · 1,000-row stock list filters in < 400ms.

## Definition of done

Tests at the right layers (including the **cross-tenant leak suite**) · both colour modes · keyboard operable · axe clean · loading/empty/error states designed · copy in dealer vocabulary · audit event on every mutation · expand/contract migration with a rollback path · changelog entry.

## Commands

```bash
pnpm dev             # all apps
pnpm db:migrate      # run migrations
pnpm db:policies     # verify RLS on every tenant table
pnpm test            # unit + integration
pnpm test:isolation  # cross-tenant leak suite — the one that matters
pnpm test:e2e        # Playwright critical journeys
pnpm lint            # includes the no-raw-hex and tenant-scope rules
pnpm lighthouse      # public site budget check
pnpm storybook
```

## What not to do

Do not add a table without an RLS policy and a leak test. Do not compute a customer-facing figure client-side. Do not hard-code a VAT rate or a regulatory threshold. Do not guess a vehicle derivative when the lookup is ambiguous — show a picker. Do not write "An error occurred". Do not make loss reasons optional. Do not ship a compliance feature without the retained consultant's sign-off.
