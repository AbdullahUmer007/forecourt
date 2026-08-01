# Design brief — Forecourt

**Paste this whole document into Claude Design as your first message.** It is self-contained; you don't need any other file to start.

---

## Who you are and what you're designing

You are the product designer for **Forecourt**, a UK SaaS platform for independent used-car dealers. Two connected surfaces, one dataset:

1. **The Office CRM** — the system that runs the dealership: stock, reconditioning, pricing, leads, deals, motor finance, compliance, invoicing.
2. **The public dealer website** — a fast, brandable shopfront per dealer, driven by the same inventory with no re-keying.

We sell it on subscription: £89/month (under 30 cars), £189–£319/month (stock-banded, the core product), £159 per site for groups. Published pricing, no contract, free migration in and out.

**Our test dealer is real.** Kennington Car Sales in Milton Keynes — 120 cars, currently on a competitor platform. Their real details are in §4 and you should design against them, not against invented data. This is an internal demo build; mark any exported artwork "Demo — unsolicited".

---

## 1. The strategic point, so your design decisions have a reason

Our competitor's platform has these measurable failures on every dealer site it hosts, verified on Kennington's live site in August 2026:

- Their sitemap has 27 URLs and **not one is a car** — all 120 vehicles are invisible to Google
- Every vehicle page Google has indexed shows **"This Vehicle is Sold Out"**, carrying the homepage's title
- **No structured data anywhere** — no Vehicle/Offer/AutoDealer schema
- Vehicle URLs are `?stockId=50111`, not readable slugs
- **No monthly payment or APR anywhere on the site** — despite nine lender logos and an active FCA credit-broking permission
- No MOT history, no provenance badge, no video, no reserve-online, no similar vehicles

So the design has to demonstrably win on four things, in this order:

1. **Every car is a real, findable, beautiful page.** The vehicle detail page is the most important screen in the entire product.
2. **A compliant monthly payment on every car.** This is the revenue argument — but it is legally constrained (see §6). Design it right and it is our biggest differentiator.
3. **The dealer can see what they actually made, and prove they did it properly.** Margin, days-to-sell, compliance evidence.
4. **It's fast, and it works on a phone in the rain.**

---

## 2. The two personalities

| | **CRM (Office)** | **Public dealer website** |
|---|---|---|
| Who | Dealer principal, sales exec, buyer, prep coordinator, administrator | A car buyer, 3 minutes, on a phone |
| Where | Desk, forecourt, workshop, auction hall | Sofa, bus, lunch break |
| Priority | Density, speed, keyboard, information | Photography, clarity, trust, conversion |
| Personality | Calm, quiet, tool-like. The data is the only loud thing. | Confident, spacious, the car is the hero |
| Chrome | Minimal, recessive, ours | Minimal, brandable per dealer |

Never bring CRM density to the public site, or public-site spaciousness to a stock list.

---

## 3. Design principles

1. **The data is the only thing allowed to be loud.** Chrome is recessive, borders are hairlines, backgrounds near-white. Colour carries meaning, never decoration.
2. **Density is a feature.** A stock manager wants 30 rows on screen, not 8. Comfortable default plus a compact mode.
3. **The forecourt is muddy and one-handed.** 44px touch targets, primary actions in thumb reach, camera-first flows.
4. **Every number is traceable.** Any figure on a dashboard clicks through to the records that produced it.
5. **Empty states teach.** Every list's empty state shows the next action, not a shrug.
6. **Borders before shadows.** Four elevation levels, nothing else.
7. **Assume a 55-year-old dealer principal who is brilliant with cars and impatient with software.** If it needs training, it's wrong.
8. **Would they be proud to show this to a customer over their shoulder?** That's the bar.

---

## 4. The test dealer — Kennington Car Sales

Real, public data. Design against this.

**Business:** Kennington Car Sales Limited, 32–36 Aylesbury Street, Bletchley, Milton Keynes MK2 2BA. Trading since 2013. Roughly **120 cars in stock**.

**Reputation:** 4.8 ★ from 252 reviews (167 Google, 85 Auto Trader). AA Approved Dealer. Claims 97% satisfaction, 1,836 happy customers.

**Contact:** Sales 07477070105 / 01908 883940 · After-sales 01908 050699 · WhatsApp 447477070105. Open seven days — sales Mon–Sat 10:00–18:00, Sun 11:00–16:00; after-sales Mon–Sat 09:00–17:00, Sun 11:00–16:00.

**Regulatory:** FCA-authorised credit broker, FRN 993469. Credit broker, not a lender. Limited lender panel, not whole-of-market.

**Lender panel (nine):** Advantage Finance, Blue Motor Finance, CarMoney, Close Brothers, DSG Finance, First Response, Mallard, MotoNovo, Zopa.

**Stock mix:** budget to premium, roughly £6,500–£20,000. Makes seen: Audi, BMW, Citroën, Fiat, Land Rover, Lexus, SsangYong, Tesla, Volkswagen, Volvo. Mainstream hatchbacks and saloons through to hybrid and electric.

**Aftercare products they sell:** 6-month nationwide warranty (standard) + 1 year AA breakdown cover, extended warranty, paint protection, underbody protection, tyre protection, service plans.

### A real vehicle to design the pages around

Use this exact car for every vehicle-detail mockup:

| Field | Value |
|---|---|
| Vehicle | 2022 Tesla Model X Dual Motor Long Range |
| Registration | WN22HNL |
| Price | £19,999 |
| Mileage | 40,470 |
| Fuel | Electric |
| Transmission | Automatic |
| Owners | 1 from new |
| Keys | 2 |
| MOT expires | 17 February 2027 |
| Battery health | 93.2% |
| Warranty | 6 months nationwide + 1 year breakdown cover |
| Indicative finance | £289/month, 60 months, £2,000 deposit, 12.9% APR representative — *see §6, this cannot be shown alone* |

Design a second, contrasting car too — something like a £7,495 2017 Volkswagen Polo 1.2 TSI Match, 62,000 miles, petrol, manual, 3 owners — so the layouts are tested at both ends of their range.

---

## 5. Design tokens — use these exactly

Do not invent colours. These are validated for contrast and colour-vision deficiency in both light and dark modes.

### Brand — "Petrol"
```
brand-50    #E6F4F1   tinted backgrounds, selected rows     (dark: #0A2E38)
brand-100   #C7E5E1   hover wash                            (dark: #0B3A47)
brand-300   #5EC7DC   dark-mode accent text                 9.03:1 on dark surface
brand-600   #0E5A6B   PRIMARY actions, links                7.80:1 on white
brand-700   #0B4553   hover / pressed                      10.55:1 on white
```

### Accent — "Signal Amber", used sparingly
```
accent-500  #F59E0B   fills, one high-emphasis CTA per view
accent-700  #B45309   text on light                         5.02:1
```

### Neutrals — 90% of every screen
```
                     light        dark
surface-1  cards     #FFFFFF      #16181D
surface-2  page      #F8FAFC      #0E1013
surface-3  headers   #F1F5F9      #1D2027
border               #E2E8F0      #2A2E36
border-strong        #CBD5E1      #3A404A
ink        primary   #0F172A      #FFFFFF     17.85 / 17.76
ink-muted  secondary #475569      #94A3B8      7.58 /  6.93
ink-subtle meta      #64748B      #7A8598      4.76
```

### Status — fixed, never themed, **always with an icon AND a text label**
```
good      #0CA30C   ready, sold, published, in budget
warning   #FAB219   aging 60–90 days, SLA approaching
serious   #EC835A   aging 90+, feed failure, missing evidence
critical  #D03B3B   adverse provenance, compliance breach, payment failed
```
`warning` and `serious` are below 3:1 on white **by design** — the icon plus label is the mitigation. A status colour must never carry meaning on its own.

### Vehicle status map
`Sourcing`/`Purchased` slate · `In prep` warning · `Ready` brand-600 · `Live` good · `Reserved` violet `#4A3AA7` · `Sold` ink-muted · `Delivered` ink-subtle · `On hold` serious

### Charts — validated palette, fixed order, never cycled
```
slot 1 blue     #2A78D6  (dark #3987E5)
slot 2 orange   #EB6834  (dark #D95926)
slot 3 aqua     #1BAF7A  (dark #199E70)
slot 4 yellow   #EDA100  (dark #C98500)
slot 5 magenta  #E87BA4  (dark #D55181)
slot 6 green    #008300  (dark #008300)
slot 7 violet   #4A3AA7  (dark #9085E9)
slot 8 red      #E34948  (dark #E66767)
```
Rules: assign in fixed order, never cycle. Colour follows the entity, never its rank. **Never a dual-axis chart.** Sequential = one hue light→dark; diverging = blue↔red with a neutral grey midpoint; never a rainbow. Text never wears the series colour — labels and values use ink tokens, a coloured dot beside them carries identity. Legend always present for two or more series; direct labels for four or fewer; never a number on every point. Bars ≤24px thick with a 4px rounded data-end, lines 2px, markers ≥8px, 2px surface gap between touching marks. Gridlines hairline and solid, never dashed. Every chart has a table view.

### Typography
**Inter** variable throughout (system-ui fallback). **JetBrains Mono** for registrations, VINs, stock numbers and references. No display or serif face anywhere, including hero figures.

```
display  40/44  600   hero figure — exactly one per view (≥48px on public site)
h1       28/34  600
h2       20/28  600
h3       16/24  600
body     14/20  400
body-sm  13/18  400   tables, dense lists
caption  12/16  400   meta, helper
label    12/16  500 +0.02em   field labels, table headers — sentence case, never ALL CAPS
mono     13/20  400
```
`tabular-nums` only in columns that must align vertically. Large standalone numbers use proportional figures.

### Spacing, radius, motion
4px base scale (2/4/8/12/16/20/24/32/40/48/64). Radius: `sm 4px` badges and inputs, `md 6px` buttons and cards, `lg 10px` modals and panels, `full` avatars and pills. Motion: 100ms hover, 160ms dropdown, 200ms drawer, 240ms modal, easing `cubic-bezier(0.2, 0, 0, 1)`. Honour `prefers-reduced-motion` fully — no parallax, no scroll-jacking, no decorative animation in the CRM.

### Elevation
`flat` border only · `raised` `0 1px 2px rgb(15 23 42 / 0.06)` · `overlay` `0 8px 24px rgb(15 23 42 / 0.12)` · `modal` `0 24px 48px rgb(15 23 42 / 0.18)`. Nothing else.

---

## 6. The one hard constraint you must design around

**Any monthly payment, APR, deposit or cost-of-credit figure shown anywhere — website, CRM, advert, PDF, email — must be accompanied by a complete FCA representative example** (CONC 3.5.3R), containing: representative APR, the interest rate and whether it's fixed or variable, total amount of credit, other charges, cash price, advance payment/deposit, agreement duration, total amount payable, and the amount of each repayment.

Design a **`FinancePromotion` component** that makes this structurally impossible to get wrong: a payment figure and its representative example are one indivisible component, and there is no variant that renders a bare payment.

Your design challenge: make that compliant block **feel like a feature rather than small print**. On a card in a grid you have very little room. Solve it — this is the single highest-value design problem in the product, because the competition has no finance display at all and most dealer sites that do have it are non-compliant.

Also design a "Representative example" disclosure pattern that works at three sizes: a listing card, a vehicle detail page, and a printed order form.

---

## 7. What to design, in priority order

### Priority 1 — the public dealer website (this wins the deal)

1. **Vehicle detail page (mobile first, then desktop).** Above the fold on mobile, in this order: photo gallery (swipe, tap for fullscreen) → make/model/derivative → price and finance-from → key specs (year, mileage, fuel, transmission) → CTA row (Call · WhatsApp · Enquire · Reserve). Below: full gallery, description, full spec accordion, **MOT history with a mileage chart**, provenance badge, declared condition and damage photos, finance calculator, part-exchange widget, warranty and delivery, dealer trust block (reviews, AA logo, FCA disclosure), similar vehicles. Include a **sticky mobile CTA bar** that never scrolls away.
2. **Search results / stock listing.** Facets in a bottom sheet on mobile, left rail on desktop. Card grid and list toggle. Facet counts always shown, zero-count options disabled not hidden. Badges for "Just arrived" and "Reduced". A shortlist heart. **A monthly-payment filter.** And design the zero-results state properly — nearest matches plus "notify me when something like this arrives", never a dead end.
3. **Homepage** for Kennington — hero with search, featured stock, trust block with their 4.8★/252 reviews and AA approval, finance, part-exchange, why-us, location and hours.
4. **Part-exchange / value my car** flow — registration entry, confirm the car, mileage, condition, get an indicative figure.
5. **Reserve online** — the £99 deposit flow, three steps maximum.

### Priority 2 — the CRM

6. **App shell.** Top bar (logo, dealership switcher, site switcher, ⌘K search, + New, notifications, account), left nav collapsible to an icon rail. Nav groups: Today · Stock · Customers · Deals · Website · Reports · Compliance · Settings.
7. **Stock list** — the workhorse. Virtualised table with sticky header, saved views, filter chips, inline edit on price and status, bulk action bar, health-flag chips (`No photos`, `Aged 90+`, `Priced above market`, `Feed error`, `No provenance check`). Both a comfortable and a compact density. Plus a card/grid alternative.
8. **Vehicle record page** — sticky header with photo, reg plate, title, price, status, days in stock; tabs for Overview · Specification · Media · Advert & channels · Costs & margin · Prep · Pricing · Leads · Documents · History. Design the **History tab** as a single merged timeline — it's one of the most-loved features in a dealership and competitors don't have it.
9. **Owner dashboard, mobile.** Six tiles, no charts, readable at 7am on a phone: stock value at cost · units sold MTD vs target · average gross profit per unit · average days to sell with trend · overage stock 90+ days and capital tied up · leads today and response-time compliance.
10. **Sales manager dashboard, desktop.** One hero figure, a KPI tile row, at most four charts, and a "needs attention" list.
11. **Lead inbox** — three panes: filterable lead list, an interleaved multi-channel conversation (email, SMS, WhatsApp, call notes), and a right rail with the contact and vehicle cards. The composer switches channel inline.
12. **Prep board** — kanban with per-card SLA ring, blocked-state treatment, cost-so-far vs budget. Design the **mobile single-column mode with a stage picker** — a horizontally scrolling board is unusable in a workshop.
13. **Deal builder** — a wizard with a visible step spine, and a live margin panel that updates as the deal is built.
14. **Part-exchange appraisal, mobile.** The damage map is the interesting problem: a vehicle silhouette you tap to mark damage, then attach a photo and a cost per mark, usable with a gloved finger in a car park.

### Priority 3 — the wedge

15. **The free Dealer Site Audit report.** A public tool where a dealer enters their domain and gets a score out of 100 with failed checks in plain English. Design the report so it's shareable and slightly alarming without being smug. This is our lead-generation machine and often the first thing a prospect ever sees from us — it has to look like it came from people who know what they're doing.

---

## 8. Component library to establish

Primitives: Button (primary/secondary/ghost/destructive × sm/md/lg, loading, disabled) · Input · Select · Combobox · Checkbox · Radio · Switch · DatePicker · FileUpload · Currency input · **RegistrationInput** · Tooltip · Popover · Dropdown · Dialog · Sheet · Tabs · Accordion · Toast · Skeleton · Badge · **StatusBadge (icon + label, always)** · Chip · Pagination · Command palette · EmptyState · ErrorState · ConfirmDialog.

Domain components: **VehicleCard** (three densities) · **RegPlate** (proper UK plate, yellow rear and white front variants — car people notice this) · **PricePosition** gauge · **AgingBar** · **MOTTimeline** with mileage chart · **DamageMap** · **FinancePromotion** (§6) · **StatTile** (label sentence-case · value semibold auto-compact `£4.2M` · optional signed delta versus a *named* period with an arrow icon · optional 12-point sparkline) · **LeadThread** · **EvidenceTimeline** · **ChannelPnLTable**.

---

## 9. Accessibility — a build gate, not a review item

WCAG 2.2 AA throughout. Text contrast ≥4.5:1 (≥3:1 for large text), UI components and focus indicators ≥3:1. A visible focus ring on everything interactive: 2px `brand-600` at 2px offset. Persistent visible labels on every field — placeholders are not labels. Target size ≥24×24px minimum, ≥44×44px for mobile primary actions. Charts never rely on colour alone. Alt text on vehicle images generated from the vehicle data ("2022 Tesla Model X Long Range, front three-quarter view").

---

## 10. Performance budget — design within it

The public site is judged on these and the build fails if they're breached:

| Metric | Budget |
|---|---|
| LCP, p75 mobile 4G | < 2.0s |
| INP | < 200ms |
| CLS | < 0.1 |
| JS on the vehicle page | < 120KB gzipped |
| Above-fold page weight | < 500KB |
| Lighthouse Performance / Accessibility | ≥ 92 / 100 |

Practically: hero images must be sized and formatted for a real budget, skeletons must match final dimensions so nothing shifts, and no design should require a heavy JS library to render its first paint. If a design idea needs 300KB of JavaScript, it's the wrong idea.

---

## 11. Voice and vocabulary

Plain, direct, British. "Send quote", not "Initiate quotation workflow". Errors say what happened, why, and what to do — *"Couldn't publish to Auto Trader — their API rejected the mileage (must be a whole number). Fix the mileage and retry."* Never "An error occurred."

**Use the trade's words, always:** forecourt · part-exchange (part-ex) · reg or registration · V5C or logbook · MOT · prep or recon · HPI check · stock · unit · gross · days in stock · overage.
**Never:** lot · trade-in · license plate · detailing · inventory (in dealer-facing copy).

British spelling throughout: colour, tyre, licence (noun), organise.

---

## 12. What I want back

For each screen: a mobile and a desktop composition, in **both light and dark mode**, with the loading, empty and error states designed rather than assumed. Annotate anything where you've made a judgement call so I can argue with it.

Start with **the vehicle detail page for the Kennington Tesla, mobile, light mode**, and the `FinancePromotion` component inside it. If that one screen is right, the rest of the system follows from it.

Push back on anything here you think is wrong. This brief is a starting position, not a specification.
