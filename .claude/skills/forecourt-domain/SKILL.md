---
name: forecourt-domain
description: UK used-car dealership domain knowledge and regulatory rules for building the Forecourt dealer SaaS. Use whenever working on vehicles, stock, VAT margin scheme, part-exchange, motor finance, FCA/Consumer Duty, Consumer Rights Act, DVLA/MOT data, dealer terminology, or any feature of a car dealer CRM/DMS. Trigger words - vehicle, stock, forecourt, dealer, part-exchange, VAT margin, HPI, MOT, V5C, finance commission, Consumer Duty, CONC, APR, reg/registration, DVLA.
---

# Forecourt — UK used-car dealer domain

Load this before writing any code, spec, copy or test that touches the dealer domain. Getting the vocabulary and the rules right is what makes this product credible to a 55-year-old dealer principal who has been doing this for thirty years.

## 1. Speak the trade's language

| Use this | Not this |
|---|---|
| forecourt | lot, yard |
| part-exchange, part-ex, PX | trade-in |
| reg, registration, VRM | licence plate, tag |
| V5C, logbook | title, registration document |
| MOT | inspection, roadworthy test |
| prep, recon | detailing, refurbishment |
| HPI check, provenance check | history report |
| stock (dealer-facing copy) | inventory (fine as an internal identifier) |
| unit | car (when counting sales) |
| gross, GP | profit margin |
| deal | transaction, order (except the specific `order` state) |
| days in stock, days to sell | inventory age |
| overage | stale stock |
| book-in | intake, receiving |

Currency is always GBP, shown with `£` and two decimals in documents, whole pounds in dashboards. Dates in UI as `12 Aug 2026`. Mileage in miles. Never Americanise: colour, tyre, licence (noun) / license (verb), organise.

## 2. The vehicle lifecycle — the spine of the product

```
Sourcing → Purchased → In transit → Booked in → In prep → Ready
   → Live → Reserved → Sold → Delivered
```
Side states: On hold · Returned (CRA rejection) · Trade disposal · Written off · Archived.

Hard rules:
- A vehicle cannot go **Live** without: all mandatory VAT stock-book fields, at least one published photo, a retail price, a VAT scheme, and a completed provenance check.
- **Reserved** requires a deposit record or an explicit manager override with a reason.
- **Sold** requires a linked deal. **Delivered** requires a completed handover checklist and a DVLA notification flag.
- Every transition is timestamped and attributed. The durations between states are the product's most valuable metric (days in prep, days to live, days to sell).

## 3. Money rules that must never be got wrong

- **Store money as integer minor units (pence) with an explicit currency.** Never a float. Never a JS `number` for arithmetic on more than one value.
- **Gross margin per unit** = sale price − (purchase price + prep costs + transport/fees + provenance + advertising allocation + stocking interest). A typical £12,000 retail car has ~£1,325 of vehicle margin; finance commission and add-ons add roughly another £580. Margins are thin — rounding errors are real money.
- **Never compute a customer-facing figure client-side.** Prices, margins, VAT and finance figures are computed server-side and returned.

### VAT — the single most audited thing in a dealership

Two mutually exclusive schemes per vehicle, decided at book-in from the purchase source:

**Margin scheme** — the vehicle was bought where no VAT was recoverable (private individual, unregistered business, another dealer selling under the margin scheme, Motability zero-rated).
- VAT due = gross margin × **1/6** (at a 20% standard rate).
- Negative margin → no VAT, and it **cannot** be offset against another vehicle's positive margin. Each vehicle stands alone.
- The sales invoice must **not show VAT separately**. Showing it makes the whole sale standard-rated. *There must be no code path that can produce a margin invoice with a VAT line — assert it in a test.*
- Invoice must cross-reference the stock book entry and show both parties' names and addresses, the date, and the vehicle registration/description.

**VAT qualifying** — input VAT was reclaimed on purchase (ex-fleet, ex-lease, bought from a VAT-registered dealer on a standard invoice).
- VAT charged and shown on the **full selling price**. Business buyers can reclaim it — which is why commercial-vehicle buyers care.

**The stock book** has 12 mandatory fields and must be retained ≥6 years:
1. Stock book number (sequential) · 2. Date of purchase · 3. Purchase invoice number · 4. Purchase price · 5. Seller's name and address · 6. Registration · 7. Vehicle description (make/model/VIN) · 8. Date of sale · 9. Sales invoice number · 10. Buyer's name and address · 11. Selling price · 12. Margin and VAT due.

Entries are immutable once the sale is invoiced; corrections create an adjusting entry with a reason.

## 4. Regulatory rules the code must enforce

Read `references/compliance-rules.md` for full detail and sources. The five that bite hardest:

1. **No cost-of-credit figure without a representative example.** Any monthly payment, APR, deposit or credit-cost figure shown anywhere — website, advert, email, PDF — requires a full representative example (CONC 3.5.3R). Implement this as a single component/primitive that cannot render without a valid, in-date example record. There must be no other code path.
2. **Contract formation is a mandatory structured field on every deal**: on-premises / distance / off-premises. Distance and off-premises trigger a 14-day cancellation right starting the day after delivery (or collection). An online enquiry followed by an in-showroom signature is an **on-premises** sale with no cancellation right. Getting this wrong is expensive.
3. **Delivery starts two Consumer Rights Act clocks**: the 30-day short-term right to reject (which *pauses* during a repair attempt and resumes with ≥7 days remaining) and the 6-month reversed burden of proof.
4. **Marketing consent is a record, never a boolean.** Channel + basis (explicit consent / PECR soft opt-in / legitimate interest) + source + timestamp + the exact wording version shown. Consent is re-checked **at send time**, not at schedule time.
5. **Finance introductions are append-only evidence, retained indefinitely.** Every disclosure, every quote presented (not just the chosen one), commission type and amount, demands-and-needs, affordability, vulnerability screen and document version. This is the product's moat and the dealer's defence.

**All regulatory thresholds, dates and percentages live in the platform `compliance_rules` table as versioned, source-linked data — never as constants in code.** UK motor finance regulation is actively moving; changing the law must be a data deployment.

## 5. Data sources and what they give you

| Source | Key by | Gives |
|---|---|---|
| DVLA VES (free) | registration | make, colour, fuel, engine cc, CO2, tax status, MOT status/expiry, year, export marker |
| DVSA MOT History (free) | registration | full test history, per-test mileage, defects, advisories |
| cap hpi / JATO / aggregator (paid) | registration/VIN | derivative, trim, options, standard equipment |
| cap hpi / Percayso (paid) | vehicle | trade/retail/private valuation, forecast days to sell |
| HPI Check / AutoCheck (paid) | registration | outstanding finance, write-off category, stolen, mileage anomaly, plate changes |

**Lookups cost real money.** Cache aggressively (spec indefinitely; DVLA/MOT/valuation 24h), meter per tenant, store the raw response alongside the parsed result, and never re-run a paid lookup without a cache miss or an explicit user action.

**DVLA rarely gives you the derivative.** Multiple trims share one DVLA record. When the spec provider returns several candidates, show a derivative picker with distinguishing attributes — never guess. A wrong derivative means a wrong price and a mis-described vehicle, which is a Consumer Rights Act problem.

**Mileage below the highest recorded MOT reading is a hard warning** requiring explicit acknowledgement. It is both a fraud signal and a legal exposure.

## 6. Registration numbers

UK VRM formats: current `AB12 CDE`, prefix `A123 BCD`, suffix `ABC 123D`, dateless, Northern Ireland `ABC 1234`. Store normalised (uppercase, no spaces); display formatted with the space. Search must tolerate spacing, and `O`/`0` and `I`/`1` confusion. Unique per tenant among non-archived vehicles.

## 7. The users, and what they actually need

- **Dealer principal** — on a phone, 20 seconds: stock value, units MTD, average GP per unit, days to sell, overage, leads today.
- **Sales executive** — on a phone, on the forecourt: my leads, next actions, quick quote, appraise a part-ex, log a call.
- **Buyer** — in an auction hall with bad signal: what's it worth, how fast will it sell, what's my max bid. Must work offline.
- **Prep coordinator** — in a workshop, gloves on: what's blocking this car, add a cost, move a card, take photos.
- **Administrator** — at a desk for hours: density, keyboard shortcuts, invoices, VAT book, finance payouts, documents.

If a daily task can't be done one-handed on a phone in the rain, it is designed wrong.

## 8. Anti-patterns — do not do these

- Storing money as a float, or doing currency arithmetic in the browser
- A single `marketing_opt_in` boolean on a contact
- Hard-coding a VAT rate, a regulatory threshold or a scheme date
- Rendering a monthly payment through anything other than the finance-promotion primitive
- Letting a vehicle go live without a provenance check "just for now"
- Mutating or deleting a financial, invoice, stock-book or evidence record — always append a correction
- Making loss reasons optional (they're how a dealer learns their business)
- Using American automotive vocabulary anywhere a dealer can see it
- Any database query without a tenant scope
- Guessing a derivative when the lookup is ambiguous
