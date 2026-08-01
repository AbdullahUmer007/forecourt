# Compliance rules reference

> Engineering reference only. Not legal or regulatory advice. Every rule here must be signed off by the retained FCA compliance consultant and VAT specialist before the feature implementing it ships. Verify current status of anything marked ⚠ before building.

## Rules live in data, not code

Every threshold, date, percentage and window below belongs in the platform-level `compliance_rules` table:

```
compliance_rules(id, key, version, effective_from, parameters jsonb, source_url, notes)
```

Example:
```json
{
  "key": "vat.margin_fraction",
  "version": 3,
  "effective_from": "2011-01-04",
  "parameters": { "numerator": 1, "denominator": 6, "standard_rate": 0.20 },
  "source_url": "https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181"
}
```

Application code reads the rule effective on the relevant date — the sale date for VAT, the agreement date for finance, the delivery date for consumer rights. **Never `const VAT_FRACTION = 1/6`.**

---

## 1. FCA — credit broking permission

Introducing a customer to a lender is **credit broking** (Article 36A, Regulated Activities Order). Three bases, captured per tenant at onboarding and validated against the FCA Register:

| Basis | Meaning | Product effect |
|---|---|---|
| Limited permission | Broking ancillary to selling vehicles (CONC 2.5, "secondary credit broker"). Most independents. | Standard journey |
| Full permission | Broking is a primary line, or combined with other full-permission activities | Same journey + extra reporting fields |
| Appointed Representative | Operating under a principal firm's permission (SUP 12); the principal carries responsibility | Principal's name and FRN appear on the initial disclosure and every finance promotion; principal's approved wording set is used |

## 2. Point-of-sale evidence — required elements

Written to the append-only, hash-chained `deal_evidence` ledger:

| Element | Rule reference | Captured |
|---|---|---|
| Initial disclosure (firm identity, broker-not-lender, panel scope, remunerated by commission, right to request commission detail) | CONC 4 | Before any finance discussion |
| **Every** quote presented, not only the selected one | Consumer Duty / evidential | Quote stage |
| Commission type, amount or basis, and confirmation of disclosure | Post-*Hopcraft*; s.140A CCA 1974 | Quote/selection |
| Demands and needs statement | Consumer Duty | Quote stage |
| Creditworthiness/affordability assessment inputs and result | CONC 5.2A | Application |
| Adequate explanation (key features, total cost, APR, cancellation rights) | CONC 4.2 | Application |
| Vulnerability screen and any adjustment made | FG21/1 | Throughout |
| Fair-value confirmation reference from the lender/manufacturer | PRIN 2A.4 | Selection |
| Add-ons: separate demands-and-needs, separate fair-value reference, explicit opt-in (never pre-ticked) | PRIN 2A | Deal build |
| Document versions shown, with effective dates | Evidential | Every step |

**Retention:** indefinite for finance introductions while the redress-scheme look-back environment persists; ≥6 years otherwise. Erasure requests go through legal hold.

## 3. Financial promotions (CONC 3)

**Trigger for a representative example (CONC 3.5.3R):** stating any rate of interest, or any amount relating to the cost of credit — including "from £199/month".

Required contents of the representative example:
- Representative APR
- Rate of interest, and whether fixed or variable
- Total amount of credit
- Any other charges
- Cash price and any advance payment/deposit
- Duration of the agreement
- Total amount payable
- The amount of each repayment

**Trigger for representative APR with equal prominence (CONC 3.5.7R):** the promotion suggests credit availability regardless of financial status, makes favourable competitor comparisons, or offers an incentive to apply.

**"Representative"** = at least **51%** of customers responding to that promotion would get that rate or better.

> ⚠️ **Under active FCA review.** Consultation **CP26/15** (opened April 2026, closed 17 June 2026) proposes simplifying or removing the CONC 3.5.3R representative-example requirement and revisiting the 51% threshold (a rise to 66% has been floated). Final rules were expected later in 2026. Build the representative-example structure as **configurable data**, not a fixed field list, and re-check before launch.

**Implementation contract:**
```ts
// The ONLY way a cost-of-credit figure reaches a screen or a PDF.
<FinancePromotion example={representativeExample}>  // will not mount without a valid, in-date example
  <MonthlyPayment value={…} />
</FinancePromotion>
```
Plus: free-text scanning for cost-of-credit language blocks publishing; a governance report compares advertised representative APR against APRs actually achieved on completed deals and alerts when the 51% test fails.

## 4. ⚠ Motor finance redress scheme — status and parameters

**The scheme is currently PARTIALLY SUSPENDED and has not gone live for payouts.** The Upper Tribunal partially suspended it on/around **1–2 July 2026** following challenges from Consumer Voice, Mercedes-Benz Financial Services, Volkswagen Financial Services and Crédit Agricole Auto Finance. Firms do not currently have to calculate or pay redress under the original timetable. A hearing is expected **December 2026 – February 2027**; payments would start in 2027 if the scheme is upheld.

**Therefore:** the parameters below are what PS26/3 published, not what is currently operative. Store them as versioned data. Never present the deadlines to a dealer as settled fact — label them provisional and subject to litigation. Re-check before building and at every quarterly regulatory watch.

Recorded parameters as published in FCA PS26/3 (30 March 2026):

| Parameter | Value |
|---|---|
| Agreements in scope | Entered 6 April 2007 – 1 November 2024 where the lender paid the broker commission |
| Volume | ~12.1 million agreements |
| Trigger 1 | Discretionary Commission Arrangement (DCA) — broker could vary the rate to increase its own commission (banned from Jan 2021) |
| Trigger 2 | Non-DCA commission ≥39% of total cost of credit **and** ≥10% of amount of credit |
| Trigger 3 | Undisclosed contractual tie / exclusivity (limited carve-outs) |
| Exclusion — small commission | ≤£120 (pre-April 2014 agreements); ≤£150 (post-April 2014) |
| Other exclusions | 0% APR deals; cases already resolved by FOS or a court; loans above the 99.5th percentile for the year |
| Remedy | ~90,000 "high unfairness" cases: full commission refund + interest. Others: hybrid — average of (a) commission paid and (b) estimated loss from an interest-rate differential, using a 21% APR adjustment assumption pre-2014 and 17% post-1 April 2014, capped at ~90% of commission-plus-interest in ~a third of hybrid cases |
| Interest | Simple, Bank of England base rate + 1% p.a., 3% floor, from overpayment to payment |
| Firm implementation deadlines | 30 June 2026 (agreements from 1 April 2014); 31 August 2026 (6 April 2007 – 31 March 2014) |
| Notification windows | 3 months to notify complainants of outcomes; 6 months to proactively contact non-complainants owed money |
| Consumer response window | 6 months from contact |
| Consumer longstop | 31 August 2027 for complaints from consumers not proactively contacted |
| Scale | ~£7.5bn redress + ~£1.6bn admin ≈ £9.1bn; ~£829 average payout |

## 5. VAT — margin scheme

| Rule | Value |
|---|---|
| Margin VAT fraction | gross margin × 1/6 (20% standard rate) |
| Negative margin | No VAT; **cannot** be offset against another vehicle |
| Margin invoice | VAT must **not** be shown separately |
| Qualifies for margin scheme | Bought from a private individual, an unregistered business, a dealer selling under the margin scheme, or Motability (zero-rated) |
| Excluded | New vehicles; vehicles bought with VAT shown separately (VAT-qualifying); most EU-sourced dealer purchases (NI rules differ) |
| Stock book fields | The 12 listed in SKILL.md §3 (VAT Notice 718/1 §5.2). Note: the primary text specifies the seller's and buyer's **name**; "address" may be an invoice requirement rather than a stock-book one — capture both, but caveat the claim in customer-facing copy |
| Retention | ≥6 years (stock book, purchase and sales invoices) |
| Commercial vehicles | Same scheme, same records |

## 6. Consumer Rights Act 2015 / Consumer Contracts Regulations 2013

| Rule | Value |
|---|---|
| Quality standard | Satisfactory quality, fit for purpose, as described — judged against age, price, mileage, condition |
| Short-term right to reject | 30 days from delivery; full refund |
| Clock pause | Pauses during a repair attempt; resumes with **≥7 days remaining** (CRA **s.22(6)–(7)**; s.22(3) sets the 30-day baseline and s.22(4) the perishables exception) |
| Repair/replacement | One reasonable opportunity, at no cost, within a reasonable time |
| Final right to reject | If repair fails/impossible/disproportionate/delayed; refund may be reduced by a deduction for use |
| Reversed burden of proof | 6 months from delivery — fault presumed present at sale unless the trader proves otherwise |
| CCR cancellation right | 14 days, distance and off-premises sales only, no reason needed |
| CCR clock start | Day after delivery; or day after collection where the buyer contracted remotely and collects |
| **Not applicable** | Contract concluded in person on the dealer's premises — even after an online enquiry |
| Deduction for use | Permitted for use beyond establishing nature/characteristics (relevant to test-drive mileage in the cancellation window) |
| Pre-contract information | Mandatory for distance sales: vehicle characteristics/condition, trader identity and contact, total price inc. taxes, delivery costs, payment/delivery arrangements, complaints process, statutory rights reminder, cancellation mechanics |

## 7. UK GDPR / PECR

**PECR soft opt-in (reg. 22)** — usable for email/SMS marketing without prior explicit consent only if **all** of:
1. Details obtained directly from the customer in the course of a sale or negotiations for a sale (a quote request, test drive booking or valuation counts; browsing does not)
2. Marketing is limited to the dealer's own **similar** products or services
3. A clear, free opt-out was offered **at the point of collection**
4. Every subsequent message includes an easy opt-out

Third-party / aggregator leads generally **cannot** rely on the dealer's own soft opt-in — check what basis the aggregator relied on and whether it validly passed consent for this dealer specifically.

**Consent record shape (never a boolean):**
```
contact_consents(contact_id, channel, basis, granted, wording_version_id,
                 source, evidence, recorded_by, recorded_at, expires_at)
```
Append-only. Re-evaluated at send time, not at schedule time.

**Roles:** we are the **processor** for tenant customer data (the dealer is controller); we are **controller** for our own dealer-facing marketing, product analytics and any anonymised benchmarking product. Document both explicitly in the DPA and the privacy notice.

**Retention:** ≥6 years typical for credit-related records. **Do not apply blanket short retention to historic finance-introduction data** while the redress look-back is live. Marketing consent goes stale after roughly 2 years of inactivity (ICO good practice, not a hard rule).

## 8. Anti-money laundering

| Rule | Value |
|---|---|
| High Value Dealer trigger | Accepting or making cash payments of **£10,000 or more** (single or linked/split payments) |
| Currency | **Fixed £10,000 sterling with effect from 30 June 2026.** The MLR 2017 euro-denominated thresholds were converted to sterling in the 2026 AML reform. Anything citing €10,000 is out of date. Store the threshold in `compliance_rules` keyed on the receipt date so pre-30-June-2026 records still evaluate correctly |
| Registration | Must register with HMRC **before** accepting a qualifying payment; registration cannot be retrospective |
| Obligations once registered | Full CDD at/above threshold, risk assessment, nominated officer for SARs, AML policies, training records, annual fee, fit-and-proper checks |
| Supervisor | HMRC Economic Crime Supervision |

Control: a running cash total per customer and per linked transaction set, alerting as the threshold approaches and hard-blocking with an override-and-justify flow at the threshold for tenants not registered as HVDs.

## 9. Trade operations

| Item | Detail |
|---|---|
| Trade plates | DVLA forms VTL301 (first licence) / VTL318 (renewal); current fees **£97.35 (6 months) / £177 (12 months)** for all vehicles, £68.75 / £125 for bicycles and tricycles ≤450kg; 6-month licences run Jan–Jun or Jul–Dec, 12-month licences run Jan–Dec; must be on the Motor Insurance Database and covered by motor trade insurance |
| DVLA on purchase from a private seller | Seller completes the "sold to a motor trader" section of the V5C; dealer keeps the yellow sold-to-trade section. The dealer does not re-register the vehicle while it is in stock |
| DVLA on sale | Complete new keeper details, notify DVLA (online or by post), and hand the buyer the V5C/2 new-keeper supplement. ⚠ Confirm exact procedure against gov.uk/sold-bought-vehicle before hard-coding |
| Motor Ombudsman Vehicle Sales Code (CTSI-approved) | MOT copy handed over; sold safe and roadworthy; faults found at pre-sale inspection rectified; documented pre-sale inspection provided; provenance check on every used vehicle |
| CAP Code / ASA | Advertised prices genuinely available and inclusive of mandatory extras; "from £X" must reflect a real available deal; environmental and performance claims substantiated. CAP compliance does not imply CONC compliance, or vice versa |

## 10. Quarterly regulatory watch

Assign an owner. Re-check every quarter and update `compliance_rules`:

- FCA motor finance redress scheme — status, legal challenges, parameter changes
- FCA Handbook — CONC, PRIN 2A, DISP, SUP 12
- HMRC margin-scheme guidance and VAT rate
- ICO direct marketing and PECR guidance
- CAP Code motoring section and ASA rulings against car dealers
- DVLA/DVSA API terms and data-use restrictions
