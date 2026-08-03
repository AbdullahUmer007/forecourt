# Forecourt — public dealer site

The multi-tenant public website. One deployment serves every dealer; the Host
header decides which one.

## What this app is, and is not

It is **route handlers only**. No pages, no components, no client bundle.
`renderVehiclePage` and `renderResultsPage` in `src/render/` are pure functions
that return a complete HTML document, and the handlers return that string.

That is not minimalism for its own sake. The vehicle detail page must render
without JavaScript and stay under a 120KB JS budget, and the surest way to
never regress a budget is to have nothing to regress: there is no client bundle
to grow, no `use client` to slip in during a refactor, no hydration cost.

Interactivity that genuinely needs JavaScript — gallery swipe, a filter panel —
is added later as a separately-budgeted progressive enhancement, never as a
prerequisite for seeing the car or finding the phone number.

## Running it

From the repo root:

```bash
cp .env.example .env          # point DATABASE_URL at a local Postgres 16
pnpm install
pnpm db:setup                 # extensions, RLS, every migration in order
pnpm db:policies              # asserts every tenant table is protected
pnpm db:seed                  # the Kennington demo tenant, 14 cars
pnpm dev                      # http://localhost:3000 (PORT=3001 to move it)
```

`localhost` and `127.0.0.1` are seeded as **verified** domains. Any other host
gets the "this domain isn't connected yet" page — the same refusal production
gives, exercised in development on purpose.

### The finance block will be missing, and that is correct

`pnpm db:seed` leaves `compliance_rules` → `conc.representative_example`
**unsigned**, so no cost-of-credit figure renders anywhere. The vehicle page
shows an honest "ask us about finance" block with no figure in it, and the
server logs why. That is the M8 launch gate.

To see the finance block locally:

```bash
DEMO_SIGN_COMPLIANCE_RULE=1 pnpm db:seed
```

which writes a clearly-labelled demo sign-off as rule version 999. Never do
that anywhere a customer can reach.

## Where things live

```
app/                         route handlers — routing, caching, nothing else
  used-cars/[[...segments]]  results: all stock, make, make+model, any filter
  used-cars/[make]/[model]/[slug]   the vehicle detail page
  sitemap.xml, robots.txt
src/render/                  pure renderers — the actual HTML
src/data/                    reads, every one tenant-scoped through withTenant
src/tenant.ts                host → tenant, and the rules for refusing
src/request.ts               the only source of a tenant id
```

## Tenant resolution is not middleware

It was. Next middleware runs in the Edge runtime, which has no TCP sockets and
therefore cannot reach Postgres, where the host-to-tenant mapping lives. The
production answer is an edge-readable replica of the domain table; until that
exists, `requireTenant` in `src/request.ts` is the single source of a tenant id,
so a handler that skips it has nothing to pass to the data layer.

## Preview without a database

```bash
pnpm preview                  # writes demo/preview/*.html
```

Runs the same renderers over the demo dataset and writes plain files you can
open from disk. Useful for looking at markup and layout without standing
anything up.
