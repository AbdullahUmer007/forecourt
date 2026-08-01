# Forecourt — Competitive Strategy vs DealersHub

**Version:** 1.0 — August 2026
**Status:** supersedes the pricing section (§6) and parts of the competitive section (§4) of `01-product-strategy.md`
**Why this exists:** DealersHub is our named direct competitor and holds a live target account (Kennington Car Sales). This document is the refined plan against them.

---

## 1. The headline

DealersHub is not a strong product. It is a **templated website builder with a light DMS bolted on**, sold at £120+VAT/month by a company that is 16 months old. Its weakness is not opinion — it is measurable, on its customers' live sites, today.

**But it is winning, and we are not, because it exists and we don't.** That asymmetry is the only thing that matters right now, and it changes what we build first and how we sell.

The refined strategy in one line:

> **Build the audit before you build the product.** Because DealersHub runs one templated platform across every customer, every one of its dealer sites fails in exactly the same way. Fingerprint the platform, audit the estate, and you have a pre-qualified prospect list where you already know what's broken before the first phone call.

---

## 2. What DealersHub actually is

### 2.1 Company

| Fact | Detail | Source confidence |
|---|---|---|
| Legal entity | **AS INTELLIGENCE LTD**, t/a Dealers Hub | Verified (their own privacy policy) |
| Company number | **15647846** | Verified (Companies House) |
| Incorporated | **15 April 2024** | Verified (Companies House) |
| Registered office | 84a Ford End Road, Bedford MK40 4JX | Verified |
| Directors | **One** — Ather Shahzad, appointed 15 April 2024 | Verified |
| SIC codes | 62012 software development, 62020 IT consultancy, 82990 business support | Verified |
| Funding | None found | No evidence either way |
| Parent/sibling | AS Intelligence — a general Bedford software/web agency. DealersHub appears to be one product line of it | Verified (shared API host `api.asintelligence.co.uk` serves customer sites) |
| Earliest web archive | **6 September 2025** | Verified (Wayback availability API) |
| Third-party reviews | **None found anywhere** — no Trustpilot, G2, Capterra, LinkedIn company page, forum mentions, or trade press | Verified by absence |
| Marketing claim | "12 Years Excellence and Counting", "Since 2012", "+12k Deals done in 12 years" | Verified as their published claim |

### 2.2 On the tenure discrepancy — how to handle it

The published claim of twelve years' trading sits against a company incorporated in April 2024 and a website first archived in September 2025. There may be an innocent explanation — prior trading through a different entity, a founder's personal industry experience being expressed as the company's, an acquired book of business. We have not found one, but we have not disproved one either.

**How to use this: as qualification intelligence, not as an attack line.**

- ✅ **Do** use it internally to assess how durable the competitor is, how much roadmap investment a customer can expect, and what the business-continuity risk is for a dealer whose live inventory feed and website sit on a single-director company's infrastructure.
- ✅ **Do** compete on the *verifiable trust signals they structurally lack*: published pricing with no consultation gate, named case studies with real dealer names and links, a public Trustpilot profile, a public uptime/status page, a published data-portability charter, a named support SLA, and more than one person on the About page.
- ❌ **Do not** put "our competitor is lying about being 12 years old" in a pitch deck, an email, or on the website. It is legally risky, it makes us look like the aggressor, and — most importantly — it makes the conversation about them instead of about the dealer's broken vehicle pages. Let the dealer discover Companies House themselves; they will, because everyone in this trade checks.

The one acceptable framing, if a prospect raises longevity: *"We publish who we are, who our customers are, our prices, our uptime and our data-export policy. We'd encourage you to check any supplier — including us — on Companies House before you hand over your website."* That is fair, defensible, and lands harder than an accusation.

### 2.3 Product

**What they have:** dealer website (22 themes), stock management, leads/CRM, invoicing with templates, VAT reporting, PDI sheets, test-drive booking and calendar, deposit/payment via Stripe, finance integration (CarFinance247, CodeWeavers), reviews module, marketplace sync (Auto Trader incl. Deal Builder, CarGurus, Motors, eBay, Carwow, Gumtree, Facebook, Instagram, Google Vehicle Ads), AI chatbot and AI description/image assistance, role-based team management, 5 email accounts.

**What they do not have — nowhere claimed on their site:**

| Gap | Why it matters |
|---|---|
| **HPI / provenance checking** | Motor Ombudsman code expects a provenance check on every used vehicle. Not a feature. |
| **Accounting integration** — Xero, Sage, QuickBooks all absent | Every dealer has an accountant. This means manual re-keying every month. |
| **A real VAT margin stock book** | "VAT reporting" and "VAT margin calculations" are claimed; the 12 mandatory HMRC stock-book fields are not. |
| **Prep / reconditioning management** | The single biggest days-to-sell lever in a dealership. Absent entirely. |
| **Pricing intelligence / valuations** | CAP and Glass's are named once in generic services copy and appear nowhere in the product description. |
| **Cost and true-margin tracking per unit** | Cannot answer "what did I actually make on that car?" |
| **E-signature** | Mentioned once in services copy; not a product feature. |
| **Mobile app** | None. Responsive web only. |
| **Structured data / SEO tooling** | The word "SEO" doesn't appear in their feature list. It shows (§3). |
| **Compliance evidence** | No Consumer Duty capture, no commission disclosure ledger, no consent records. |

**Commercials:** one published tier, **£120+VAT/month** or £1,200+VAT/year. No published contract length, notice period or setup fee — their terms page 404s. Final price is set "during your consultation", so it is effectively quote-based. No free trial advertised, no self-serve signup, no tier comparison.

**Delivery model:** customer sites are served from a shared platform (`sites.dealershub.co.uk/?theme=N`), assets and stock API from `api.asintelligence.co.uk`. All 22 theme demos share one fictitious dealer identity — same address, same phone, same VAT number, same FCA number. There is no case-studies page, and every testimonial on their homepage is a bare first-and-last name with no dealership, no location and no link.

---

## 3. The evidence: what a real DealersHub customer gets

We audited **Kennington Car Sales** (kenningtoncarsales.co.uk, ~120 cars, Milton Keynes, 4.8★ from 252 reviews, FCA FRN 993469) — a live DealersHub customer on theme 21, and one of our named target accounts.

The findings are not stylistic. They are structural, and they are almost certainly identical on every other site the platform runs.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Zero vehicle pages in the sitemap.** 27 URLs, all static pages, none of the ~120 cars. | `/sitemap.xml` |
| 2 | **Vehicle URLs are query-string IDs**, not slugs: `/get-car-details?stockId=50111` | Live |
| 3 | **Every indexed vehicle page tested returns "This Vehicle is Sold Out"** — a 200 response, no redirect, self-canonical, carrying the homepage's title and meta description. Four sampled, all identical. | Live |
| 4 | **Make × location landing pages are indexed by Google but 404** — `/used/audi/milton-keynes/`, `/used/bmw/1-series/`, `/used/land-rover/luton/` and others. | Live |
| 5 | **No JSON-LD structured data anywhere** — no `Vehicle`, `Car`, `Product`, `Offer`, `AutoDealer` or `LocalBusiness` schema on any page. | Live |
| 6 | **`robots.txt` points the Sitemap directive at a dev subdomain** — `dev.kenningtoncarsales.co.uk/sitemap.xml`, which resolves publicly. | `/robots.txt` |
| 7 | **`robots.txt` leaks the platform** — the file contains the comment `# robots.txt for DealersSite` and `Disallow: /StockData/`. | `/robots.txt` |
| 8 | **No finance payment or APR anywhere on the site.** No calculator, no "from £X/month", nothing — despite nine lender logos on the homepage and an active FCA credit-broking permission. | Live |
| 9 | **Compliance documents are PDFs, not pages.** Initial Disclosure, Complaints Procedure, Commission Disclosure all live at `/theme21/Kennington-PDF/…`; several of the corresponding HTML routes 404. One filename is misspelled ("Disclousre"). | Live |
| 10 | **Stock/data sync bug.** The PDF spec-sheet generator returned a live, current-dated listing for stock 86415 while the customer-facing page for the same ID showed "Sold Out". | Live, reproducible |
| 11 | **No MOT history, no provenance badge, no video, no 360, no reserve-online, no similar vehicles** on vehicle pages. | Live |
| 12 | **No monthly-payment filter**; results page is JS/AJAX-dependent against `/StockData/`. | Live |

**The commercial translation, for the dealer:** a 120-car forecourt where Google cannot find a single car, and where the only vehicle pages Google *has* found all say "sold out". And an FCA-authorised credit broker with nine lenders on its panel and no way for a customer to see a monthly payment.

Item 8 is the one that pays for us. See §5.

---

## 4. Refined positioning

### 4.1 What changed in our thinking

The original strategy positioned Forecourt against *incumbent legacy DMS vendors* and Auto Trader. That's still true for the wider market, but the immediate fight is different and narrower.

| Original assumption | Revised |
|---|---|
| We compete on being modern vs 20-year-old software | We compete on **provable defects in a live product**, verifiable in five minutes by the dealer |
| Compliance is the moat | Compliance is the moat **for retention**; **SEO and finance conversion are the moat for acquisition** — they are visible, quantifiable, and the dealer feels the loss immediately |
| Target £229/month Pro tier | The real band for this tier is £39–£220. Price against DealersHub's £120+VAT, **above it**, and justify it with revenue the dealer can count |
| GTM is outbound to Auto Trader defectors | GTM is **platform-fingerprint prospecting** — find every site running a competitor platform, audit it automatically, lead with the audit |

### 4.2 Positioning statement (revised)

> **For independent used-car dealers who are paying for a dealer website that Google can't find and customers can't finance, Forecourt is the dealership platform that makes every car on your forecourt a page that ranks, a payment a customer can afford, and a deal you can prove you did properly — with your data yours to take, always.**

### 4.3 The four things we sell, in order of what wins the meeting

1. **"Google cannot see your cars."** Sitemap, schema, slugs, sold-vehicle handling, indexed 404s. Show them the audit. This is undeniable and it makes them angry at their current supplier, which is the emotion that closes a switch.
2. **"You're an FCA credit broker with nine lenders and no way to show a monthly payment."** Compliant finance display, soft-search eligibility, and the finance journey. This one has a pound sign attached (§5).
3. **"You can't answer what you actually made on that car, or what HMRC will ask for."** True cost per unit, prep pipeline, VAT margin stock book, deal evidence. This is what stops them leaving us later.
4. **"Your data is yours."** Published portability charter, free export, free migration out. Nobody in this tier offers it; one competitor explicitly says the opposite.

### 4.4 What we will not compete on

Commoditised across the whole tier, free or near-free everywhere, and not worth a single slide: marketplace feed syndication, responsive templates, AI-generated descriptions, basic lead forms, SSL and hosting, free trials. We must *have* all of these on day one — see the table-stakes list in `01-product-strategy.md` §4.2 — but they win nothing.

---

## 5. The Kennington business case (and the template for every pitch)

This is how we put a pound figure on the pitch. **All assumptions are labelled; validate each with the dealer in the meeting rather than asserting them.**

**Known:** ~120 cars in stock. Mixed stock, budget to ~£20k+ EVs. 4.8★ from 252 reviews. FCA-authorised credit broker, nine-lender panel. Currently paying DealersHub £120+VAT ≈ **£144/month inc VAT**.

**Assumed (to confirm with the dealer):** ~45 units sold per month; average finance commission ~£400 per financed deal; current finance penetration low, because there is no finance tooling on the website at all.

**Line 1 — Finance conversion.** Adding a compliant on-site finance calculator with soft-search eligibility typically lifts finance penetration. Take a deliberately conservative **+5 percentage points** on 45 units = **2.25 extra financed deals/month × £400 = ~£900/month**. That is **6× the entire DealersHub subscription**, from one feature they don't have.

**Line 2 — Organic search.** Currently: zero of 120 vehicles in the sitemap, no structured data, query-string URLs, and every indexed vehicle page showing "Sold Out". We will not invent a traffic number. The honest pitch is the fact itself: *"You have 120 cars and Google has zero of them indexed as available. Every vehicle page it has found says sold out. Whatever that's worth to you, it is currently worth nothing."* Then offer to measure it: install analytics, publish proper VDPs, and report the delta at 90 days.

**Line 3 — Days to sell.** Independents average ~52 days versus ~32 for car supermarkets (cap hpi). On 120 cars at, say, £10,000 average cost and ~8% annualised stocking cost, **each day of average stock turn costs roughly £260 across the forecourt per day of improvement per year** — five days off average turn is meaningful money. Frame as a measured commitment, not a promise: capture their baseline in the first 30 days and report against it.

**Line 4 — What they stop losing.** No provenance check surfaced on any vehicle page despite performing HPI checks (per their Auto Trader profile). No MOT history shown despite it being free public data. Both are pure trust-building content they already own and currently waste.

**The close:** *"You're paying £144 a month. We're £249 for your stock level. The extra £105 needs to find you one financed deal every four months to pay for itself. We think it finds you two a month. And if it doesn't in 90 days, we'll hand you your data and your domain and you can walk — no notice period."*

---

## 6. Revised pricing and packaging

Supersedes `01-product-strategy.md` §6.

### 6.1 The market band (verified, August 2026)

| Segment | Real price band | Who's there |
|---|---|---|
| Website only | £39–£100/mo | TraderWay Launch £39, Car Dealer 5 Responsive £44+VAT, Autoweb ~£100 |
| Website + stock | £49–£150/mo | Vehiso £49–£79, TraderWay Growth £59, MotorDesk £149 |
| Website + full DMS | £77–£220/mo | Car Dealer 5 Symphony £110+VAT (+£110 setup), **DealersHub £120+VAT**, Vehiso Business/Ultra £149–£199 |
| DMS-first | £199–£899/mo | DMS Navigator £199–£899 |

### 6.2 Our tiers

Published on the website. No setup fee. No contract. No notice period.

| | **Forecourt Site** | **Forecourt Pro** | **Forecourt Group** |
|---|---|---|---|
| For | Under 30 cars | The core product | 2–8 sites |
| **Price** | **£89/mo** | **£189/mo** ≤60 live vehicles<br>**£249/mo** 61–120<br>**£319/mo** 121–250<br>250+ POA | **£159/site + £249 platform** |
| Users | 3 | Unlimited | Unlimited |
| Website + themes | ✓ | ✓ full theme control | ✓ per site + group site |
| Marketplace feeds | Auto Trader + 1 | All | All |
| Stock, leads, CRM | ✓ | ✓ | ✓ |
| Invoicing & payments | ✓ | ✓ | ✓ |
| **VAT margin stock book** | ✓ | ✓ | ✓ |
| **Deal Evidence Ledger** | ✓ | ✓ | ✓ |
| **Compliant finance journey** | ✓ | ✓ | ✓ |
| DVLA + MOT lookups | 50/mo included | Unlimited fair use | Unlimited fair use |
| Provenance checks | at cost | at cost, 10 included | at cost, 25 included |
| Prep pipeline | — | ✓ | ✓ |
| Pricing intelligence | — | ✓ | ✓ |
| Channel P&L | — | ✓ | ✓ |
| Accounting sync | — | ✓ | ✓ |
| Multi-site consolidation | — | — | ✓ |
| Support | Email | Email + phone | Named CSM |

**Why priced above DealersHub, not below.** In a tier this commoditised, undercutting signals a worse product and starts a race we cannot win against a one-person operation with near-zero costs. £249 for a 120-car dealer against their £144 is a £105 gap that one financed deal every four months covers. We sell the gap, not the price. Anyone who will only buy on price is not a customer we want — they will churn to the next £39 product.

**Compliance is in every tier, including the £89 one.** It is our moat and it only works as a moat if it's universal and credible.

### 6.3 Transactional revenue (year 2+)

Unchanged in principle from `01-product-strategy.md` §6.3 and now more important, because it is how we out-earn a cheaper competitor without out-pricing them: finance commission share, provenance checks resold at a small margin, payment platform fee, warranty/GAP marketplace (under strict fair-value governance), and anonymised market intelligence.

Target blended ARPU: £205 (yr 1) → £340 (yr 2) → £460 (yr 3).

### 6.4 The two published guarantees

These are the marketing assets. Nobody in this tier has either, and one competitor explicitly states the opposite of the first.

**1. The Data Portability Charter.**
> Your domain is registered in your name. Your stock data, customer records, photographs and documents are exportable in full, in a documented format, self-serve, at any time, without asking us. If you leave, we will help you migrate out for free and we will keep your old vehicle URLs redirecting for 12 months so you don't lose your search rankings. We will never hold your business hostage.

Context that makes this land: at least one competitor in this tier states in its own FAQ that the website code, stock system and dealer admin area "are not transferred to another provider."

**2. The 90-Day Switch Guarantee.**
> We build your new site alongside your current one, free. We migrate your stock, your photos, your customers and your URLs, free. You keep running both for as long as you want. If after 90 days live you are not better off, you leave — no notice, no fee, and we hand you everything.

This removes every rational objection to switching. It costs us almost nothing because the migration is automated (see §7.2) and because a dealer who is better off does not leave.

---

## 7. Go-to-market: the displacement playbook

### 7.1 The strategic insight

DealersHub runs **one templated platform** across every customer. So does every competitor in this tier. That means:

- Their defects are **identical on every customer site**
- Those sites are **fingerprintable from the public internet**
- One audit engine prospects the **entire customer base of a competitor at once**

This turns cold outbound into warm, evidenced outbound at near-zero marginal cost.

### 7.2 Build this first: the Forecourt Dealer Site Audit

**Before the CRM. Before the stock list. This is the first thing we ship**, as a free public tool at `forecourt.co.uk/audit` where any dealer enters their domain and gets a scored report in 60 seconds.

**What it checks:**

| Check | Fail condition |
|---|---|
| Vehicles in sitemap | Sitemap contains 0 vehicle URLs |
| Vehicle URL structure | Query-string IDs rather than descriptive slugs |
| Sold-vehicle handling | Sold pages return 200 with duplicate title/meta and no redirect |
| Indexed 404s | URLs in Google's index returning 404 |
| Structured data | No `Vehicle`/`Car`/`Product`/`Offer`/`AutoDealer`/`LocalBusiness` JSON-LD |
| Per-vehicle titles and meta | Vehicle pages sharing the homepage's title |
| **Finance compliance** | A monthly payment or APR displayed **without** a complete CONC 3.5.3R representative example — **or** no finance display at all, flagged as lost conversion |
| FCA disclosure | No credit-broker statement or FRN discoverable as HTML |
| Legal pages | Compliance documents PDF-only, or HTML routes 404 |
| MOT history | Free public MOT data not displayed |
| Provenance | No provenance/HPI trust signal on vehicle pages |
| Core Web Vitals | LCP > 2.5s, CLS > 0.1, INP > 200ms on a sampled vehicle page |
| Image formats | No AVIF/WebP |
| robots.txt hygiene | Sitemap directive pointing at a non-production host; platform leakage |
| Mobile CTAs | No `tel:` link, no WhatsApp, no sticky mobile CTA |

**Output:** a score out of 100, the failed checks in plain English with what each one costs in commercial terms, and a "here's what it looks like fixed" side-by-side. Emailed as a PDF in exchange for a name — that's the lead.

**Why this is the right first build:**
- It is a lead-generation machine that works before we have a single customer or a single case study
- It is a **credibility demonstration** — it proves we understand this better than their current supplier, which is the whole pitch
- It is the **product demo** — the fixes are literally our feature list
- It costs a fraction of the CRM to build
- It doubles as our own regression suite: every check becomes a CI gate on the sites we build (see the performance budgets in `04-design-system.md` §6.4)

### 7.3 Platform fingerprinting — building the prospect list

Identify every site running a competitor platform and audit them all. Known fingerprints:

| Signal | Platform |
|---|---|
| `robots.txt` containing `DealersSite` | DealersHub |
| URL pattern `/get-car-details?stockId=` | DealersHub |
| Assets served from `api.asintelligence.co.uk` | DealersHub |
| Path segments `/themeNN/` | DealersHub |
| `Disallow: /StockData/` | DealersHub |
| Google: `inurl:get-car-details stockId` | DealersHub estate |

Build the same fingerprint set for Vehiso, MotorDesk, TraderWay, Car Dealer 5 and Click Dealer. Combine with dealer directories (Auto Trader retailer pages, AA Cars, Motors dealer lists) and Companies House SIC 45112 to build a national list of independent dealers with their platform tagged.

**Then:** audit every one, rank by (stock size × severity of failures), and work the list. Each dealer gets a specific, evidenced first contact — not a cold pitch.

> ⚠️ **Do this properly.** Respect `robots.txt` and rate limits, identify our crawler honestly with a contact URL, only ever fetch publicly available pages, and never store personal data from these sites. A polite, identified, rate-limited crawler of public dealer websites is normal commercial practice; anything else is not, and would be a terrible look for a company selling compliance.

### 7.4 The first contact

Not a pitch. An audit, sent free, with no ask.

> **Subject: 120 cars, and Google can't see any of them**
>
> Hi [name],
>
> I run [Forecourt]. We build software for independent dealers, and we've been auditing dealer websites across the UK.
>
> I ran yours. Three things you'll want to know, regardless of whether you ever speak to us:
>
> 1. Your sitemap has 27 pages in it and none of them are cars. All ~120 of your vehicles are invisible to it.
> 2. Every vehicle page of yours that Google *has* indexed shows "This Vehicle is Sold Out" — including cars I think you're still selling.
> 3. Your `robots.txt` is telling Google to look at `dev.kenningtoncarsales.co.uk`, which is your development site.
>
> Full report attached, including the finance point, which I think is the expensive one.
>
> You don't need us to fix these — your current supplier can, and you should ask them to. If you'd rather someone just did it, I'm happy to show you what your stock looks like on our platform. No charge either way.
>
> [name]

That email is honest, specific, immediately verifiable, and impossible to ignore. It also works whether or not they switch — it builds the reputation that makes the next twenty easier.

### 7.5 Sequence

| Phase | Target | Focus |
|---|---|---|
| **0. Audit** (months 0–2) | Ship the audit tool. Fingerprint and audit 500 UK independent dealer sites. | Prospect list + credibility + the first 20 conversations |
| **1. Design partners** (months 1–5) | 8 dealers, free for 12 months, real data, public case study. **Kennington is target #1** — they're 120 cars, they have a named list of defects, and they're a reference account in a real town. | Build with them in the room |
| **2. Founding cohort** (months 5–11) | 50 paying dealers, sold personally, audit-led | Proof, reviews, case studies |
| **3. Scale** (months 11–24) | 400 dealers | Self-serve Site tier, inside sales, referrals |

### 7.6 The trust signals we ship on day one

Because these are exactly what the competition structurally lacks, and they cost us almost nothing:

- Published pricing, on the website, with no "book a call" gate
- A real About page with real people and real photographs
- A public Trustpilot profile, actively solicited from the first customer onwards
- Named case studies with the dealer's name, their logo, a link to their live site and a real quote
- A public status/uptime page
- The Data Portability Charter and the 90-Day Switch Guarantee, published as pages, not buried in T&Cs
- Actual terms and conditions that resolve (a 404 on a terms page is not a small thing when you're asking someone to trust you with their business)

---

## 8. Product implications — what moves in the roadmap

| Change | Rationale |
|---|---|
| **NEW: Dealer Site Audit tool ships before Release 1** | GTM engine, credibility, demo, and our own regression suite |
| **Promote SEO from a website feature to a headline product pillar** | It is the most visible competitor failure and the easiest to demonstrate |
| **Promote the compliant finance journey into MVP** (was Release 2) | It is the pitch with a pound sign; the competition has none |
| **Promote MOT history + provenance display on public VDPs into MVP** | Free data, high trust value, competitor doesn't show it |
| **Add "URL redirect preservation on migration" to MVP** | Underpins the Switch Guarantee; keeps the dealer's rankings intact |
| **Add named migration importers for DealersHub** to the MVP importer set | `/StockData/` and the PDF spec-sheet endpoint are both structured sources we can parse |
| **Keep prep, pricing intelligence and channel P&L in Release 2** | These are retention features, not acquisition features. Right where they are. |
| **Ship the public status page and portability export in MVP** | They are marketing assets, not engineering luxuries |

Revised MVP definition, in one sentence: *a dealer can be migrated onto Forecourt in a day, their stock is fully indexable with structured data and real slugs, every vehicle shows a compliant finance payment and its MOT history, and their VAT stock book and deal evidence are complete from day one.*

---

## 9. Risks specific to this fight

| Risk | Mitigation |
|---|---|
| DealersHub fixes the SEO and finance gaps once we start selling against them | They are structural (URL routing, sitemap generation, schema, a compliant finance component) and would need a platform rewrite across 22 themes. We have a lead measured in months, not weeks. Use it, and keep moving to the compliance and DMS depth they can't reach quickly. |
| We look like we're attacking a small competitor | Never mention them by name in any public material. Sell the dealer's own audit. The audit is about the dealer's site, not about a vendor. |
| A dealer shows our audit to DealersHub and they fix that one site | Good. We have 500 more audits and their platform is one template. Also, we've just proved our expertise to a dealer for free — that relationship is worth more than the objection. |
| We over-index on displacement and neglect the wider market | Displacement is the wedge, not the market. Auto Trader defectors, spreadsheet dealers and legacy-DMS switchers are all still in scope from `01-product-strategy.md` §7. |
| Our own site fails our own audit | Fail the build on it. Every check in the audit tool becomes a CI gate. Nothing would end us faster than a dealer running our audit on us. |
| Crawling dealer sites at scale draws complaints | Identified crawler, contact URL, respect robots.txt, rate limit, public pages only, no personal data stored, honour removal requests instantly. |

---

## 10. What I need from you next

1. **Build the audit tool first.** Six checks would be enough to start: sitemap vehicle coverage, structured data, sold-page handling, vehicle URL structure, finance-display compliance, and Core Web Vitals. Ship it in three weeks, not three months.
2. **Confirm the Kennington numbers** before pitching: units per month, current finance penetration, average commission, and what they actually pay DealersHub. Every figure in §5 marked "assumed" is a question for that meeting, not a claim to make in it.
3. **Register the two guarantees as published pages** and get the terms drafted properly. They are the differentiator and they need to be real.
4. **Decide the name and buy the domain.** "Forecourt" is still a working name — check trade marks in classes 9 and 42.
5. **Do not undercut on price.** The moment we compete on being cheaper than a one-person operation, we lose.

---

## Sources

**DealersHub:** [dealershub.co.uk](https://dealershub.co.uk/) · [pricing](https://dealershub.co.uk/pricing) · [features](https://dealershub.co.uk/features) · [DMS](https://dealershub.co.uk/dms) · [themes](https://dealershub.co.uk/themes) · [theme demos](https://sites.dealershub.co.uk/?theme=theme1) · [Companies House — AS INTELLIGENCE LTD 15647846](https://find-and-update.company-information.service.gov.uk/company/15647846) · Wayback availability API

**Kennington Car Sales:** [homepage](https://www.kenningtoncarsales.co.uk/) · [sitemap.xml](https://www.kenningtoncarsales.co.uk/sitemap.xml) · [robots.txt](https://www.kenningtoncarsales.co.uk/robots.txt) · [available stock](https://www.kenningtoncarsales.co.uk/available-stock) · [finance](https://www.kenningtoncarsales.co.uk/finance) · [initial disclosure PDF](https://www.kenningtoncarsales.co.uk/theme21/Kennington-PDF/KENNINGTON.Initial.Finance.Disclousre.IDD.pdf) · [Companies House 08384467](https://find-and-update.company-information.service.gov.uk/company/08384467) · [Auto Trader dealer profile](https://www.autotrader.co.uk/dealers/buckinghamshire/milton-keynes/kennington-car-sales-10036642) · [AA Cars profile](https://www.theaa.com/used-cars/dealers/kennington-car-sales-ltd-milton-keynes)

**Pricing benchmarks:** [Vehiso](https://www.vehiso.com/pricing/) · [MotorDesk](https://motordesk.com/pricing/) · [TraderWay](https://traderway.co.uk/pricing) · [Car Dealer 5](https://www.cardealer5.co.uk/packages_responsive.php) · [Car Dealer 5 FAQs (data portability)](https://www.cardealer5.co.uk/faqs.php) · [DMS Navigator](https://www.dmsnavigator.com/pricing) · [Autoweb Design](https://autowebdesign.co.uk/car-dealer-websites)
