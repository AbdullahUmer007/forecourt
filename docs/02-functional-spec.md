# Forecourt — Functional Specification

**Version:** 1.0 — August 2026
**Scope:** UK independent used-car dealer SaaS — Office CRM + Public Website
**Companion docs:** `01-product-strategy.md`, `03-architecture-and-data-model.md`, `04-design-system.md`, `05-integrations-and-compliance.md`

---

## Contents

**Part A — Platform**
1. Tenancy, onboarding and settings
2. Users, roles and permissions
3. Audit, notifications and search

**Part B — Inventory**
4. Vehicle records and stock management
5. Vehicle data, provenance and history checks
6. Buying and sourcing
7. Preparation (reconditioning) pipeline
8. Media and merchandising
9. Pricing and market intelligence

**Part C — Demand**
10. Publishing and channel management
11. Public website engine
12. Public inventory experience (incl. shortlists)
13. Contacts and customer records
14. Leads, pipeline and communications
15. Appointments and test drives

**Part D — Transacting**
16. Part-exchange and appraisal
17. Deal builder: quote → order → invoice
18. Motor finance and Consumer Duty
19. Add-on products (warranty, GAP, protection)
20. Delivery, handover and DVLA
21. Aftercare, retention and reviews

**Part E — Running the business**
22. Money: invoicing, payments, VAT margin stock book
23. Accounting integration and reporting
24. People: staff, targets, commission
25. Suppliers and purchasing
26. Reporting, dashboards and channel P&L
27. Compliance centre
28. Platform administration (our side)

**Part F**
29. Cross-cutting requirements
30. MVP scope matrix

---

# Part A — Platform

## 1. Tenancy, onboarding and settings

### 1.1 Concepts

| Term | Meaning |
|---|---|
| **Tenant** | One dealership business (one FCA firm / one VAT registration). The isolation boundary for all data. |
| **Site** | A physical forecourt belonging to a tenant. Every vehicle, sale and user belongs to a site. Single-site tenants get one, created automatically. |
| **Brand** | A public-facing identity (name, logo, domain, theme). Usually 1:1 with tenant; groups may run several. |
| **Workspace** | What a logged-in user sees — a tenant, scoped to the sites they may access. |

### 1.2 Onboarding a new dealer (the sales-critical flow)

**Goal: from signed order to a live, populated, published website in under 4 working hours of our time and under 60 minutes of the dealer's.**

Steps, in order:

1. **Create tenant** — company name, trading name, Companies House number (validated against Companies House API where possible), VAT number, FCA FRN (validated against the FCA Register), addresses, primary contact.
2. **Compliance profile** — set once, drives behaviour everywhere:
   - FCA permission basis: Limited Permission / Full Permission / Appointed Representative (+ principal firm name and FRN)
   - VAT registered? Y/N. Default VAT scheme for stock: Margin / Qualifying / Mixed
   - Motor Ombudsman / trade body memberships
   - AML: does the dealer accept cash at or above the HVD threshold? If yes → HMRC HVD registration number required
   - Data protection: DPO/contact, retention policy overrides
3. **Sites** — name, address, opening hours, phone, geolocation, VAT/stock defaults.
4. **Branding** — logo (light + dark), colour, typeface choice from curated set, tone-of-voice preset for AI copy.
5. **Import stock** — one of:
   - CSV/XLSX upload with column mapping UI and a saved mapping profile
   - Named importers: Dragon2000, Click Dealer, Vehiso, MotorDesk, generic Auto Trader stock export
   - Bulk registration-number paste → DVLA + MOT + spec lookup auto-populates (fastest path; a 40-car dealer can be populated from a list of regs in ~10 minutes)
   - Image bulk upload with reg-number filename matching
6. **Import contacts** — CSV with mapping; **must** capture marketing consent basis per contact or default to "no marketing permission" (never assume consent).
7. **Website** — pick theme, confirm content (about, opening hours, finance page, reviews), set domain. System issues TLS, sets DNS instructions, runs a pre-flight check (Lighthouse, structured data, sitemap).
8. **Channels** — connect Auto Trader, Motors/Gumtree, CarGurus, Meta, Google. Each connection runs a validation publish of one vehicle before enabling bulk.
9. **Integrations** — accounting, email, SMS/WhatsApp, finance, payments, e-sign.
10. **Users** — invite staff, assign roles, optional guided tour per role.
11. **Go-live checklist** — a visible checklist with completion %; the tenant is not marked "live" until stock > 0, website resolves, and at least one channel publishes successfully.

**Acceptance criteria**
- AC1: A tenant can be created and reach "live" state without engineering involvement.
- AC2: Every import is previewable, reversible (single-click undo within 24h), and produces an error report row-by-row.
- AC3: Any import that would create a vehicle without the mandatory VAT stock-book fields flags those rows rather than silently accepting them.
- AC4: DNS/TLS provisioning is self-serve with copy-paste records and automatic verification polling.

### 1.3 Settings (tenant level)

Grouped, searchable settings with a change log:

- **Business** — legal entity, VAT, FCA, trade bodies, insurance/trade plate records
- **Sites** — CRUD, opening hours, holiday calendar, per-site defaults
- **Branding & website** — theme, logo, colours, domains, legal pages, cookie/consent banner config
- **Sales** — deal defaults, admin fee, deposit amount and policy, delivery charges, part-ex policy
- **Stock** — default VAT scheme, prep SLA targets, aging thresholds (amber/red), stock number format, warranty defaults
- **Finance** — lender panel, commission disclosure templates, representative APR settings, product target-market notes
- **Documents** — templates for invoice, order form, order T&Cs, PDI checklist, handover pack, part-ex disclaimer (with version history — see §27.2)
- **Communications** — email sending domain (DKIM/SPF/DMARC), SMS sender ID, WhatsApp number, templates, quiet hours
- **Automation** — follow-up sequences, reminders, aging alerts, escalation rules
- **Integrations** — connection status, credentials, health, last sync, error log
- **Data & privacy** — retention rules, consent defaults, export, erasure request handling
- **Billing** — plan, invoices, usage, payment method

---

## 2. Users, roles and permissions

### 2.1 Roles (defaults; every permission individually overridable)

| Role | Summary |
|---|---|
| **Owner** | Everything, including billing and tenant deletion. Cannot be removed if last owner. |
| **Manager** | Everything operational; no billing, no tenant deletion, no permission editing above own level |
| **Sales Executive** | Own leads and deals; read all stock; create appraisals, quotes and orders up to a discount limit; no cost prices unless granted |
| **Business Manager / Admin** | Full deal, invoice, finance, document and compliance access; no cost/purchase editing unless granted |
| **Buyer / Stock Controller** | Full stock, purchase, valuation and supplier access; read-only on CRM |
| **Prep / Workshop** | Job cards, costs, media capture, status changes; no pricing, no customer data |
| **Marketing** | Website, content, channels, campaigns, media; read-only stock and reports |
| **Accountant (external)** | Read-only financial data + export; no customer PII beyond invoice requirements |
| **Read-only / Auditor** | Read everything, change nothing; useful for compliance consultants |

### 2.2 Permission model

Resource × action matrix (`vehicle.cost.read`, `deal.discount.approve`, `finance.commission.edit`, `contact.export`, …) with:

- **Scope modifiers**: all sites / my site / my records only
- **Field-level rules** for sensitive fields: purchase price, total cost, margin, commission, customer DOB and address, bank details
- **Value thresholds**: discount limit, refund limit, price change limit — above which an approval workflow triggers
- **Sensitive-action step-up**: re-authentication (password or passkey) required for exporting contacts, changing bank details, editing a finance commission record, or bulk-deleting

**Acceptance criteria**
- AC1: A Sales Executive who cannot see cost prices sees no derived value that reveals them (no margin, no "profit" column, no total-cost-based sorting).
- AC2: Every permission denial is logged with actor, resource and timestamp.
- AC3: Permissions are evaluated server-side on every request; UI hiding is a convenience only and is never the sole control.

### 2.3 Authentication

Email + password with a strong policy, passkeys/WebAuthn, TOTP 2FA (mandatory for Owner and anyone with `finance.*` or `contact.export`), Google/Microsoft SSO, SAML/OIDC for Group tier. Session policy: 12h idle timeout in-office, 30 days on trusted mobile devices with biometric re-auth. Full device/session list with remote revoke.

---

## 3. Audit, notifications and search

### 3.1 Audit log
Append-only. Every create/update/delete of a business object records: actor (user or system/integration), tenant, site, resource type and ID, action, before/after diff for changed fields, IP, user agent, request ID, timestamp (UTC). Retained 7 years minimum. Filterable and exportable. **Financial, finance-introduction and compliance records are append-only in the audit sense: corrections create a new versioned record; nothing is ever hard-deleted.**

### 3.2 Notifications
Channels: in-app bell, email digest, push (mobile), SMS for critical. Per-user preferences by category. Categories: new lead, lead unattended past SLA, appointment today/imminent, deal stage change, approval needed, prep SLA breach, vehicle aged past threshold, price position drift, feed publish failure, payment received, document signed, compliance task due, integration failure.

### 3.3 Global search (⌘K / Ctrl-K)
Single search box across vehicles (reg, VIN, stock no, make/model/derivative), contacts (name, phone, email, postcode), deals (deal no, invoice no), documents, and settings. Also a command palette: "Add vehicle", "New lead", "Go to today's appointments", "Publish all". Sub-200ms p95. Fuzzy matching on registrations (handles spacing and O/0, I/1 confusion).

---

# Part B — Inventory

## 4. Vehicle records and stock management

The vehicle record is the spine of the system. Everything else references it.

### 4.1 Lifecycle states

```
Sourcing → Purchased → In transit → Booked in → In prep → Ready
   → Live (advertised) → Reserved → Sold (awaiting delivery) → Delivered
```
Plus terminal/side states: **On hold**, **Returned** (CRA rejection), **Trade disposal**, **Written off**, **Archived**.

Rules:
- A vehicle cannot be **Live** without: mandatory stock-book fields, ≥1 published photo, a retail price, VAT scheme set, and a completed provenance check (configurable per tenant, but on by default).
- **Reserved** requires a deposit record or an explicit manager override with a reason.
- Moving to **Sold** requires a linked deal; moving to **Delivered** requires the handover checklist and DVLA notification flagged.
- Every state change is timestamped and attributed; the durations between states drive the prep and days-to-sell metrics.

### 4.2 Fields

**Identity**: stock number (auto per tenant format), registration (VRM), VIN, previous registration(s), engine number, key count, V5C present + document reference, number of former keepers, service history type (full main dealer / full / part / none) and last service date/mileage.

**Specification** (auto-populated from lookup, all overridable with an "edited" flag): make, model, derivative/trim, body style, doors, seats, transmission, drivetrain, fuel type, engine size (cc) and power (bhp/kW), CO2 g/km, Euro status, ULEZ/CAZ compliance, first registration date, year, colour (+ paint type), mileage and mileage-unit, MOT expiry, road tax band and cost, insurance group, plate type, factory options list, standard equipment list.

**Commercial**: purchase price, purchase date, purchase source (auction / part-ex / trade / private / consignment / fleet), supplier, purchase invoice reference, VAT treatment on purchase, **VAT scheme (Margin / Qualifying / Non-qualifying)** — *set at book-in and locked once a sale is invoiced*, funding method (cash / stocking loan / consignment) and funder, target retail price, current retail price, price history, minimum acceptable price (restricted field), total costs, total cost of sale, projected margin, days in stock, days since price change.

**Merchandising**: advert headline, description (long + short), highlights/bullets, condition notes, attention grabber, video URL, 360 spin URL, publish flags per channel, feature tags (e.g. "One owner", "Full service history", "Apple CarPlay").

**Operational**: site, physical location on site, keys location, current status, on-hold reason, assigned prep owner, PDI status, warranty offered, MOT booked date, notes.

**Documents**: purchase invoice, V5C scan, provenance check PDF, MOT certificates, service records, PDI checklist, photos of damage, weighbridge/collection notes.

### 4.3 Stock list — the workhorse screen

Table + card views. Density toggle. Saved views per user, plus shared tenant views.

- **Columns** (configurable): thumbnail, stock no, reg, vehicle (make/model/derivative), year, mileage, colour, status, days in stock, days since price change, price, price position vs market, cost, margin (permission-gated), site, prep status, lead count, view count, assigned to.
- **Filters**: status, site, make/model, price band, age band (0–30/31–60/61–90/90+), VAT scheme, funding, fuel, transmission, body, prep state, has photos, published channels, has leads, price position band.
- **Sorts**: days in stock (default desc for the aging view), margin, leads, views, price position.
- **Bulk actions**: publish/unpublish, price change (fixed or %), reassign site, add tag, export, re-run lookup, generate descriptions, apply a photo template.
- **Inline editing** for price, status and assignment.
- **Health flags** shown as chips on each row: `No photos` · `No description` · `Aged 90+` · `Priced above market` · `Feed error` · `MOT expiring` · `Missing V5C` · `No provenance check`.

**Acceptance criteria**
- AC1: 1,000 vehicles render and filter in under 400ms p95 (server-side pagination and filtering).
- AC2: Every filter combination is URL-addressable and shareable.
- AC3: Bulk price change writes an individual price-history row per vehicle, attributed to the actor and the bulk operation ID.

### 4.4 Vehicle detail page

Tabbed, with a persistent header (photo, reg plate, make/model, price, status, days in stock, quick actions):

`Overview` · `Specification` · `Media` · `Advert & channels` · `Costs & margin` · `Prep` · `Pricing` · `Leads` · `Documents` · `History`

The **History** tab is a single merged timeline: created, lookups run, status changes, price changes, cost added, photos added, published, viewed N times, leads received, reserved, sold, delivered. This timeline is one of the most-used features in a dealership and is usually missing from competitors.

### 4.5 Duplicate and integrity controls
- Registration is unique per tenant among non-archived vehicles; attempting to re-add a reg surfaces the existing record and offers "this is a returning/re-purchased vehicle" (creates a new stock record linked to the previous one, preserving history).
- VIN check-digit validation where applicable; warning (not block) on mismatch with reg lookup.
- Mileage entered lower than the highest recorded MOT reading triggers a **hard warning** with an explicit acknowledgement (mileage anomaly is both a fraud and a CRA risk).

---

## 5. Vehicle data, provenance and history checks

### 5.1 Registration lookup ("the magic moment")

Type a registration → in one action the system returns and populates:

| Source | Data |
|---|---|
| DVLA VES | Make, colour, fuel, engine capacity, CO2, year of manufacture, tax status/due, MOT status/expiry, wheelplan, export marker, V5C issue date |
| DVSA MOT History | Full test history, pass/fail, mileage per test, advisories and defects |
| Spec provider (cap hpi / JATO / aggregator) | Derivative, trim, body, transmission, doors, power, standard equipment, factory options |
| Valuation provider | Trade, retail, private valuations; forecast residuals |

**UX requirement:** the whole thing completes in under 4 seconds with a progressive UI — DVLA fields appear first, spec and valuation fill in as they arrive. If derivative is ambiguous (very common — e.g. multiple trims share a DVLA record), present a **derivative picker** with distinguishing attributes rather than guessing.

**Cost control:** lookups cost money. Cache aggressively per registration (spec: indefinite; DVLA: 24h; MOT: 24h; valuation: 24h), show a per-tenant lookup counter, and never re-run a paid lookup without either a cache miss or an explicit user action.

### 5.2 Provenance check
On-demand and (optionally) automatic at book-in. Returns: outstanding finance (lender, agreement type, date), insurance write-off status and category, stolen marker, mileage anomaly, plate transfer history, import/export markers, colour changes, scrapped marker.

- Result stored as structured data **and** the provider's PDF, attached permanently to the vehicle.
- **Any adverse marker blocks the vehicle from going Live** until a manager acknowledges it with a written reason, which is recorded in the Deal Evidence Ledger.
- Provenance check status appears on the public vehicle page as a trust signal ("Provenance checked ✓ — date").

### 5.3 MOT and roadworthiness
MOT history rendered as a readable timeline with mileage plotted (a mileage graph immediately exposes anomalies and is a great sales tool on the public site too). Advisories from the most recent test are surfaced into the prep checklist automatically as suggested work items — this is a small feature that dealers love.

---

## 6. Buying and sourcing

### 6.1 Appraisal-to-buy (trade/auction/private purchase)
A mobile-first "Buy" flow: enter reg → lookup → condition capture (guided damage map, photos per panel, tyre depths, interior grade) → costs estimate (auto-suggested from the tenant's historic average recon cost for that make/model/age band) → valuation panel (cap hpi trade/retail, Auto Trader retail rating if available, our own days-to-sell estimate) → **maximum bid calculator**:

```
Max bid = Target retail  − Estimated prep  − Fees/transport
          − Target margin  − (Stocking cost × forecast days to sell)
```

Output is a single number the buyer can act on in an auction hall, with the assumptions visible and adjustable.

### 6.2 Sourcing tools
- **Watchlists**: saved criteria; alerts when a matching vehicle appears in a connected source or when a customer wishlist matches nothing in stock.
- **Demand signals**: what people searched for on the dealer's own website and found nothing, ranked. ("14 searches for a diesel automatic estate under £15k in the last 30 days, zero matches.") This is genuinely differentiating and costs us nothing to build.
- **Gap analysis**: your stock mix vs. what sells fastest in your postcode/price band, based on our own aggregated (anonymised) platform data plus valuation-provider days-to-sell.
- **Purchase orders and consignment**: record intent to buy, deposit paid at auction, collection scheduling.

### 6.3 Book-in
Arrival checklist: keys count, V5C present, service book, locking wheel nut, spare/kit, documents, damage photos, mileage confirmation, initial valet. Completing book-in creates the stock-book entry and starts the prep clock.

---

## 7. Preparation (reconditioning) pipeline

**This module is where we prove ROI. Treat it as a first-class product, not an afterthought.**

### 7.1 Model
A kanban board of prep stages, configurable per tenant. Default stages:
`Awaiting collection → Booked in → Mechanical → Bodywork/SMART → MOT → Parts on order → Valet → Photography → Quality check → Ready`

Each vehicle card on the board shows: photo, reg, model, days in current stage vs SLA, blocking issue, assigned owner, total cost so far vs budget.

### 7.2 Job cards
Per vehicle: line items (description, type [mechanical/body/tyres/MOT/parts/valet/other], supplier, estimated cost, actual cost, VAT, status, assigned to, due date, attachments). Supports internal labour (hours × internal rate) and external supplier work (linked purchase invoice).

- MOT advisories auto-suggested as line items (§5.3).
- Parts ordering: supplier, part number, ordered date, ETA, received date. A vehicle waiting on parts is flagged as **blocked**, and blocked time is reported separately from working time — this single distinction is what lets a dealer fix their prep problem.
- Approval threshold: costs over £X require manager approval before they're committed.

### 7.3 SLAs and alerts
Per-stage target durations. Breach → notification to prep owner and manager, and a red flag on the stock list. Weekly "prep performance" report: average days by stage, worst offenders, cost variance vs budget, blocked days by cause.

### 7.4 Photography workflow
A specific stage with its own checklist (see §8). A vehicle cannot reach **Ready** without the minimum photo set defined in settings.

**Acceptance criteria**
- AC1: The board is usable one-handed on a phone in a workshop, including moving a card between stages and adding a cost with a photo.
- AC2: "Days to live" (book-in → Live) is calculated and reported per vehicle, per stage, per month, with a tenant baseline captured in the first 30 days for later comparison.
- AC3: Prep costs post to the vehicle's total cost in real time and flow to the accounting integration as purchase items.

---

## 8. Media and merchandising

### 8.1 Photo management
- Bulk upload (drag/drop, mobile camera, or reg-matched filenames), reorder by drag, set hero image, per-image captions and tags (exterior front 3/4, interior, dash, boot, engine, damage, wheels…).
- **Guided capture on mobile**: an on-screen ghost overlay for each required angle so photos are consistent across the whole forecourt — this is what makes a small dealer's ads look professional.
- Automatic processing pipeline: EXIF strip, orientation fix, resize to a responsive set (AVIF + WebP + JPEG fallback), **licence plate blur/replace** (configurable — some dealers want their plate frame), background removal/replacement with a branded backdrop, watermark, colour/exposure normalisation.
- Damage photos are stored and flagged as **disclosure evidence**: any image tagged "damage" and shown at point of sale is written to the Deal Evidence Ledger, which is a real defence in a CRA dispute.
- 360 spin and video: upload or embed from a provider; hotspot annotations optional.

### 8.2 Advert copy
- AI-generated description from spec + options + condition + tone-of-voice preset, with a strict rule set: **never invent features, never state a claim not present in the structured data, never use language that could be an unfair commercial practice.** Generated copy is always presented for human approval and is versioned.
- Templates and snippets per tenant; merge fields (`{{make}} {{model}} {{derivative}} — {{mileage}} miles, {{owners}} owners`).
- Quality score for each advert: photo count and coverage, description length, features listed, price position, video present. Shown as a 0–100 "advert strength" with specific fix suggestions.

### 8.3 Compliance guardrails on merchandising
- Any statement of a monthly payment, deposit or rate in an advert triggers the **representative example** requirement (CONC 3.5.3R) — the system detects cost-of-credit language in free text and blocks publishing until a compliant representative example block is attached. See §18.5.
- Advertised price must equal the price that will be honoured; mandatory charges (admin fee, delivery if unavoidable) must be included or clearly disclosed — the system requires the tenant to declare which fees are mandatory and renders them accordingly.

---

## 9. Pricing and market intelligence

### 9.1 Price position
For every live vehicle, show:
- Market retail (from valuation provider), our price, and the **price position %** (our price ÷ market retail).
- Comparable live listings within a configurable radius (count, price range, median, our rank).
- **Forecast days to sell** at current price, and at −2%/−5% price points.
- Price history chart with each change attributed.

### 9.2 Aging price ladder
Tenant-configured rules: at day 30 / 45 / 60 / 90, suggest a price move of X% or to Y% of market. The system **suggests**; a human approves. Bulk "apply all suggestions" with a preview of total margin impact.

### 9.3 Stock health dashboard
- Aging buckets with capital tied up in each
- Total stock value at cost and at retail
- Average days in stock and trend
- Overage report (90+ days) with recommended action per vehicle: reprice / re-photograph / trade dispose / retail elsewhere
- Stock mix vs sales mix (what you buy vs what sells)

---

# Part C — Demand

## 10. Publishing and channel management

### 10.1 Channels
Own website (always), Auto Trader, Motors.co.uk / Gumtree (eBay Motors Group), CarGurus, Carwow, Meta (Facebook Marketplace / dynamic ads catalogue), Google Vehicle Ads via Merchant Center, plus generic XML/CSV export for anything else.

**Note:** there is no universal UK stock-feed standard — each portal defines its own schema. Build a **feed-mapping layer**: one canonical internal vehicle model, one adapter per channel, versioned, with per-channel field validation.

### 10.2 Publishing controls
- Per-vehicle, per-channel toggle; bulk publish/unpublish; scheduled publish; rules-based auto-publish ("publish to Auto Trader when status = Live and photos ≥ 8").
- Channel-specific overrides: price (some dealers advertise differently per channel), description, photo selection, feature list.
- **Publish preview** — see exactly what each channel will render before pushing.
- **Feed health monitor**: last successful sync per channel, per-vehicle publish status, error list with human-readable causes and one-click retry. Errors notify the marketing/manager role.
- Delisting: when a vehicle is sold or reserved, unpublish everywhere within the tenant's configured delay (immediate by default; some dealers keep sold cars up for a day to capture "similar" enquiries — support both, with a clear "SOLD" state on our own site).

### 10.3 Channel attribution
Every lead carries its source channel, campaign and the vehicle it referenced. Combined with per-channel cost (entered monthly or pulled where possible), this produces the **Channel P&L** in §26.

---

## 11. Public website engine

The dealer's own site is a first-class product, not a brochure.

### 11.1 Architecture requirements
- Server-rendered, statically generated where possible, revalidated on stock change. Vehicle pages must be crawlable and fast without JS.
- **Performance budget (build fails if breached):** LCP < 2.0s, INP < 200ms, CLS < 0.1 on a mid-tier mobile over 4G; total JS < 120KB gzipped on the vehicle detail page.
- Custom domain per brand, automatic TLS, `www`/apex handling, redirects manager.
- Multi-brand and multi-site support (a group can have a group site plus per-site sites, or one site with a location filter).

### 11.2 Page types
`Home` · `Vehicle search/results` · `Vehicle detail (VDP)` · `Sell your car / valuation` · `Finance` · `Part exchange` · `About / meet the team` · `Contact & location` · `Reviews` · `Warranty` · `Blog/news` · `Legal (privacy, cookies, terms, complaints, initial disclosure)` · `Thank-you / confirmation` · Custom pages.

### 11.3 Content editing
A block-based editor (not a raw HTML box): hero, vehicle carousel (rule-driven: newest, reduced, under £X, specific tag), text, image, gallery, testimonials, FAQ, CTA, map, opening hours, team, logos, video, form. Live preview, mobile preview, scheduled publishing, draft/published states, version history and rollback.

### 11.4 SEO
- Per-page title/meta/canonical/OG/Twitter, editable, with sensible generated defaults
- Automatic `Vehicle`/`Car`, `Product`+`Offer`, `AutoDealer`, `LocalBusiness`, `BreadcrumbList`, `FAQPage` JSON-LD
- Clean URLs: `/used-cars/ford/fiesta/st-line-2019-ab19xyz`
- XML sitemaps (auto, split by type, submitted on change), robots.txt control
- Location landing pages ("Used cars in Milton Keynes") generated from a template with unique content requirements enforced
- Make/model landing pages auto-generated from live stock, with automatic noindex when stock for that facet is empty (avoids thin-content penalties)
- 301 redirect management for sold vehicles → relevant search results (never a 404)
- Google Business Profile connection, review schema

### 11.5 Analytics and consent
- First-party analytics built in (page views, VDP views, search terms, filters used, enquiry conversion, phone-click, WhatsApp-click), plus GA4/Meta Pixel/GTM support behind a **consent-mode-aware cookie banner** (UK GDPR + PECR compliant, granular categories, consent log retained).
- Per-vehicle view counts feed back into the CRM stock list — dealers love seeing "142 views, 3 enquiries" against a car.

### 11.6 Forms and lead capture
Enquiry, callback request, test drive booking, part-ex valuation, finance enquiry, reserve/deposit, "notify me of similar", contact. All with: spam protection (honeypot + rate limit + optional Turnstile), server-side validation, GDPR-compliant consent wording with the **specific consent text version recorded against the resulting contact record**, and instant creation of a CRM lead with source attribution.

---

## 12. Public inventory experience (including shortlists)

### 12.1 Search and results
- Faceted search: make, model, derivative, price (and **monthly payment** — a huge conversion driver, see compliance note), year, mileage, fuel, transmission, body, doors, seats, colour, engine size, drivetrain, features, site/location, keyword.
- Sort: newest, price ↑/↓, mileage, year, relevance.
- Results: card grid + list toggle, quick-view, comparison checkbox, "reduced" and "just arrived" badges, finance-from figure, save-to-shortlist heart.
- Fast: results should update in under 300ms; facets show counts and disable empty options.
- **Zero-result handling**: never a dead end — show nearest matches, offer "notify me" (creates a wishlist lead), and log the search for the sourcing demand signal in §6.2.

### 12.2 Vehicle detail page (VDP)
The single most important page in the business. Contains:
- Photo gallery (swipeable, full-screen, 360 spin, video), with hero and count
- Price, finance-from monthly payment (compliant — see below), price-reduced indicator
- Key specs grid, full specification accordion, standard equipment and factory options
- **MOT history with mileage chart** and advisory summary
- Provenance check badge and date
- Vehicle condition/disclosure section including any dealer-declared damage with photos
- Finance calculator (deposit, term, annual mileage → monthly payment) with a **compliant representative example rendered whenever any cost-of-credit figure is displayed**
- Part-exchange estimate widget (reg + mileage → indicative figure, creates a lead)
- Reserve online (deposit via Stripe), enquire, call, WhatsApp, book a test drive, request a video walkaround
- Warranty and delivery information
- Dealer trust block: reviews, trade body logos, years trading, FCA disclosure statement
- Similar vehicles
- Structured data and share links

### 12.3 Shortlists / saved cars
- Anonymous shortlisting via local storage; persisted to an account when the user identifies themselves.
- Optional lightweight customer account (email magic-link, no password): saved vehicles, saved searches, enquiry history, appointment details, documents shared by the dealer, deposit receipts.
- **The dealer sees shortlist activity in the CRM** — "this contact has saved 3 cars, viewed the Golf 6 times." This turns a passive website into a lead-intelligence source and is a genuine differentiator.
- Price-drop and sold alerts on shortlisted vehicles (email/push), subject to marketing consent rules (transactional alerts on a user's own saved items rely on the user's request; marketing must respect PECR).

### 12.4 Finance display compliance (critical)
Any monthly payment, APR, deposit figure or "cost of credit" statement on a public page **must** be accompanied by a representative example containing: representative APR, interest rate (and whether fixed/variable), total amount of credit, other charges, cash price, advance payment/deposit, agreement duration, total amount payable and the amount of each repayment. The representative APR must be one that at least 51% of customers responding to the promotion would actually receive.

**Implementation:** a single `<FinancePromotion>` primitive that cannot render a payment figure without a linked, valid representative example record. There is no code path that produces a bare monthly payment. This is a hard architectural rule, not a content guideline.

---

## 13. Contacts and customer records

### 13.1 Contact record
- Type: individual / business. Name, salutation, DOB (where needed for finance), addresses (with UK postcode lookup, address history for finance applications), phones, emails, preferred contact method and times.
- Marketing permissions: per channel (email, SMS, phone, WhatsApp, post) with **basis** (explicit consent / soft opt-in / legitimate interest), **source**, **timestamp**, **the exact wording version shown**, and full change history. Never a single boolean.
- Vulnerability indicators (restricted access): flag with category and note, recorded reason, review date. Drives prompts in the sales flow (§18.4).
- Relationships: household/business links, previous purchases, vehicles owned (current and past), service history with us.
- Timeline: every interaction — calls, emails, SMS/WhatsApp, website visits, VDP views, forms, appointments, test drives, quotes, deals, invoices, documents, complaints.
- Tags and segments; custom fields per tenant.
- Do-not-contact / suppression list, honoured globally including by automations.

### 13.2 Data subject rights
Self-serve tooling for: access request (generates a complete export of everything held on a contact), rectification, erasure (with legal-hold override for records that must be retained — finance introductions, VAT records, live disputes), restriction, and objection to marketing. Each request is logged with a deadline and status.

### 13.3 Deduplication
Fuzzy matching on email, phone (E.164 normalised), and name+postcode. Merge UI showing field-by-field selection, with a full record of what was merged and the ability to unmerge within 30 days.

---

## 14. Leads, pipeline and communications

### 14.1 Lead capture
Sources: own website forms, phone (via call tracking), inbound email (parsed), Auto Trader / Motors / CarGurus / Carwow lead emails and APIs, Meta lead ads, WhatsApp, walk-in (manual), referral, live chat.

- **Marketplace lead parsing** must be robust: a library of per-portal parsers extracting customer name, contact details, vehicle reference and message from the notification email, with a fallback that files unparseable leads for manual triage rather than losing them.
- Automatic contact matching/creation, vehicle linking, duplicate lead detection (same contact + same vehicle within 24h → merged into one thread).
- **Instant acknowledgement**: configurable auto-response within seconds (email/SMS), because response time is the single strongest predictor of conversion.

### 14.2 Lead inbox
A unified, conversation-threaded inbox — not a list of orphaned records. Left: filterable list (unassigned, mine, overdue, today, by source, by site). Centre: the conversation, with all channels interleaved. Right: contact card, vehicle card, quick actions.

Actions: reply (email/SMS/WhatsApp, with templates and merge fields), call (click-to-dial with logging), assign, snooze, set next action, book appointment, create appraisal, build a quote, mark outcome.

### 14.3 Pipeline
Stages: `New → Contacted → Qualified → Appointment booked → Test driven → Quoted → Negotiating → Deposit taken → Won / Lost`

- Kanban and list views; per-stage aging; required-fields-to-advance rules.
- **Loss reasons** are mandatory and structured (price, sold elsewhere, finance declined, no stock match, changed mind, no contact, part-ex value, timing). Loss reason reporting is how a dealer learns their business — most systems make this optional and therefore useless.
- Next-action enforcement: no lead can sit in an active stage without a dated next action. Overdue actions escalate.

### 14.4 SLA and response management
- Configurable first-response SLA (default: 15 minutes in opening hours). Countdown visible on each new lead. Breach escalates to manager.
- Out-of-hours routing and auto-response.
- Round-robin or rules-based assignment with availability/holiday awareness.

### 14.5 Automation
Visual sequence builder: trigger (new lead / no reply in N hours / appointment booked / test drive completed / quote sent / lost / anniversary / MOT due / finance ending) → conditions → actions (send email/SMS/WhatsApp, create task, assign, change stage, notify, wait).

**Guardrails, enforced by the platform:** quiet hours, frequency caps, global suppression list, marketing-consent checks before every send, automatic stop on reply or on unsubscribe, and a per-tenant sending reputation monitor. An automation that would breach PECR simply cannot be saved.

### 14.6 Communications
- **Email**: per-tenant sending domain with DKIM/SPF/DMARC setup wizard, template editor, tracking (open/click) with consent-aware configuration, threading, two-way sync with Gmail/Microsoft 365 so replies land in the CRM.
- **SMS**: sender ID, templates, two-way, opt-out keyword handling (STOP), delivery receipts.
- **WhatsApp**: Business Platform via a BSP, template messages for outbound outside the 24h window, media sharing (video walkarounds are a huge conversion tool), full thread in the CRM.
- **Calls**: click-to-dial, inbound matching to contact, recording (with consent notice and configurable retention), call outcome logging, missed-call follow-up task.
- **Video walkaround**: record on mobile, upload, send a link by SMS/WhatsApp, track when viewed. Small feature, very high perceived value.

---

## 15. Appointments and test drives

- Calendar (day/week/month, per user and per site), with drag-to-reschedule and conflict detection.
- Appointment types: viewing, test drive, part-ex appraisal, collection/handover, service, video call.
- Public booking: from the VDP, with real availability, buffer times and capacity rules; confirmation + reminder (email/SMS) sequence; reschedule/cancel links; no-show tracking.
- **Test drive workflow**: driving licence capture (photo/scan + optional DVLA check code validation), insurance confirmation, mileage out/in, route, accompanied/unaccompanied, damage check before and after (photo capture), digital signature on the test drive agreement, trade plate assignment where used. All stored as evidence.
- Handover appointments generate the handover checklist (§20).

---

# Part D — Transacting

## 16. Part-exchange and appraisal

- Mobile-first appraisal: reg lookup → spec confirmation → mileage → guided condition capture (bodywork damage map with tap-to-mark and photo per mark, tyres, interior, mechanical notes, service history, keys, V5C, MOT) → outstanding finance question (with settlement figure capture) → valuation panel (trade value from provider, adjusted by our recon estimate) → **offer figure** with an internal breakdown the customer never sees.
- Recon estimate builder with tenant-configurable standard costs (a scuffed alloy = £65, a tyre = £90, a full valet = £45…). This turns a subjective guess into a defensible number.
- Customer-facing appraisal summary PDF: offer, validity period, condition photos, and the standard disclaimer (offer subject to inspection and matching declaration).
- Outstanding finance handling: settlement figure, expiry date, payer, evidence of settlement — this is a frequent source of disputes and must be tracked to completion.
- On deal completion the part-ex converts into a new stock record in `Purchased` state, with the appraisal photos, condition notes and agreed value carried across as the purchase price. **Zero re-keying** — this is one of the highest-value integrations in the whole system.

---

## 17. Deal builder: quote → order → invoice

### 17.1 Deal structure
A deal links: contact, vehicle, salesperson, site, and contains:

- Vehicle price, discount (with approval if above threshold), admin/documentation fee, delivery charge, plates/personalisation, accessories
- Part-exchange (value, settlement, equity)
- Deposit (amount, method, date, refundable/non-refundable status clearly stated)
- Add-on products (warranty, GAP, paint protection, service plan) — each with its own demands-and-needs record
- Finance (product, lender, term, APR, deposit, balloon/GFV, monthly payment, total payable, commission)
- Balance to pay, payment schedule
- Delivery/collection date, method, and address

**Live margin panel** (permission-gated): vehicle margin, part-ex margin (projected), finance commission, add-on margin, total deal profit. Updates as the deal is built. This is what makes a sales manager use the system.

### 17.2 States
`Draft quote → Sent → Accepted → Order (deposit taken) → Awaiting finance → Approved → Invoiced → Delivered → Completed` with `Cancelled` and `Returned` branches.

### 17.3 Documents
Generated from tenant templates, with merge fields and version control: quotation, order form, vehicle sales invoice, part-ex purchase invoice, finance documentation cover sheet, PDI/pre-sale inspection checklist, handover checklist, warranty certificate, distance-sale cancellation notice (where applicable), and the initial disclosure document.

E-signature via DocuSign/Dropbox Sign: send, track, remind, countersign, store the signed PDF and the certificate of completion against the deal.

### 17.4 Contract-formation capture (compliance-critical)
The deal must record, as structured data, **where and how the contract was formed**:

- On-premises (signed at the dealership) → no CCR 14-day cancellation right
- Distance (concluded online/by phone) → **14-day cancellation right applies**, clock starts the day after delivery, or the day after collection where the customer collects after contracting remotely
- Off-premises (signed at the customer's home, or at an event)

Selecting distance/off-premises **automatically**: attaches the mandatory pre-contract information pack, attaches the cancellation form, starts and displays the 14-day clock on the deal, and creates a task at day 12. Getting this wrong is one of the most common and most expensive dealer mistakes; the system should make it impossible to get wrong.

### 17.5 Consumer Rights Act clocks
On delivery, the system starts:
- **30-day short-term right to reject** clock — visible on the deal and the vehicle
- **6-month reversed burden of proof** window — flagged on any subsequent complaint or fault report
- Repair-attempt tracking: logging a repair attempt **pauses** the 30-day clock and resumes it with at least 7 days remaining, per CRA s.22(6)–(7).

Any post-sale fault report creates a **case** (§21.3) linked to the deal, with the applicable rights and deadlines calculated and displayed.

---

## 18. Motor finance and Consumer Duty

**This module is the product's spine of defensibility. Build it first, build it carefully, and have it reviewed by an FCA compliance consultant before it ships.**

### 18.1 Firm permission context
The tenant's compliance profile (§1.2) determines behaviour:
- **Limited Permission**: standard secondary credit-broking journey
- **Full Permission**: same journey, plus additional reporting fields
- **Appointed Representative**: the principal firm's name and FRN appear on the initial disclosure document and all finance promotions; the principal's approved wording set is used

### 18.2 Quote journey
1. **Initial disclosure**: presented and recorded before any finance discussion — firm name, FRN/principal, that the firm is a credit broker not a lender, the panel/scope of lenders, how the firm is remunerated (commission), and that the customer may request commission details.
2. **Eligibility / soft search** via the finance platform (iVendi Connect, Codeweavers) — no hard footprint, returns indicative products.
3. **Quote comparison**: products across the lender panel with APR, term, deposit, monthly payment, total payable, balloon/GFV. Sorted by cost to the customer by default, never by commission to the dealer.
4. **Demands and needs**: structured capture of why the recommended product suits this customer (usage, mileage, ownership intent, budget, whether they want to own the car at the end).
5. **Affordability**: income, expenditure, dependants, employment, residency history; result recorded.
6. **Commission disclosure**: type (fixed fee / percentage / difference-in-charges), the actual amount or the basis, and confirmation the customer was shown it. **Recorded permanently.**
7. **Application submission** to the chosen lender; status tracking (submitted / referred / approved / declined / conditional), conditions list, payout confirmation.

### 18.3 Consumer Duty capture
Every finance deal records:
- Target market confirmation (does this customer fall in the product's stated target market?)
- Fair-value confirmation reference from the lender/manufacturer for that product
- Customer understanding evidence: which explanations were given, which documents were shown, and — where used — a comprehension check
- Consumer support: what post-sale contact and support was set up
- The complete document version set shown at the point of sale

### 18.4 Vulnerability
- Screening prompts integrated into the journey using the FCA's four drivers (health, life events, resilience, capability).
- Where a vulnerability indicator is recorded, the journey adapts: extra time prompts, a "consider deferring" nudge, alternative communication options, and a required manager review before completion for higher-risk categories.
- Outcomes are monitored: a report comparing conversion, product mix, APR and complaint rates for flagged vs unflagged customers, because the FCA expects firms to evidence that vulnerable customers are not getting worse outcomes.

### 18.5 Financial promotions engine
- A library of approved promotion templates with the representative example structure built in.
- Automatic detection of cost-of-credit language in any free-text advert, website block or email template; publishing is blocked until a valid representative example is attached.
- **Representative APR governance**: the system records the APR actually achieved on every completed finance deal and reports whether the advertised representative APR was achieved by ≥51% of customers who responded to that promotion. If not, it raises a compliance alert. Nobody else does this and it is exactly what an FCA supervisor would ask for.
- Promotion approval workflow (drafted → reviewed → approved → live), with expiry dates and an archive of everything ever published, with its live dates.

### 18.6 Deal Evidence Ledger
An append-only, cryptographically chained record per deal. Every entry: timestamp, actor, event type, payload hash, document version references. Events include: initial disclosure shown, quotes presented (all of them, not just the chosen one), commission disclosed, demands-and-needs captured, affordability run, vulnerability screen, documents shown and signed, contract formation basis, delivery date, cancellation rights notified.

- Exportable as a signed evidence bundle (PDF + JSON + attachments) for a complaint, a lender data request, an FCA request, or an FOS case.
- Retention: **indefinite for finance introductions** while the redress-scheme look-back environment persists; minimum 6 years for everything else. Never auto-deleted; erasure requests against these records are handled under legal hold.

### 18.7 Historic deal register
For dealers with historic business, a register that can ingest legacy finance introductions (CSV import) and flag agreements against the redress-scheme criteria: DCA arrangements, non-DCA commission ≥39% of total cost of credit **and** ≥10% of the amount of credit, and undisclosed exclusivity/tie arrangements — for agreements dated 6 April 2007 to 1 November 2024, excluding commission ≤£120 (pre-April 2014) or ≤£150 (post-April 2014) and 0% APR deals.

**This is a compelling standalone sales hook.** A dealer facing lender data requests can answer them in an afternoon instead of a fortnight.

> ⚠️ **Build note:** the redress scheme was **partially suspended by the Upper Tribunal on/around 1–2 July 2026** pending challenges from Consumer Voice, Mercedes-Benz FS, VW FS and Crédit Agricole Auto Finance. A hearing is expected December 2026 – February 2027; payouts are not currently running. All thresholds, dates and criteria in §18.7 must therefore be **configurable rule data, not hard-coded constants**, and all dealer-facing copy must present the timeline as provisional. See `05-integrations-and-compliance.md` §1.6.

---

## 19. Add-on products

- Product catalogue per tenant: warranty tiers, GAP, paint/fabric protection, service plans, tyre and alloy insurance, with cost, retail price, margin, provider, and **target market statement + fair value assessment reference**.
- Sold as part of a deal with its own demands-and-needs record and separate customer agreement. **Never pre-ticked, never bundled by default** — the system enforces an explicit opt-in per product, because pre-selection is a textbook Consumer Duty failure.
- Cancellation/cooling-off handling and refund calculation.
- Registration with the provider (API where available; otherwise a task with the provider's portal link and evidence upload).
- Fair-value monitoring report: claims ratio / usage where data is available, price paid vs benefit delivered, flagged for annual review.

---

## 20. Delivery, handover and DVLA

- Handover checklist (configurable): vehicle prepared and valeted, fuel level, both keys, V5C arrangements, MOT certificate copy handed over, service book stamped, PDI checklist signed, warranty documents, finance documents, invoice, cancellation notice (distance sales), owner's manual, locking wheel nut, spare/kit, insurance confirmed, plates.
- **DVLA notification**: prompt and record the keeper-change notification (online at gov.uk or by post), record the reference, and record that the V5C/2 new-keeper supplement was handed to the customer. Store the confirmation.
- Delivery vs collection: capture which, the date/time, address for delivery, driver, and — for delivery — proof of delivery with signature and photos. **The delivery date starts the CRA and CCR clocks (§17.4–17.5).**
- Trade plate assignment and return, linked to the trade licence record and MID status.
- Handover pack generated as a single PDF and emailed/shared to the customer portal.
- Post-handover: automatic thank-you, review request (timed), and a 7-day check-in call task.

---

## 21. Aftercare, retention and reviews

### 21.1 Retention engine
Automated, consent-aware triggers:
- MOT due (from the DVLA/MOT data we already hold — we know every customer's MOT date, which is a free retention machine)
- Service due (mileage/time estimate)
- Finance agreement approaching end of term / equity position reached ("you could change your car for the same monthly payment")
- Purchase anniversary
- Warranty expiry
- Seasonal (winter check, holiday travel)

Each trigger respects marketing permissions and the soft opt-in rules: contact details obtained in the course of a sale or negotiations, marketing limited to the dealer's own similar products, opt-out offered at collection and in every message.

### 21.2 Reviews
Request reviews post-handover via Google, Trustpilot, Autotrader reviews or the dealer's own; monitor and display on the public site; alert on negative reviews with a response workflow.

### 21.3 Complaints and cases
- Structured case record: type (vehicle fault / service / finance / sales conduct / other), linked deal and vehicle, dates, description, evidence, actions taken, outcome, compensation.
- **Automatic rights calculation**: given the delivery date, shows whether the 30-day right to reject applies, whether the 6-month reversed burden applies, and whether the CCR 14-day cancellation window is live.
- FCA complaint handling: where the complaint relates to a regulated activity, apply DISP timescales (acknowledgement, 8-week final response), generate the final response letter with FOS referral rights, and record the outcome for regulatory reporting.
- Repair-attempt log that drives the CRA clock pausing in §17.5.

---

# Part E — Running the business

## 22. Money: invoicing, payments and the VAT margin stock book

### 22.1 Invoicing
- Vehicle sales invoice, part-exchange purchase invoice, deposit receipt, credit note, service/parts invoice (later).
- Sequential numbering per tenant per document type, gapless, never reused.
- **VAT logic driven by the vehicle's scheme:**
  - **Margin scheme**: VAT is **not shown separately** on the sales invoice (showing it makes the whole sale standard-rated). Invoice must cross-reference the stock book entry, show both parties' names and addresses, date, and the vehicle registration/description. VAT due = margin × 1/6 at a 20% standard rate. A negative margin produces no VAT and **cannot** be offset against another vehicle's positive margin.
  - **VAT qualifying**: VAT charged and shown on the full selling price.
- The system must make it structurally impossible to issue a margin-scheme invoice showing VAT.

### 22.2 The VAT margin stock book
A first-class, always-available report and data structure with all mandatory fields enforced:

| # | Field | Enforced at |
|---|---|---|
| 1 | Stock book number (sequential) | Book-in |
| 2 | Date of purchase | Book-in |
| 3 | Purchase invoice number | Book-in |
| 4 | Purchase price | Book-in |
| 5 | Seller's name and address | Book-in |
| 6 | Vehicle registration number | Book-in |
| 7 | Vehicle description (make/model/VIN) | Book-in |
| 8 | Date of sale | Invoice |
| 9 | Sales invoice number | Invoice |
| 10 | Buyer's name and address | Invoice |
| 11 | Selling price | Invoice |
| 12 | Margin and VAT due on margin | Calculated |

- Exportable to XLSX/CSV/PDF for an HMRC inspection, filtered by date range.
- Retained ≥6 years; entries are immutable once the sale is invoiced (corrections create an adjustment entry with a reason).
- A **"stock book health"** check that lists any vehicle missing a mandatory field, so the dealer can fix it before an inspection rather than during one.

### 22.3 Payments
- Deposits and balances via Stripe (cards, Apple/Google Pay, Payment Links for remote deposits) and GoCardless/open banking for larger amounts.
- Payment methods recorded: card, bank transfer, cash, finance payout, part-ex equity, cheque.
- **Cash threshold monitoring**: a running total of cash accepted per customer and per linked transaction set, with an alert at 80% of the High Value Dealer threshold (**£10,000 — converted from €10,000 to fixed sterling with effect from 30 June 2026**; held in `compliance_rules`, never hard-coded), and a hard block with an override-and-justify flow at the threshold if the tenant is not HMRC-registered as an HVD.
- Refunds, including deposit refunds under the CCR cancellation right and CRA rejections, with reason codes.
- Reconciliation view: expected vs received per deal; outstanding balances report; finance payout tracking (submitted → paid, with aging).

### 22.4 Costs and purchase ledger
Supplier invoices attached to vehicles or to overheads; approval workflow; payment status; per-vehicle true cost roll-up; cost category reporting (mechanical, body, tyres, valet, parts, transport, advertising, funding).

---

## 23. Accounting integration and reporting

- **Xero** (primary), **QuickBooks Online**, **Sage** — OAuth connection, account/tax-rate mapping UI, and a sync engine that pushes: sales invoices (with correct VAT treatment per scheme), purchase invoices, credit notes, payments, and journal entries for margin VAT.
- Dry-run mode showing exactly what will be created before the first real sync.
- Error queue with per-record retry and a clear explanation.
- Bank feed reconciliation assistance (match payments to deals).
- Fallback for tenants without a supported package: a clean, mapped CSV export per period.

**Critical rule:** we are not the ledger. We are the source of accurate, VAT-correct transactional data. Never invent journal entries the accountant did not agree to; always allow the accountant read-only access to check us.

---

## 24. People: staff, targets and commission

- Staff records: role, site, start date, contact, holiday calendar, working hours (drives lead assignment and appointment availability).
- Targets: units, gross profit, finance penetration, add-on penetration — per person, per site, per month, with live progress.
- Commission calculation: rules engine (per unit, % of gross, banded, finance/add-on bonuses, clawbacks on cancelled or refunded deals), monthly statements per person, exportable for payroll.
- Leaderboards (opt-in per tenant — some cultures love it, some hate it; make it a setting).
- Training and competence records: who is signed off to discuss finance, when their training was completed, when it expires. This is an FCA competence expectation and dealers routinely have no record of it.

---

## 25. Suppliers and purchasing

- Supplier directory: auctions, trade sellers, parts factors, bodyshops, valeters, photographers, transporters, warranty providers, funders. Contact details, account numbers, payment terms, rates card.
- Purchase orders and invoice matching.
- Spend by supplier and by category, with per-vehicle attribution.
- Transport/logistics booking (Movex integration) and status tracking.

---

## 26. Reporting, dashboards and channel P&L

### 26.1 Role-based dashboards

**Owner (mobile-first, 6 tiles):** stock value at cost · units sold MTD vs target · average gross profit per unit · average days to sell (with trend) · overage stock (90+ days) and capital tied up · leads today and response-time compliance.

**Sales Manager:** pipeline by stage and value · today's appointments · leads awaiting first response (with countdown) · deals awaiting approval · team performance vs target · conversion by source.

**Sales Executive:** my next actions · my appointments · my leads by stage · my month vs target · my recent activity.

**Buyer:** stock gaps and demand signals · aging and repricing suggestions · funding headroom · recent purchase performance (did what I bought actually sell, and at what margin?).

**Administrator:** deals awaiting documents · finance payouts outstanding · unreconciled payments · stock book health · compliance tasks due · DVLA notifications outstanding.

### 26.2 Report library
Sales (by period/site/salesperson/make/source), gross profit analysis (vehicle/finance/add-on split), stock (aging, valuation, mix, turn rate), prep (days by stage, cost variance, blocked time), leads (volume, source, conversion, response time, loss reasons), marketing (channel spend, cost per lead, cost per sale, ROI), finance (penetration, lender mix, average commission, APR distribution, representative APR compliance), compliance (evidence completeness, overdue tasks, consent health), and VAT/stock book.

All reports: filterable, saved views, scheduled email delivery, CSV/XLSX/PDF export, and drill-down to the underlying records.

### 26.3 Channel P&L (the strategic feature)
Combine per-channel cost (entered or integrated) with attributed leads and sales:

| Channel | Spend | Leads | Cost/lead | Sales | Cost/sale | GP generated | ROI |
|---|---|---|---|---|---|---|---|
| Own website | £229 (platform) | 84 | £2.73 | 11 | £20.82 | £20,955 | 91× |
| Auto Trader | £1,850 | 142 | £13.03 | 18 | £102.78 | £34,290 | 18.5× |
| Motors/Gumtree | £203 | 31 | £6.55 | 3 | £67.67 | £5,715 | 28× |

This single table is the most persuasive screen in the product. It reframes our subscription as the cheapest channel the dealer has, and it gives them the ammunition they currently lack when negotiating with marketplaces.

---

## 27. Compliance centre

A dedicated area, because compliance is our differentiator and it deserves a front door.

### 27.1 Compliance dashboard
- Overall completeness score with a breakdown
- Open tasks and deadlines (FCA complaint response due, annual fair-value reviews, training expiry, HVD threshold approaching, insurance/trade licence renewal, data retention actions)
- Evidence completeness per deal — a list of deals with any missing evidence element, so gaps are fixed while memories are fresh
- Consent health: contacts with no valid marketing basis, expiring consents, unsubscribes
- Representative APR compliance (§18.5)
- Stock book health (§22.2)

### 27.2 Document version control
Every customer-facing template (invoice, order T&Cs, initial disclosure, cancellation notice, privacy notice, consent wording) is versioned with effective dates. **The Deal Evidence Ledger records which version was shown to which customer on which date.** This is the difference between "we think our terms said X in 2021" and being able to prove it.

### 27.3 Policies and registers
Trade plates and licences register (numbers, expiry, MID status, insurance), motor trade insurance record, FCA permissions and AR agreement record, staff competence register, AML policy and risk assessment, complaints register with DISP outcomes, data breach register, DPIA store, sub-processor list.

### 27.4 Disclaimer (mandatory and prominent)
Every compliance feature carries a clear statement that Forecourt provides tooling and record-keeping, not legal or regulatory advice, and that the dealer remains responsible for its own compliance. Each compliance rule in the system links to its source (FCA Handbook reference, HMRC notice, legislation) so a dealer's adviser can verify our interpretation.

---

## 28. Platform administration (our side)

A separate super-admin application, never mixed into tenant UI:

- Tenant directory: plan, status, usage, health score, MRR, key contacts, notes
- Provisioning: create tenant, apply plan, set feature flags, seed demo data
- **Support impersonation**: time-limited, reason-required, explicitly consented per tenant, fully audited, visibly banner-flagged in the UI, and never able to view finance commission or full payment details without a second approval
- Billing: Stripe subscriptions, invoices, dunning, plan changes, usage-based add-ons (lookups, SMS, e-sign)
- Feature flags per tenant and per cohort
- Integration credential management and per-tenant quota monitoring (data lookups cost money — watch them)
- Platform observability: error rates, job queues, feed failures across all tenants, API latency
- Release management, changelog publishing, in-app announcements
- Reseller/white-label management: partner accounts, sub-tenants, branding overrides, revenue share reporting
- Data operations: tenant export, tenant deletion (with retention hold checks), backup restore testing

---

# Part F

## 29. Cross-cutting requirements

**Performance:** CRM p95 page interaction < 500ms; global search < 200ms; stock list with 1,000 vehicles < 400ms; public VDP LCP < 2.0s p75 on mobile; feed publish for 100 vehicles < 60s.

**Availability:** 99.9% target for the CRM; 99.95% for public websites (they are the dealer's shopfront and downtime is directly lost revenue). Public sites must serve from cache/static even if the CRM API is degraded.

**Mobile:** every daily task completable on a phone. Native-quality PWA with offline capture for appraisals and photos (a workshop or an auction hall often has no signal), syncing when connectivity returns.

**Accessibility:** WCAG 2.2 AA across both the CRM and the public sites. The public sites especially — a dealer sued over an inaccessible website is a bad day for us too.

**Internationalisation:** en-GB throughout v1, but every string externalised, all money as minor units with an explicit currency, all dates as UTC with tenant timezone rendering, and address/phone formats abstracted, so that Ireland and the Netherlands are configuration rather than a rewrite.

**Data portability:** full self-serve tenant export (all objects, all documents, all media, in a documented JSON + file structure) available at any time without asking us. This is a marketing feature and a matter of principle.

**Offline/degraded behaviour:** if a valuation provider, feed or finance platform is down, the user is told which one, what is unaffected, and when we will retry — never a generic error.

**Empty states:** every list has a designed empty state that teaches the next action. This is where new tenants either activate or churn.

---

## 30. MVP scope matrix

| Module | R1 (MVP) | R2 | R3 | R4 |
|---|---|---|---|---|
| Tenancy, onboarding, settings | ✅ Full | | | |
| Users, roles, permissions | ✅ Core roles | Custom roles | Field-level rules | SSO/SAML |
| Vehicle records & stock list | ✅ Full | | | |
| DVLA + MOT + spec lookup | ✅ | Valuation feed | | |
| Provenance check | ✅ | | | |
| VAT margin stock book | ✅ Full | | | |
| Costs & margin | ✅ | | | |
| Media & AI descriptions | ✅ Core | Guided capture, 360 | | |
| Prep pipeline | Basic status | ✅ Full board + SLAs | | Workshop module |
| Pricing intelligence | Manual | ✅ Full | | Sourcing scores |
| Website engine | ✅ 3 themes | Block editor v2 | Multi-brand | |
| Public inventory + shortlists | ✅ | Customer accounts | | |
| Channel feeds | AT + Motors | + CarGurus, Meta, Google | | |
| Contacts | ✅ | | | |
| Leads & inbox | ✅ Web + email | ✅ SMS/WhatsApp/calls | | |
| Automation sequences | Basic | ✅ Full builder | | |
| Appointments & test drives | ✅ Basic | ✅ Full | | |
| Part-exchange appraisal | Basic | ✅ Full mobile | | |
| Deal builder | ✅ | E-sign | | |
| Finance & Consumer Duty | ✅ Evidence ledger + disclosure | ✅ Quoting integration | Historic register | |
| Add-on products | Basic | ✅ | Provider APIs | |
| Delivery, handover, DVLA | ✅ | | | |
| Aftercare & retention | | ✅ | Reviews | |
| Invoicing & payments | ✅ | | | |
| Accounting sync | | ✅ Xero/QBO | Sage | |
| People & commission | | Basic | ✅ | |
| Suppliers | Basic | | ✅ | |
| Reporting | ✅ Core dashboards | Report library | ✅ Channel P&L | Benchmarking |
| Compliance centre | ✅ Core | ✅ | ✅ AML | |
| Platform admin | ✅ | | Reseller | |
| Public API | | Read | ✅ Read/write + webhooks | |
