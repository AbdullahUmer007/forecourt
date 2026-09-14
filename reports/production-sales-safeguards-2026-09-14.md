# Production readiness: invoice action safeguards

Use existing feature/domain guidance. Close the legacy browser-posted invoice pricing path by routing it through the server-derived reviewed-deal workflow. Enforce permissions inside issue/credit/payment mutations, validate IDs/directions, serialize invoice status and balance reads, and serialize cash aggregation on the customer. Check sale draft associations and total against the linked simple cash deal before issue; refuse stale or unsupported settlement and unapproved discounts before numbering. Preserve existing VAT calculations and stock-book behavior in this slice. No live payments/issue/deployment. Acceptance: direct permission refusal, malformed IDs/direction safe errors, concurrent issue/credit/refund produces one valid outcome without duplicate numbering or over-refund, stale total issue refused, legacy entry point cannot forge price. Existing margin stock-book completeness and AML override policy still need production review. No migration; rollback code with records retained.


## Delivered

- The legacy `createDraftInvoice` server action now requires the reviewed deal revision and uses `draftInvoiceFromDeal`. Posted buyer, tax scheme, price and extra-line fields cannot override the server-derived draft.
- Issue, credit and payment mutations enforce their own permissions and branch/owner scope; malformed invoice IDs and payment directions return safe refusals.
- Invoice row locks serialize issuance, crediting and balance calculations. Cash receipts also lock the customer before aggregating cash across their invoices.
- Sale issue checks the linked agreed/contracted deal, customer, vehicle, currency, recorded VAT scheme, simple settlement, exact gross total and current discount approval before allocating a number.
- Approval remains readable after a draft is attached, while its revision binding still invalidates changed terms. Request/review eligibility remains unchanged.
- Credit-note payments and new receipts against cancelled invoices are refused; refunds remain on the original sale invoice.
- Six regression tests cover direct permissions/scope, malformed input, stale totals, competing issue/credit/refund requests, cross-invoice cash aggregation and forged legacy form fields. Existing payment tests now select their own sale invoice even after its status changes.

## Release limits and next work

This is a local safeguards slice, not complete accounting or a production release. No migration, live payment, external message or Railway change was made. Existing stock-book behavior and VAT calculations are unchanged: missing/already-sold margin stock-book entries, purchase-price provenance and independently authorized cash overrides need the next accounting pass. Full PX/finance/add-on/deposit settlement and contract/handover synchronization remain blocked. Then complete real communications delivery, shared production media storage, backup restoration, monitoring and deployed end-to-end checks. Revert the code for rollback; retain all financial/audit records.

## Verification

Fresh local database `forecourt_safeguards_final`: all 33 migrations, 1,853 tests across 69 files passed. Typecheck and lint passed; RLS gate reports all 103 expected protected tables. Linux CRM production image `forecourt-crm-codex:invoice-safeguards` built successfully. No UI changed in this slice; regression coverage exercises the server action and real database mutations, not a newly claimed browser walkthrough. Initial full run exposed stale status assumptions in two older refund tests; selecting the fixture sale invoice across issued/part-paid/paid states fixed them, followed by the fresh full passing run.
