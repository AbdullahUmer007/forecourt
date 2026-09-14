# Saved-car shortlist slice

A buyer on a phone can save cars, return to their private list, remove choices, compare up to three available cars and enquire through the existing vehicle form. Use existing shortlist tables/domain limits, host-resolved tenant context and a first-party HttpOnly cookie created only by an explicit successful save. Store a SHA-256 token digest, never the raw cookie or contact details. Public RLS must isolate both dealer and visitor, with no access to contact-owned/merged lists. Reads and personalised responses must be no-store. Sold/withdrawn items retain their place but reveal no private stock details. No communications, consent or financial state changes.

Acceptance: save/remove/re-save and duplicate safety; private visitor/tenant boundaries with real Postgres; invalid/cross-origin POST and invalid stock refused; cookie/cache headers verified; mobile empty/list/compare states and real vehicle enquiry links; current public price/specs, never private costs. Migration 0032 extends policy generation so future reapplication preserves visitor protection. Rollback app first; revoke public shortlist grants while retaining all data.


## Delivered locally
- `/saved-cars` GET/POST now implements the previously missing stock-card destination. Vehicle pages can save too; navigation and footer links agree, and the legacy `/saved` link redirects.
- Anonymous choices persist in the existing shortlist tables. A 32-byte random cookie is created only after a successful explicit save, with HttpOnly, SameSite=Lax, one-year expiry and Secure outside localhost. Only a SHA-256 digest reaches the database. No token is put into links, rendered HTML or audit data.
- Visitor-specific RESTRICTIVE policies compose with tenant/site RLS. Contact-owned and merged lists are unavailable through the anonymous path. The policy generator recreates these restrictions and exact grants during future reapplication.
- Save/remove/re-save are idempotent. A locked parent row protects the 50-item limit across concurrent requests. Changes retain removed rows and append audit records.
- The list shows current public prices/specifications and hides details when stock is no longer public. Comparison supports two or three available saved cars; invalid selection gives a clear error and keeps selections.
- Cross-origin/malformed writes are refused, local return paths are constrained, and personalised responses use private/no-store and noindex headers. The list and comparison use normal forms and need no client JavaScript.
- The dead vehicle `#reserve` anchor is now an honest 'Ask about reserving' enquiry link. This does not take deposits or reserve inventory.

## Verification
- 1,810 tests passed across 63 files. Twelve new real-Postgres integration tests cover visitor/tenant isolation, direct forged writes, concurrency, the 50-car limit, duplicate/removal/re-save, public-stock filtering, digest storage/audits, cookie/cache/origin handling and private comparisons.
- Policy verification passed for all 103 tables. Lint, TypeScript and the site Docker production build passed.
- Browser: empty list, stock-card save, two-car comparison, removal, vehicle-detail re-save, invalid one-car comparison preserving selection and the reservation enquiry anchor. The two saved choices survived moving from dev port 3105 to the production-mode local server at port 3100.
- axe-core 4.13 WCAG A/AA checks found no violations on the shortlist and comparison in a 375px dark preview, a 375px light shortlist and a 1440px light comparison. No page-wide overflow; the comparison region scrolls independently on phones. Light preview used the actual base theme variables in an isolated QA frame. Temporary QA assets removed.
- Local Docker image: `forecourt-site-codex:saved-cars`. Previous local preview retained as `forecourt-codex-site-before-saved-cars`. No Railway deployment or production data mutation.

## Remaining scope
Saved-search alerts, identity/cross-device linking, automatic shortlist expiry cleanup and CRM buyer-interest analytics remain separate work. Real inventory photography/storage still needs the earlier deployment verification; demo images remain labelled demo images. Shortlist saving sends no communications, creates no marketing consent and makes no reservation. Losing the browser cookie loses access to the anonymous list.

## Deployment / rollback
Migration 0032 must precede the site deployment. It was applied only to the two isolated local PostgreSQL databases. Roll back site code first, then use the down migration to revoke the new public grants while preserving records and visitor policies. Restore the previous policy-generator definition before any later policy reapplication when rolling back. The public role still has no SELECT privileges on contacts, leads, messages, sessions, invoices or audit records.
