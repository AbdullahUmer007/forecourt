# Website themes and catalogue demo stock

Dealer staff select and preview three modern public layouts in the CRM, preserving their copy and contact settings. Keep existing theme IDs compatible, pass layout identity to every public renderer, add actual-stock photography to the homepage, and provide read-only unsaved preset previews on desktop/phone. Acceptance: distinct layouts, gallery selection persists, preview does not mutate, permission/tenant checks preserved, responsive keyboard-accessible pages, filters reflect catalogue-selected demo make/model/variant. User authorized local and Railway demo replacement; archive prior demo stock and retain financial/evidence records, create catalogue-derived stock with audited writes, validate exact demo tenant and catalogue matches before mutations. No tax, finance or consent changes.


## Delivered

- Three compatible theme IDs now carry layout identity through the shared public renderer: Showroom (classic), Studio and Motor Market (compact). Previously the renderer received colours and radii but no layout ID.
- CRM gallery uses read-only thumbnails of real tenant stock/copy; full desktop/phone preset previews do not save changes. Selecting a preset updates the form controls; the explicit Save website action persists it with the existing permission/audit path. Saved copy and contact settings survive switching.
- Distinct responsive homepage, card and surface treatments; real stock photographs are used when present, with a clearly labelled generated showroom illustration when absent. Empty photo cards say photographs are coming soon. Mobile navigation wraps.
- Variant joins existing URL-based filters; it appears under one selected make and model and resets when either changes. SQL slug normalisation handles the catalogue’s punctuation-heavy derivative labels. Browser verified Ford Focus two cars -> exact variant one car.
- Added public assets to standalone Docker images (previously omitted).

## Demo data changes — explicitly authorized for local and Railway

Ran the scoped, dry-run-by-default `packages/db/scripts/refresh-demo-catalogue-stock.mjs` against Kennington only. Archived 14 local and 15 Railway active old demo cars. Sold/delivered and all financial/evidence records retained. Added eight catalogue-selected examples in each database: Ford Focus (two generations), Fiesta, Audi A3 (two engine variants), Kia Sportage and Toyota Corolla (hatchback/estate). All eight in both databases have matching make/model/variant IDs and catalogue labels. Source IDs are explicit; no inferred derivatives. New records carry demo descriptions and DEMO registrations, with no invented photographs or provenance checks. This seed is only for the named demo tenant, not a production intake workflow. Audit records cover each archive/create, and snapshots retain the previous IDs/states for rollback. Snapshots are in the session work directory, not committed. Re-running the refresh does not duplicate its stock.

## Verification and release scope

1,856 tests / 69 files passed, including read-only distinct preset previews, private-stock exclusion, variant facet/count matching and URL/reset behavior. Final typecheck and lint passed. CRM browser selected Studio, saved and reloaded it; then saved Showroom with refreshed local headline/lead. Gallery desktop and phone-width axe checks returned zero violations and no page overflow. Public phone check found two pre-existing dark surface contrast issues in browse headings; changed them to the readable muted token. Final public desktop and 343px content-width phone audits both returned zero violations and no overflow. The RLS gate passed for all 103 protected tables. Both CRM and site Linux production builds passed; final clean CRM build excludes QA assets. Local public preview runs the new image on port 3100, CRM dev on 3101. Railway database changed as authorized; theme/filter code is not deployed there yet.

## Generated asset

Built-in image generation; saved and compressed to `apps/site/public/themes/showroom.webp` and `apps/crm/public/themes/showroom.webp` (126,060 bytes each). Prompt: Create a premium automotive website hero photograph-style illustration, landscape 3:2. An unbranded graphite silver modern estate car, front three-quarter view, parked on pale warm concrete in front of a minimalist architectural showroom with tall glass windows and warm interior lights. Soft late-afternoon light, olive trees, refined editorial automotive photography, realistic proportions, no people/logos/signage/text, blank plate. Car fully visible with breathing room. Clearly labelled as an illustration, not actual stock photography.

Remaining: add verified car photographs; deploy the code to Railway to expose the gallery, redesigned layouts and Variant filter there. No claim of measured production Lighthouse/LCP budgets. Existing fonts use curated system fallbacks when font assets are not installed; no third-party font request added.
