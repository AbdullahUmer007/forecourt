# Stock workspace and shared visual refresh

Local implementation; no Railway deployment or production data changes.

## Delivered
- Shared CRM navy navigation rail, grouped destinations, contextual top bar, larger page headings, more generous surfaces and responsive drawer focus handling.
- Reconciled stale stock-number counters under the existing allocation lock, preventing imported/seeded stock from breaking booking. Archive now returns to the inventory with confirmation.
- Stock photo cards and compact list, URL-preserving view switch, real status totals linked to filtered inventory, price sorting, partial/spaced registration and stock-number search, safe pagination and sort fallback.
- Vehicle detail cover photograph, improved specifications hierarchy, sticky book-in/edit save controls, and a missing booked-in/returned to preparation action. Existing state-machine and publishing checks remain enforced.
- Photo controls with pending/error handling, missing-media fallback, audit events, serialized cover selection, disclosure protection for unpublishing as well as withdrawal, and protection against removing the last photo from live/reserved stock. Ownership is checked before storing upload bytes.
- Public-site shared spacing, larger headings/cards, clearer sorting and collapsible filters. Admin shared layout, directory spacing and typography refreshed; admin keeps its distinct teal identity.
- Existing demo SVG illustrations are rendered as the existing assets. No substitute vehicle photography or invented performance trends.

## Validation
- Full regression suite: 1,770 tests across 58 files passed. The stock workspace suite contains eight tests including real local JPEG storage/EXIF stripping, concurrent booking after a stale counter, cover selection, evidence retention and the last-live-photo guard.
- Stock performance suite: 13 tests passed, including the 1,000-vehicle query budget.
- Lint and type checking passed. Linux Docker production builds succeeded for site, CRM and admin; CRM rebuilt after final interaction fixes.
- Browser: registration search, filter-preserving list/grid switch, mobile navigation and collapsible public filters verified. Both apps measure clientWidth=scrollWidth=360 within 375px frames.
- Browser stock-controller walkthrough: saved KEN-0015 despite the previously stale counter; moved through preparation/ready; publishing was rejected for four missing requirements; actual JPEG upload succeeded after the Chrome extension reconnected and reduced the requirements to three.
- Archive was found to end on a 404; it now redirects to stock with a success message. A second local record KEN-0016 was used to verify that path. Both walkthrough records are archived.
- Local catalogue seeded: 650 makes, 4,218 models and 46,263 variants. These are local data changes only.

## Remaining product work
This is the first shared visual pass, not completion of every module. Individual dashboard, lead/deal, prep and website-management workflows still need their own design and implementation passes. Provenance-provider integration/recording and complete publishing readiness (including stock-book checks) remain unfinished; do not bypass those checks to publish a demo car. Local shared media storage / production R2 configuration needs separate end-to-end deployment verification. Public saved cars and other previously identified placeholder routes remain on the backlog.

## Local preview
CRM http://localhost:3101/stock; public site http://localhost:3100/used-cars.
All testing uses the isolated forecourt_test / forecourt_bootstrap databases on port 55432. The previous public-site container is retained stopped as forecourt-codex-site-before-stock for rollback.
