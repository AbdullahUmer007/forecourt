# Website enquiries → CRM inbox

Buyer journey: a buyer on a phone asks about a public vehicle or contacts the dealer. Their enquiry must appear in the correct dealership's existing lead inbox, linked to the advertised vehicle and its branch where applicable.

Data: insert a contact, lead, creation event and audit event in one tenant-scoped transaction. Use the existing lead SLA policy. No marketing consent is inferred and no outbound message is sent.

Acceptance:
- General and vehicle enquiries persist and appear in the CRM inbox.
- Invalid input retains entered values with an actionable error; successful POST redirects to a confirmation page.
- Unknown, deleted, unpublished and other-tenant vehicles cannot create a vehicle enquiry.
- Public writes do not acquire SELECT access to private contacts or leads.
- Host resolution, same-origin checks, bounded input and a bot trap protect the public route.
- Forms remain usable without JavaScript and in both colour modes.

Initial inspection also found missing saved-car/saved-search routes, a reservation anchor without a reservation journey, demo stock photography, and incomplete provider integrations. These remain separate modules; existing STATE.md completion percentages are not evidence of working end-to-end journeys.

Baseline: typecheck passed. Fresh local database setup failed at migration 0007 because the RLS generator grants access to lead/appraisal tables before they exist. Fixing the grant loop is necessary to run the local isolation suite.

Rollout: apply migration 0028, then deploy the site. Roll back the code (including the RLS generator) first and apply the 0028 down migration to remove the additional public audit INSERT grant. Existing enquiries remain intact.

## Implemented and verified

- Vehicle and general enquiries create real inbox records through the `app_public` role. UUIDv7 references are allocated before INSERT so private SELECT grants are unnecessary. No consent or outbound message is created.
- Request host determines the tenant. Cross-origin POSTs, invalid input and oversized request bodies are refused; a hidden bot field discards simple spam. Errors preserve escaped input and are not cached. Successful submissions redirect to avoid resubmission on refresh.
- Part-exchange had the same INSERT RETURNING permission bug. It now creates the contact, lead and appraisal without private SELECT, appends an audit event, and rejects blank mileage instead of silently accepting zero.
- Contact page has desktop columns, phone stacking, light/dark tokens and visible keyboard focus. Browser verified at desktop size and in 375px light/dark iframe viewports with no horizontal document overflow.
- Fixed footer newest-stock link, missing site workspace dependency, missing site-route typecheck coverage, existing route typing errors, colour-token lint violations and credential-file exclusion from Docker context.
- Updated stale tests to own their fixtures, allow only the explicit public INSERT grants, and distinguish decorative brand logos from car-photo alt text. Serial test files avoid races over shared integration records.

Validation: all 1,762 tests passed, including cross-tenant tests, on a database without demo seeds; lint and typecheck passed; fresh database setup passed all 28 migrations; all three Docker images (site, CRM, admin) built successfully. Native Windows build compiles but cannot produce standalone symlinks under the current Windows permissions; Linux Docker is the deployment validation.

Browser evidence: submitted a dummy general enquiry through localhost:3100/contact; confirmed success redirect and its appearance under Website enquiry in localhost:3101/leads using the seeded sales account. Railway was read-only.

Remaining: the honeypot is not a production rate limiter; robust abuse controls and duplicate-submission handling belong in the operational pass. Part-exchange HTTP handling still needs the same bounded-input/redirect treatment. Missing saved-car/search and reservation journeys are not fixed by this slice. Finance, provider integrations and live administration have not been certified.
