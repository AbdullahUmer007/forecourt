# Design tokens

Source of truth is `packages/ui/tokens.json` (W3C Design Tokens format). Style Dictionary generates the Tailwind theme, CSS custom properties, and a TypeScript type union from it. **Nobody writes a hex code in a component.**

## CSS custom property scaffold

```css
:root {
  color-scheme: light;

  /* Brand — "Petrol" */
  --brand-50:  #E6F4F1;
  --brand-100: #C7E5E1;
  --brand-300: #5EC7DC;
  --brand-600: #0E5A6B;   /* primary action, link — 7.80:1 on white */
  --brand-700: #0B4553;   /* hover/pressed — 10.55:1 on white */

  /* Accent — "Signal Amber", used sparingly */
  --accent-500: #F59E0B;  /* fills */
  --accent-700: #B45309;  /* text on light — 5.02:1 */

  /* Surfaces */
  --surface-1: #FFFFFF;   /* cards, panels, chart surface */
  --surface-2: #F8FAFC;   /* page plane */
  --surface-3: #F1F5F9;   /* table headers, wells */

  /* Lines */
  --border:        #E2E8F0;
  --border-strong: #CBD5E1;

  /* Ink */
  --ink:        #0F172A;  /* 17.85:1 */
  --ink-muted:  #475569;  /* 7.58:1 */
  --ink-subtle: #64748B;  /* 4.76:1 */

  /* Status — fixed, never themed, always with an icon + label */
  --status-good:     #0CA30C;
  --status-warning:  #FAB219;
  --status-serious:  #EC835A;
  --status-critical: #D03B3B;

  /* Data-viz categorical — fixed order, never cycled */
  --series-1: #2A78D6;  --series-2: #EB6834;
  --series-3: #1BAF7A;  --series-4: #EDA100;
  --series-5: #E87BA4;  --series-6: #008300;
  --series-7: #4A3AA7;  --series-8: #E34948;

  /* Chart chrome */
  --grid:     #E2E8F0;
  --axis:     #CBD5E1;
  --delta-up: #006300;

  /* Radius */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px;

  /* Elevation */
  --elev-raised:  0 1px 2px  rgb(15 23 42 / 0.06);
  --elev-overlay: 0 8px 24px rgb(15 23 42 / 0.12);
  --elev-modal:   0 24px 48px rgb(15 23 42 / 0.18);
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) { /* dark values below */ }
}
:root[data-theme="dark"] {
  color-scheme: dark;

  --brand-600: #177A8F;  --brand-700: #0E5A6B;
  --brand-50:  #0A2E38;  --brand-100: #0B3A47;

  --surface-1: #16181D;  --surface-2: #0E1013;  --surface-3: #1D2027;
  --border:    #2A2E36;  --border-strong: #3A404A;
  --ink:       #FFFFFF;  --ink-muted: #94A3B8;  --ink-subtle: #7A8598;

  --series-1: #3987E5;  --series-2: #D95926;
  --series-3: #199E70;  --series-4: #C98500;
  --series-5: #D55181;  --series-6: #008300;
  --series-7: #9085E9;  --series-8: #E66767;

  --grid: #2A2E36;  --axis: #3A404A;  --delta-up: #0CA30C;
}
```

Declare dark values under **both** the media query and the `data-theme` scope, with the `:not()` guard, so an explicit light stamp beats OS-dark and the toggle wins both ways.

## Sequential ramp (single hue, blue)

`100 #CDE2FB` · `150 #B7D3F6` · `200 #9EC5F4` · `250 #86B6EF` · `300 #6DA7EC` · `350 #5598E7` · `400 #3987E5` · `450 #2A78D6` · `500 #256ABF` · `550 #1C5CAB` · `600 #184F95` · `650 #104281` · `700 #0D366B`

Full range for **sequential** encoding (continuous magnitude). For an **ordinal** ramp (discrete ordered marks — funnel stages, tiers) the step nearest the surface must still clear 2:1: on light start no lighter than **250**; on dark go no darker than **600**.

Diverging pair: **blue ↔ red**, neutral grey midpoint `#F0EFEC` light / `#383835` dark. Equal step count per arm.

## Spacing scale (4px base)

`0.5→2px · 1→4 · 2→8 · 3→12 · 4→16 · 5→20 · 6→24 · 8→32 · 10→40 · 12→48 · 16→64`

## Typography scale

| Token | Size/LH | Weight | Use |
|---|---|---|---|
| `display` | 40/44 | 600 | Hero figure (one per view); ≥48px on public sites |
| `h1` | 28/34 | 600 | Page title |
| `h2` | 20/28 | 600 | Section |
| `h3` | 16/24 | 600 | Card title |
| `body` | 14/20 | 400 | Default |
| `body-sm` | 13/18 | 400 | Tables, dense lists |
| `caption` | 12/16 | 400 | Meta, helper |
| `label` | 12/16 | 500, +0.02em | Field labels, table headers |
| `mono` | 13/20 | 400 | Reg, VIN, stock no, references |

## Vehicle status colour map

| Status | Token |
|---|---|
| Sourcing, Purchased, In transit | `ink-subtle` / slate |
| Booked in, In prep | `status-warning` |
| Ready | `brand-600` |
| Live | `status-good` |
| Reserved | `series-7` (violet) |
| Sold | `ink-muted` |
| Delivered | `ink-subtle` |
| On hold | `status-serious` |
| Written off, Trade disposal | `status-critical` |

Always rendered through `<StatusBadge>` with an icon and a text label.

## Public site theme tokens (dealer-editable)

Only these are exposed to a dealer, and every one is validated before it can be saved:

| Token | Constraint |
|---|---|
| `brand-primary` | Must pass AA against the theme's chosen surface. The picker shows the failure and offers the nearest passing step. |
| `logo-light`, `logo-dark` | SVG or PNG ≥2× |
| `typography-pairing` | One of six curated variable-font pairings |
| `radius` | One of three: sharp / soft / rounded |
| `card-style` | One of three: bordered / elevated / flat |
| `hero-style` | One of three: full-bleed / split / search-first |

**A dealer cannot break the design.** That is the point of a constrained theme system.

## Validating a palette change

Never eyeball a colour decision. If a series or status hex changes, re-run the validator against both surfaces:

```bash
node scripts/validate_palette.js "<hex,hex,…>" --mode light --surface "#FFFFFF"
node scripts/validate_palette.js "<hex,hex,…>" --mode dark  --surface "#16181D"
```

Both must pass the lightness band, chroma floor, adjacent-pair CVD separation (ΔE ≥ 8), the normal-vision floor (ΔE ≥ 15) and contrast. The current palette passes both; a contrast WARN obligates visible labels or a table view and is not dismissable.
