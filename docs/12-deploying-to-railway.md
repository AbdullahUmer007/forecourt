# 12 — Deploying to Railway

A working deployment of all three applications and the database. Written and
verified on 5 August 2026; the container images in this guide were built and
run locally against a real database before it was written.

**This is a staging deployment.** Read §7 before pointing a real dealer's
domain at it — three things must not be true of anything a customer reaches,
and one of them is a live regulatory gate.

---

## 1. What you are deploying

| Railway service | `APP` | What it serves | Public? |
|---|---|---|---|
| Postgres | — | The database | No |
| `forecourt-site` | `site` | The public dealer website | **Yes** |
| `forecourt-crm` | `crm` | The dealer application | Yes, behind sign-in |
| `forecourt-admin` | `admin` | Platform administration | Yes, behind a separate sign-in |

There is no Redis and no worker service yet — `workers/` does not exist, and
nothing in the product currently queues a job. Add them when M4's paid
lookups land.

All three services build from **one `Dockerfile` at the repository root**,
selected by an `APP` build argument. They share a lockfile, a workspace and the
domain package, so three near-identical Dockerfiles would be three places to
forget the same change.

---

## 2. Create the project and the database

```bash
npm i -g @railway/cli
railway login
railway init            # name it "forecourt"
railway add --database postgres
```

Or in the dashboard: **New Project → Deploy PostgreSQL**.

Railway's Postgres exposes two connection strings as service variables:

- `DATABASE_URL` — the **private** address (`postgres.railway.internal`). Use
  this for the applications. It never leaves Railway's network, costs no
  egress, and needs no TLS.
- `DATABASE_PUBLIC_URL` — through Railway's TCP proxy. Use this from your
  laptop to run migrations, and **append `?sslmode=require`**.

---

## 3. Create the three services

For each of `site`, `crm` and `admin`, in the dashboard:

1. **New → GitHub Repo →** `AbdullahUmer007/forecourt`.
2. **Settings → Build:** Railway picks up `railway.json` at the root, which
   selects the Dockerfile builder. Leave the root directory as `/` — the build
   context must be the repository root, because every app imports
   `packages/domain` from outside its own directory.
3. **Variables:**

   | Variable | Value | Why |
   |---|---|---|
   | `APP` | `site` / `crm` / `admin` | Selects which app the image builds. Railway passes service variables to the Docker build as arguments. |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | A reference, not a copy — it follows the database if it moves. |
   | `NODE_ENV` | `production` | Already set in the image; harmless to repeat. |
   | `R2_ACCOUNT_ID` | Cloudflare account id | **crm and site only.** Same values on both. See §3.1. |
   | `R2_ACCESS_KEY_ID` | S3 API token | **crm and site only.** |
   | `R2_SECRET_ACCESS_KEY` | S3 API token | **crm and site only.** |
   | `R2_BUCKET` | `rixdrive-media` | **crm and site only.** Private bucket. |
   | `R2_JURISDICTION` | `eu` | **crm and site only.** Required if the bucket was created in the EU jurisdiction. |
   | `ADMIN_MFA_BYPASS` | `1` | **admin only, temporary.** Second-factor screens are not built yet. Remove the moment they ship. |

   Do **not** set `PORT`. Railway injects it and the standalone server reads it.

4. **Settings → Deploy → Custom Start Command: leave it EMPTY.**

   `railway.json` sets it to `/app/start.sh` and config-as-code wins, but a
   value typed into the dashboard before the config file reached the deployed
   commit is the most common way this breaks. Anything invoking a package
   manager — `pnpm start`, `npm start` — fails at *Create container* with
   **"The executable `pnpm` could not be found"**, because the runtime image is
   a bare `node:20-slim`: pnpm exists only in the build stages, and the
   standalone server does not need it.

   `/app/start.sh` is written during the build with the app name already
   baked into it, so it takes no arguments and reads no variables. The same
   string works for all three services.

5. **Settings → Networking → Generate Domain.**

If a build fails with `APP must be crm, site or admin — got ''`, the service
variable is missing. That message is deliberate: without it the build fails
ninety seconds later inside pnpm with "no projects matched the filter", which
tells nobody what to do.

### 3.1 Photographs — Cloudflare R2

Railway cannot attach one volume to two services. A disk on crm and a disk
on site are two different folders, so a photograph the office uploads never
reaches the public page. R2 is the shared store.

**Do this in Cloudflare, once:**

1. [Dashboard](https://dash.cloudflare.com/) → **Storage & databases → R2 → Overview**. Add the R2 subscription if asked (the free tier is enough to start).
2. **Create bucket.** Name it `rixdrive-media` (or anything you then put in `R2_BUCKET`). Location: **European Union** — these are UK dealer photographs, and a part-exchange shot is often taken at a customer's house. Do **not** enable public access.
3. On the R2 overview, **Account details → API Tokens → Manage**.
4. **Create Account API token** (or User token). Permission: **Object Read & Write**, scoped to that one bucket. Copy **Access Key ID** and **Secret Access Key** now — the secret is shown once.
5. Account id: the R2 overview, or any zone's right-hand sidebar.

**Then on Railway, on both `forecourt-crm` and `forecourt-site` (not admin):**

| Variable | Value |
|---|---|
| `R2_ACCOUNT_ID` | the account id |
| `R2_ACCESS_KEY_ID` | the token's Access Key ID |
| `R2_SECRET_ACCESS_KEY` | the token's Secret Access Key |
| `R2_BUCKET` | `rixdrive-media` |
| `R2_JURISDICTION` | `eu` |

Same values on both services. Half-set variables refuse to boot (a fallback to disk would look like R2 worked and then lose every photo on deploy). Redeploy both.

The apps keep serving `/media/t/<tenant>/…`. They never expose the R2 host. Unpublished interiors and appraisal photographs stay behind the existing session / published-row checks.

A Railway volume at `/var/media` is now optional. Leave it if you already attached one; it is unused once R2 is fully configured.

---

## 4. Build the schema

The applications do **not** migrate on start. Three services booting at once
would otherwise all migrate the same database simultaneously; more importantly,
a schema change should be a decision somebody makes, not a side effect of a
deploy.

From your machine, with the public URL:

```bash
export DATABASE_URL='postgresql://postgres:...@turntable.proxy.rlwy.net:12345/railway?sslmode=require'

pnpm db:deploy --check    # says what it would do, changes nothing
pnpm db:deploy            # extensions, roles, migrations, policy verification
pnpm db:seed:catalogue    # make / model / variant (~46k rows) from vehicle_details/
```

`db:deploy` is the deployment counterpart of `db:setup`, which refuses any host
that is not localhost and takes a `--reset` that drops the schema. `db:deploy`
is **strictly additive** — no drops, no truncation, nothing that can lose a row
— which is what makes it safe to point at a real database. Every step is
idempotent, so re-running it is a no-op, and it takes a Postgres advisory lock
so two people running it at once queue rather than collide.

It refuses to finish if any tenant table is left without forced row-level
security. A deployment that would serve unprotected data stops instead.

> `db:migrate` alone is **not** enough on a fresh database: it applies
> migrations but never creates the extensions or the four application roles, so
> migration 0001 dies calling a function that does not exist yet.

---

## 5. Make the public site answer

A freshly deployed site returns **404 to everything**, and that is correct
rather than broken. `apps/site` resolves a request to a dealer by its `Host`
header and refuses an unknown or unverified host without a fallback — falling
through to a default tenant would serve one dealer's stock under another
dealer's domain.

So tell it about the host Railway gave you:

```bash
pnpm db:seed                                     # the Kennington demo dealership
pnpm db:domain forecourt-site-production.up.railway.app
```

For a real dealer's domain, add a `CNAME` to the Railway target first, then
register it. `db:domain` marks a host verified without the DNS TXT challenge,
which is a deliberate shortcut **for a host you control** — the challenge is
what stops somebody pointing a CNAME at us and impersonating a dealer on a
domain they do not own. The script says so on every run.

Check it:

```bash
curl -I https://forecourt-site-production.up.railway.app/
curl -s  https://forecourt-site-production.up.railway.app/sitemap.xml | head
```

---

## 6. Demo data and accounts

**Nothing is seeded by default, deliberately.** These seeds create accounts
whose password is printed to a terminal, and a publicly reachable CRM with a
known password is a live credential on the open internet.

If you want the demo dealership for a walkthrough, seed it and then change the
passwords, or take the CRM off its public domain when you are not using it:

```bash
pnpm db:seed            # Kennington Car Sales, 14 cars — no accounts
pnpm db:seed:crm        # two staff accounts
pnpm db:seed:leads      # and prep / deals / invoices / spend / compliance /
                        # channels / accounting, as you need them
```

`db:seed:crm` creates `owner@kenningtoncarsales.co.uk` and
`sales@kenningtoncarsales.co.uk` with a password that is **written in
`packages/db/scripts/seed-crm.mjs`** — so it is known to everyone who can read
the repository. Fine on a laptop. Not fine on a public URL.

Neither account gets an authenticator. The owner's permissions require one, so
its first sign-in is an **enrolment** screen — which means whoever signs in
first claims the second factor, and it does not have to be you. On a public URL
that is a hijack, not a theoretical risk.

So if you seed accounts, do these two immediately, in this order:

```bash
pnpm db:password owner@kenningtoncarsales.co.uk    # reads stdin, not an argument
pnpm db:password sales@kenningtoncarsales.co.uk
```

then sign in and complete MFA enrolment before anybody else can. `db:password`
revokes every existing session as it goes.

---

## 7. Before a customer sees any of this

Three things, and none of them is optional.

**1. `DEMO_SIGN_COMPLIANCE_RULE` must never be set.** It writes a fake sign-off
for `conc.representative_example` so the finance block renders locally. On
anything a customer can reach it would publish a cost-of-credit figure with no
approved representative example behind it, which is a CONC 3.5.3R breach on
every page it appears on. The variable does not exist in the deployment; keep
it that way.

**2. Four pages in the site's own footer and sitemap return 404** —
`/finance`, `/initial-disclosure`, `/complaints-procedure` and
`/privacy-policy`. Two of those are regulatory disclosures and one is required
by UK GDPR Article 13. They are advertised in `sitemap.xml`, so a search engine
will report them as errors as soon as it is submitted. The routes have never
been written. This is not a deployment problem and deploying does not cause it,
but it is a reason not to point a dealer's real domain here yet.

**3. The database connects as a superuser.** The applications set
`SET LOCAL ROLE app_user` / `app_public` inside every transaction, which is
what makes row-level security apply, and `db:deploy` grants the login role
membership of all four so it works whether or not it is a superuser. But
Railway's default `postgres` user *is* one, so a bug that skipped the door
would bypass RLS entirely. Hardening — a login role per application, with only
the membership it needs — is described in §9.

---

## 8. Day-to-day

```bash
railway logs --service forecourt-crm
railway run --service forecourt-crm pnpm db:policies    # against the real DB
```

Deploys happen on push to `main`. A schema change is a separate, deliberate
step: merge the migration, run `pnpm db:deploy --check`, then `pnpm db:deploy`,
then let the services redeploy. Expand/contract means the old code keeps
working against the new schema, so the order is forgiving — but it is only
forgiving if the migration is genuinely expand-then-contract.

**Rolling back a migration** is `packages/db/migrations/NNNN_*.down.sql`, by
hand, deliberately. Every migration has one and every one has been verified to
roll back and re-apply. Two are documented no-ops: `0020` inserts an
append-only compliance rule and `0021` adds a column to a table whose history
must not be rewritten.

---

## 9. Hardening, when this stops being staging

Roughly in the order it will matter:

1. **A login role per application.** Create `crm_login`, `site_login` and
   `admin_login` with `GRANT app_user TO crm_login` and so on, and give each
   service its own `DATABASE_URL`. Then the site's connection cannot become
   `app_user` even if a bug tried, and the CRM's cannot become `app_platform`.
   This is the single largest gap between this deployment and a real one.
2. **Take the admin app off a public domain** — put it behind Railway's private
   networking or an IP allow-list. It is the most dangerous surface in the
   product and it is currently partial.
3. **Backups.** Railway snapshots the volume; that is not the same as a tested
   restore. The stock book and the evidence ledger have statutory retention of
   six years and indefinitely.
4. **Sentry and OpenTelemetry**, which the architecture assumes and which
   nothing currently wires up.
5. **A dedicated migration user**, so `app_migrator` stops being a role nothing
   connects as.

---

## 10. If it does not work

| Symptom | Cause |
|---|---|
| **`The executable pnpm could not be found`, at *Create container*** | A custom start command is set on the service. The runtime image is a bare `node:20-slim` and has no package manager — clear the box, or set it to `/app/start.sh`. The image built fine; only the command used to launch it is wrong. |
| `Cannot find module '/app/apps//server.js'` | Same class, one step further on: a start command that relies on `$APP` expanding, in a context that did not expand it. Use `/app/start.sh`, which has the name baked in. |
| Build fails, `APP must be crm, site or admin` | The `APP` service variable is missing. |
| `DATABASE_URL is not set` in the logs | The variable reference is wrong. It must be `${{Postgres.DATABASE_URL}}`, with the service named exactly as Railway named it. |
| Every site URL 404s | No verified `domains` row for that host. Run `pnpm db:domain <host>`. Correct behaviour, not a fault. |
| Photographs vanish after a deploy | The container filesystem is ephemeral. Set the four `R2_*` variables (plus `R2_JURISDICTION=eu` for an EU bucket) on **both** crm and site. A Railway disk cannot be shared between those two services. |
| Photographs upload in the CRM but 404 on the public site | The two services do not have the same `R2_*` values, or site is still on local disk. Compare the variables. |
| Boot error, `R2 is half-configured` | All four of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` must be set, or none of them. |
| `PermanentRedirect` / 301 from R2 | The bucket is in a jurisdiction. Set `R2_JURISDICTION=eu` (or `R2_ENDPOINT` to `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`). |
| `permission denied for table …` | The schema is older than the code. Run `pnpm db:deploy`, which re-applies the grants. |
| `permission denied to set role "app_user"` | `db:deploy` never ran against this database, so the login role has no membership of the app roles. |
| Health check times out | The server is bound to `127.0.0.1`. The image sets `HOSTNAME=0.0.0.0`; something is overriding it. |
| Migrations hang | Another `db:deploy` holds the advisory lock. It will proceed when that one finishes. |

---

## 11. Building the images locally

Worth doing before pushing — it is the same build Railway runs.

```bash
docker build --build-arg APP=site -t forecourt-site .
docker run --rm -p 4000:3000 \
  -e DATABASE_URL='postgres://postgres:postgres@host.docker.internal:5433/forecourt' \
  forecourt-site
```

Around 400MB per image. The runtime carries neither pnpm nor the workspace's
`node_modules` — Next's `standalone` output traces only what the server
actually needs.
