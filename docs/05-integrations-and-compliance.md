# Forecourt — Integration Register & Compliance Control Matrix

**Version:** 1.0 — August 2026
**Status:** researched from primary sources where available; confidence flagged throughout
**Companion docs:** `02-functional-spec.md`, `03-architecture-and-data-model.md`

> ⚠️ **This document is engineering and product input, not legal or regulatory advice.** Every compliance control described here must be reviewed by a qualified motor-trade FCA compliance consultant and a VAT specialist before it ships. Source links are provided so your advisers can check our interpretation. Regulation in this sector is actively moving — see §3.1.

---

# Part 1 — Integration register

## 1. Vehicle data

| Integration | Provides | API | Access | Cost | Priority |
|---|---|---|---|---|---|
| **DVLA Vehicle Enquiry Service (VES)** | Make, colour, fuel, engine cc, CO2, Euro status, tax status/due, MOT status/expiry, wheelplan, revenue weight, V5C issue date, export marker, year of manufacture | REST, `x-api-key` header | Register with DVLA API Access (`DvlaAPIAccess@dvla.gov.uk`) + T&Cs portal | **Free** | **MVP** |
| **DVSA MOT History API** | Full MOT test history, pass/fail, per-test mileage, defects and advisories | REST | Hybrid: OAuth2 client-credentials (Microsoft Entra ID, 60-min tokens) **plus** an API key. Client secret rotates every 2 years; unused keys revoked after 90 days idle | **Free** | **MVP** |
| **Aggregator** (One Auto API, UK Vehicle Data, CheckCarDetails et al.) | Wraps DVLA/DVSA and resells cap hpi / Experian data under one key | REST, self-serve sandbox | Self-serve, free trial keys | ~£0.05–£0.50+/lookup at low volume | **MVP — the fastest route to launch** |
| **cap hpi** (Solera) | Full VRM→derivative decode, trim, options; CAP/Black Book trade/retail/private valuations and forecast residuals | REST (`api.cap-hpi.co.uk/docs`) but gated | Commercial contract, sales-led, no self-serve | Not published | **MVP via aggregator; direct contract by R2** |
| **HPI Check** (Solera) | Outstanding finance, write-off category, stolen (PNC), mileage discrepancy, plate-change history | REST, self-serve "get API key" request form | PAYG → subscription; sales contact for volume | Not published (~£8–15/check retail) | **MVP** |
| **Experian AutoCheck** | Equivalent provenance checks + guarantee products | Yes, also via aggregators | Commercial | Not published | Alternative to HPI |
| **Total Car Check** | Budget provenance check | Documented, self-serve, PAYG | Self-serve | Cheaper tier | Fallback |
| **JATO Dynamics** | OEM-defined full spec/options/packs with codes; VIN/VRM decode; build-rule interdependencies | Full public dev portal (`developer.jato.com`), browsable without login | Free trial self-serve; production = commercial | Not published | R2 |
| **Percayso Vehicle Intelligence** (ex-Cazana, relaunched Feb 2026) | Real-time market valuation, days-to-sell, RV forecasting | Yes, thin public docs | Commercial | Not published | R2 |
| **Glass's** (Autovista / J.D. Power) | Valuations, retail live pricing | No public dev portal found | Enterprise | Not published | Later |
| **Auto Trader Retail Check / Retail Rating** | Valuation + days-to-sell | Via Auto Trader Connect only | **Requires an existing Auto Trader advertising contract** — not sold standalone | Bundled | R2 |

**Key commercial insight:** cap hpi and HPI Check share a parent (Solera). Negotiate valuation + provenance as one contract, not two.

**MOT API rate limits:** 500,000 requests/day quota; burst ~10 requests per short window, ~15/sec average; HTTP 429 on breach; key locked for 24 hours if the daily quota is exceeded. Design the lookup queue accordingly.

## 2. Advertising and marketplace feeds

| Integration | Provides | API | Access | Priority |
|---|---|---|---|---|
| **Auto Trader Connect** | Real-time stock push (Stock Manager), leads, live valuations, Retail Rating, Vehicle Check, Deal Builder | REST, documented at `developers.autotrader.co.uk/api`, Postman collection published | Requires the dealer's existing Auto Trader advertising contract **plus** a separate technical partner agreement for direct integration. Auto Trader states most software vendors integrate via an existing technology partner | **MVP — mandatory** |
| **eBay Motors Group** (Motors.co.uk, Gumtree Motors, eBay Motors) | Single feed across three sites since 2019 | Feed-based XML/CSV, not a modern REST API | Commercial advertising agreement + feed registration | **MVP** |
| **CarGurus UK** | Stock feed, dealer page, pricing badges | Feed-based | Advertising contract + feed setup | R2 |
| **Carwow** | Marketplace + enquiry leads | Bespoke stock feed per dealer | Partner agreement | R2 |
| **Meta (Facebook Marketplace / dynamic ads)** | Vehicle catalogue, Marketplace listings, dynamic retargeting | Catalog feed (CSV/TSV/XML) or Commerce Manager API | **Self-serve, free to set up** — pay only for ad spend | R2 |
| **Google Vehicle Ads** | Paid vehicle ads across Search/YouTube/Gmail/Display | Feed via Merchant Center + linked Google Ads + Business Profile. UK in **open beta**; VIN optional in UK, dealer's own `[id]` used | Self-serve once verified | R2 |
| ~~Google free organic Vehicle Listings~~ | — | **Discontinued.** Google has sunset the free organic listings feature and stopped processing those feeds | — | **Do not build** |

**There is no universal UK stock-feed standard.** Each portal defines its own schema. Build one canonical internal vehicle model plus one versioned adapter per channel, with per-channel field validation and a publish-preview. Budget ongoing engineering for feed maintenance — this is permanent, not one-off.

## 3. Finance and payments

| Integration | Provides | API | Access | Priority |
|---|---|---|---|---|
| **iVendi Connect** | White-label finance quoting, soft-search eligibility (no hard footprint), application submission — 60+ lender brands for quoting, 25+ for applications | Yes (`ivendi.com/connect-api`) | Sales-led commercial contract | **R2 — primary finance layer** |
| **Codeweavers** | White-label calculator/eligibility widgets; integrates Evolution Funding and CarFinance247 | Yes, via partner docs | Commercial, sales-led | R2 alternative |
| **Evolution Funding** | Broker/finance sourcing platform | Mainly via Codeweavers | Commercial | Later |
| **Zuto** | Consumer broker with a defined application-submission contract (schema published on GitHub) | Yes | Commercial partner agreement | Later |
| **Lenders** (Close Brothers, Blue Motor, MotoNovo, Startline, First Response) | These are lenders, not tech platforms — they plug into the quoting layers above rather than exposing dealer-facing REST APIs. Close Brothers offers its own "Showroom" quote-and-apply tool | Not standalone public APIs | Lender panel agreement (requires FCA credit-broking permission) | Reach via iVendi/Codeweavers, **not** direct |
| **Stripe** | Card payments, Payment Links, Checkout — online deposits; **Stripe Connect so deposits settle to the dealer, not to us** | Extensive public REST API | Self-serve | **MVP** |
| **GoCardless** | Direct Debit / open banking — cheaper for larger deposits, lower chargeback risk | Public API | Self-serve | R2 |
| **Worldpay / Adyen** | Enterprise acquiring for dealers with existing merchant relationships | Public APIs | Commercial merchant account | Later |
| **Floorplan/stock funding** (NextGear, Close Brothers, Blue Motor, Oodle) | Wholesale stock funding | **No public API found for any of them** — portal and manual reconciliation only | Credit facility agreement | R4, manual workflow until then |

> **Money-transmission note:** using Stripe Connect (dealer as the connected account) keeps customer deposits out of our regulatory perimeter. Do not build a model where deposits land in a Forecourt account and are paid on to the dealer without specialist advice — that is a payments-regulation question, not an engineering one.

## 4. Operations

| Integration | Provides | API | Access | Priority |
|---|---|---|---|---|
| **Xero** | Sales/purchase invoices, contacts, payments | Mature REST + OAuth2 | Free dev registration; App Store review for public distribution | **R2 — primary** |
| **QuickBooks Online** | Same | Intuit developer platform | Free registration + app review | R2 |
| **Sage** | Accounting sync | **Fragmented** — Accounting, 200 and Intacct have different APIs and portals | Free for Accounting API; enterprise for 200/Intacct | R3 (many established dealers run Sage 200) |
| **DocuSign** | E-signature | Mature REST API | Self-serve dev account | **R2** |
| **Dropbox Sign** | Cheaper e-signature | REST API | Self-serve | R2 alternative |
| **Yoti Sign** | UK signing + identity combined | Yes | Self-serve/commercial | Later |
| **Onfido / Yoti / Credas / Experian ID3Global** | ID verification, AML/KYC | All have APIs; Credas and Yoti are UK-focused | Self-serve dev → commercial production | R3 |
| **Twilio** | SMS, voice, WhatsApp Business Platform, email (SendGrid) | Extensive, well documented | Self-serve | **MVP (SMS) / R2 (WhatsApp)** |
| **WhatsApp Business Platform** | Two-way messaging, template messages outside the 24h window, media (video walkarounds) | Via a BSP such as Twilio | WhatsApp Business verification + BSP | R2 |
| **Gmail API / Microsoft Graph** | Two-way email sync into the CRM | Mature, free-tier dev access | OAuth2; Google/Microsoft verification for sensitive scopes | R2 |
| **CloudCall / Aircall / Ringover** | VoIP, call tracking and recording in the CRM | All publish CRM integration APIs/webhooks | Self-serve → commercial, ~£25–40/user/month | R2 |
| **Spyne / Impel (SpinCar) / Fusion / Evolution Photo** | AI photo studio, 360 spin, background removal, plate blur | Spyne documented; Impel via DMS partners; others no public API | Commercial per-site subscription, typically £100s/month | R2 (build our own basic pipeline first) |
| **Movex** (Cox Automotive) | Vehicle transport booking and tracking | Documented API/DMS integration page | Commercial, sales-led | R3 |
| **Warranty/GAP** (WMS, Warrantywise, Autoguard, Car Care Plan) | Product sales and claims | **No public developer APIs found** — portal/account-manager onboarding | Dealer agreement | R3, manual workflow until a provider confirms an API |
| **Manheim** | Trade sourcing: searches, valuations, purchases, transactions | Public developer portal exists but is **US-centric**; UK availability unconfirmed | API access request | R4 — enquire with Cox Automotive UK |
| **BCA / Dealer Auction / Motorway** | Trade sourcing and disposal | **No public API found** — web portal only | Relationship-based | R4, portal/manual |
| **Companies House** | Company verification at onboarding | Free public API | Free registration | MVP (nice-to-have) |
| **FCA Register** | Verify a tenant's FRN and permissions at onboarding | Public API | Free | MVP (nice-to-have) |

## 5. Integration engineering rules

1. **One adapter per provider**, behind a common interface (`execute`, `healthCheck`, `costPerCall`, `rateLimit`). Never call a third party from a request handler — always through the job queue.
2. **Store the raw response** alongside the parsed result. Parser bugs are then fixable without re-paying for the call.
3. **Idempotency keys on every job.** Feed publishes are debounced per vehicle and deduplicated by payload hash.
4. **Circuit breaker per provider**, with a named, specific degraded-state message in the UI ("Valuations are unavailable — cap hpi is not responding. Everything else is working. Retrying in 5 minutes.").
5. **Contract tests with recorded fixtures**, plus a nightly job that checks live provider responses against the fixture shape and alerts on drift. These APIs change without notice.
6. **Per-tenant credential storage** where the tenant holds the contract (Auto Trader, accounting, finance, payments); platform credentials where we hold it (DVLA, MOT, aggregators). Both encrypted with envelope encryption.
7. **Cost metering per tenant per provider**, surfaced in the UI and in platform admin. Lookups are our dominant marginal cost.
8. **Procurement lead time is the real risk.** cap hpi, HPI, Auto Trader Connect, iVendi, Movex and Credas are all sales-gated with no self-serve path. Start those conversations in month one; they gate releases, not the code.

---

# Part 2 — Compliance control matrix

Each control below maps a legal or regulatory obligation to a specific product mechanism, so nothing depends on a user remembering the law.

## 1. FCA — motor finance

### 1.1 Permission basis
Introducing a customer to a lender is **credit broking** under Article 36A of the Regulated Activities Order — regulated whether or not the dealer lends. Three routes:

- **Limited permission** — credit broking ancillary to selling vehicles (FCA "secondary credit broker" regime, CONC 2.5). What most independents hold.
- **Full permission** — where broking is a primary business line or is combined with other full-permission activities.
- **Appointed Representative** — the dealer operates under a principal firm's permission; the principal carries regulatory responsibility and must supervise (SUP 12).

**Control:** the tenant's permission basis is captured at onboarding, validated against the FCA Register, and drives which disclosure wording, which promotion templates and which fields appear throughout. AR tenants render the principal's name and FRN on the initial disclosure and every finance promotion.

### 1.2 Point-of-sale evidence (the Deal Evidence Ledger)
Post-*Hopcraft/Johnson/Wrench* (Supreme Court, 1 August 2025), commission non-disclosure is not automatically unlawful, but it is a factor in an unfair-relationship claim under s.140A Consumer Credit Act 1974 — and *Johnson* succeeded on exactly that basis where commission was very high and an undisclosed tie created a false impression of impartiality.

**Control:** every finance introduction writes an append-only, hash-chained evidence record containing, at minimum:

| Evidence element | Captured at |
|---|---|
| Initial disclosure shown (firm identity, broker-not-lender, lender panel scope, remuneration by commission, right to request commission details) | Before any finance discussion |
| **All** quotes presented, not just the selected one | Quote stage |
| Commission type, amount or basis, and confirmation it was disclosed | Quote/selection |
| Demands and needs statement | Quote stage |
| Creditworthiness/affordability assessment inputs and result (CONC 5.2A) | Application |
| Adequate explanation given (CONC 4.2): key features, total cost, APR, cancellation rights | Application |
| Vulnerability screening outcome and any adjustment made | Throughout |
| Fair-value confirmation reference from the lender/manufacturer for that product | Selection |
| Add-on products: separate demands-and-needs, separate fair-value reference, explicit opt-in (never pre-ticked) | Deal build |
| Document versions shown, with effective dates | Every step |
| Staff member and timestamp on every entry | Every step |

**Retention:** indefinite for finance introductions while the redress-scheme look-back environment persists; minimum 6 years otherwise. Erasure requests against these records go through legal hold, not deletion.

### 1.3 Consumer Duty (PRIN 2A)
Four outcomes, four controls:

| Outcome | Product control |
|---|---|
| Products and services | Target-market check at product selection; the system asks whether this customer falls in the product's stated target market and records the answer |
| Price and value (PRIN 2A.4) | Fair-value reference required per product; the dealer cannot undermine the manufacturer's assessment with unjustified rate mark-up — commission structure is recorded and reportable |
| Consumer understanding | Structured record of which explanations and documents were given; optional comprehension check |
| Consumer support | Post-sale support setup recorded; add-on cancellation must be as easy as purchase (no sludge) — the system exposes a one-click cancellation request |

### 1.4 Vulnerable customers (FG21/1)
Screening prompts across the FCA's four drivers — health, life events, resilience, capability. Where a flag is recorded: extra-time prompts, a "consider deferring" nudge, alternative communication options, and manager review before completion for higher-risk categories. **Outcome monitoring report** comparing conversion, product mix, APR and complaint rates for flagged vs unflagged customers — the FCA expects firms to evidence that vulnerable customers are not worse off, and almost no dealer can.

### 1.5 Financial promotions (CONC 3)
- All promotions must be clear, fair and not misleading (CONC 3.3.1R), identifiable as promotions, in plain language, with the firm named.
- **Representative example trigger (CONC 3.5.3R):** stating *any* rate of interest or amount relating to the cost of credit — including a "from £199/month" figure — requires a representative example containing representative APR, interest rate (fixed/variable), total amount of credit, other charges, cash price, advance payment/deposit, agreement duration, total amount payable, and the amount of each repayment.
- **Representative APR trigger (CONC 3.5.7R):** an APR must appear with equal prominence where a promotion suggests credit availability regardless of financial status, makes favourable competitor comparisons, or offers an incentive to apply.
- **"Representative"** means at least 51% of customers responding to that promotion would actually get that rate or better.

**Controls:**
1. The `<FinancePromotion>` component (design system §4.2) is the only code path that can render a cost-of-credit figure, and it cannot mount without a valid, in-date representative example record. A bare monthly payment is architecturally impossible.
2. Free-text advert and email content is scanned for cost-of-credit language; publishing is blocked until a compliant example is attached.
3. **Representative APR governance report:** the system records the APR actually achieved on every completed finance deal and reports whether the advertised representative APR was achieved by ≥51% of responding customers, raising an alert if not.
4. Promotion approval workflow with versions, effective dates and a permanent archive of everything ever published with its live dates.

### 1.6 Historic deal register (redress scheme)
For agreements dated **6 April 2007 – 1 November 2024**, flag against the scheme's eligibility triggers: a discretionary commission arrangement (DCA); a non-DCA commission ≥39% of total cost of credit **and** ≥10% of amount of credit; or an undisclosed contractual tie/exclusivity. Exclusions: commission ≤£120 (pre-April 2014) or ≤£150 (post-April 2014), 0% APR deals, cases already resolved by FOS or a court, and loans above the 99.5th percentile for the year.

> ⚠️ **The scheme is currently partially suspended and has not gone live for payouts.** The Upper Tribunal partially suspended it on/around **1–2 July 2026** following legal challenges from Consumer Voice, Mercedes-Benz Financial Services, Volkswagen Financial Services and Crédit Agricole Auto Finance. Firms do not currently have to calculate or pay redress under the original timetable. A Tribunal hearing is expected **December 2026 – February 2027**, with payments starting in 2027 if the scheme is upheld.
>
> **Consequences for the product:** all thresholds, dates and criteria live in the platform-level `compliance_rules` table as versioned, source-linked parameters — never as constants in code. Any dealer-facing copy must present the redress timeline as **provisional and subject to litigation**, never as settled deadlines. Re-check status before this feature ships and at every quarterly regulatory watch.

## 2. HMRC — VAT margin scheme

| Obligation | Control |
|---|---|
| Vehicle qualifies for the margin scheme only where no VAT was recoverable on purchase (private seller, unregistered business, another dealer selling under the margin scheme, Motability zero-rated) | `vat_scheme` set at book-in from the purchase source, with the reasoning recorded; locked once a sale is invoiced |
| VAT-qualifying stock (input VAT reclaimed) must charge VAT on the full selling price | Separate scheme value drives invoice generation |
| Margin VAT = gross margin × 1/6 at a 20% standard rate | Computed in integer pence; property-based tests on rounding |
| A negative margin produces no VAT and **cannot** be offset against another vehicle's positive margin | Per-vehicle calculation; no aggregation path exists in the code |
| Margin-scheme invoices must **not** show VAT separately | Golden-file test: a margin invoice containing a VAT line fails the build |
| Invoice must cross-reference the stock book entry and show both parties' names/addresses, date, and vehicle registration/description | Enforced fields on invoice generation |
| Stock book with 12 mandatory fields (see functional spec §22.2) | Enforced at book-in and at invoice; "stock book health" report lists any gaps |
| Records retained ≥6 years | Retention policy; stock book entries immutable, corrections create adjusting entries |
| Commercial vehicles follow the same scheme and the same records | Same model; body-type does not change the logic |

## 3. Consumer Rights Act 2015 and Consumer Contracts Regulations 2013

| Obligation | Control |
|---|---|
| Satisfactory quality / fit for purpose / as described, judged against age, price, mileage, condition | Condition disclosure captured with photographs and shown at point of sale, written to the evidence ledger |
| **30-day short-term right to reject** | Clock starts automatically on the recorded delivery date; visible on the deal and vehicle |
| Clock **pauses** during a repair attempt and resumes with at least 7 days remaining (CRA **s.22(6)–(7)**; s.22(3) sets the 30-day baseline) | Repair-attempt log drives the clock arithmetic |
| One reasonable repair/replacement opportunity, then final right to reject (subject to a deduction for use) | Case workflow with attempt count and outcome |
| **6-month reversed burden of proof** | Second clock started on delivery; any fault report inside the window is flagged with the burden position |
| **CCR 14-day cancellation** for distance and off-premises sales; clock starts the day after delivery, or the day after collection where the buyer collects having contracted remotely | `contract_formation` is a mandatory structured field on every deal; selecting distance/off-premises auto-attaches the pre-contract information pack and cancellation form, starts the 14-day clock, and creates a day-12 task |
| **On-premises sales have no CCR cancellation right** — an online enquiry followed by an in-showroom signature is an on-premises sale | The field forces an explicit choice; guidance text explains the distinction at the point of decision |
| Mandatory pre-contract information for distance sales | Templated, versioned, and recorded as shown |

## 4. UK GDPR / PECR

| Obligation | Control |
|---|---|
| Lawful basis for lead follow-up | Legitimate interests for the sales process; recorded per contact |
| **PECR soft opt-in** for email/SMS marketing requires all of: details obtained directly in the course of a sale or negotiations; marketing limited to the dealer's own **similar** products; a free opt-out offered at the point of collection; and an opt-out in every message | `contact_consents` records channel, basis, source, wording version, timestamp and evidence. An automation that would breach these rules cannot be saved. Consent is re-evaluated **at send time**, not at schedule time |
| Third-party/aggregator leads generally cannot rely on the dealer's own soft opt-in | Lead source drives the default basis; aggregator leads default to no marketing permission until a valid basis is recorded |
| Accountability — evidence consent | Append-only consent history with wording versions; never a boolean |
| Data subject rights | Self-serve DSR tooling with deadlines; legal-hold override for records that must be retained |
| Retention | Policy-driven; **no blanket short retention on historic finance-introduction data** while the redress look-back is live |
| Controller/processor roles | We are the **processor** for tenant customer data; the dealer is controller. We are **controller** for our own dealer marketing, product analytics and any anonymised benchmarking product. Both roles documented explicitly in the per-tenant DPA and our privacy notice |
| Sub-processors | Published, versioned list with change notification |
| Marketing analytics | Consent-mode-aware cookie banner with granular categories and a retained consent log |

## 5. Trade operations and advertising standards

| Obligation | Control |
|---|---|
| Trade plates (DVLA forms VTL301 / VTL318; current fees **£97.35 for 6 months / £177 for 12 months** for all vehicles, £68.75 / £125 for bicycles and tricycles ≤450kg; 6-month licences run Jan–Jun or Jul–Dec, 12-month licences run Jan–Dec) must be insured and registered on the Motor Insurance Database | Trade plate register with numbers, expiry, MID status, insurer and policy; renewal reminders |
| Motor trade insurance | Policy record with renewal reminder |
| DVLA notification of keeper change on sale; hand the V5C/2 new-keeper supplement to the buyer | Handover checklist item + notification reference stored + confirmation attached. *(Procedural detail should be confirmed against gov.uk/sold-bought-vehicle before hard-coding.)* |
| MOT certificate handed over; vehicle sold safe and roadworthy; documented pre-sale inspection provided; provenance check on every used vehicle (Motor Ombudsman Vehicle Sales Code, a CTSI-approved code) | PDI checklist template, MOT copy in the handover pack, provenance check required before a vehicle can go Live |
| CAP Code / ASA motoring guidance: advertised prices genuinely available and inclusive of mandatory extras; "from £X" must reflect a real available deal; substantiated environmental and performance claims | Mandatory-fee declaration per tenant, rendered in adverts; AI copy guardrails forbid unsubstantiated claims; advertised price must equal the price honoured |

## 6. Anti-money laundering

| Obligation | Control |
|---|---|
| A business accepting cash of **£10,000 or more** (single or linked payments) is a High Value Dealer under MLR 2017 and must register with HMRC **before** accepting such a payment — registration cannot be retrospective. **The threshold was converted from €10,000 to a fixed £10,000 sterling with effect from 30 June 2026** as part of the wider AML reform; any material citing euros is out of date | `cash_ledger` maintains a running per-customer and per-linked-transaction total in GBP against the threshold held in `compliance_rules`. Alerts at 80%; hard block with an override-and-justify flow at the threshold for tenants not registered as HVDs |
| HVD obligations: CDD at or above the threshold, risk assessment, nominated officer for SARs, AML policies and training records | Compliance centre registers: AML policy, risk assessment, nominated officer, training records |
| Fraud typologies (cloned vehicles, HP fraud, identity fraud on finance applications) regardless of HVD status | Provenance check mandatory before Live; ID verification integration on finance deals (R3) |

## 7. Compliance engineering rules

1. **Rules are data, not code.** Every threshold, date, percentage and window lives in the platform `compliance_rules` table with a version, an effective date, a source URL and notes. Changing the law is a data deployment.
2. **Compliance features are enforced by construction where possible.** A margin invoice cannot show VAT. A finance payment cannot render without a representative example. A marketing send cannot dispatch without a valid consent record. These are golden-file tests in CI, not guidelines.
3. **Every compliance surface links to its source** (FCA Handbook reference, HMRC notice, legislation.gov.uk) so a dealer's adviser can check our interpretation.
4. **Every compliance surface carries the disclaimer** that Forecourt provides tooling and record-keeping, not legal or regulatory advice, and the dealer remains responsible for their own compliance.
5. **Independent review before every compliance release.** The retained FCA compliance consultant and VAT specialist sign off on the behaviour, not just the copy.
6. **A quarterly regulatory watch task** re-checks: the redress scheme's status and parameters, FCA Handbook changes to CONC/PRIN 2A/DISP, HMRC margin-scheme guidance, ICO direct-marketing guidance, and the CAP Code motoring section. Assign it an owner; put it in the calendar.

---

## Sources

**Regulation**
- [FCA PS26/3 — Motor Finance Consumer Redress Scheme](https://www.fca.org.uk/publications/policy-statements/ps26-3-motor-finance-consumer-redress-scheme)
- [FCA — statement confirming the motor finance redress scheme](https://www.fca.org.uk/news/statements/fca-confirms-motor-finance-redress-scheme)
- [Foot Anstey — legal challenges to the redress scheme](https://www.footanstey.com/our-insights/articles-news/the-fca-faces-legal-challenges-to-its-motor-finance-redress-scheme-what-is-the-latest/)
- [Norton Rose Fulbright — Supreme Court judgment in the Hopcraft appeals](https://www.nortonrosefulbright.com/en/knowledge/publications/8ddc6b59/supreme-court-judgment-in-hopcraft-appeals)
- [FCA Handbook — CONC 3 (financial promotions)](https://handbook.fca.org.uk/handbook/conc3)
- [FCA Handbook — CONC 2.5 (secondary credit brokers)](https://handbook.fca.org.uk/handbook/conc2/conc2s5)
- [FCA Handbook — PRIN 2A.4 (price and value)](https://handbook.fca.org.uk/handbook/prin2a/prin2as4)
- [FCA FG21/1 — fair treatment of vulnerable customers](https://www.fca.org.uk/publication/finalised-guidance/fg21-1.pdf)
- [Gov.uk — margin scheme on second-hand vehicles (VAT Notice 718/1)](https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181)
- [Consumer Rights Act 2015](https://www.legislation.gov.uk/ukpga/2015/15)
- [Business Companion — car traders and the Consumer Contracts Regulations](https://www.businesscompanion.info/focus/car-traders-and-consumer-law/part-3-consumer-contracts-regulations)
- [ICO — PECR electronic mail marketing rules](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/)
- [Gov.uk — high value dealer registration](https://www.gov.uk/guidance/money-laundering-regulations-high-value-dealer-registration)
- [The Motor Ombudsman — Vehicle Sales Code of Practice](https://www.themotorombudsman.org/wp-content/uploads/2025/06/TMO_VehicleSalesCode.pdf)
- [ASA/CAP — motoring finance and leasing guidance](https://www.asa.org.uk/advice-online/motoring-finance-and-leasing.html)
- [DVLA VTL301 — first trade licence application](https://assets.publishing.service.gov.uk/media/69c551d578ca1aa5a636092c/vtl301-application-for-a-first-trade-licence.pdf)

**Integrations**
- [DVLA Vehicle Enquiry Service API](https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/vehicle-enquiry-service/v1.2.0-vehicle-enquiry-service.html)
- [DVSA MOT History API — authentication](https://documentation.history.mot.api.gov.uk/mot-history-api/authentication/) · [rate limits](https://documentation.history.mot.api.gov.uk/mot-history-api/rate-limits/)
- [cap hpi API docs](https://api.cap-hpi.co.uk/docs/index.html) · [HPI vehicle data API](https://www.hpi.co.uk/vehicle-data-api.html)
- [JATO developer portal](https://developer.jato.com/getting-started)
- [Auto Trader Connect](https://www.autotrader.co.uk/partners/retailer/platform/autotrader-connect) · [developer portal](https://developers.autotrader.co.uk/api)
- [Google vehicle ads — Merchant Center](https://support.google.com/merchants/answer/15312145?hl=en-GB) · [Google sunsetting free vehicle listings](https://www.purecars.com/resources/google-is-sunsetting-vehicle-listings-what-it-means-for-your-dealership)
- [Meta vehicle catalogue setup](https://www.facebook.com/business/help/685696635352394)
- [iVendi Connect API](https://www.ivendi.com/connect-api)
- [Xero Accounting API](https://developer.xero.com/documentation/api/accounting/invoices) · [Sage developer portal](https://developers.sageone.com/)
- [Movex API integration](https://movex.co.uk/api-integration/) · [Manheim developer portal](https://developer.manheim.com/apis/marketplace/index.html)
