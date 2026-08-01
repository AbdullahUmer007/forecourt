# Forecourt — Product Strategy & Business Plan

**Working product name:** Forecourt
**Market:** United Kingdom (Europe later)
**Primary customer:** Independent used-car dealers, 5–150 units in stock
**Document owner:** CEO
**Version:** 1.0 — August 2026

---

## 0. How to read this document

I have written this as if I run a £1m+/yr independent dealership and I am telling you what I actually need — not what looks good in a feature list. Everything in Section 2 is the reality of the business you are selling into. If the software doesn't respect that reality it will not be used, no matter how well it is built.

The other documents in this set:

| Doc | What it is |
|---|---|
| `01-product-strategy.md` | This document — market, ICP, positioning, packaging, roadmap |
| `02-functional-spec.md` | Module-by-module functional specification |
| `03-architecture-and-data-model.md` | Stack, multi-tenancy, schema, APIs, security |
| `04-design-system.md` | UI/UX design system and screen patterns |
| `05-integrations-and-compliance.md` | Integration register + compliance control matrix |
| `06-ai-toolkit-setup.md` | Skills, system prompt and repo conventions for building it |

---

## 1. The thesis in one page

**What we are building.** A single multi-tenant SaaS platform that runs an independent UK used-car dealership end to end — buying, reconditioning, pricing, advertising, selling, financing, delivering, and accounting for vehicles — plus a fast, brandable public website per dealer that is driven by the same inventory data, with zero re-keying.

**Why now.** Three things are true at the same time, and they rarely are:

1. **The incumbent stack is old.** Dragon2000, Click Dealer, Dealerweb and Gemini have been in market 15–25 years. Their dealer-facing UI and their bundled websites are consistently described by third parties and reviewers as dated and weak on mobile. Dragon2000 — a 20-year incumbent — has effectively no public review footprint at all. Legacy vendors have stopped competing on product.
2. **The dominant channel is losing goodwill.** Auto Trader's Deal Builder rollout and repeated price rises triggered the loudest independent-dealer revolt in years: the IMDA surveyed ~700 members and reported ~70% had downgraded or cut their package, and Auto Trader itself confirmed 59 cancellations and 70 downgrades inside ten days, with its CEO publicly conceding "we know we are not cheap." Dealers are, right now, actively re-evaluating what they pay for and who owns their customer relationship.
3. **Compliance load just went up sharply.** Consumer Duty, the Supreme Court judgment in *Hopcraft/Johnson/Wrench* (Aug 2025) and the FCA's motor finance redress scheme (PS26/3, 30 March 2026, ~12.1m agreements in scope, ~£9.1bn estimated cost — **partially suspended by the Upper Tribunal since early July 2026 pending legal challenge**) have made "can you evidence what you told the customer, and what commission you took, on a deal from 2013?" an existential question for dealers. The suspension does not reduce the exposure; it prolongs the uncertainty, which if anything makes the record-keeping more valuable. Almost no independent-dealer DMS was designed to answer it.

**The wedge.** We are not competing with Auto Trader for eyeballs. We are the *system of record and the dealer's own shopfront* — the thing that makes Auto Trader an optional, measurable channel rather than the dealer's entire business. Our pitch: **"Own your stock data, own your website, own your customer, and prove your compliance. Publish to Auto Trader if it earns its money."**

**Why we win.** Three defensible reasons, in order:

1. **Design.** A genuinely modern, fast, mobile-first product in a category where "dated" is the standard complaint. This is cheap for us and enormously visible to the buyer.
2. **Compliance as a product, not a checkbox.** An immutable deal-evidence ledger, an HMRC-shaped VAT margin stock book, CONC-compliant finance promotions by construction, and CRA/CCR clocks that run themselves. Nobody in the independent tier sells this.
3. **One system, one dataset.** Website, stock, CRM, finance, accounting and marketplace feeds off one record. The recurring complaint in the challenger tier is that "website + basic DMS" products stop short of being the whole business system.

**What we are explicitly not doing in v1.** Franchised/OEM dealers. Full workshop/parts management for third-party retail service. Accounting ledger replacement (we push to Xero/QuickBooks/Sage; we do not become the ledger). US/EU markets.

---

## 2. The dealer's business, as it actually works

You cannot design this product without holding this in your head. Every screen we build should shorten one of these loops.

### 2.1 The unit economics of one car

A typical independent buying a £12,000-retail car:

| Line | Typical | Notes |
|---|---|---|
| Purchase price (auction/part-ex/trade) | £9,800 | The single biggest determinant of profit. Buying is where money is made. |
| Buyer's fee / delivery | £250 | Auction fee, transport |
| Preparation (recon) | £450 | Service, MOT, tyres, brakes, bodywork, valet |
| Provenance & data checks | £15 | HPI/AutoCheck |
| Advertising allocation | £70 | Auto Trader et al., amortised per unit |
| Stocking finance interest | £90 | ~45–55 days on the forecourt |
| **Total cost** | **£10,675** | |
| Sale price | £12,000 | |
| **Gross margin (vehicle)** | **£1,325** | ~11% — thin |
| Finance commission | £400 | Where a real chunk of profit lives |
| Warranty / GAP / add-ons | £180 | Now under intense Consumer Duty scrutiny |
| **Total gross profit per unit** | **~£1,905** | |

**What this tells us about the product:**

- **Days to sell is the master metric.** cap hpi data reports independents averaging ~52 days to sell versus ~32 for car supermarkets. Every extra week costs stocking interest and depreciation and eats a meaningful slice of that £1,325. A product that reliably cuts 5 days off average stock turn is worth several thousand pounds a year per 30 cars — far more than our subscription. **This is our ROI story and it must be provable inside the product.**
- **Back-end profit (finance + add-ons) is roughly a third of gross.** So the product must handle finance introduction properly *and* keep it defensible under Consumer Duty. If we make finance compliance easy, we protect the dealer's most profitable line.
- **Margins are thin enough that a £200/month tool needs to justify itself explicitly.** Our dashboard must show, in pounds, what we saved them.

### 2.2 The eight loops a dealership runs

1. **Source** — auctions (BCA, Manheim), Dealer Auction, Motorway, part-exchanges, trade contacts, private buys. Decision: *what is this worth, and how fast will it sell?*
2. **Acquire & book in** — purchase invoice, V5C handling, HPI check, arrival photos, into the stock book (VAT scheme decided here — this decision is irreversible in practice).
3. **Prepare (recon)** — service, MOT, parts, bodywork, valet, photography. This is where days silently leak. Most dealers do not measure it.
4. **Price** — cap hpi / Auto Trader Retail Rating / Percayso, adjusted for condition, mileage and local demand. Re-priced on a schedule as the car ages.
5. **Advertise** — own website + Auto Trader + Motors/eBay/Gumtree + CarGurus + Facebook Marketplace + Google Vehicle Ads. Photos and description quality drive click-through more than anything else.
6. **Convert** — inbound calls, web forms, WhatsApp, marketplace leads. Appointment → test drive → part-ex appraisal → finance quote → deposit → order.
7. **Deliver** — finance payout, docs, e-sign, DVLA notification, plates, handover, warranty registration.
8. **Aftercare & retention** — MOT/service reminders, PCP/HP end-of-term timing, review requests, repeat and referral business.

The single biggest operational failure in this business is **loop 3 and loop 4 not talking to loop 8** — cars sit in prep with nobody accountable, and nobody ever markets to the customer who bought three years ago and is exactly due to change.

### 2.3 The people, and what each one needs

| Role | Typical count | What they live in | What they need from us |
|---|---|---|---|
| Dealer Principal / Owner | 1 | Their phone | Stock health, cash tied up, profit per unit, what's aging, what's overdue — in 20 seconds |
| Sales Manager | 0–1 | Desk + phone | Pipeline, today's appointments, deal approvals, pricing decisions, staff performance |
| Sales Executive | 1–8 | Phone, forecourt | Their leads, next actions, quick quote, part-ex appraisal, deal build |
| Buyer / Stock Controller | 0–1 | Auction hall, phone | Valuation, days-to-sell forecast, budget/funding headroom, buy-vs-skip |
| Prep / Workshop Coordinator | 0–2 | Workshop | Job cards, parts on order, what's blocking a car going live |
| Administrator / Business Manager | 1–2 | Desk | Invoices, VAT stock book, finance payouts, DVLA, docs, compliance |
| Accountant (external) | — | Xero | Clean, reconciled sales and purchase data |

**Design implication:** the owner and the sales exec use this on a phone, standing up, on a forecourt, in the rain. The administrator uses it on a desktop for two hours a day and needs density and keyboard speed. These are two different UIs of the same system and we must design both deliberately.

---

## 3. Market and ICP

### 3.1 Size

- ~15,500 businesses in the UK "used car and light motor vehicle sales" industry (IBISWorld, 2026); broader estimates of all dealership types run 15,000–25,000.
- Auto Trader reports ~14,000 retailer forecourts advertising on its platform — a good proxy for *digitally active* dealers of all types.
- Auto Trader's average revenue per retailer is ~£2,854/month (FY25) — blended across small independents and large groups, but it establishes that this market already spends serious money on software and advertising.

**Serviceable market:** conservatively 10,000–12,000 UK independent forecourts. At an average £220/month blended ARPU, that is a **~£26–32m ARR TAM in the UK alone** for the core platform, before transactional revenue (see §6.3). Capturing 5% is a ~£1.5m ARR business; 15% is a ~£4.5m ARR business with a natural expansion path into Ireland, Netherlands, Spain and Poland.

### 3.2 The ideal first customer (be ruthlessly narrow)

> **A single-site independent used-car dealer in England, 25–60 cars in stock, 2–8 staff, £2–8m turnover, currently paying for Auto Trader plus a website they dislike, running their stock on a spreadsheet or a legacy DMS they have complained about, doing finance through one or two lenders, and personally worried about Consumer Duty paperwork.**

Why this profile:
- Big enough to feel the pain and pay £150–£350/month without a committee.
- Small enough that the owner decides in one meeting.
- Not so small that they'll churn when trading dips.
- Complex enough that they need all our modules — which makes them sticky.

**Secondary segments (v1.5+):** 2–5 site groups (needs multi-site consolidation), commercial vehicle / van specialists (VAT-qualifying stock matters far more), prestige/performance specialists (fewer units, higher touch, better websites), and motorcycle/motorhome dealers (same shape, different data model — cheap to add).

**Do not chase in year one:** franchised dealers (OEM-mandated DMS choice), car supermarkets (bespoke needs, brutal procurement), and pure online retailers (they build their own).

### 3.3 What they buy today, and what it costs them

| Line item | Typical monthly spend | Source confidence |
|---|---|---|
| Auto Trader advertising | £700–£1,000+ for ~20 cars; £2,854 average across all retailers | Auto Trader FY25 (verified); per-vehicle rate is third-party estimate |
| eBay Motors Group (Motors/Gumtree) | ~£169+VAT for 20 cars | Third-party estimate — verify |
| DMS | £0 (free tier) – £200; up to £300+ at scale | Challenger vendor pricing pages (verified) |
| Dealer website (if separate) | £25–£100 template; £150–£300 bespoke | Vendor pricing (verified) |
| Finance platform (iVendi/Codeweavers/Evolution) | Usually **£0** — funded by lender commission | Vendor materials (verified) |
| Stocking finance | Interest + fees; no verified public rates found | **Unverified — do primary research** |

**Critical strategic read:** we are competing for the **£50–£300/month DMS + website line**, and we should be positioned as making the **£700–£2,800/month advertising line** more efficient. Never position as a replacement for Auto Trader — position as the thing that lets them measure and reduce their dependence on it.

---

## 4. Competitive position

> ⚠️ **Partly superseded.** Since this was written, **DealersHub** (dealershub.co.uk) has been identified as our named direct competitor, holding a live target account. See **`07-competitive-strategy-dealershub.md`** for the teardown, the revised positioning, the revised pricing in §6, and the displacement playbook. The tier analysis below remains valid; the immediate fight is narrower than it describes.

### 4.1 The landscape in three tiers

**Tier 1 — Enterprise/franchise:** Keyloop (Autoline/Drive), Pinewood (Pinnacle), GForces/NetDirector, Gemini (upper end). Per-seat or per-employee enterprise licensing, deep OEM integration, long implementations. *Irrelevant to our ICP except as proof that the good tooling is currently reserved for big players.*

**Tier 2 — Established independent-sector incumbents:** Click Dealer, Dragon2000, Dealerweb, Gemini (lower end), DMS Navigator. 15–25 years old, quote-only pricing, sales-led, longer contracts, dated UI, weak bundled websites, thin public social proof. *These are the accounts we take.*

**Tier 3 — Modern challengers:** Vehiso (£0–£199/mo), MotorDesk (£79+VAT), TraderWay (£39–£79), Car Dealer 5 (£44–£110+VAT), SpidersNet/Autopromotor. Published pricing, no lock-in, AI descriptions and background removal as standard. *These are our real competitors — but they are website+light-DMS products, not full business systems. None combines best-in-class CRM, deep pricing intelligence, finance workflow and compliance evidence.*

**Adjacent layers we integrate with rather than fight:** Auto Trader / Motors / CarGurus / Carwow (demand), Dealer Auction / Motorway / BCA / Manheim (supply), iVendi / Codeweavers / Evolution Funding (finance middleware, usually free to the dealer because lenders pay), cap hpi / Percayso / Glass's (data), Xero / Sage / QuickBooks (accounting).

### 4.2 Table stakes — no credibility without these on day one

1. One-click syndication to Auto Trader, Motors.co.uk/Gumtree, CarGurus, Facebook Marketplace
2. Stock management with true cost and margin per unit, DVLA lookup by reg
3. Unified lead inbox (web, phone, marketplace, WhatsApp)
4. Modern, fast, mobile-first dealer website the dealer actually controls (SEO included)
5. Finance quoting integration with at least one aggregator
6. E-signature / digital order forms
7. Xero/QuickBooks/Sage sync for MTD
8. AI vehicle descriptions and image cleanup (now baseline, not a differentiator)
9. **Published pricing, no lock-in** — increasingly a competitive weapon

### 4.3 Where we actually differentiate

| # | Differentiator | Why it's defensible |
|---|---|---|
| 1 | **Deal Evidence Ledger** — immutable, append-only record of every disclosure, quote, commission, vulnerability screen and document version at point of sale | Directly answers the post-*Hopcraft* / redress-scheme fear. Legacy systems can't retrofit this. High switching cost once populated. |
| 2 | **HMRC-shaped VAT margin stock book** — all mandatory fields enforced at data-entry time, per-vehicle margin/qualifying flag, correct invoice VAT suppression, 6-year retention | Every dealer gets inspected eventually. Nobody markets this well. Cheap for us, terrifying for them. |
| 3 | **Prep pipeline with a days-to-live clock** | The most measurable ROI in the business, and nobody in Tier 3 does it properly. Ties directly to the days-to-sell metric. |
| 4 | **Pricing intelligence in the core product** (cap hpi/Percayso + our own days-to-sell model) | Auto Trader reserves "Retail Accelerator"-style intelligence for large retailers. We give it to a 30-car independent. |
| 5 | **Websites that are genuinely fast and rank** — Core Web Vitals budget enforced, structured data, per-vehicle landing pages, local SEO | Direct attack on the loudest complaint about incumbents; directly reduces Auto Trader dependence, which is emotionally resonant right now. |
| 6 | **Data portability as a headline feature** — full export, documented schema, one-click migration in and out | Nobody markets this. It removes the #1 objection to switching and shames incumbents. |
| 7 | **Channel P&L** — cost per lead and cost per sale by channel, including Auto Trader spend | Makes us the system that judges their biggest expense. Extremely sticky. |

### 4.4 Positioning statement

> **For independent used-car dealers who are tired of paying more for tools they don't control, Forecourt is the dealership operating system that runs your stock, your website, your customers and your compliance in one place — so you can prove where every pound of margin came from, and stop renting your business from a marketplace.**

---

## 5. Product principles (non-negotiable)

1. **One record, one truth.** A vehicle is entered once. Website, feeds, invoices, stock book and dashboards all read the same row. No re-keying, ever.
2. **The forecourt is mobile.** Every daily task — appraise a part-ex, photograph a car, log a call, take a deposit — must be completable one-handed on a phone.
3. **Compliance by construction, not by discipline.** If a field is legally required, the system enforces it at entry. If a clock starts on delivery, the system starts it. Users should not have to remember the law.
4. **Speed is a feature.** Sub-second navigation in the CRM. Sub-2.5s LCP on public vehicle pages. We will publish a performance budget and fail builds that breach it.
5. **Never hold the dealer hostage.** Full data export, always, self-serve. Published pricing. Monthly rolling contracts.
6. **Show the money.** Every module surfaces a pound figure. "You saved 6 days of average stock turn this quarter = £4,100 of retained margin."
7. **Boring where it matters.** Accounting, VAT and finance records are conservative, auditable and double-checked. Creativity belongs in the merchandising, not the ledger.
8. **Assume a 55-year-old dealer principal who is good at cars and impatient with software.** If it needs training, it's wrong.

---

## 6. Packaging, pricing and revenue model

> ⚠️ **Superseded by `07-competitive-strategy-dealershub.md` §6.** Verified market pricing puts this tier at £39–£220/month, with DealersHub at £120+VAT. Revised tiers are **£89 / £189–£319 (stock-banded) / £159 per site**, plus two published guarantees. The reasoning below stands; the numbers have moved.

### 6.1 Tiers

| | **Starter** | **Pro** | **Group** |
|---|---|---|---|
| Target | 1–15 cars | 15–80 cars, 1 site | 2–8 sites |
| Price | **£79/mo** | **£229/mo** | **£179/site/mo + £299 platform** |
| Users | 3 | Unlimited | Unlimited |
| Stock records | 25 live | Unlimited | Unlimited |
| Public website | 1, template themes | 1, full theme control + custom domain | 1 per site + group site |
| Marketplace feeds | Auto Trader + 1 | All | All |
| CRM & lead inbox | ✓ | ✓ | ✓ + lead routing rules |
| Prep pipeline | Basic | ✓ Full with SLAs | ✓ |
| VAT margin stock book | ✓ | ✓ | ✓ |
| Deal Evidence Ledger | ✓ | ✓ | ✓ |
| Finance quoting | ✓ | ✓ | ✓ |
| Pricing intelligence | — | ✓ | ✓ |
| Channel P&L | — | ✓ | ✓ |
| Accounting sync | — | ✓ | ✓ |
| Multi-site consolidation | — | — | ✓ |
| API access | — | Read | Read/write |
| Support | Email | Email + phone | Named CSM |

**Add-ons (per tenant/month):** extra website £39 · advanced 360 imagery pipeline £59 · call tracking £29/seat · e-sign volume pack £25 · white-label reseller £POA.

**Rationale.** £79 undercuts the challenger tier's mid-point and is an easy yes. £229 is priced against "one legacy DMS + one website + one add-on" and is still less than 10% of what they spend on Auto Trader. We publish these prices on the website — in a market where six incumbents refuse to, transparency is itself a marketing asset.

### 6.2 What we deliberately don't charge for

Onboarding and data migration (free, always — it's our wedge against lock-in), the first 90 days of a switching dealer's overlap period, and the compliance modules. Compliance is bundled into every tier because it is our moat and it must be universal to be credible.

### 6.3 Second revenue line — transactional (year 2+)

This is where the business becomes genuinely valuable:

- **Finance commission share.** We become an introducer to a lender panel (or partner with iVendi/Codeweavers/Evolution) and take a share. At ~£400 commission per financed deal and 40% finance penetration, a 30-car/month dealer generates ~£4,800/month of commission. Even a 5% share is £240/month — larger than the subscription.
- **Provenance & data checks resold at a small margin** (HPI/AutoCheck, ~£8–15 each, 25–40 checks/month per dealer).
- **Payments.** Online deposits via Stripe/GoCardless — small platform fee.
- **Warranty/GAP marketplace** — commission share, subject to strict Consumer Duty fair-value governance.
- **Anonymised market intelligence** — aggregate pricing and days-to-sell benchmarks sold back as a premium data product (must be genuinely anonymised and covered in the tenant DPA).

**Target blended ARPU trajectory:** £180 (yr 1, subscription only) → £310 (yr 2, +transactional) → £430 (yr 3).

### 6.4 Unit economics targets

| Metric | Target |
|---|---|
| CAC | < £900 |
| Payback | < 5 months |
| Gross margin | > 80% (subscription), > 60% blended with transactional |
| Logo churn | < 1.5%/month (year 1), < 0.9% (year 2) |
| Net revenue retention | > 108% |
| LTV:CAC | > 4:1 by month 18 |

---

## 7. Go-to-market

> ⚠️ **Amended by `07-competitive-strategy-dealershub.md` §7.** A new Phase 0 sits in front of everything below: **ship the free Dealer Site Audit tool and fingerprint-prospect the competitor estate.** It is now the first thing we build, before the CRM.

### 7.1 The sequence

**Phase 0 — Design partners (months 0–4).** Recruit **8 dealers** across the ICP. Two must be VAT-margin-heavy, one must be a van specialist, one must be a 3-site group. Free for 12 months in exchange for weekly access, real data, and a public case study. Build with them in the room. Do not write a line of production code until three of them have walked you through their stock book, their Auto Trader bill and their last VAT inspection.

**Phase 1 — Founding cohort (months 5–10).** 50 paying dealers. Sold personally by the founders. Channel: direct outbound + trade press + IMDA/trade association presence. The message writes itself right now: *"Own your customer. Publish to Auto Trader on your terms."*

**Phase 2 — Scale (months 11–24).** 400 dealers. Add inside sales, self-serve Starter tier, referral programme, partner channel.

### 7.2 Channels, ranked by expected efficiency

1. **Direct outbound to dealers who publicly downgraded/cancelled Auto Trader.** These are identifiable through trade press, IMDA activity and forum posts. Highest intent audience in the market today.
2. **Trade press and events.** Car Dealer Magazine, AM-Online, Motor Trader; Car Dealer Live, Automotive Management Live, the Used Car Awards. Car Dealer Power awards are demonstrably a credibility currency in this sector (SpidersNet has used them well).
3. **Trade associations.** IMDA (independent-focused and currently activist), NFDA, IMI, the Motor Ombudsman's approved code scheme. Association endorsement is worth more than any ad in this market.
4. **Content and SEO aimed at the dealer's fears, not their features.** "The 11 fields HMRC will ask for in your VAT stock book." "What the FCA redress scheme means if you were the broker." "How to work out what Auto Trader actually costs you per sale." This content builds the compliance-authority position that underpins differentiator #1 and #2.
5. **Migration-led acquisition.** Build free, self-serve importers for Dragon2000, Click Dealer, Vehiso, MotorDesk and CSV/spreadsheet exports. Market them by name. Publish a "switching guide" per incumbent.
6. **Partner/reseller.** Finance brokers, accountants specialising in motor trade, prep/valeting franchises, and photography suppliers all sit next to our buyer.
7. **Trustpilot/G2/Capterra from day one.** The incumbents have almost nothing. Twenty real reviews makes us look like the established option.

### 7.3 The sales narrative (30 seconds)

> "You're paying Auto Trader thousands a month, you've got a website you can't edit, your stock's in a spreadsheet, and if the FCA or HMRC asked you to evidence a deal from four years ago you'd be sweating. Forecourt runs your whole forecourt off one record — stock, website, leads, finance, VAT book — and it proves every deal. It's £229 a month, published price, cancel any time, we migrate your data free, and if we don't take five days off your average stock turn in ninety days we'll tell you to leave."

### 7.4 Objection handling

| Objection | Response |
|---|---|
| "I've used X for 12 years." | Free parallel run for 60 days. We import your data. You decide. |
| "My website is fine." | We'll build yours in the trial and show you the Core Web Vitals and speed difference side by side. |
| "I don't have time to learn a new system." | Onboarding is done for you. We enter your stock. You approve it. |
| "You're new — will you still be here?" | Full export any time, documented schema. You're never trapped, which is more than your current vendor offers. |
| "What about Auto Trader?" | We publish to them. We just also show you exactly what they cost you per sale. |

---

## 8. Roadmap

### Release 1 — "Run the forecourt" (months 0–6, MVP)
The smallest set that lets a dealer actually stop using their old system.

- Tenant provisioning, users, roles, permissions
- Vehicle/stock records with DVLA VES + MOT history lookup
- VAT margin stock book (all mandatory fields, margin calc, invoice suppression)
- Purchase, costs and true-margin tracking per unit
- Media manager (photos, ordering, plate blur, AI background)
- Public website engine v1 — 3 themes, custom domain, vehicle search, VDP, enquiry forms
- Auto Trader + Motors/Gumtree feed publishing
- Lead inbox: web forms, email parsing, manual entry
- Contacts and basic pipeline
- Sale/invoice generation, deposit taking (Stripe)
- Deal Evidence Ledger v1
- Owner dashboard (stock health, aging, margin)

### Release 2 — "Sell better" (months 7–11)
- Full CRM: tasks, appointments, test drives, automated follow-up sequences
- WhatsApp + SMS two-way (Twilio), email sync (Gmail/Graph)
- Part-exchange appraisal (mobile, photo-driven, valuation-assisted)
- Finance quoting via iVendi/Codeweavers + Consumer Duty capture
- E-signature (DocuSign/Dropbox Sign)
- Prep pipeline with job cards, SLAs and days-to-live clock
- Pricing intelligence: cap hpi/Percayso feed, price position, aging price ladder
- CarGurus, Facebook Marketplace, Google Vehicle Ads feeds
- Xero + QuickBooks sync

### Release 3 — "Prove it and scale it" (months 12–18)
- Channel P&L and full attribution
- Multi-site / group consolidation
- Reporting suite + scheduled reports
- Aftercare engine (MOT/service reminders, finance end-of-term, review requests)
- AML/ID verification (Yoti/Onfido/Credas), cash threshold monitoring
- Sage integration; supplier/purchase ledger export
- Warranty/GAP integrations
- Public REST API + webhooks
- Reseller/white-label mode

### Release 4 — "Be indispensable" (months 19–30)
- Stock funding reconciliation
- Sourcing intelligence (buy-vs-skip scoring, auction watchlists)
- Workshop module (internal recon + light retail service)
- Benchmarking data product
- Second market entry (Ireland → Netherlands)

### Explicitly parked
Full retail workshop DMS · parts inventory · OEM/franchise integrations · replacing the accounting ledger · consumer-facing marketplace of our own.

---

## 9. Metrics

**Company (monthly board pack):** ARR, net new logos, logo churn, NRR, blended ARPU, CAC, payback, gross margin, activation rate (tenant reaches 10 live vehicles + 1 sale within 21 days), support tickets per tenant.

**Product health:** DAU/tenant, mobile session share, time-to-list a new vehicle (target < 6 minutes from reg entry to live on website), feed error rate, p95 API latency, public site LCP p75.

**Customer value (the numbers we put in front of the dealer):** average days to sell (vs their baseline and vs cohort), days in prep, gross profit per unit, finance penetration %, lead response time, cost per sale by channel, stock aging over 60/90 days.

**North Star:** **£ of gross profit transacted through the platform per tenant per month.** It captures volume, margin and finance penetration in one number, and it is the number the dealer cares about.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Auto Trader restricts or prices out API/feed access | **High** | Never be single-channel dependent. Ship Motors/CarGurus/Meta/Google feeds early. Position own-website traffic as the hedge. Maintain a manual export fallback. |
| cap hpi / provenance data contracts are slow and expensive | High | Launch on an aggregator (One Auto API or similar) for speed; negotiate direct Solera contract (cap hpi + HPI Check together) once volume justifies it. |
| We get compliance wrong and a dealer is penalised | **Critical** | Retain a motor-trade compliance consultant and a VAT specialist on advisory retainer *before* launch. Every compliance feature carries an "informational, not advice" disclaimer plus a documented source citation. Independent review before each compliance release. |
| Motor finance redress scheme timeline slips or changes (**partially suspended by the Upper Tribunal since early July 2026**; hearing expected Dec 2026–Feb 2027) | Medium | Build the evidence ledger to be scheme-agnostic — capture facts, not scheme-specific fields. Hold all scheme parameters as versioned data. Never state the deadlines to a dealer as settled. Track FCA publications quarterly. |
| CONC 3.5.3R changes under FCA CP26/15 (representative example possibly simplified or removed; 51% threshold possibly raised to 66%) | Medium | The `<FinancePromotion>` primitive stays; its required field list becomes configurable rule data rather than a fixed structure. |
| Incumbents cut prices or copy features | Medium | Our moat is design velocity + compliance depth, not features. Keep shipping. |
| Long sales cycles / dealers won't switch mid-quarter | Medium | Free parallel running, free migration, monthly rolling contracts. Remove every reason to say "not now." |
| Multi-tenant data leak between dealers | **Critical** | Postgres row-level security + tenant-scoped ORM + automated cross-tenant leak tests in CI. See `03-architecture-and-data-model.md` §5. |
| Building too much before selling anything | High | 8 design partners paying attention before Release 1 ships. Nothing ships that a named dealer hasn't asked for. |

---

## 11. What I need from you next (the CEO's asks)

1. **Recruit the 8 design partners before the architecture is finalised.** Nothing here survives contact with a real stock book unchanged.
2. **Get the compliance advisers on retainer now.** A motor-trade FCA compliance consultant and a VAT specialist. Budget £1.5–3k/month. This is the cheapest insurance in the plan.
3. **Start the data conversations immediately** — cap hpi/Solera, an aggregator for launch, Auto Trader technology partner status. These take months, not weeks, and they gate Release 1.
4. **Validate the two unverified numbers** in the research: typical independent stock size, and stocking finance rates. Both feed pricing tiers.
5. **Buy the domain and name properly.** "Forecourt" is a working name — check trade marks in class 9/42 and .co.uk availability before we print anything.

---

## Appendix A — Source notes and confidence

*All load-bearing regulatory claims in this document set were independently fact-checked against primary sources (legislation.gov.uk, gov.uk, fca.org.uk, ICO, DVSA) in August 2026. Four corrections were applied: the AML threshold currency, DVLA trade licence fees, the CRA s.22 subsection citation, and the operative status of the redress scheme. Claims that could not be verified are labelled below.*


**Verified (company-published or reputable trade press):** Auto Trader ARPR £2,854/mo and ~14,013 forecourts (FY25 results); IMDA survey ~70% downgrade figure and Auto Trader's confirmed 59 cancellations / 70 downgrades; Auto Trader CEO's "we know we are not cheap" quote; cap hpi days-to-sell 52 (independents) vs 32 (supermarkets); IBISWorld 15,517 UK used-car businesses; challenger pricing (Vehiso £0–£199, MotorDesk £79+VAT, TraderWay £39–£79, Car Dealer 5 £44–£110+VAT); FCA PS26/3 published 30 March 2026 with ~12.1m agreements in scope, ~£9.1bn total cost, ~£829 average payout, firm implementation deadlines 30 June 2026 and 31 August 2026, consumer complaint longstop 31 August 2027; Supreme Court judgment 1 August 2025 in *Hopcraft/Johnson/Wrench*.

**Unverified / needs primary research:** average independent stock size (~20–40 assumed, no primary source); stocking finance interest rates and fees (no public UK figures found); Auto Trader per-vehicle weekly rates (£8.50–£11.50+VAT, single third-party source); eBay Motors Group ~£169+VAT/20 cars (single third-party source); Dragon2000 "£99.95 per feature/month" (Capterra listing, unusual structure, unconfirmed); prevalence of long lock-in contracts among incumbents (inferred from challenger marketing).

**Live and changing (recheck before launch):**
- **The FCA motor finance redress scheme is partially suspended.** The Upper Tribunal partially suspended it on/around 1–2 July 2026 pending challenges from Consumer Voice, Mercedes-Benz FS, VW FS and Crédit Agricole Auto Finance. A hearing is expected December 2026 – February 2027; payouts would begin in 2027 if upheld. The PS26/3 deadlines are published but not currently operative — never present them to a dealer as settled.
- **FCA CP26/15** (April–June 2026) proposes simplifying or removing the CONC 3.5.3R representative-example requirement and revisiting the 51% representative-APR threshold. Final rules expected later in 2026.
- **The AML High Value Dealer threshold moved from €10,000 to a fixed £10,000 sterling on 30 June 2026.**
- **DVLA trade licence fees are now £97.35 (6 months) / £177 (12 months)** — earlier figures of £90.75/£165 are stale.
- Google has sunset free organic vehicle listings in favour of paid Vehicle Ads (UK open beta); Percayso Vehicle Intelligence relaunched February 2026.

### Sources

- [Auto Trader FY25 results](https://plc.autotrader.co.uk/media/umddcnxx/full-year-press-release-fy25.pdf)
- [Auto Trader defends its pricing — Car Dealer Magazine](https://cardealermagazine.co.uk/auto-trader-defends-its-pricing-as-bosses-deny-deal-builder-is-responsible-for-falling-share-value/320741)
- [IMDA claims 165 dealers cancelled Auto Trader — Car Dealer Magazine](https://cardealermagazine.co.uk/imda-claims-165-dealers-have-cancelled-auto-trader-in-wake-of-deal-builder-roll-out/320444)
- [Autotrader responds to Deal Builder criticism — AM-Online](https://www.am-online.com/news/autotrader-responds-to-deal-builder-criticism-after-facing-threat-of-mass-cancellations)
- [FCA PS26/3 — Motor Finance Consumer Redress Scheme](https://www.fca.org.uk/publications/policy-statements/ps26-3-motor-finance-consumer-redress-scheme)
- [Supreme Court judgment in Hopcraft appeals — Norton Rose Fulbright](https://www.nortonrosefulbright.com/en/knowledge/publications/8ddc6b59/supreme-court-judgment-in-hopcraft-appeals)
- [FCA legal challenges tracker — Foot Anstey](https://www.footanstey.com/our-insights/articles-news/the-fca-faces-legal-challenges-to-its-motor-finance-redress-scheme-what-is-the-latest/)
- [Used car dealers faced forecourt slowdown — Car Dealer Magazine](https://cardealermagazine.co.uk/used-car-dealers-faced-forecourt-slowdown-while-competition-for-stock-increases/319690)
- [IBISWorld — UK used car dealers, number of businesses](https://www.ibisworld.com/united-kingdom/number-of-businesses/used-car-light-motor-vehicle-dealers/2576/)
- [Vehiso pricing](https://www.vehiso.com/car-dealer-website-providers)
- [MotorDesk / TraderWay / Car Dealer 5 pricing comparisons](https://traderway.co.uk/blog/car-dealer-website-costs-uk)
