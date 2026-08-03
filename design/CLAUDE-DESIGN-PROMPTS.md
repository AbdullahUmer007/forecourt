# Claude Design briefs — Forecourt public dealer site

Six prompts, one per page. Run them **in the order given**: the vehicle detail
page sets the visual language and the others should be told to inherit it.

Each prompt is self-contained — paste one at a time. Section A is identical in
every prompt on purpose; that repetition is what makes six separate design runs
come back as one product rather than six.

---

## What went wrong the first time, so we do not repeat it

The current build is a wireframe with design tokens applied. Specifically:

- **One type size does all the work.** Almost everything is 14–16px. There is
  no display type, no editorial rhythm, nothing that says "this is the car" as
  opposed to "this is a field label".
- **No header, no brand.** The page starts with a breadcrumb. A dealer's own
  website has no logo, no navigation, no phone number in a masthead, and a
  footer that is two lines of links.
- **Photography is not designed for.** There is one hero and a stack of
  images. No gallery grid, no thumbnail strip, no full-bleed treatment, no
  count, nothing that makes a car look worth £46,000.
- **Uniform grey cards.** Every section is the same bordered box, so the
  MOT history, the finance block and the description all carry equal weight.
- **The finance block is a spreadsheet.** Eight label/value rows.
- **Trust is stated, not shown.** "Rated 4.8 from 252 reviews" is a sentence
  in a paragraph. Warranty, years trading and trade bodies are invisible.
- **Spacing is uniform and tight.** No rhythm, no breathing room, nothing that
  reads as considered.

Tell the designer this. It is the most useful part of the brief.

---

# PROMPT 1 — Vehicle detail page

> Paste everything below into Claude Design.

---

You are designing the **vehicle detail page** for Forecourt, a SaaS platform
that builds and hosts websites for UK independent used-car dealers. One
deployment serves every dealer; this page is the single most important page in
the business, because it is where a buyer decides whether to get in their car
and drive to a forecourt.

## A. House rules — these apply to every page and are not negotiable

**Two audiences, one page.** A buyer on a phone with three minutes, and Google.

**It must render as server-side HTML with ZERO JavaScript.** This is a hard
platform constraint, not a preference. Design only what CSS can do: no
carousels that require JS, no modals, no accordions that need a script, no
infinite scroll, no client-side filtering. `<details>`/`<summary>`, CSS scroll
snap, `:target`, `:focus-within` and CSS grid are all available and encouraged.
If you want an interaction that needs JS, design the no-JS version as the
primary and note the enhancement separately.

**Performance budget (build gates, not aspirations):** LCP < 2.0s at p75 on
mobile 4G · CLS < 0.1 · above-fold weight < 500KB · Lighthouse Accessibility
100. Every image box must reserve its space.

**Colour tokens — use these exact values, no others:**

```
brand-600  #0E5A6B  primary actions, links (7.80:1 on white)
brand-700  #0B4553  hover / pressed
brand-300  #5EC7DC  brand text on DARK surfaces only (9.03:1 on #16181D)
brand-50   #E6F4F1  tinted wells
accent-500 #F59E0B  fills, one high-emphasis moment per page
accent-700 #B45309  amber as TEXT on light

surface-1  #FFFFFF / #16181D    cards, panels
surface-2  #F8FAFC / #0E1013    page plane
surface-3  #F1F5F9 / #1D2027    wells, media placeholders
border     #E2E8F0 / #2A2E36
ink        #0F172A / #FFFFFF
ink-muted  #475569 / #94A3B8
ink-subtle #64748B / #7A8598

status: good #0CA30C · warning #FAB219 · serious #EC835A · critical #D03B3B
```

Warning and serious are sub-3:1 on white **by design** — a status colour never
carries meaning alone, so every one ships with an icon *and* a text label.

**Dark mode is designed, not flipped.** Give me both. Every token above has an
explicit dark value; a brand colour used as *text* must switch to brand-300 on
dark, while a brand colour used as a *fill* stays brand-600 with white on it.

**Typography.** One family: Inter variable, system-ui fallback. No display or
serif face anywhere. JetBrains Mono for registrations, VINs and stock numbers
only. The current build tops out at 28px — **go bigger where it earns it.**

**Spacing:** 4px scale. **Radius:** 4 / 6 / 10 / full. **Motion:** 100ms hover,
160ms dropdown, 200ms drawer, `cubic-bezier(0.2,0,0,1)`, and
`prefers-reduced-motion` honoured throughout.

**Accessibility:** 44px minimum touch targets on mobile, 24px everywhere.
Visible focus ring, 2px brand at 2px offset, on everything interactive.

**Voice:** plain, direct, British. Trade vocabulary — forecourt, part-exchange,
reg, MOT, V5C, prep, HPI check, unit. Never Americanise: never "lot",
"trade-in", "license plate", "detailing", or "inventory" in buyer-facing copy.

**Responsive at 375 / 768 / 1280 / 1920.** Mobile is the primary design; over
60% of this traffic is a phone.

## B. What this page must contain

Above the fold on mobile, in this order — this order is fixed:

1. Gallery
2. Year, make, model, derivative
3. Price
4. Key specs
5. CTA row — Call · WhatsApp · Enquire · Reserve

Everything below the fold, in a sequence you decide:

- **Full gallery.** 8–20 photographs. Design the grid, the mobile swipe (CSS
  scroll-snap), the count, and the "view all" affordance.
- **Declared condition.** Photographs of every mark on the car, each *captioned
  with what it is* — "Kerbed nearside front alloy", "Bonnet stone chip". This
  is our biggest differentiator: no competitor shows damage voluntarily. It
  must read as confidence, not apology. Do not bury it.
- **Provenance.** "Provenance clear — no outstanding finance, not stolen, not
  written off. Checked 14 July 2026 with HPI Check."
- **MOT history** — every test, date, result, mileage and advisory, straight
  from the DVSA, **plus a mileage-over-time chart**. Free public data that
  competitors hide. The chart's y-axis starts at zero.
- **EV battery health** where applicable: "93.2% — tested 24 July. Typical is
  90–94% at four years."
- **Full specification** — around 13 fields.
- **Finance block** (see Prompt 4 — design a placeholder of the right size and
  weight here, roughly 8 rows of figures plus a headline payment and 6 lines of
  small print; it is regulated and heavy, and the page must not collapse
  around it).
- **Dealer trust block** — reviews with a rating, warranty, years trading,
  trade-body logos, FCA disclosure, the address and a map.
- **Enquiry form.**
- **Similar vehicles.**
- Sticky mobile CTA bar so a buyer never scrolls back up to find the phone
  number.

**Real data for the hero example** (use exactly this — it is our demo car):

```
2022 Tesla Model X Dual Motor Long Range      WN22 HNL
£45,999   (reduced by £1,200 on 12 July — show this)
40,470 miles · Electric · Automatic · SUV · 7 seats · Pearl White
1 former keeper · 2 keys · Full Tesla service history · MOT to 17 Feb 2027
2 declared marks: kerbed nearside front alloy, bonnet stone chip
Battery health 93.2%, tested 24 July 2026
MOT: 14 Feb 2026 pass at 38,940 (advisory: nearside front tyre close to the
     legal limit) · 12 Feb 2025 pass at 25,110
Dealer: Kennington Car Sales, Bletchley, Milton Keynes · 4.8 from 252 reviews
```

## C. What I want you to solve

1. **Make the car the hero.** Right now the page treats a £46,000 vehicle like
   a database record. Design the gallery as the centrepiece.
2. **Give the page a masthead.** Dealer logo, phone number, opening status
   ("Open until 6pm"), navigation. It is the dealer's own website and it
   currently looks like nobody's.
3. **Build a type scale with actual range.** The price should be unmissable.
   Field labels should recede.
4. **Stop every section being an identical bordered card.** Vary weight,
   background, and full-bleed vs contained. Some things are furniture; the
   gallery, price and declared condition are not.
5. **Design the declared-condition section so it sells trust.**
6. **Show the trust signals** rather than writing them in a sentence.
7. **Design the empty and degraded states**: a car with no photographs, no MOT
   history yet, price on application, and finance unavailable.

## D. Deliver

Desktop and mobile, light and dark. Annotate the type scale and spacing
decisions so they can be implemented exactly. Flag anything that would need
JavaScript so we can decide whether it earns its budget.

---

# PROMPT 2 — Search results / stock list

> Paste everything below into Claude Design.

---

You are designing the **stock list** for Forecourt, a SaaS platform that builds
websites for UK independent used-car dealers. This page has to work as the
homepage-in-practice — most buyers land here from Google — and as a filtering
tool for someone with a budget and a shortlist in their head.

**Inherit the visual language from the vehicle detail page** designed in the
previous brief: same masthead, same type scale, same card treatment.

## A. House rules

[PASTE SECTION A FROM PROMPT 1 HERE — identical, unchanged]

## B. What this page must contain

**One URL shape, four uses:** all stock · one make (`/used-cars/tesla`) · make
and model (`/used-cars/tesla/model-x`) · any filtered view. The heading changes
with the filters — "Used Tesla Model X for sale in Milton Keynes" — and is
never a generic "Used cars".

- **Facet sidebar**: make, model, fuel, gearbox, body style, colour. Every
  option shows its **count**. An option with zero matches is **shown, greyed
  and unclickable** — never hidden, because a sidebar whose options appear and
  vanish is impossible to filter with. Model only appears once a make is
  chosen.
- **Applied-filter chips**, each removing exactly one constraint, plus clear all.
- **Sort**: most relevant · just arrived · price ↑ · price ↓ · lowest mileage ·
  newest year.
- **Result cards**: photograph, year/make/model/derivative, price, key specs
  (year, mileage, fuel, gearbox), a save-to-shortlist control, and up to **two**
  badges — "Price reduced", "Just arrived", "Reserved", "Low mileage". Three
  badges and they stop meaning anything.
- **Result count** and pagination — 24 per page.
- **Keyword search box** that also accepts a registration.
- A **map / location** treatment, since a buyer's next question is "how far?".

**Critical constraint on filtering:** every facet, every sort option and every
page link is a real `<a href>` that reloads the page. No JS. Design for that —
it means the filter panel on mobile cannot be a JS drawer. Solve it with
`<details>`, a `:target` panel, or a filter page. Your call, but it must work
with scripting off.

**Zero results is a state of this page, and it is the one that matters most.**
It is where a dealer loses a buyer who was ready to spend. It must never be a
dead end. Design it to:

- say plainly what we do not have
- show the closest real cars, with a line explaining what we widened
  ("Here are 4 cars we have in any colour")
- offer "tell me when one arrives" — email plus an explicit, unticked consent
  checkbox with real wording and a one-click-unsubscribe promise

Design the loading and error states too.

## C. What I want you to solve

1. The current version is a grey sidebar and a grid of identical grey boxes.
   Make a card that is worth clicking.
2. Density: a dealer with 120 cars needs a scannable grid; one with 12 needs it
   not to look empty. Design both.
3. The facet sidebar on mobile with no JavaScript.
4. Make the counts and the disabled options feel deliberate rather than broken.
5. A list/grid toggle, if you think it earns its place with no JS.

## D. Deliver

Desktop and mobile, light and dark, plus the zero-result state and the
"only 12 cars in stock" variant.

---

# PROMPT 3 — Home page

> Paste everything below into Claude Design.

---

You are designing the **home page** of a UK independent used-car dealer's
website, generated by Forecourt. It does not exist yet — this is a clean sheet.

**Inherit the visual language** from the vehicle detail page and stock list.

## A. House rules

[PASTE SECTION A FROM PROMPT 1 HERE — identical, unchanged]

## B. Context that should shape it

The dealer is **Kennington Car Sales**, Bletchley, Milton Keynes: 123 cars in
stock, £6,495 to £45,999, FCA-authorised credit broker (FRN 993469), 4.8 from
252 reviews, open Mon–Sat 10–6 and Sunday 11–4.

This is a **template**, not a one-off. Every dealer using Forecourt gets this
page with their own logo, brand colour, stock and copy. So it must look good
with 12 cars or 300, with a good logo or a bad one, and with a brand colour
anywhere in a constrained palette. Design for the template, not the example.

Content it needs, in an order you choose and can justify:

- A hero that gets someone into the stock list fast. Consider a search-first
  hero over a stock photograph — these buyers arrive with a budget and a body
  style in mind.
- Featured or just-arrived stock, and the total count as a credibility signal.
- Browse-by entry points: body style, budget, make, fuel.
- **Why buy here** — the differentiators, shown not told: every car
  provenance-checked, full MOT history published, declared condition
  photographed, warranty included.
- Reviews, prominently.
- Part-exchange and finance entry points.
- Location, opening hours, "open now" status, and how to get there.
- Footer with the FCA disclosure, initial disclosure, complaints procedure,
  privacy policy and terms as **pages, not PDFs**.

## C. What I want you to solve

Most independent dealer homepages are a stock-photo hero, a slider nobody
uses, and three icon boxes. Do not design that. The specific problem: a buyer
who lands here needs to be in the stock list within one action, while a buyer
who is deciding *whether to trust this dealer* needs an answer without
scrolling past marketing.

Note carefully: **the hero cannot be a JS slider.** If you want motion, it must
be CSS-only and it must respect `prefers-reduced-motion`.

## D. Deliver

Desktop and mobile, light and dark. Show it twice: once for a dealer with 123
cars and a decent logo, once for a dealer with 14 cars and a poor one.

---

# PROMPT 4 — Finance block (regulated component)

> Paste everything below into Claude Design.

---

You are designing a **regulated finance component** for UK car dealer websites.
Read the constraints carefully — most of this component's design is dictated by
FCA rules, and getting it wrong is a compliance breach rather than a
visual-taste problem.

## A. House rules

[PASTE SECTION A FROM PROMPT 1 HERE — identical, unchanged]

## B. The regulatory constraints — these drive the design

Under **FCA CONC 3.5.3R**, showing any cost-of-credit figure — a monthly
payment, an interest rate, an APR — obliges us to show a **representative
example** alongside it. The example must contain these eight items **in this
order**, which is set by CONC 3.5.5R and is not a layout choice:

1. Rate of interest, and whether fixed or variable
2. The nature and amount of any other charge
3. Total amount of credit
4. **Representative APR**
5. Cash price and any advance payment
6. Duration of the agreement
7. Total amount payable
8. The amount of each repayment

**CONC 3.5.6R: the representative APR must be given greater prominence than
every other figure in the promotion — including the headline monthly payment
that triggered it.** That is the central design tension. The payment is what
sells; the APR must be visually louder. Solve it.

The block must also carry, legibly: "credit broker, not a lender", the firm's
FCA reference number, the lender's name, a commission statement, "subject to
status", and a link to the initial disclosure.

Real figures to design with:

```
£375.00 a month · 48 months · £5,000 deposit · Hire Purchase
Provided by Blue Motor Finance

Representative Example
Rate of interest              9.9% fixed
Other charges                 None
Total amount of credit        £14,999.00
Representative APR            9.6% APR
Cash price / advance payment  £19,999.00 / £5,000.00
Duration of agreement         48 months
Total amount payable          £18,000.00
Amount of each repayment      48 × £375.00
```

## C. What I want you to solve

The current version is a bordered table of eight label/value rows with the APR
in bigger type. It is legally correct and nobody reads it. Design something a
buyer will actually take in — while keeping the mandated order and the APR's
prominence.

Also design:

- The **absent** state: no approved representative example exists, so no figure
  of any kind may appear. It must still invite a finance conversation and read
  as deliberate, not broken.
- The same block **inside a results card**, where space is tight and the
  example still has to appear on the page.
- A **finance calculator** (deposit, term, annual mileage → payment) that must
  work with **no JavaScript**. Server round-trip on submit. Design that
  honestly; do not design a live-updating slider.

## D. Deliver

Both colour modes. Show it in place on a vehicle page as well as standalone, so
we can see whether it overwhelms the page — it currently does.

---

# PROMPT 5 — Saved cars and saved searches

> Paste everything below into Claude Design.

---

You are designing the **saved cars** page for a UK used-car dealer website
built by Forecourt.

**Inherit the visual language** from the previous briefs.

## A. House rules

[PASTE SECTION A FROM PROMPT 1 HERE — identical, unchanged]

## B. What it must contain

A buyer saves cars anonymously — no account, no sign-up, just a heart on a
card. They can identify themselves later and keep the list. Saving works
without JavaScript: it is a form POST that reloads the page.

- The saved cars, with everything needed to compare them side by side: price,
  mileage, year, monthly payment, MOT expiry, declared marks.
- **A car that has sold stays on the list, marked, with a link to the closest
  live alternative.** Never silently removed — deleting it makes the buyer
  think we lost it, and wastes the one moment we know exactly what they wanted.
- A **comparison** view for 2–3 cars. With no JavaScript.
- **Saved searches**: named the way a buyer would say it out loud ("Automatic
  Golf under £15,000"), with an alert frequency and a real consent checkbox.
- An **empty state that teaches the next action**, not a shrug.
- A quiet, honest prompt to leave an email so the list survives clearing
  cookies — with consent handled properly, never pre-ticked.

## C. What I want you to solve

Make this feel like a useful tool rather than a bookmarks folder. The dealer
sees this activity in their CRM — a buyer with three saved cars is their
warmest lead — so the page should gently encourage identification without
holding the list hostage.

## D. Deliver

Desktop and mobile, light and dark, plus the empty state and the
"one of these has sold" state.

---

# PROMPT 6 — Enquiry, reserve and part-exchange forms

> Paste everything below into Claude Design.

---

You are designing the **lead capture forms** for a UK used-car dealer website
built by Forecourt. These are where the money is: every one of these is a lead
landing in the dealer's CRM within seconds.

**Inherit the visual language** from the previous briefs.

## A. House rules

[PASTE SECTION A FROM PROMPT 1 HERE — identical, unchanged]

## B. The forms

1. **Enquire about this car** — name, email, phone, message.
2. **Reserve this car** — a deposit taken online, with what the deposit does
   and does not do stated plainly, and the refund position clear.
3. **Book a test drive** — with date and time preference.
4. **Part-exchange valuation** — registration and mileage in, indicative figure
   out.
5. **Request a video walkaround.**
6. **Notify me when one arrives** (from the zero-result page).

## C. Constraints

- **No JavaScript.** Native HTML validation, server-side round trip, and the
  error state is a re-rendered page with the values preserved. Design that
  error state properly — it is the state users actually hit.
- **Consent is a record, not a tick.** Where a form captures marketing consent
  it needs real wording, an unticked box, and a stated unsubscribe route.
  Never pre-ticked, never bundled with the enquiry itself — someone asking
  about a car has not agreed to a newsletter.
- Errors say **what happened, why, and what to do**. Never "An error occurred",
  never "Invalid input".
- 44px touch targets, correct `inputmode` and `autocomplete` on every field so
  a phone shows the right keyboard.

## D. What I want you to solve

Design the **success** states as carefully as the forms. "Thanks, we'll be in
touch" wastes the highest-intent moment in the entire journey — the buyer has
just raised their hand. What should be on that screen instead?

Also: these forms appear both inline on a vehicle page and as their own pages.
Design both.

## E. Deliver

Every form, both modes, with empty, filled, error and success states.

---

## After the designs come back

Send them to me and I will:

1. Rebuild `apps/site/src/render/theme.ts` from the annotated type scale,
   spacing and colour decisions.
2. Rewrite the renderers to match, keeping the zero-JS guarantee.
3. Re-run the self-audit — our own site currently scores 100/100 on the tool
   we sell with, and that must not regress.
4. Screenshot every page in both modes at 375 / 768 / 1280 / 1920 and put them
   in front of you before I call it done.

**Not covered here:** the Office CRM — stock list, vehicle record, prep board,
lead inbox, deal builder, dashboards. That is a different personality
(dense, keyboard-first, staff using it six hours a day) and deserves its own
set of briefs. Ask when you want them.
