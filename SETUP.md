# Setup

## Requirements
Node 20+ · pnpm 9+ · Docker (for Postgres and Redis) · a Postgres 16 database

## First run

```bash
pnpm install
cp .env.example .env          # then fill it in
docker compose up -d          # Postgres, Redis, MinIO, Mailpit
pnpm db:migrate               # schema
psql "$DATABASE_URL" -f packages/db/src/rls.sql
psql "$DATABASE_URL" -c "SELECT * FROM apply_tenant_policies();"
pnpm test                     # domain tests
pnpm test:isolation           # the gate that matters — needs DATABASE_URL
```

## The audit tool (works today, no database needed)

```bash
# Live audit of any dealer site
node apps/audit/src/index.mjs www.example-dealer.co.uk --out report.md --json report.json

# Replay the Kennington fixture — used for CI regression and offline testing
pnpm audit:fixture
```

The live crawler needs outbound network access to the target host. In a
restricted environment (a sandbox with an egress allowlist) use `--fixture`.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | All apps |
| `pnpm test` | Unit and integration |
| `pnpm test:isolation` | **The cross-tenant leak suite — the blocking gate** |
| `pnpm db:policies` | Verify RLS is enabled, forced and policied on every tenant table |
| `pnpm audit <domain>` | Run a dealer site audit |
| `pnpm audit:fixture` | Replay the Kennington fixture |
| `pnpm typecheck` / `pnpm lint` | |

## CI must

1. Provide `DATABASE_URL` — without it the isolation suite skips and the gate is meaningless
2. Run `pnpm test:isolation` as a blocking step
3. Run `pnpm db:policies` after migrations
4. Fail on any raw hex colour outside `packages/tokens/`
5. Run Lighthouse against a representative vehicle page once `apps/site` exists

## Where things are

```
apps/audit/         the Dealer Site Audit tool (M0 — working)
packages/tokens/    tokens.json — the single source of truth for design
packages/domain/    money, VAT, consumer-rights clocks (property-tested)
packages/db/        RLS policies, tenant context, policy verification gate
tests/isolation/    the cross-tenant leak suite
docs/               specifications 01–09
design/             the Claude Design brief
sales/              the Kennington audit
.claude/skills/     three skills, versioned with the code
STATE.md            read this first, every session
DECISIONS.md        append-only decision log
```
