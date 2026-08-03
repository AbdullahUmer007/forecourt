# Compliance sign-off brief

**For:** the retained FCA compliance consultant and the VAT specialist
**From:** Forecourt (Abdullah Umer)
**Date:** 3 August 2026
**Status:** three modules are built, tested and **deliberately inert** pending the sign-offs below.

---

## What we are asking for

Three features are complete and will not operate until a named person signs
off the rules they enforce. This is by construction, not by policy: the code
reads its thresholds and wording from a `compliance_rules` database table, and
every one of the rows below ships **unsigned**. Nothing renders, nothing sends
and nothing calculates until the `signed_off_by` and `signed_off_at` fields are
populated.

**You are being asked to review data rows, not a codebase.** Each item below is
a small set of values with a source link. If a value is wrong, we change one
row and deploy data — not a release.

We have deliberately batched these into one brief rather than three
conversations. Items 1 and 3 are for the FCA consultant; item 2 is for the VAT
specialist; they can be reviewed independently.

**This document is not a legal opinion and does not claim to be complete.** It
states what we have built and why, so that a qualified person can tell us where
we are wrong.

---

## 1 — CONC 3.5: the representative example (FCA consultant)

**Module:** M8, Finance display. **Rule key:** `conc.representative_example` v2.

### What the code does

No cost-of-credit figure — a monthly payment, an interest rate, an APR, a
"from £199/month" — can reach any screen, email or PDF unless it is
accompanied by a representative example that is signed off, approved, in date,
and arithmetically reconciled. There is no other code path: the renderer takes
a type that only the approval function can construct.

### What we need you to confirm

| # | Item | What we have implemented | Source relied on |
|---|---|---|---|
| 1.1 | Required fields | Eight items: rate of interest and whether fixed/variable; nature and amount of any other charge; total amount of credit; representative APR; cash price and any advance payment; duration; total amount payable; amount of each repayment | CONC 3.5.5R |
| 1.2 | **Field order** | The sequence above is treated as prescribed, not as a layout choice | CONC 3.5.5R |
| 1.3 | Prominence | The representative APR is rendered larger than, and above, the monthly payment. Exactly one item may carry the prominence marker and it must be the APR | CONC 3.5.6R |
| 1.4 | "Representative" | ≥51% of business resulting from the promotion expected at that rate or better; governed monthly against concluded agreements | CONC 3.5.2R |
| 1.5 | Small-sample rule | Below 20 concluded agreements we report "not enough evidence yet" rather than a percentage | Our own decision — please confirm it is defensible |
| 1.6 | Re-approval window | An example expires 90 days after approval | Our own decision — is this the right interval? |

### The specific question that changes what we build

**CP26/15.** The consultation on simplifying or removing the CONC 3.5.3R
representative example, and on revisiting the 51% threshold (a rise to 66% has
been floated), opened 29 April 2026 and closed 17 June 2026. As at 3 August
2026 we are not aware of a published policy statement.

**What is your view on the likely landing point, and when?** Our field list is
configurable data precisely so we can absorb a change, but the answer decides
whether we build the alternative disclosure now or wait.

### One thing we found and want checked before we ever repeat it

A competitor's published representative example reconciles exactly on every
figure, but its advertised "representative APR" appears to be a **nominal
annual rate compounded monthly** rather than an effective annual rate. Their
own cashflows imply an APR roughly 0.9 points higher than the one advertised.

CONC App 1.2 requires an effective annual rate. **We have not used this in any
customer-facing material and will not until you confirm the reading** — being
wrong about a competitor's compliance in a sales meeting would be worse than
saying nothing. The arithmetic is in `demo/kennington.ts` if you want to check
it.

---

## 2 — VAT margin scheme and the stock book (VAT specialist)

**Modules:** M11, Money; M13, Part-exchange appraisal (questions 2.11–2.12).
**Rule key:** `vat.margin_fraction` v1.

### What the code does

Every vehicle is assigned a VAT scheme at book-in. On a margin-scheme sale the
invoice **cannot** show VAT: the construction zeroes it, a guard function
refuses it, two database CHECK constraints refuse the row, and a golden-file
test renders an actual document and fails the build if a VAT figure appears.

### What we need you to confirm

| # | Item | What we have implemented | Source relied on |
|---|---|---|---|
| 2.1 | Margin VAT | gross margin × 1/6 at a 20% standard rate | VAT Notice 718/1 |
| 2.2 | Rounding | Half-up to the nearest penny | **Please confirm** — the notice permits rounding down in the dealer's favour in some circumstances and we have not assumed it |
| 2.3 | Negative margin | Produces zero VAT and is **never** offset against another vehicle. Each vehicle stands alone; there is no code path that aggregates margins before applying the fraction | VAT Notice 718/1 |
| 2.4 | Invoice presentation | A margin invoice shows no VAT line, and carries the wording "Margin scheme — second-hand goods. This invoice does not give the buyer the right to reclaim VAT." | **Please confirm this wording** |
| 2.5 | Stock book fields | The twelve listed in VAT Notice 718/1 §5.2 | VAT Notice 718/1 §5.2 |
| 2.6 | Seller/buyer address | We capture both name **and** address, though we understand the stock-book requirement may be name-only with address being an invoice requirement | **Please confirm which is which** |
| 2.7 | Retention | Six years from the sale | VAT Notice 718/1 |
| 2.8 | Corrections | The stock book is append-only. A correction is an adjusting entry referencing the original, with a mandatory reason; the original is never edited | Our own decision — please confirm it satisfies the record-keeping requirement |
| 2.9 | Period VAT | Summed per entry from each entry's own stored figure, never by aggregating margins and applying the fraction once | VAT Notice 718/1 — this is the difference between £83.33 and £33.33 on a +£500 / −£300 pair |

### Question

**2.10** — Is there any circumstance in which a margin-scheme dealer may
*correctly* show a VAT figure on a sales invoice? We have made it structurally
impossible, and we would rather know now if that is too absolute.

**2.11 — The purchase price of a part-exchange (added with M13).** When a car
is taken in part-exchange we record the **allowance** — the amount actually
given in exchange — as the purchase price on the resulting stock record, and
that is the figure the stock book carries and the margin is computed against
when that car later sells.

The case we want confirmed is the **over-allowance**. A dealer routinely allows
£5,000 on a car worth £4,600 to close the deal on the car being sold. We treat
the purchase price as the full £5,000 and record the £400 separately as an
over-allowance, on the view that the £400 is economically a discount on the
sale car rather than a reduction in what was paid for the part-exchange.

The alternative treatment — recording £4,600 as the purchase price and the £400
as a discount on the sale — produces a different margin, and therefore a
different VAT figure, on **both** vehicles.

- Is the allowance the correct purchase price for stock-book purposes in all
  cases, including an evident over-allowance?
- Does the answer change where the over-allowance is large enough that HMRC
  might regard the stated allowance as not reflecting the true value?

**2.12 — Part-exchange from a VAT-registered business.** We do not infer the
VAT scheme from the seller's registration status. A private individual and an
unregistered business are always margin, because neither can charge VAT. For a
VAT-registered seller we block the conversion until someone states whether a
VAT invoice was actually issued — they may have sold to us under the margin
scheme themselves, in which case there is no input VAT to reclaim and the car
is a margin car despite the seller being registered. Please confirm this is the
right test, and that a VAT invoice received is the correct and sufficient
condition for treating the vehicle as qualifying.

---

## 3 — Point-of-sale evidence (FCA consultant)

**Module:** M12, Deals and the Evidence Ledger.

### What the code does

Every step of a financed deal writes an entry to an append-only,
hash-chained ledger. Each entry contains the hash of the one before it, so
removing or altering an entry breaks verification for every entry after it —
tampering is not merely prevented, it is **provable**, including by a recipient
who does not trust us. The export bundle is what would be sent to a lender or
the Ombudsman.

### What we need you to confirm

| # | Item | What we have implemented | Source relied on |
|---|---|---|---|
| 3.1 | Required evidence on a financed deal | Initial disclosure · every quote presented (not only the selected one) · commission disclosure · demands and needs · affordability · adequate explanation · contract formation | CONC 4, CONC 5.2A, Consumer Duty |
| 3.2 | Commission disclosure | Requires the amount or its basis **and** the exact wording version shown. A discretionary commission arrangement cannot be recorded at all — the type is refused | Banned Jan 2021; post-*Hopcraft*; s.140A CCA 1974 |
| 3.3 | Add-ons | Each carries its own demands-and-needs statement and its own fair-value reference. Never pre-ticked: an acceptance dated before its offer is refused at the database level | PRIN 2A |
| 3.4 | Contract formation | Mandatory before a deal can be contracted. Drives the 14-day CCR cancellation right; an online enquiry followed by an in-showroom signature is treated as **on-premises with no cancellation right** | CCR 2013 |
| 3.5 | CRA clocks | 30-day short-term right to reject, pausing during a repair attempt and resuming with ≥7 days remaining; 6-month reversed burden of proof | CRA 2015 s.22(3), s.22(6)–(7) |
| 3.6 | Retention | Indefinite for finance introductions while the redress look-back persists. An erasure request is refused for these, with the basis recorded | Article 17(3)(b) |
| 3.7 | Vulnerability | Recorded against the FCA's four drivers, access-controlled separately from ordinary notes | FG21/1 |

### Questions

**3.8** — Is our required-evidence list (3.1) complete for a limited-permission
credit broker? We would rather over-collect.

**3.9** — On 3.4: we treat "enquired online, signed in the showroom" as
on-premises. We believe this is right and it is the case most likely to be got
wrong in either direction. Please confirm.

**3.10** — On 3.6: is indefinite retention of finance-introduction evidence
still the right posture given the Upper Tribunal's partial suspension of the
redress scheme (~1–2 July 2026, hearing expected December 2026 – February
2027)?

---

## Commercial

We expect this to be an ongoing retainer rather than a one-off review: the
regulatory watch in our own documentation assumes a quarterly re-check of CONC,
PRIN 2A, the redress scheme, HMRC margin-scheme guidance and ICO direct-marketing
guidance. Budget discussed internally at roughly £1.5–3k per month.

**What sign-off looks like in practice:** you tell us a value is right or
wrong. For each rule we then write one database row carrying your name, the
date, the source URL and the effective date. The feature begins working at that
moment. If a rule later changes, we ship a new version of the row — the old one
is retained, because it is the record of what we believed and enforced at the
time.

## What is deliberately not live today

| Module | Status | Blocked on |
|---|---|---|
| M8 — Finance display | Built, 100% tested | §1 |
| M11 — Money and VAT | Built, tested | §2 |
| M12 — Deals and Evidence Ledger | Built, tested | §3 |

No monthly payment, no VAT-bearing invoice and no finance evidence bundle can
be produced by the system until the corresponding rule is signed. That is the
point.
