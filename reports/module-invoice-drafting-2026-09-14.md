# Invoice drafting from a deal

A permitted staff member opens an agreed cash deal and reviews an invoice draft before issue. Read the linked customer, vehicle, price and VAT scheme from tenant-scoped server data; never trust posted associations/scheme. Retain buyer identity/address snapshot, show actionable missing-detail errors, refuse complex finance/PX/add-on deals until line handling is complete, and serialize duplicate invoice creation on the deal. A draft allocates no invoice number and changes no stock-book or payment state. Existing tax calculation/issue gates remain; no new tax interpretation or production issue. Local testing only.

Acceptance: server-derived associations and values; cross-tenant/permission rejection; concurrency one invoice; missing customer details block; review -> draft -> existing invoice screen; no numbering/issue on draft; margin display remains guarded by existing golden tests. Rollback new entry points and retain all invoice/audit data.


## Delivered and verified
Added an invoice review page and guarded server action for agreed/contracted simple cash deals. Required street/postcode and VAT scheme errors link back to the source records. Customer, vehicle, scheme and gross cash total are server-derived; a composite revision rejects stale reviews and the deal row serializes concurrent draft requests. The existing draft API also rejects mismatched associations/schemes and checks permission. The domain accepts an explicit single-line VAT-inclusive price using existing versioned-rate calculations; qualifying gross remains exact and non-qualifying lines no longer receive output VAT.

Four new integration cases and three domain/property cases pass alongside the existing 28 invoice integration cases. Browser verified missing-details gates and creation of draft 01a09ec9-9b97-771d-b9f8-2fcf9665e0b3 for local fixture WE17DQV / Local Appointment Test at £5,990.50, no invoice number/payment/issue. Mobile document checks passed with no automated accessibility violations or overflow. Local test fixture address and VAT scheme were populated solely for this exercise.

## Remaining limitations
Full settlement (PX, finance, deposits and add-ons), quote/order documents, issuance readiness and operational accounting remain separate work. In particular, legacy margin draft calculation uses total vehicle cost as purchase price; stock-book source-of-truth and tax treatment need explicit completion/review before production use. No invoice was issued. New draft creation must not be interpreted as end-to-end accounting readiness.

Final verification: CRM/site production Docker builds, lint, typecheck and 103-table RLS policy gate passed. Full suite checkpoint was 1,838 tests / 66 files; the final public-hours follow-up passed 32 targeted tests. No temporary QA harness files remain. Changes are uncommitted for user review.
