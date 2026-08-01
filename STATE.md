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
| **Current module** | M2 — Tenancy & identity (`ready`, not started) |
| **Last shipped** | M0 Audit tool · M1 Foundation |
| **Backlog complete** | 2 of 21 modules (10%) |
| **Blocking issue** | **No git remote.** Code cannot persist between sessions. See "Needs Abdullah" below. |
| **Next milestone** | End of M8 — Kennington's stock live, passing all 16 audit checks, compliant payment on every car |

---

## Module status

| # | Module | Status | Notes |
|---|---|---|---|
| M0 | Dealer Site Audit tool | ✅ done | 16 checks, fixture mode, Kennington fixture scores 16/100. Web front end still to build. |
| M1 | Foundation | ✅ done | Workspace, tokens, domain (11 tests green), db/RLS, isolation suite, skills committed |
| M2 | Tenancy & identity | 🟢 ready | Next up |
| M3 | Vehicle core | ⬜ todo | Blocked by M2 |
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

1. **A private GitHub repository, with access.** Until this exists, code does not survive between sessions and modules cannot build on each other. Highest-value unblock by a wide margin.
2. **Compliance advisers on retainer** — a motor-trade FCA compliance consultant and a VAT specialist, ~£1.5–3k/month. M8, M11 and M12 cannot go live without them.
3. **Start the data provider conversations** — cap hpi / HPI Check (same parent, negotiate together), an aggregator for launch speed, Auto Trader technology partner status. All sales-gated, months of lead time, and they gate M4 and M16.
4. **Confirm the Kennington numbers** before any pitch: units per month, current finance penetration, average commission, what they actually pay today.
5. **Decide the product name and buy the domain.** "Forecourt" is a working name — check trade marks in classes 9 and 42.
6. **Approve the two published guarantees** (Data Portability Charter, 90-Day Switch Guarantee) and get the terms drafted properly.

---

## Open risks

| Risk | Status |
|---|---|
| No git remote → no code continuity | **Live.** Mitigated by delivering archives, but it's friction on every session. |
| FCA motor finance redress scheme partially suspended (Upper Tribunal, ~1–2 July 2026; hearing expected Dec 2026–Feb 2027) | Monitoring monthly. All scheme parameters held as data, not code. |
| FCA CP26/15 may change the CONC 3.5.3R representative example and the 51% threshold | Monitoring. `<FinancePromotion>` field list must be configurable, not fixed. |
| Competitor could fix the SEO and finance gaps | Structural for them (URL routing, sitemaps, schema, a compliant finance component across 22 themes). Lead measured in months. Keep moving to compliance depth. |
| Our own site failing our own audit | Every audit check becomes a CI gate on sites we build. Non-negotiable. |

---

## Metrics

| | Now | 90-day target |
|---|---|---|
| Modules complete | 2 / 21 | 9 (M0–M8) |
| Domain tests passing | 11 | — |
| Dealer sites audited | 1 (Kennington, via fixture) | 500 |
| Design partners | 0 | 8 |
| Paying dealers | 0 | first in sight |
| Tenant leaks | 0 | 0 |

---

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-08-01 | Setup | Strategy docs 01–07, three skills, design brief, M0 audit tool (16 checks, tested), M1 foundation (11 tests green), build plan, manager charter, scheduled tasks created |
