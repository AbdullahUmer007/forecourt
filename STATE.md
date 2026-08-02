# STATE — Forecourt

> **Read this first, every session.** It is the single source of truth for what is done, in flight and blocked.
> Update it at the end of every session. Keep it short; detail goes in `reports/`.

**Last updated:** 2026-08-01 · by: Claude (setup session)
**Current phase:** Foundation complete, M2 next
**Autonomy:** Broad (see `docs/09-manager-charter.md`)

---

## Right now

| | |
|---|---|
| **Current module** | M3 — Vehicle core (`ready`, not started) |
| **Last shipped** | M2 Tenancy & identity (1 Aug 2026, overnight) |
| **Backlog complete** | 3 of 21 modules (14%) |
| **Repository** | **`github.com/AbdullahUmer007/forecourt`** (private, `main`, 48 files, pushed 2026-08-01) |
| **Blocking issue** | None. GitHub push access is **permanently unavailable** on this plan — see "Delivery method" below. Sessions deliver `git bundle` files; Abdullah pulls and pushes. This is settled, not a workaround. |
| **Next milestone** | End of M8 — Kennington's stock live, passing all 16 audit checks, compliant payment on every car |

---

## Module status

| # | Module | Status | Notes |
|---|---|---|---|
| M0 | Dealer Site Audit tool | ✅ done | 16 checks, fixture mode, Kennington fixture scores 16/100. Web front end still to build. |
| M1 | Foundation | ✅ done | Workspace, tokens, domain (11 tests green), db/RLS, isolation suite, skills committed |
| M2 | Tenancy & identity | ✅ done | 13 tables, 9 roles, permissions with derived-value protection, provisioning + go-live checklist. **Fixed a cross-tenant leak in the M1 RLS generator** — see reports/session-2026-08-01-m2.md |
| M3 | Vehicle core | 🟢 ready | Next up. Note: registration must be `UNIQUE (tenant_id, registration)` — a global unique would leak the existence of a rival's stock |
| M4 | Vehicle data & provenance | ⬜ todo | Blocked by M3. **Needs a data provider contract — long lead time, start now** |
| M5 | Media pipeline | ⬜ todo | Blocked by M3 |
| M6 | Public website engine | ⬜ todo | Acquisition-critical |
| M7 | Public inventory experience | ⬜ todo | Acquisition-critical |
| M8 | Finance display & compliance | ⬜ todo | Acquisition-critical. **Needs adviser sign-off before go-live** |
| M9 | Contacts & consent | ⬜ todo | |
| M10 | Leads & communications | ⬜ todo | |
| M11 | Money | ⬜ todo | **Needs VAT specialist sign-off** |
| M12 | Deals & Evidence Ledger | ⬜ todo | **Needs FCA compliance sign-off** |
| M13 | Part-exchange appraisal | ⬜ todo | |
| M14 | Prep pipeline | ⬜ todo | |
| M15 | Pricing intelligence | ⬜ todo | |
| M16 | Channel feeds | ⬜ todo | **Auto Trader partner status — long lead time** |
| M17 | Accounting sync | ⬜ todo | |
| M18 | Reporting & Channel P&L | ⬜ todo | |
| M19 | Compliance centre | ⬜ todo | |
| M20 | Platform admin & billing | ⬜ todo | |

---

## Needs Abdullah (ranked)

1. **Compliance advisers on retainer** — a motor-trade FCA compliance consultant and a VAT specialist, ~£1.5–3k/month. M8, M11 and M12 cannot go live without them.
3. **Start the data provider conversations** — cap hpi / HPI Check (same parent, negotiate together), an aggregator for launch speed, Auto Trader technology partner status. All sales-gated, months of lead time, and they gate M4 and M16.
4. **Confirm the Kennington numbers** before any pitch: units per month, current finance penetration, average commission, what they actually pay today.
5. **Decide the product name and buy the domain.** "Forecourt" is a working name — check trade marks in classes 9 and 42.
6. **Approve the two published guarantees** (Data Portability Charter, 90-Day Switch Guarantee) and get the terms drafted properly.

---

## Delivery method — SETTLED, do not revisit

**Sessions cannot push to GitHub. Do not attempt it, do not test for it, and never ask Abdullah to fix it.**

Investigated exhaustively on 1–2 Aug 2026 and closed:
- The GitHub OAuth connector works — a session can authenticate and read the account identity as `AbdullahUmer007`.
- The Claude GitHub App was correctly installed against `AbdullahUmer007/forecourt` on 1 Aug.
- Every API call to `/repos/AbdullahUmer007/forecourt` still returns **403 "GitHub access to this repository is not enabled for this session"**, in three separate sessions including a freshly-fired one.
- The `add_repo` tool the error message names **does not exist in Cowork sessions** — it is a Claude Code feature.
- The session-to-repository binding is an **organisation-level setting**, and organisation settings require a **Team or Enterprise plan**. This account is on an individual plan, so the control is not available. Confirmed by Abdullah on 2 Aug.

**The workflow, permanently:**
1. Build and commit locally in the session container.
2. `git bundle create <name>.bundle --all` and deliver it with `SendUserFile`.
3. Abdullah runs `git pull ~/Downloads/<name>.bundle main && git push`.

**Consequences to hold in mind:**
- A session **cannot see the true state of `main`**. `STATE.md` in the project is the authoritative record — trust it over any assumption about the remote.
- Always state in the report which commits the bundle contains, so Abdullah can tell what is outstanding.
- Never assume a previous session's work reached GitHub. It only did if Abdullah pulled and pushed it.

---

## Open risks

| Risk | Status |
|---|---|
| Sessions cannot push to GitHub (plan-tier limitation) | **Closed — accepted permanently.** Bundle delivery is the workflow. The residual risk is drift between the container's copy and `main`; mitigated by treating project `STATE.md` as authoritative and naming the bundle's commits in every report. |
| Git credentials on the founder's machine default to a different GitHub account (`naumansharifwork`) | The `forecourt` remote URL now pins `AbdullahUmer007@`, so pushes from `/d/Projects/dealer/forecourt` are correctly attributed. Other repos on that machine are unaffected and may still push under the cached account. |
| FCA motor finance redress scheme partially suspended (Upper Tribunal, ~1–2 July 2026; hearing expected Dec 2026–Feb 2027) | Monitoring monthly. All scheme parameters held as data, not code. |
| FCA CP26/15 may change the CONC 3.5.3R representative example and the 51% threshold | Monitoring. `<FinancePromotion>` field list must be configurable, not fixed. |
| Competitor could fix the SEO and finance gaps | Structural for them (URL routing, sitemaps, schema, a compliant finance component across 22 themes). Lead measured in months. Keep moving to compliance depth. |
| Our own site failing our own audit | Every audit check becomes a CI gate on sites we build. Non-negotiable. |

---

## Metrics

| | Now | 90-day target |
|---|---|---|
| Modules complete | 3 / 21 | 9 (M0–M8) |
| Tests passing | 129 (61 domain + 68 isolation) | — |
| Dealer sites audited | 1 (Kennington, via fixture) | 500 |
| Design partners | 0 | 8 |
| Paying dealers | 0 | first in sight |
| Tenant leaks | 0 | 0 |

---

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-08-01 | Setup | Strategy docs 01–07, three skills, design brief, M0 audit tool (16 checks, tested), M1 foundation (11 tests green), build plan, manager charter, scheduled tasks created |
| 2026-08-01 | Repo | `github.com/AbdullahUmer007/forecourt` created and pushed — 48 files, 74 objects, `main`. Claude GitHub App access still to be granted. |
| 2026-08-01 | M2 build | Tenancy, identity, roles, permissions, provisioning. 129 tests green. Found and fixed a cross-tenant leak: permissive `site_scope` policies were OR-ing away tenant isolation on every table with a `site_id`. |
