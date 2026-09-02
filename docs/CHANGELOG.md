# Changelog

## Sellable dealer spine

Admin can provision a second dealership. The owner runs staff, photographs, the shopfront and part-exchange from the CRM. Public pages are templates, not a CMS. A car still cannot go live without a published photograph, a retail price and a VAT scheme.

- **Provisioning** — one transaction creates tenant, site, brand, nine system roles and the owner. Isolation tested.
- **Admin** — create dealership, tenant detail, connect a hostname, suspend / restore / cancel, gated by `operatorCan`.
- **People** — invite a system role, suspend, remove with typed confirm. The last owner cannot be removed.
- **Photographs** — upload, hero, publish, withdraw. Stored on Cloudflare R2 when `R2_*` is set on crm and site (same private bucket, tenant-prefixed keys). Local disk otherwise.
- **Website** — Classic / Studio / Compact, brand colour (AA), logo, contact, copy. Preview in the CRM without a host lookup. About, contact, finance, part-exchange, privacy, complaints, initial disclosure, terms and warranty ship as templates. Finance still cannot invent a monthly payment.
- **Part-exchange** — create a draft, record an offer, accept or decline, take into stock (purchase price = allowance). The public form creates a lead and a draft and says we will ring with a figure.
- **Withdraw** — archive a car that was never sold (stock book stays). Withdraw an appraisal draft (offers stay). Staff membership is revoked, not deleted. Invoices and settlements have no delete.

`ADMIN_MFA_BYPASS=1` remains until admin MFA screens exist. That debt is still visible on purpose.
