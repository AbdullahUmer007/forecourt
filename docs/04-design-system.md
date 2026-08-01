# Forecourt — Design System & UI/UX Specification

**Version:** 1.0 — August 2026
**Applies to:** the CRM application, the public dealer websites, and the platform admin app
**Companion docs:** `01-product-strategy.md`, `02-functional-spec.md`, `03-architecture-and-data-model.md`

---

## 1. Why this document exists

In our category, "dated" is the standard complaint about incumbents. Design quality is not a nice-to-have here — it is one of the three reasons a dealer switches to us (see `01-product-strategy.md` §4.3). But "professional" in this market does not mean decorative. It means **fast, dense, legible, and trustworthy** — the qualities of a well-run business, not a design portfolio.

Two products, two personalities, one system:

| | **CRM (Office)** | **Public dealer website** |
|---|---|---|
| User | Staff, 6+ hours a day | A buyer, 3 minutes, on a phone |
| Priority | Density, speed, keyboard, information | Photography, clarity, trust, conversion |
| Personality | Calm, quiet, tool-like. The data is the only loud thing. | Confident, spacious, the car is the hero |
| Chrome | Minimal, recessive | Minimal, brandable per dealer |

---

## 2. Design principles

1. **The data is the only thing allowed to be loud.** Chrome is recessive. Borders are hairlines. Backgrounds are near-white. Colour carries meaning, never decoration.
2. **Density is a feature, not a failure.** A stock manager wants 30 rows on screen, not 8. Provide a comfortable default and a compact mode, and remember the choice.
3. **Never make someone wait for a page to tell them something it already knows.** Optimistic updates, skeletons that match final layout, instant navigation between records.
4. **The forecourt is muddy and one-handed.** Touch targets ≥44px on mobile, primary actions within thumb reach, camera-first flows, offline capture.
5. **Every number is traceable.** Any figure on a dashboard is clickable through to the records that produced it. Unverifiable numbers destroy trust faster than missing ones.
6. **Empty states teach.** Every list's empty state shows the next action, not a shrug.
7. **Destructive and financial actions are deliberate.** Confirmation with typed intent for irreversible actions; never a lone red button next to a common one.
8. **Accessibility is a build gate, not a review item.** WCAG 2.2 AA, checked in CI.

---

## 3. Foundations

### 3.1 Colour

The UI palette is deliberately narrow: one brand hue, a full neutral ramp, four status colours, and the data-viz palette. Nothing else.

**Brand — "Petrol"** (chosen to be recognisably not-another-generic-dealer-blue, and to read as premium and mechanical rather than corporate):

| Token | Light | Dark | Use |
|---|---|---|---|
| `brand-50` | `#E6F4F1` | `#0A2E38` | Tinted backgrounds, selected rows |
| `brand-100` | `#C7E5E1` | `#0B3A47` | Hover wash |
| `brand-300` | `#5EC7DC` | `#5EC7DC` | Dark-mode accent text (9.03:1 on dark surface) |
| `brand-600` | `#0E5A6B` | `#177A8F` | **Primary actions, links** (7.80:1 on white) |
| `brand-700` | `#0B4553` | `#0E5A6B` | Hover/pressed (10.55:1 on white) |

**Accent — "Signal Amber"** — used sparingly, for a single high-emphasis CTA per view and for "attention needed" highlights. `amber-500 #F59E0B` for fills, `amber-700 #B45309` for text on light (5.02:1).

**Neutrals** (the workhorse — 90% of every screen):

| Token | Light | Dark | Contrast on own surface |
|---|---|---|---|
| `surface-1` (cards, panels) | `#FFFFFF` | `#16181D` | — |
| `surface-2` (page plane) | `#F8FAFC` | `#0E1013` | — |
| `surface-3` (table header, wells) | `#F1F5F9` | `#1D2027` | — |
| `border` (hairline) | `#E2E8F0` | `#2A2E36` | — |
| `border-strong` | `#CBD5E1` | `#3A404A` | — |
| `ink` (primary text) | `#0F172A` | `#FFFFFF` | 17.85 / 17.76 |
| `ink-muted` (secondary) | `#475569` | `#94A3B8` | 7.58 / 6.93 |
| `ink-subtle` (tertiary, meta) | `#64748B` | `#7A8598` | 4.76 |

**Status** (fixed, never themed, never reused as a series colour — always paired with an icon and a label, never colour alone):

| Role | Hex | On white | Used for |
|---|---|---|---|
| good | `#0CA30C` | 3.35 | Ready, sold, published, in budget |
| warning | `#FAB219` | 1.79 ⚠ | Aging 60–90 days, SLA approaching, prep overdue |
| serious | `#EC835A` | 2.57 ⚠ | Aging 90+, feed failure, missing evidence |
| critical | `#D03B3B` | 4.80 | Adverse provenance, compliance breach, payment failed |

⚠ `warning` and `serious` are sub-3:1 on light by design. **The icon + text label is the mitigation** — a status colour never carries meaning on its own. This is a hard rule, enforced by the `<StatusBadge>` component, which will not render without both an icon and a label.

**Vehicle status colours** (a semantic map, not free choice):

`Sourcing` slate · `Purchased` slate · `In prep` amber · `Ready` brand · `Live` good · `Reserved` violet · `Sold` ink-muted · `Delivered` ink-subtle · `On hold` serious

### 3.2 Data visualisation palette

**Do not invent chart colours.** The categorical palette below is validated (lightness band, chroma floor, colour-vision-deficiency separation, normal-vision separation, and contrast) against our exact surfaces — `#FFFFFF` light and `#16181D` dark. Both modes pass every gate.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2A78D6` | `#3987E5` |
| 2 | orange | `#EB6834` | `#D95926` |
| 3 | aqua | `#1BAF7A` | `#199E70` |
| 4 | yellow | `#EDA100` | `#C98500` |
| 5 | magenta | `#E87BA4` | `#D55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4A3AA7` | `#9085E9` |
| 8 | red | `#E34948` | `#E66767` |

Rules that are not negotiable:

- **Assign slots in fixed order and never cycle.** A ninth series folds into "Other", becomes small multiples, or the chart is wrong.
- **Colour follows the entity, never its rank.** Filtering out a series must not repaint the survivors.
- **Never a dual-axis chart.** Two measures of different scale → two charts, small multiples, or index to a common base.
- **Sequential = one hue light→dark** (default blue ramp `#CDE2FB` → `#0D366B`). **Diverging = blue ↔ red with a neutral grey midpoint** (`#F0EFEC` light, `#383835` dark). Never a rainbow.
- **Text never wears the series colour.** Labels, values and legends use ink tokens; a coloured dot or swatch beside the text carries identity.
- **All-pairs charts (scatter, bubble, choropleth) cap at three series** — slots 1–3 are the only trio that clears the all-pairs floors in both modes.
- On light mode, slots 3, 4 and 5 sit below 3:1 against white — those charts must ship **visible direct labels or a table view** (the relief rule).
- Re-run the validator if anyone ever changes these hexes. Do not eyeball it.

**Chart chrome:** gridlines `#E2E8F0` light / `#2A2E36` dark, hairline, solid, never dashed. Axis/baseline `#CBD5E1` / `#3A404A`. Axis labels in `ink-subtle`.

**Mark specs:** bars ≤24px thick with a 4px rounded data-end and a square baseline · lines 2px with round joins · markers ≥8px · area fills at ~10% opacity · a 2px surface gap between touching marks · a 2px surface ring on overlapping dots. Never a border around a mark.

### 3.3 Typography

One family: **Inter** (variable), with `system-ui` fallback. No display face, no serif, anywhere — including hero figures. A serif number on a dealer dashboard reads as decoration.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display` | 40/44 | 600 | Hero figure (exactly one per view), ≥48px on the public site |
| `h1` | 28/34 | 600 | Page title |
| `h2` | 20/28 | 600 | Section |
| `h3` | 16/24 | 600 | Card title |
| `body` | 14/20 | 400 | Default UI text |
| `body-sm` | 13/18 | 400 | Table cells, dense lists |
| `caption` | 12/16 | 400 | Meta, timestamps, helper |
| `label` | 12/16 | 500, +0.02em | Field labels, table headers (sentence case, never ALL CAPS shouting) |
| `mono` | 13/20 | 400 | Registrations, VINs, stock numbers, references — JetBrains Mono |

**Numerals:** `tabular-nums` in tables, axis ticks and any vertically-aligned column. **Proportional figures for large standalone numbers** — tabular gives `121` the width of `000` and looks loose at display size.

Public site typography is per-brand: the dealer chooses from a curated set of 6 pairings (all variable, all self-hosted, all subset). Free choice of Google Fonts is not offered — it is the single fastest way for a dealer to make their own site ugly and slow.

### 3.4 Spacing, radius, elevation

4px base scale: `0.5→2px · 1→4 · 2→8 · 3→12 · 4→16 · 5→20 · 6→24 · 8→32 · 10→40 · 12→48 · 16→64`.

Radius: `sm 4px` (badges, inputs) · `md 6px` (buttons, cards) · `lg 10px` (modals, panels) · `full` (avatars, pills).

Elevation — **borders before shadows**. Four levels only: `flat` (border only) · `raised` (`0 1px 2px rgb(15 23 42 / 0.06)`) · `overlay` (`0 8px 24px rgb(15 23 42 / 0.12)`, dropdowns/popovers) · `modal` (`0 24px 48px rgb(15 23 42 / 0.18)`). Nothing else.

### 3.5 Motion

Fast and purposeful. `100ms` hover/press · `160ms` dropdown/tooltip · `200ms` panel/drawer · `240ms` modal. Easing `cubic-bezier(0.2, 0, 0, 1)`. Full respect for `prefers-reduced-motion` — all non-essential motion becomes an instant state change. No parallax, no scroll-jacking, no decorative animation anywhere in the CRM.

### 3.6 Iconography

**Lucide**, 1.5px stroke, 16px in dense UI / 20px in navigation / 24px on mobile actions. Icons never appear alone as the only label for a destructive or ambiguous action. A small custom set for domain concepts that Lucide lacks: number plate, V5C, MOT certificate, forecourt, trade plate, part-exchange.

### 3.7 Dark mode

**Selected, not flipped.** Every token has an explicitly chosen dark value (§3.1, §3.2) validated against the dark surface. Both an OS-preference media query and an explicit user toggle are supported, with the toggle winning both ways. Dark mode is genuinely used in this sector — a sales office at 7pm in November — so it must be correct, not an afterthought.

---

## 4. Component inventory

Built on **Radix primitives via shadcn/ui**, so we own the source and the accessibility behaviour comes from the primitive rather than from our discipline.

### 4.1 Primitives
Button (primary/secondary/ghost/destructive × sm/md/lg, loading and disabled states) · IconButton · Input · Textarea · Select · Combobox (async, searchable) · MultiSelect · Checkbox · Radio · Switch · Slider · DatePicker · DateRangePicker · TimePicker · FileUpload (drag, camera, progress, retry) · Currency input (pence-safe, no float arithmetic) · **RegistrationInput** (UK plate styling, auto-uppercase, space normalisation, O/0 and I/1 tolerance) · MileageInput · Tooltip · Popover · Dropdown · Dialog · Sheet/Drawer · Tabs · Accordion · Toast · AlertBanner · Skeleton · Spinner · Progress · Avatar · Badge · **StatusBadge** (icon + label, always) · Chip · Breadcrumb · Pagination · Command palette (⌘K) · EmptyState · ErrorState · ConfirmDialog (typed-intent variant for irreversible actions).

### 4.2 Domain components — the ones that matter

| Component | Behaviour |
|---|---|
| **VehicleCard** | Photo (16:9, AVIF/WebP, blurhash placeholder), reg plate, make/model/derivative, key specs row, price, price-position pill, days-in-stock chip, status badge, health flags, quick actions. Three densities: grid, list row, compact picker. |
| **VehicleTable** | Virtualised, sticky header, resizable and reorderable columns, saved views, inline edit on price/status/assignee, multi-select with a bulk action bar, keyboard row navigation, URL-addressable filter state. |
| **RegPlate** | Renders a UK plate (yellow rear / white front variants), correct typeface proportions. Small detail, disproportionate credibility with car people. |
| **PricePosition** | A compact gauge: our price vs market retail, with the % and a colour band (under / at / over market). Tooltip shows comparables. |
| **AgingBar** | Horizontal segmented bar of the stock book by age bucket, with capital tied up per bucket. Click-through to filtered stock. |
| **PrepBoard** | Kanban with drag between stages, per-card SLA ring, blocked-state treatment, mobile-friendly single-column mode with a stage picker. |
| **DamageMap** | Tap-to-mark vehicle outline (car/van/estate silhouettes) with per-mark type, severity, photo and cost. Works with a gloved finger. |
| **MediaGrid** | Drag-reorder, hero designation, per-image processing status, bulk tag, guided-capture launcher. |
| **MOTTimeline** | Test history with a mileage line chart; anomalies flagged; advisories expandable; used on both the CRM and the public VDP. |
| **LeadThread** | Interleaved multi-channel conversation (email, SMS, WhatsApp, call notes) with channel affordances and a composer that switches channel inline. |
| **PipelineBoard** | Stage columns with aging, value totals, required-field gates on advance. |
| **DealSummary** | The deal's live financial breakdown with a permission-gated margin panel. |
| **FinancePromotion** | **The compliance primitive.** Renders any monthly payment / APR / cost-of-credit figure. It cannot mount without a valid, in-date representative example record; there is no prop combination that produces a bare payment figure. |
| **ConsentControl** | Per-channel permission with basis, source, timestamp and the exact wording version — never a bare checkbox. |
| **EvidenceTimeline** | The Deal Evidence Ledger rendered as a verifiable chain, with an export-bundle action. |
| **StatTile** | `label` (sentence case) · `value` (semibold, auto-compact: 1,284 / 12.9K / £4.2M, proportional figures) · optional `delta` (signed, vs a named period, coloured by direction × whether up is good, with an arrow icon) · optional 12-point sparkline in the de-emphasis hue. |
| **ChannelPnLTable** | The Channel P&L (functional spec §26.3) — our most persuasive screen. Sortable, drillable, exportable. |

---

## 5. CRM layout and navigation

### 5.1 Shell (desktop)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logo] Dealership ▾ | Site ▾        ⌘K Search      + New ▾  🔔  👤   │  56px
├────────┬─────────────────────────────────────────────────────────────┤
│        │  Page header: title · context · primary action              │
│  Nav   ├─────────────────────────────────────────────────────────────┤
│ 220px  │                                                             │
│ (56px  │  Content                                                    │
│ rail   │                                                             │
│ when   │                                                             │
│ collap-│                                                             │
│ sed)   │                                                             │
└────────┴─────────────────────────────────────────────────────────────┘
```

Navigation groups: **Today** (dashboard, my tasks, appointments) · **Stock** (inventory, prep, pricing, buying, suppliers) · **Customers** (leads, contacts, appointments, campaigns) · **Deals** (pipeline, deals, invoices, payments) · **Website** (pages, channels, media, analytics) · **Reports** · **Compliance** · **Settings**.

Collapsible to an icon rail; the choice is remembered per user. Badge counts on Leads (unattended) and Compliance (overdue). A per-user "pinned views" section at the top for saved stock filters and reports — dealers develop three or four views they live in.

### 5.2 Mobile

Bottom tab bar: **Today · Stock · Leads · Add · More**. "Add" is a full-screen action sheet: add vehicle (camera/reg), log a lead, appraise a part-ex, add a cost, take a photo set. Every one of those is completable one-handed, offline, with a queue that syncs later.

### 5.3 Page patterns

Six patterns, used consistently:

1. **List/table page** — filter bar (sticky), saved views, table, bulk action bar, pagination. Filters are URL state.
2. **Record page** — sticky header with identity and primary actions, tabs, right rail for related records and activity.
3. **Board page** — column config, card density toggle, per-column totals.
4. **Wizard** — for onboarding, appraisals and deal building: a visible step spine, saved drafts, "save and exit" always available, never a modal that loses work.
5. **Dashboard** — a hero figure, a KPI tile row, then at most four charts. One hero figure per view.
6. **Settings** — two-pane (nav + form), autosave with an explicit saved indicator, a change log link.

### 5.4 Keyboard

`⌘K` command palette · `g` then `s/l/d/c` to go to Stock/Leads/Deals/Contacts · `n` new (contextual) · `/` focus filter · `j/k` row navigation · `x` select row · `e` edit · `Esc` close. Every action reachable from the palette. Shortcuts are documented in a `?` overlay.

---

## 6. Public website design

### 6.1 Themes
Three at launch — **Classic** (traditional, trustworthy, good for family independents), **Studio** (editorial, photography-led, good for prestige), **Compact** (dense listings, value-focused, good for high-volume). Each theme exposes a constrained token set the dealer can edit: brand colour (with automatic contrast checking that refuses combinations failing AA), logo, typography pairing (from the curated six), corner radius, card style, and hero style.

**The dealer cannot break the design.** Every editable token is validated. If a dealer picks a brand colour that fails contrast against their chosen surface, the picker shows the failure and offers the nearest passing step. This is the difference between a theme system and a liability.

### 6.2 The vehicle detail page — layout priority

Above the fold on mobile, in this order: photo gallery → make/model/derivative → price and finance-from → key specs (year, mileage, fuel, transmission) → primary CTA row (Call · WhatsApp · Enquire · Reserve). Everything else below.

Then: full gallery · description · full specification (grouped accordion) · MOT history with mileage chart · provenance badge · declared condition and damage photos · finance calculator (inside `<FinancePromotion>`) · part-exchange widget · warranty and delivery · dealer trust block (reviews, trade bodies, years trading, FCA disclosure) · similar vehicles.

**Conversion details that matter more than they look:** a sticky mobile CTA bar; a phone number that is a `tel:` link with click tracking; WhatsApp deep-link with a pre-filled message naming the vehicle; a gallery that opens full-screen on tap and supports swipe; a "request a video walkaround" button (highest-converting single feature we can ship cheaply).

### 6.3 Search results
Facets in a mobile bottom-sheet, desktop left rail. Results update without a full page load but with real URLs (shareable, back-button correct). Facet counts always shown; zero-count options disabled, not hidden. Loading uses skeleton cards matching final dimensions — never a spinner over an empty page, never layout shift.

### 6.4 Performance budget (build fails if breached)

| Metric | Budget |
|---|---|
| LCP (p75, mobile 4G) | < 2.0s |
| INP | < 200ms |
| CLS | < 0.1 |
| JS on VDP | < 120KB gzipped |
| Total page weight (VDP, above fold) | < 500KB |
| Lighthouse Performance | ≥ 92 |
| Lighthouse Accessibility | 100 |

Enforced by Lighthouse CI on every PR against a representative VDP, results posted to the PR. This is not aspirational — it is the differentiator against incumbents' "dated on mobile" reputation, and reputations are built on numbers.

---

## 7. Content and voice

**CRM voice:** plain, direct, British. "Send quote", not "Initiate quotation workflow". Errors say what happened, why, and what to do: *"Couldn't publish to Auto Trader — their API rejected the mileage (must be a whole number). Fix the mileage and retry."* Never "An error occurred."

**Domain vocabulary — use the dealer's words, always:** forecourt (not "lot"), part-exchange / part-ex (not "trade-in"), reg or registration (not "license plate"), MOT, V5C or logbook, prep or recon, HPI check, stock (not "inventory" in dealer-facing copy — though `inventory` is fine as an internal identifier), unit, gross, deal, punter is theirs not ours.

**Numbers:** always show currency and units. Dates as `12 Aug 2026` in UI, `12/08/2026` only in dense tables. Durations in the dealer's terms — "47 days in stock", not "1,128 hours".

**Public site voice:** set per dealer via the tone-of-voice preset (Traditional / Friendly / Premium / Straight-talking), which drives the AI description generator. Guardrails apply regardless of preset: never claim a feature not in the structured data, never use pressure language, never make an unsubstantiated environmental or performance claim, never state a cost-of-credit figure outside `<FinancePromotion>`.

---

## 8. Accessibility

WCAG 2.2 AA, verified by axe-core in CI on every page type plus a manual keyboard-and-screen-reader pass before each release.

- Text contrast ≥4.5:1 (≥3:1 for ≥18.66px bold or ≥24px); UI components and focus indicators ≥3:1
- Visible focus ring on every interactive element: 2px `brand-600` at 2px offset. Never `outline: none` without a replacement.
- Full keyboard operability; logical tab order; focus trapped in modals and returned on close
- Every form field has a persistent visible label (placeholders are not labels); errors are associated via `aria-describedby` and announced
- Live regions for async results (search counts, save confirmations, publish status)
- Charts: never colour alone — legend always present for ≥2 series, direct labels for ≤4, a table view available on every chart, and an opt-in texture channel for CVD, print and `forced-colors`
- Images: meaningful alt text auto-generated from vehicle data (`"2019 Ford Fiesta ST-Line, front three-quarter view"`), decorative images marked
- Target size ≥24×24px minimum (AA), ≥44×44px on mobile primary actions
- `prefers-reduced-motion` honoured throughout
- Public sites inherit all of this — an inaccessible dealer website is the dealer's legal exposure and our reputational one

---

## 9. Implementation

**Tokens.** A single `tokens.json` (W3C Design Tokens format) is the source of truth → Style Dictionary generates the Tailwind theme, CSS custom properties, and a TypeScript type union. Nobody writes a hex code in a component. A lint rule fails the build on raw colour values outside the token files.

**Structure.**
```
packages/ui/           shared primitives + domain components + tokens
apps/crm/              authenticated dealer application
apps/site/             public multi-tenant website renderer
apps/admin/            platform administration
```

**Storybook** for every component, with all states (default, hover, focus, disabled, loading, error, empty) and both colour modes. Chromatic visual regression on every PR — this is what stops a design system rotting.

**Definition of done for any UI work:** Storybook story with all states · both modes · keyboard operable · axe clean · responsive at 375 / 768 / 1280 / 1920 · loading and error and empty states designed · copy reviewed against §7 · performance budget unaffected.

---

## 10. What "professional" means here — a checklist

Print this and hold every screen against it:

- [ ] Could a dealer principal understand this screen in 10 seconds without training?
- [ ] Is every number on it clickable through to its source?
- [ ] Does it work one-handed on a phone in a workshop?
- [ ] Is there exactly one obvious primary action?
- [ ] Does the empty state teach the next step?
- [ ] Does the error state say what to do, not just what failed?
- [ ] Is any colour carrying meaning without a label or icon beside it?
- [ ] Would this look current in three years, or is it wearing this year's trend?
- [ ] Does it load in under two seconds on a bad connection?
- [ ] If the dealer showed it to a customer over their shoulder, would they be proud of it?
