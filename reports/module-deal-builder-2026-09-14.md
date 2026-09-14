# Draft deal builder

Sales staff need to start a deal from an enquiry or stock at the desk. Create a building-state deal for an existing visible customer and available vehicle, with optional matching enquiry and a positive GBP cash price. Record the chosen cash price, author and evidence/audit; do not change stock state, mark a lead won, record money received, form a contract or introduce finance. Reuse existing tables and downstream deal controls. Serialize on the vehicle; return the existing draft for a repeated same-customer request, refuse a competing active deal without revealing customer information. Searchable selectors expose only permitted contact/vehicle labels. Validate tenant, branch, erased/merged contacts, lead/customer/vehicle association and permissions server-side.

Acceptance: create and reopen from real UI, exact pence parsing, read-only costs withheld, failure retains form, duplicate/concurrent creation, restricted/missing/foreign records rejected, one audit and first evidence entry. Verify existing invoice draft path separately; further quote/order/handover work remains tracked. Roll back routes/actions to remove creation; retain records and history. Local only.

## Implementation checkpoint
Draft creation and repricing implemented with customer/vehicle selectors, enquiry prefill, link entry points, exact pence parsing, retained evidence and audit, row locking, duplicate protection and stale-price rejection. Eight new integration/property cases; full suite 1,827 tests passed. Browser created a draft for Local Appointment Test / Ford Fiesta WE17DQV, then changed £5,995 to £5,990.50. Local sales demo role and seed corrected to include the standard deal.create permission. Existing finance, contract, tax and stock state rules untouched. UI accessibility/build verification follows with invoice workflow. Quote documents, discount approval enforcement, finance/PX structure and handover remain follow-on work.


## UI verification
Phone-width draft builder and invoice document passed automated WCAG 2 A/AA checks with no horizontal overflow. New-customer shortcut is hidden without contact.create. New evidence payloads render human-readable actions and currency instead of raw IDs/pence. Local-only browser test records remain for review; no real transaction or deployment.

Final verification: CRM/site production Docker builds, lint, typecheck and 103-table RLS policy gate passed. Full suite checkpoint was 1,838 tests / 66 files; the final public-hours follow-up passed 32 targeted tests. No temporary QA harness files remain. Changes are uncommitted for user review.
