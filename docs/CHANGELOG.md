# Changelog

## 14 September 2026 — website theme gallery

- Choose Showroom, Studio or Motor Market from visual previews of your own dealership in CRM.
- Preview a theme before saving, with desktop and phone views.
- Refresh public layouts, mobile navigation and photo placeholders; ship image assets in production containers.
- Filter stock by variant after selecting make/model; reset dependent choices correctly.
- Refresh local and Railway Kennington demo stock from explicit catalogue variants, retaining old records and audit history. Theme code awaits Railway deployment.

## 14 September 2026 — production invoice safeguards (local)

- Require reviewed server-derived deal details for the legacy invoice draft action.
- Enforce permissions, current deal totals and discount approval before invoice issue.
- Serialize competing invoice issue, credit, refund and customer cash checks.
- Refuse credit-note payments and new receipts on cancelled invoices.

## 14 September 2026 — deal discount approvals (local preview)

- Request a discount with a reason and retain an independent reviewer’s approval or decline.
- Enforce saved role limits, prevent self-approval and require fresh review after deal/price changes.
- Link approved discounts to saved cash quotations and simple invoice preparation.

## 14 September 2026 — saved cash quotations (local preview)

- Review and save cash quotation versions from a deal, retaining the original customer/car/price details.
- Reopen previous versions and use a clean print layout.
- Guard stale saves, duplicate requests and unsupported discount/settlement scenarios.
- Fixed public pages failing on legacy empty-object opening hours.

## 14 September 2026 — deals, invoice drafts and weekly hours (local preview)

- Start a draft deal from a customer, car or enquiry; review and revise the cash price with retained history.
- Prepare a simple cash invoice from the agreed deal, with required customer/address/VAT details and a review step. Drafting allocates no invoice number.
- Set separate opening hours or closure for each day, including Sunday. Public contact pages show the full schedule and opening status follows UK time.
- Added tenant/branch/permission, stale-edit, concurrency, exact-money and daylight-saving checks. Full settlement, quotes, handover and provider delivery remain unfinished.

## 14 September 2026 — saved searches (local preview)

- Save stock filters and return to current matching cars without setting them again.
- Rename or remove up to 20 private searches in a responsive light/dark page.
- Saved cars and searches now link together; empty stock results can save preferences too.
- Removed the nonfunctional email-alert promise. Saving does not subscribe or send messages.

## 14 September 2026 — saved cars (local preview)

- Save cars from stock listings and vehicle pages, then return to a private browser shortlist.
- Remove or re-save a choice and compare two or three currently listed vehicles.
- Unavailable cars stay in the list with a clear explanation.
- The reservation link now opens the vehicle enquiry form.
- Buyer lists are isolated by visitor and dealership; no messages or reservations are created by saving.

## 14 September 2026 — customers and appointments (local preview)

- Find, create and update customer profiles with linked enquiries and appointment history.
- Book and reschedule viewings, test drives, collections and meetings from a customer or enquiry.
- See your daily diary in UK time and record completed visits, cancellations and missed appointments.
- Conflicting bookings and stale edits are refused; unsuccessful forms retain your entries.
- Customer and calendar navigation and responsive screens are now available to permitted staff.

## 14 September 2026 — website management (local preview)

- Preview current public stock and saved settings in desktop or phone view.
- Apply theme presets and edit appearance, contact/hours and page content in clear sections.
- Invalid hours/email and oversized copy are refused; failed submissions retain edits.
- Preserve unedited Sunday hours and address fields, with a complete before/after audit.


## 13 September 2026 — sales follow-ups (local preview)

- Create a phone, walk-in or marketplace enquiry and link an existing customer or create one.
- Schedule, reschedule, complete or cancel the next action; outcomes remain in the lead history.
- Find due callbacks and assigned enquiries through the sales inbox workload cards and filters.
- Concurrent stale edits are refused; follow-up completion leaves first-response measurement unchanged.
- Message history shows the actual queued, sent, delivered or failed status.


## Sellable dealer spine

Admin can provision a second dealership. The owner runs staff, photographs, the shopfront and part-exchange from the CRM. Public pages are templates, not a CMS. A car still cannot go live without a published photograph, a retail price and a VAT scheme.

- **Provisioning** — one transaction creates tenant, site, brand, nine system roles and the owner. Isolation tested.
- **Admin** — create dealership, tenant detail, connect a hostname, suspend / restore / cancel, gated by `operatorCan`.
- **People** — invite a system role, suspend, remove with typed confirm. The last owner cannot be removed.
- **Photographs** — upload, hero, publish, withdraw. Stored on Cloudflare R2 when `R2_*` is set on crm and site (same private bucket, tenant-prefixed keys). Local disk otherwise.
- **Vehicle catalogue** — make, model and variant from `vehicle_details/*.csv`. Book-in and part-exchange pick from the list; a typed value that is not in the list is refused. Shared platform tables, readable by every dealer, writable by none. Load with `pnpm db:seed:catalogue` after migration 0027.
- **Website** — Classic / Studio / Compact, brand colour (AA), logo, contact, copy. Preview in the CRM without a host lookup. About, contact, finance, part-exchange, privacy, complaints, initial disclosure, terms and warranty ship as templates. Finance still cannot invent a monthly payment.
- **Part-exchange** — create a draft, record an offer, accept or decline, take into stock (purchase price = allowance). The public form creates a lead and a draft and says we will ring with a figure.
- **Withdraw** — archive a car that was never sold (stock book stays). Withdraw an appraisal draft (offers stay). Staff membership is revoked, not deleted. Invoices and settlements have no delete.

`ADMIN_MFA_BYPASS=1` remains until admin MFA screens exist. That debt is still visible on purpose.
