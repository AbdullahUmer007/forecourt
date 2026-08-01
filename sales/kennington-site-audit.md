# Website Audit — Kennington Car Sales

**Prepared for:** Kennington Car Sales Limited, 32–36 Aylesbury Street, Bletchley, Milton Keynes MK2 2BA
**Site audited:** www.kenningtoncarsales.co.uk
**Date of audit:** August 2026
**Prepared by:** Forecourt

---

## Before you read this

This is a free, unsolicited audit. We build software for independent dealers and we've been auditing dealer websites across the UK. Yours came up, so we ran it properly.

Three things worth saying up front:

1. **You don't need us to fix any of this.** Every finding below can be handed to your current website supplier. They should be able to fix most of it. Ask them.
2. **Nothing here is a criticism of your business.** 4.8 out of 5 from 252 reviews and around 120 cars on the forecourt is a well-run dealership. That is precisely why the findings matter — the operation is working, and the website is leaking the results.
3. **Everything below is checkable.** We've included the exact URLs. You can verify any of it yourself in a browser in about ten minutes, and we'd encourage you to.

Findings are ordered by what we think they cost you, biggest first.

---

## Summary

| Area | Status |
|---|---|
| Vehicles findable by Google | ❌ **Zero of ~120 vehicles are in your sitemap** |
| Vehicle pages Google has found | ❌ Every one we tested displays "Sold Out" |
| Structured data (how Google reads a car listing) | ❌ None present anywhere on the site |
| Vehicle web addresses | ⚠️ Numeric IDs, not readable names |
| Finance on the website | ❌ No payment figures, no calculator, nowhere on the site |
| MOT history shown to buyers | ❌ Not displayed |
| Provenance / HPI check shown to buyers | ❌ Not displayed |
| Search filters | ⚠️ No monthly-payment filter |
| Legal and FCA documents | ⚠️ PDF downloads only; some page links don't work |
| Technical configuration | ⚠️ `robots.txt` is pointing Google at your development site |
| Reviews, opening hours, phone, WhatsApp | ✅ Present and working well |
| Mobile-friendly basics | ✅ In place |

---

## 1. Google cannot see your cars

**This is the big one.**

Your sitemap — the file that tells Google what pages exist on your site — is at:

> `https://www.kenningtoncarsales.co.uk/sitemap.xml`

It contains **27 web addresses**. They are your Home page, About Us, Finance, Warranty, the protection products, the legal documents, and so on.

**Not one of them is a car.**

You have roughly 120 vehicles in stock. As far as your own sitemap is concerned, you have none. For a used-car dealer, the individual vehicle pages *are* the website — they are what people search for ("used Tesla Model X Milton Keynes"), and they are what Google ranks.

### It gets worse

Google has found some of your vehicle pages anyway, by following links. We tested four of them:

- `/get-car-details?stockId=50111`
- `/get-car-details?stockId=51858`
- `/get-car-details?stockId=41274`
- `/get-car-details?stockId=86415`

**All four display "This Vehicle is Sold Out."** No photos of the car, no specification, no price. Just a message saying it's gone.

They also all carry the same page title as your homepage — *"Affordable Used Cars Near You | Reliable Car Dealership"* — rather than the car's own name. So if one of them did rank, the search result wouldn't tell anyone what car it was.

And they stay live forever. When a car sells, the page doesn't redirect anywhere useful — it just becomes another "sold out" page sitting at the same address. Over time that builds up into a large number of near-identical dead pages, which actively works against the site's ranking.

### And there's a set of pages Google has indexed that simply don't exist

Your site has, or had, landing pages by make and area. Google has these in its index:

- `/used/audi/milton-keynes/`
- `/used/bmw/1-series/`
- `/used/land-rover/luton/`
- `/used/volkswagen/ox1-5pb/`
- `/used/citroen/milton-keynes/`, `/used/fiat/milton-keynes/`, `/used/volvo/milton-keynes/`, `/used/lexus/milton-keynes/`, `/used/ssangyong/milton-keynes/`

**Every one we tested returns a "page not found" error.** So someone searching "used Audi Milton Keynes", finding you, and clicking, lands on an error page.

### What should be happening

- Every vehicle in stock has its own page, in the sitemap, with a readable address like `/used-cars/tesla/model-x/long-range-2022-wn22hnl`
- Each page's title is the car — *"2022 Tesla Model X Long Range | 40,470 miles | £19,999 | Kennington Car Sales"*
- When a car sells, the page redirects to similar stock in the same price range rather than becoming a dead end
- Make and area landing pages exist, work, and are built from live stock
- The sitemap updates itself every time stock changes

**Our honest assessment:** we won't pretend to know exactly what this is costing you in pounds, because nobody can without your analytics. But you have 120 cars and Google has none of them listed as available. Whatever your website's search traffic is worth, right now it's earning a fraction of what it should.

---

## 2. You are an FCA credit broker with nine lenders and no way to show a monthly payment

Your homepage carries the logos of nine lenders: Advantage Finance, Blue Motor Finance, CarMoney, Close Brothers, DSG Finance, First Response, Mallard, MotoNovo and Zopa. Your Initial Disclosure document confirms you're authorised as a credit broker under FRN 993469.

We checked your homepage, your stock listing page, your Finance page and four vehicle pages.

**There is not a single monthly payment figure or APR anywhere on your website.** There is no finance calculator. Your Finance page explains what HP, PCP and Conditional Sale are, in words, with no numbers.

Most used-car buyers now shop by monthly budget rather than cash price. On a £19,999 Tesla, "£19,999" and "from £289 a month" are very different propositions to the same customer — and only one of them is on your site.

### The compliance point, which is a genuine credit to you

There is a reason a lot of dealer sites get this wrong: the moment you display *any* cost-of-credit figure — a monthly payment, an APR, a deposit — FCA rules (CONC 3.5.3R) require a full representative example alongside it, containing the representative APR, the interest rate and whether it's fixed or variable, the total amount of credit, other charges, the cash price, any deposit, the length of the agreement, the total amount payable and the amount of each repayment.

Getting that wrong is a regulatory problem. **You have avoided it entirely by not showing any figures at all** — which is safe, and is more than can be said for a lot of dealer websites we've audited.

But the price of that safety is every finance enquiry you're not getting.

### What should be happening

- A payment figure on every vehicle page, generated from a live lender quote, with a compliant representative example rendered automatically alongside it — so it is correct by construction rather than by someone remembering
- A soft-search eligibility check that gives the customer an indicative decision without touching their credit file
- A monthly-payment filter in your stock search
- Your credit-broker disclosure and FRN as a proper web page, not only inside a PDF

**Rough arithmetic, which you're better placed to check than we are:** if you sell in the region of 45 cars a month and a financed deal earns you around £400 in commission, then lifting finance penetration by just five percentage points is a bit over two extra financed deals a month — roughly £900. We'd expect the real number to be higher. That is the single most valuable thing on this list.

---

## 3. Your vehicle pages are missing free trust-building content you already own

Three things are missing that cost nothing to add:

**MOT history.** Every vehicle's full MOT record — every test, every mileage reading, every advisory — is free public data from the DVSA. Showing it, with the mileage plotted on a chart, is one of the most reassuring things you can put in front of a used-car buyer. It's not on your site.

**Provenance checks.** Your Auto Trader profile says every car is HPI-checked. Your own website doesn't mention it on a single vehicle page. You're paying for the checks and getting no marketing value from them.

**Structured data.** There is no JSON-LD markup anywhere on your site — no `Vehicle`, `Car`, `Product`, `Offer`, `AutoDealer` or `LocalBusiness` schema. This is the invisible code that lets Google display a car with its price, mileage and availability directly in search results, and it's a requirement for Google's vehicle listing formats. Without it you're competing for attention in plain blue text against listings that show a photo and a price.

Also absent from vehicle pages: video walkarounds, 360° interior spins, a "reserve online" deposit button, and a "similar vehicles" section.

---

## 4. Two technical issues your supplier should fix regardless

**Your `robots.txt` is pointing Google at your development site.**

At `https://www.kenningtoncarsales.co.uk/robots.txt` there is a line reading:

> `Sitemap: https://dev.kenningtoncarsales.co.uk/sitemap.xml`

That's telling search engines to go and read the sitemap on `dev.` — your development or staging site — rather than your live one. That development site is publicly reachable. This should never appear on a production website.

**Your vehicle data and your website disagree with each other.**

Your site can generate a printable specification sheet for a vehicle. For stock ID 86415 it produced a complete, current-dated listing — a 2022 Tesla Model X Long Range, 40,470 miles, £19,999, registration WN22HNL, one owner, two keys, MOT to 17/02/2027, battery health 93.2%.

The customer-facing page for that same stock ID, checked moments later, said **"This Vehicle is Sold Out."**

One of those two is wrong. Either you have a car you're not selling, or you're generating spec sheets for cars you no longer have. Either way, your public website and your stock system are out of step, which is worth checking across your whole inventory.

---

## 5. Your legal and compliance documents are PDFs, not pages

Your Initial Finance Disclosure, Complaints Procedure, Commission Disclosure, Status Disclosure and Vulnerable Customer Policy all exist — which puts you ahead of plenty of dealers — but they live as PDF downloads at addresses like:

> `/theme21/Kennington-PDF/KENNINGTON.Initial.Finance.Disclousre.IDD.pdf`

Three observations:

- Several of the matching page links in your navigation return "page not found" when opened directly. A customer clicking "Complaints Procedure" may hit an error.
- PDFs are poor for accessibility — screen readers handle them badly — and poor for search visibility. The content is effectively invisible to Google.
- The filename has a typo in it: "Disclousre" rather than "Disclosure". Small, but it's on a regulatory document, and those are the ones people photograph.

The content itself is good. Your complaints procedure correctly sets out acknowledgement within three working days, investigation, a final response within eight weeks, and the Financial Ombudsman Service's details with the six-month referral window. Your commission disclosure states that commission is received and will be disclosed before signature. Your Initial Disclosure correctly states you are a credit broker and not a lender, and honestly says you don't cover the whole market.

**That's all compliant substance delivered in the wrong container.** These should be proper pages on your website — indexable, accessible, linkable, and version-controlled so you can prove which version a customer saw on a given date.

---

## 6. What's working

It would be a poor audit that only found problems.

- **Reviews.** 4.8 out of 5 across 167 Google and 85 Auto Trader reviews is a genuinely strong position, and you're right to feature it.
- **Contact.** Multiple click-to-call numbers, a WhatsApp link that works from every page including vehicle pages, and clearly stated seven-day opening hours for both sales and after-sales.
- **Product range.** Warranty, paint protection, underbody protection, tyre protection and service plans all have their own pages. The after-sales offer is well presented.
- **Stock filtering.** Make, model, body type, fuel, transmission, colour, price range and mileage range are all there. The bones are right — it's the monthly-payment filter that's missing.
- **Compliance documents exist and are substantively correct.** Many dealers have nothing.
- **AI crawler controls are configured** in your robots.txt, blocking training crawlers. Somebody has thought about that, which is more than most.

---

## 7. If it were us, in this order

1. **Get every car into the sitemap with a proper web address and its own page title.** Highest impact, and it's a platform fix rather than a per-car job.
2. **Add structured data to every vehicle page.** Free, invisible, and it changes how you appear in search.
3. **Fix the sold-vehicle handling** — redirect to similar stock instead of leaving dead pages.
4. **Fix or remove the make/area landing pages** that Google has indexed and that currently 404.
5. **Add a compliant finance calculator** with a representative example, and a monthly-payment filter.
6. **Show MOT history and your provenance checks** on every vehicle page.
7. **Fix the robots.txt sitemap line** and investigate the stock sync discrepancy.
8. **Move the legal documents from PDFs to proper pages.**

Items 1–4 and 7 are things your existing supplier ought to fix, and you're paying for a platform that should be doing them. It's a reasonable conversation to have with them, and we'd rather you had it than not.

---

## 8. If you'd like to see the alternative

We'd take your live stock, build your site on our platform, and show you the two side by side. Every car indexed with a real web address and structured data. A compliant finance payment on every vehicle. MOT history and your HPI check displayed. Your VAT margin stock book and your finance paperwork handled properly behind the scenes.

**No charge, no obligation, and we don't need you to cancel anything to look at it.**

Two things we publish, because we think they matter in this trade:

**Your data is yours.** Your domain stays in your name. You can export everything — stock, customers, photographs, documents — yourself, at any time, without asking us. If you ever leave, we help you migrate out for free and keep your old vehicle addresses redirecting for twelve months so you don't lose your rankings.

**90-day switch guarantee.** We build alongside your current site, migrate everything free, and you run both as long as you like. If you're not better off ninety days after going live, you leave. No notice period, no fee, and we hand you everything.

---

**Forecourt**
[contact details]

---

### Notes on this audit

- Every finding was verified against the live site in August 2026 at the URLs given. Websites change; if something here has since been fixed, good.
- We assessed only what is publicly visible. We have no access to your analytics, your stock system or your commercial data, so anywhere we've estimated a financial figure we have said so and shown the assumption. Those numbers are yours to check, not ours to assert.
- We were unable to independently verify FRN 993469 on the FCA Register during this audit, because the register's search page would not load for our tooling. We have taken it at face value from your own disclosure documents; we'd suggest confirming your register entry is current as routine housekeeping.
- Page speed and Core Web Vitals were not measured — that needs a rendering test we didn't run. Worth a PageSpeed Insights check.
- This audit is a technical and commercial assessment. It is not legal or regulatory advice. The finance and compliance observations are matters for your own compliance adviser.
