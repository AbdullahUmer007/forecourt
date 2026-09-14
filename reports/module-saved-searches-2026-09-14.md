# Saved searches slice

Implement browser-private saved searches beside saved cars, using the existing anonymous visitor cookie and tenant resolution. Save normalised full criteria (including sort, resetting pagination); show current public match counts; reopen, rename and remove searches. Preserve all filters, deduplicate saves under a parent-row lock, cap active searches at 20, escape names and refuse foreign origins/invalid URLs. No email capture, consent creation or delivery promises: automatic alerts remain separate work.

Acceptance: real PostgreSQL tests for both visitor and tenant isolation, contact-owned searches hidden, direct forged writes refused, duplicate/cap concurrency, audited rename/removal, lossless filter round-trip, cookie/cache security and real routes. UI has clear empty/error/no-match states, keyboard forms, responsive cards and light/dark accessibility checks. Additive migration and policy generator must retain restrictions after reapplication. Migration before deployment; rollback site first and revoke saved-search grants, retaining records.

## Delivered locally
- `/saved-searches` lists private browser-owned searches with current public-stock match counts, complete filter chips, reopen links, inline rename and removal forms. Both positive and zero-result stock pages expose a working Save this search action. Saved cars and footer links connect the journeys.
- Full normalised search URLs preserve filters and sort while resetting pagination to page one. Duplicate concurrent saves produce one record/audit; a locked anonymous parent enforces the 20-active-search cap. Removal retains the record and permits saving those preferences again.
- Uses the existing HttpOnly visitor cookie and stored token digest. Personal responses are private/no-store and noindex; save forms require same-site origin. Names are bounded/escaped, destinations limited to stock-search URLs, and public writes append audit events without visitor tokens.
- Migration 0033 adds `removed_at`, an active-search index and a restrictive public policy composed with tenant/site and anonymous-parent policies. Contact-owned/consented/notified records are inaccessible. Public role has no DELETE grant. The policy generator retains the new restriction after reapplication.
- Replaced the nonfunctional email-alert form with honest saved-search functionality. No email collected, consent created, subscription enabled or message sent.

## Verification
- 1,819 tests passed across 64 files on a fresh isolated local database (`forecourt_search_verify`). Nine new integration tests exercise filter round-trip, no-cookie reads, duplicate/cap concurrency, visitor/tenant isolation, direct forged writes, contact-record exclusion, escaping, audited rename/remove, current matching counts and origin/cookie handling.
- All 33 migrations applied from scratch. Migration 0033 also applied successfully to the existing local demo and integration databases. Policy gate passed for all 103 protected tables. TypeScript, lint and production site Docker build passed.
- Updated an obsolete rendered-results test that asserted the fake email form. Dated the website-preview fixture so the test's intended arrival stays in the six-newest selection. Repeated runs of the older shared fixture database had accumulated enough leads to exceed an inbox test's 50-row page; the final complete suite ran clean on the fresh database without deleting existing fixtures.
- Browser tested empty state, stock-filter save, rename, reopening identical filters, a zero-match search, removal preserving the other search, and persistence into the production-mode preview. Local demo choices left: Automatic and Everyday Ford options.
- axe-core WCAG A/AA: zero violations at 375px in dark and light modes, and 1440px in light mode. No page-wide horizontal overflow. Light QA applied the real base palette in an isolated frame. Temporary QA assets removed and temporary dev server stopped.
- Image `forecourt-site-codex:saved-searches` now serves local port 3100. Previous preview retained as stopped container `forecourt-codex-site-before-saved-searches`. Railway unchanged.

## Deployment and rollback
Deploy migration 0033 before new site code. Roll back site code first, then use 0033 down to revoke public saved-search access, retaining records and restrictive policies. Restore the preceding policy-generator definition before later policy reapplication on a rollback. No production deployment has been performed.

## Remaining scope
Automatic email/SMS alerts and their delivery worker/provider, cross-device identity, retention cleanup, and dealer buyer-interest analytics remain separate work. Search matching reuses existing public-stock semantics (live/reserved cars); counts are current when the page loads, not pushed in real time. Clearing or expiring the browser cookie loses access to the anonymous choices. The wider project is not fully complete.
