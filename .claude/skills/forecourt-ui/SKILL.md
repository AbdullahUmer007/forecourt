---
name: forecourt-ui
description: Forecourt design system - tokens, components, layout patterns, accessibility and performance budgets for the dealer CRM and the public dealer websites. Use whenever building or reviewing any UI, screen, component, page, dashboard, chart, form, table or email template in the Forecourt product. Trigger words - screen, page, component, UI, layout, dashboard, table, form, chart, theme, dark mode, styling, Tailwind, shadcn, accessibility.
---

# Forecourt design system

Read `references/tokens.md` for the full token values and `references/patterns.md` for screen recipes. This file is the contract every piece of UI must satisfy.

## The two personalities

| | CRM (Office) | Public dealer website |
|---|---|---|
| User | Staff, 6+ hours/day | A buyer, 3 minutes, on a phone |
| Priority | Density, speed, keyboard, information | Photography, clarity, trust, conversion |
| Voice | Calm, quiet, tool-like | Confident, spacious, the car is the hero |

Never bring CRM density to a public site, or public-site spaciousness to a stock list.

## Non-negotiables

1. **No raw hex codes.** Everything comes from `tokens.json` via Tailwind/CSS custom properties. A lint rule fails the build on a literal colour outside the token files.
2. **Colour never carries meaning alone.** Every status colour ships with an icon **and** a text label. `<StatusBadge>` will not render without both.
3. **Borders before shadows.** Four elevation levels exist; nothing else.
4. **One primary action per view.** One hero figure per dashboard.
5. **Every number is clickable through to its source records.** An unverifiable figure destroys trust in the whole dashboard.
6. **Every list has a designed empty state that teaches the next action**, and an error state that says what to do — not just what failed.
7. **44px minimum touch targets on mobile**; 24px minimum everywhere (WCAG 2.2 AA).
8. **Visible focus ring on everything interactive**: 2px `brand-600` at 2px offset. `outline: none` without a replacement fails review.
9. **`prefers-reduced-motion` honoured throughout.** No parallax, no scroll-jacking, no decorative animation in the CRM ever.
10. **Dark mode is selected, not flipped.** Every token has an explicitly chosen dark value validated against the dark surface.

## Colour, in one screen

```
brand-600  #0E5A6B   primary actions, links      (7.80:1 on white)
brand-700  #0B4553   hover/pressed              (10.55:1 on white)
brand-300  #5EC7DC   dark-mode accent text       (9.03:1 on #16181D)
accent     #F59E0B   one high-emphasis CTA; amber-700 #B45309 for text on light

surface-1  #FFFFFF / #16181D    cards, panels
surface-2  #F8FAFC / #0E1013    page plane
surface-3  #F1F5F9 / #1D2027    table headers, wells
border     #E2E8F0 / #2A2E36    hairlines
ink        #0F172A / #FFFFFF    primary text
ink-muted  #475569 / #94A3B8    secondary
ink-subtle #64748B / #7A8598    meta

status: good #0CA30C · warning #FAB219 · serious #EC835A · critical #D03B3B
```

`warning` and `serious` are sub-3:1 on light **by design** — the icon + label pairing is the mitigation. A status colour never carries meaning alone.

## Charts — the rules that get broken most

The categorical palette below is **validated** (lightness band, chroma floor, CVD separation, normal-vision separation, contrast) against our exact surfaces. Do not invent chart colours. If you change a hex, re-run the validator; do not eyeball it.

| Slot | Light | Dark |
|---|---|---|
| 1 blue | `#2A78D6` | `#3987E5` |
| 2 orange | `#EB6834` | `#D95926` |
| 3 aqua | `#1BAF7A` | `#199E70` |
| 4 yellow | `#EDA100` | `#C98500` |
| 5 magenta | `#E87BA4` | `#D55181` |
| 6 green | `#008300` | `#008300` |
| 7 violet | `#4A3AA7` | `#9085E9` |
| 8 red | `#E34948` | `#E66767` |

- Assign slots **in fixed order, never cycled**. A ninth series folds into "Other" or becomes small multiples.
- **Colour follows the entity, never its rank.** Filtering out a series must not repaint the survivors.
- **Never a dual-axis chart.** Two measures of different scale → two charts, small multiples, or index to a common base. This is the single most common chart mistake.
- Sequential = one hue light→dark. Diverging = blue ↔ red with a **neutral grey** midpoint. Never a rainbow, never a hue at the midpoint.
- **Text never wears the series colour.** Values, labels and legends use ink tokens; a coloured dot or swatch beside the text carries identity.
- Legend always present for ≥2 series (none for one — the title names it); direct labels for ≤4 series, and **never a number on every point**.
- Scatter/bubble/choropleth cap at **three** series — slots 1–3 are the only trio that clears the all-pairs floors in both modes.
- On light mode, slots 3, 4 and 5 are sub-3:1 against white — those charts must ship visible direct labels or a table view.
- Marks: bars ≤24px thick, 4px rounded data-end square at the baseline · lines 2px · markers ≥8px · area fill ~10% opacity · 2px surface gap between touching marks · 2px surface ring on overlapping dots. Never a border around a mark.
- Gridlines hairline, solid, recessive. Never dashed.
- Every chart has a table view.

**Stat tile contract:** `label` (sentence case, no trailing colon) · `value` (semibold, auto-compact `1,284` / `12.9K` / `£4.2M`, **proportional figures**) · optional `delta` (signed, versus a *named* period, coloured by direction × whether up is good, with an arrow icon) · optional 12-point sparkline in the de-emphasis hue.

**Figures:** `tabular-nums` only in columns that must align vertically (table rows, axis ticks). Large standalone numbers use proportional figures — tabular makes `121` look loose at display size.

## Typography

One family: **Inter** variable, `system-ui` fallback. **No display or serif face anywhere**, including hero figures. `JetBrains Mono` for registrations, VINs, stock numbers and references.

`display 40/44 600` · `h1 28/34 600` · `h2 20/28 600` · `h3 16/24 600` · `body 14/20 400` · `body-sm 13/18 400` · `caption 12/16 400` · `label 12/16 500 +0.02em` (sentence case, never ALL CAPS).

Public sites choose from **six curated pairings** only. Free Google Fonts choice is not offered — it is the fastest way for a dealer to make their own site ugly and slow.

## Spacing, radius, motion

4px scale. Radius `sm 4` (badges, inputs) · `md 6` (buttons, cards) · `lg 10` (modals, panels) · `full`.
Motion `100ms` hover/press · `160ms` dropdown · `200ms` drawer · `240ms` modal, easing `cubic-bezier(0.2,0,0,1)`.

## Performance budgets — build gates, not aspirations

Public dealer sites (Lighthouse CI on every PR, against a representative vehicle detail page):

| Metric | Budget |
|---|---|
| LCP (p75, mobile 4G) | < 2.0s |
| INP | < 200ms |
| CLS | < 0.1 |
| JS on the VDP | < 120KB gzipped |
| Above-fold page weight | < 500KB |
| Lighthouse Performance | ≥ 92 |
| Lighthouse Accessibility | 100 |

CRM: p95 interaction < 500ms · global search < 200ms · a 1,000-row stock list filtering in < 400ms.

## Copy

Plain, direct, British. "Send quote", not "Initiate quotation workflow". Errors say what happened, why, and what to do:

> ✅ "Couldn't publish to Auto Trader — their API rejected the mileage (must be a whole number). Fix the mileage and retry."
> ❌ "An error occurred."

Use the trade's vocabulary — forecourt, part-exchange, reg, MOT, V5C, prep, HPI check, unit, gross. Never Americanise. See the `forecourt-domain` skill.

## Definition of done

- [ ] Storybook story with every state: default, hover, focus, disabled, loading, error, empty
- [ ] Both colour modes, using tokens only
- [ ] Keyboard operable, logical tab order, focus visible and returned on modal close
- [ ] axe-core clean
- [ ] Responsive at 375 / 768 / 1280 / 1920
- [ ] Empty, loading and error states designed — not afterthoughts
- [ ] Copy reviewed against the voice rules
- [ ] Performance budget unaffected
- [ ] If it contains a chart: legend/labels present, table view available, palette unchanged, no dual axis
- [ ] If it can display a monthly payment or APR: it goes through `<FinancePromotion>` and cannot render without a valid representative example

## The professional checklist

Hold every screen against this:

- Could a dealer principal understand it in 10 seconds without training?
- Is every number clickable through to its source?
- Does it work one-handed on a phone in a workshop?
- Is there exactly one obvious primary action?
- Does the empty state teach the next step?
- Is any colour carrying meaning without a label or icon beside it?
- Would this look current in three years, or is it wearing this year's trend?
- Does it load in under two seconds on a bad connection?
- If the dealer showed it to a customer over their shoulder, would they be proud of it?
