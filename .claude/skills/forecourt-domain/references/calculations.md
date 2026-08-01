# Canonical calculations

Every formula the product depends on. All money is **integer minor units (pence)**. Every function is pure, unit tested, and property-tested for rounding. None of these run in the browser.

## Money handling

```ts
type Money = { amount: bigint; currency: 'GBP' }   // amount in pence
```

Rules:
- Never `number` for money. Never floats. Never `toFixed` for arithmetic.
- Round only at the final presentation or tax step, and always state the rounding mode.
- VAT rounds **down to the nearest penny** in the dealer's favour only where HMRC permits; default to standard half-up and confirm with the VAT adviser.
- Percentages stored as basis points (`1250` = 12.50%) to avoid float drift.

## 1. Vehicle true cost and margin

```
total_cost = purchase_price
           + Σ vehicle_costs.actual_amount (net of recoverable VAT)
           + transport_and_fees
           + provenance_check_cost
           + advertising_allocation
           + stocking_interest

stocking_interest = purchase_price × (annual_rate / 365) × days_funded

vehicle_gross      = sale_price − total_cost
deal_gross         = vehicle_gross + finance_commission + addon_margin + partex_projected_margin
```

`advertising_allocation` = total monthly advertising spend ÷ units sold that month, applied at sale (not accrued daily) unless the tenant opts into daily accrual.

`partex_projected_margin` uses the part-ex vehicle's own forecast, and is shown as *projected* until that vehicle actually sells. Never present a projection as realised profit.

## 2. VAT

```
# Margin scheme
margin      = max(0, selling_price − purchase_price)
margin_vat  = round(margin × 1 / 6)          # 20% standard rate
# negative margin → margin_vat = 0, and it is NEVER offset against another vehicle

# VAT qualifying
net         = selling_price / 1.20
vat         = selling_price − net
```

The `1/6` fraction and the `0.20` rate come from `compliance_rules` keyed on the **sale date**, never from a constant.

Invariants to assert in tests:
- A margin-scheme invoice never contains a line with a non-zero VAT amount.
- `sum(stock_book.vat_due)` for a period equals the VAT return figure derived independently.
- Two vehicles, one +£500 margin and one −£300 margin, produce £83.33 of VAT, not £33.33.

## 3. Days metrics

```
days_in_stock     = (now | sold_at) − booked_in_at
days_in_prep      = ready_at − booked_in_at
days_to_live      = live_at − booked_in_at
days_to_sell      = sold_at − live_at
days_blocked      = Σ (prep_job.blocked_until − prep_job.blocked_since)
working_prep_days = days_in_prep − days_blocked
```

All in whole days, computed in the **tenant's timezone**, not UTC — a dealer counts a day as a trading day and will not accept an off-by-one.

Benchmark context: UK independents average ~52 days to sell; car supermarkets ~32. Capture each tenant's baseline in their first 30 days so improvement can be shown against their own starting point, not an industry average they'll dispute.

## 4. Price position

```
price_position_pct = round(retail_price / market_retail × 100)
```
Bands: `< 96%` under market · `96–103%` at market · `> 103%` above market.

Forecast days to sell comes from the valuation provider where available; otherwise from our own model:
```
forecast_days = base_days(make, model, age_band, region)
              × price_position_factor
              × season_factor
              × condition_factor
```
Never present a forecast without its confidence and its inputs. Dealers will test it, and an unexplained wrong number destroys trust in the whole dashboard.

## 5. Aging price ladder

Tenant-configured. Default suggestion:

| Days in stock | Suggested action |
|---|---|
| 30 | Review photos and description; reprice to ≤100% of market |
| 45 | −2% or to 98% of market, whichever is lower |
| 60 | −3% and re-photograph |
| 90 | −5%, or consider trade disposal if projected margin < stocking cost to sell |

The system **suggests**; a human approves. Bulk application shows total margin impact before committing.

## 6. Maximum bid (buying)

```
max_bid = target_retail
        − estimated_prep
        − buyer_fees_and_transport
        − target_margin
        − (daily_stocking_cost × forecast_days_to_sell)
```

Show every assumption, and make each one adjustable inline. A buyer in an auction hall needs one number and the ability to flex it in three seconds.

## 7. Finance figures

We do not compute APR or payments ourselves in v1 — the finance platform (iVendi/Codeweavers) returns them, and they carry the regulatory responsibility for the quote. We store and display, we do not derive.

What we do compute:
```
finance_penetration = financed_deals / total_deals
representative_apr_compliance =
    count(deals where achieved_apr <= advertised_representative_apr)
  / count(deals responding to that promotion)
# must be >= 0.51, else raise a compliance alert
```

Store on every finance agreement: APR, flat rate, cash price, deposit, part-ex contribution, amount of credit, balloon/GFV, monthly payment, total charge for credit, total payable, term, annual mileage, commission type and amount.

## 8. Consumer rights clocks

```
reject_window_ends_at     = delivered_at + 30 days + Σ repair_pause_extensions
burden_of_proof_ends_at   = delivered_at + 6 months
cancellation_deadline     = (contract_formation in ['distance','off_premises'])
                            ? (delivered_at ?? collected_at) + 1 day + 14 days
                            : null
```

Repair pause: while a repair attempt is open the 30-day clock stops. On resumption, at least 7 days must remain — so:
```
resumed_end = max(original_end_shifted_by_pause, repair_completed_at + 7 days)
```

All clocks computed in the tenant timezone at end-of-day boundaries, and displayed as both a date and a countdown.

## 9. Cash / AML threshold

```
running_total = Σ cash_amount_gbp for linked transactions
threshold     = compliance_rules['aml.hvd_threshold'].on(received_at)
# £10,000 sterling from 30 June 2026 (previously €10,000 — the MLR 2017
# thresholds were converted to fixed sterling as part of the 2026 AML reform).
# Keyed on the receipt date so historic records still evaluate correctly.
```
Alert at 80% of threshold. Hard block at threshold for tenants without HVD registration, with an override-and-justify flow that writes to the audit log.

## 10. Commission

Rules engine, evaluated per deal at completion:
```
commission = Σ over rules of:
    flat_per_unit
  | percent_of_vehicle_gross
  | percent_of_total_gross
  | banded(total_gross, bands[])
  | finance_bonus_per_financed_deal
  | addon_bonus_per_product
  − clawbacks(cancelled_or_refunded_deals)
```
Statements are generated monthly, approved by a manager, and frozen once approved. A recalculation after approval creates an adjustment line in the next period, never a silent restatement.
