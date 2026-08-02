/**
 * M6b — theme tokens as CSS custom properties.
 *
 * Design system rule 1: no raw hex codes in components. Every colour a page
 * uses comes from here, so a dealer's brand colour swaps in one place and a
 * lint rule can fail the build on a literal colour elsewhere.
 *
 * Dealers get a CONSTRAINED token set (`04-design-system.md` §6.1). A brand
 * colour that fails AA contrast against its surface cannot be saved — the
 * picker offers the nearest passing step instead. That is the difference
 * between a theme system and a liability.
 */

export interface BrandTheme {
  brandPrimary: string;
  brandPrimaryHover: string;
  radius: 'sharp' | 'soft' | 'rounded';
  cardStyle: 'bordered' | 'elevated' | 'flat';
  fontStack: string;
}

export const DEFAULT_THEME: BrandTheme = {
  brandPrimary: '#0E5A6B',       // brand-600 — 7.80:1 on white
  brandPrimaryHover: '#0B4553',  // brand-700 — 10.55:1 on white
  radius: 'soft',
  cardStyle: 'bordered',
  fontStack: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`,
};

const RADIUS: Record<BrandTheme['radius'], { sm: string; md: string; lg: string }> = {
  sharp: { sm: '2px', md: '2px', lg: '4px' },
  soft: { sm: '4px', md: '6px', lg: '10px' },
  rounded: { sm: '8px', md: '12px', lg: '18px' },
};

/**
 * Critical CSS, inlined in the document head.
 *
 * Inlined rather than linked because a render-blocking stylesheet request is
 * the most common cause of a slow LCP on mobile, and the budget is 2.0s at
 * p75 over 4G. It is small enough that inlining is cheaper than a round trip.
 */
export function criticalCss(theme: BrandTheme = DEFAULT_THEME): string {
  const r = RADIUS[theme.radius];
  return `
:root{color-scheme:light dark;
--brand:${theme.brandPrimary};--brand-hover:${theme.brandPrimaryHover};
--surface-1:#FFFFFF;--surface-2:#F8FAFC;--surface-3:#F1F5F9;
--border:#E2E8F0;--ink:#0F172A;--ink-muted:#475569;--ink-subtle:#64748B;
--good:#0CA30C;--warning:#FAB219;--critical:#D03B3B;
/* warning is sub-3:1 on white by design — this is its text-safe partner. */
--warning-ink:#B45309;
--brand-50:#E6F4F1;--series-1:#2A78D6;
--plate-face:#FCD617;--plate-band:#0A3EA1;--plate-edge:#B8A400;--plate-ink:#111111;
--radius-sm:${r.sm};--radius-md:${r.md};--radius-lg:${r.lg};
--font:${theme.fontStack};
--maxw:1200px}
@media(prefers-color-scheme:dark){:root{
--surface-1:#16181D;--surface-2:#0E1013;--surface-3:#1D2027;
--border:#2A2E36;--ink:#FFFFFF;--ink-muted:#94A3B8;--ink-subtle:#7A8598;
--warning-ink:#FAB219;--brand-50:#0A2E38;--series-1:#3987E5}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:var(--font);color:var(--ink);background:var(--surface-2);
font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--brand);text-decoration-thickness:1px;text-underline-offset:2px}
a:hover{color:var(--brand-hover)}
/* Visible focus on everything interactive — design system rule 8. */
:where(a,button,input,select,textarea,summary):focus-visible{
outline:2px solid var(--brand);outline-offset:2px;border-radius:var(--radius-sm)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 16px}
.vdp-gallery{background:var(--surface-3)}
/* aspect-ratio reserves the box before the image loads: CLS budget is 0.1. */
.vdp-hero{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--surface-3)}
@media(min-width:768px){.vdp-hero{aspect-ratio:16/9}}
.vdp-head{padding:16px 0 8px}
.vdp-title{font-size:24px;line-height:1.25;font-weight:600;margin:0 0 4px}
@media(min-width:768px){.vdp-title{font-size:28px;line-height:34px}}
.vdp-price{font-size:28px;font-weight:600;margin:8px 0 0}
.vdp-specs{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0 0;padding:0;list-style:none;
color:var(--ink-muted);font-size:14px}
.vdp-specs b{color:var(--ink);font-weight:600}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin:16px 0}
.card h2{font-size:20px;line-height:28px;font-weight:600;margin:0 0 12px}
/* A proper GB plate: yellow field, blue UK band. Car people notice. */
.reg{display:inline-flex;height:30px;border:1px solid var(--plate-edge);border-radius:4px;
overflow:hidden;vertical-align:middle}
.reg-band{width:18px;background:var(--plate-band);color:var(--plate-face);font-size:8px;
font-weight:700;display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px}
.reg-no{padding:0 9px;display:flex;align-items:center;font-family:"JetBrains Mono",ui-monospace,monospace;
font-weight:700;font-size:17px;letter-spacing:.06em;color:var(--plate-ink)}
/* Price context — the pricing-intelligence differentiator, on the public page. */
.price-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:8px 0 0}
.price-label{font-size:13px;color:var(--ink-subtle)}
.price-drop{font-size:14px;font-weight:600;color:var(--good)}
.price-guide{font-size:14px;color:var(--ink-muted)}
/* Fact blocks: provenance, declared marks, EV battery health. */
.facts{display:grid;grid-template-columns:1fr;gap:12px;margin:16px 0}
@media(min-width:768px){.facts{grid-template-columns:repeat(3,1fr)}}
.fact{border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;background:var(--surface-1)}
.fact-head{display:flex;align-items:center;gap:8px;font-weight:600;margin:0 0 4px}
.fact-note{margin:0;font-size:14px;color:var(--ink-muted)}
.fact-mark{width:20px;height:20px;border-radius:999px;display:flex;align-items:center;
justify-content:center;font-size:12px;font-weight:700;flex:0 0 auto}
.mark-good{background:var(--brand-50);color:var(--good)}
.mark-warn{background:var(--brand-50);color:var(--warning-ink)}
/* Mileage chart — 2px line, >=8px markers, recessive hairline grid. */
.mileage-chart{width:100%;height:auto;margin:0 0 8px}
.mileage-chart .grid{stroke:var(--border);stroke-width:1}
.mileage-chart .series{stroke:var(--series-1);stroke-width:2;fill:none;
stroke-linejoin:round;stroke-linecap:round}
.mileage-chart .pt{fill:var(--series-1);stroke:var(--surface-1);stroke-width:2}
.mileage-chart .axis{fill:var(--ink-subtle);font-size:11px}
/* Declared marks: the caption names the fault above its photograph. */
.declared{margin:0 0 16px}
.declared figcaption{font-weight:600;font-size:14px;margin:0 0 6px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;
padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-1)}
.badge-good{color:var(--good)}
.cta-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}
@media(min-width:768px){.cta-row{grid-template-columns:repeat(4,1fr)}}
/* 44px minimum touch target on mobile — WCAG 2.2 AA. */
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;padding:12px 16px;
border-radius:var(--radius-md);font-weight:600;font-size:15px;text-decoration:none;
border:1px solid var(--brand);color:var(--brand);background:var(--surface-1)}
.btn-primary{background:var(--brand);color:#fff;border-color:var(--brand)}
.btn-primary:hover{background:var(--brand-hover);color:#fff}
/* The sticky bar is why a phone user never has to scroll back up to call. */
.sticky-cta{position:sticky;bottom:0;z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:8px;
padding:8px 16px;background:var(--surface-1);border-top:1px solid var(--border)}
@media(min-width:768px){.sticky-cta{display:none}}
.mot-table{width:100%;border-collapse:collapse;font-size:14px}
.mot-table th,.mot-table td{text-align:left;padding:8px 4px;border-bottom:1px solid var(--border)}
.mot-table th{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--ink-subtle)}
.mot-table td{font-variant-numeric:tabular-nums}
.spec-grid{display:grid;grid-template-columns:1fr;gap:0}
@media(min-width:640px){.spec-grid{grid-template-columns:1fr 1fr;gap:0 32px}}
.spec-grid div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--border)}
.spec-grid dt{color:var(--ink-muted)}
.spec-grid dd{margin:0;font-weight:500;text-align:right}
/* ---------------------------------------------------------- results page */
.results-title{font-size:24px;line-height:1.25;font-weight:600;margin:12px 0 8px}
@media(min-width:768px){.results-title{font-size:28px;line-height:34px}}
.keyword{display:flex;gap:8px;margin:0 0 16px}
.keyword input{flex:1;min-height:48px;padding:0 12px;font-size:16px;
border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-1);color:var(--ink)}
.results-layout{display:grid;grid-template-columns:1fr;gap:24px;align-items:start}
@media(min-width:1024px){.results-layout{grid-template-columns:260px 1fr}}
.filters{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.chips-head{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--ink-subtle);margin:0;width:100%}
.chip{display:inline-flex;align-items:center;min-height:32px;padding:4px 10px;font-size:13px;
border:1px solid var(--border);border-radius:999px;background:var(--surface-3);
color:var(--ink);text-decoration:none}
.chip-clear{background:transparent;color:var(--brand)}
.facet{margin:0 0 16px}
.facet-head{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--ink-subtle);margin:0 0 4px}
.facet-list{list-style:none;margin:0;padding:0}
.facet-opt a,.facet-opt span{display:flex;justify-content:space-between;gap:12px;
min-height:32px;align-items:center;padding:2px 4px;font-size:14px;
color:var(--ink);text-decoration:none;border-radius:var(--radius-sm)}
.facet-opt a:hover{background:var(--surface-3);color:var(--ink)}
.facet-opt.is-selected a{font-weight:600;color:var(--brand)}
/* A zero-count option stays visible, greyed and unclickable — a sidebar whose
   options appear and vanish is impossible to filter with. */
.facet-opt.is-disabled span{color:var(--ink-subtle);cursor:default}
.facet-count{font-variant-numeric:tabular-nums;color:var(--ink-subtle);font-size:13px}
.sortbar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between;margin:0 0 12px}
.count{margin:0;font-size:14px;color:var(--ink-muted)}
.sorts{display:flex;flex-wrap:wrap;gap:4px 12px}
.sort{font-size:13px;color:var(--ink-muted);text-decoration:none;min-height:32px;display:flex;align-items:center}
.sort.is-current{color:var(--ink);font-weight:600;text-decoration:underline}
.grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.grid{grid-template-columns:repeat(3,1fr)}}
.v-card{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);
padding:12px;display:flex;flex-direction:column}
.v-card-link{text-decoration:none;color:inherit}
.v-thumb{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-sm);background:var(--surface-3)}
.v-thumb-empty{display:block}
.v-name{font-size:16px;line-height:24px;font-weight:600;margin:8px 0 0}
.v-badges{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}
.badge-reduced{color:var(--good)}
.badge-reserved{color:var(--warning-ink)}
.badge-just-arrived,.badge-low-mileage{color:var(--ink-muted)}
.v-price{font-size:20px;font-weight:600;margin:8px 0 0}
.v-specs{display:flex;flex-wrap:wrap;gap:4px 12px;list-style:none;margin:6px 0 0;padding:0;
font-size:13px;color:var(--ink-muted)}
.v-save{margin:12px 0 0}
.btn-save{width:100%;font-size:14px}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0}
.pager-pos{font-size:14px;color:var(--ink-muted)}
.zero{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin:0 0 16px}
.zero h2{font-size:20px;line-height:28px;margin:0 0 8px}
.zero-relaxed{font-size:15px}
.notify{border-top:1px solid var(--border);margin:16px 0 0;padding:16px 0 0}
.notify h3{font-size:16px;margin:0 0 4px}
.notify input[type=email]{width:100%;max-width:360px;min-height:48px;padding:0 12px;font-size:16px;
border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-1);color:var(--ink)}
.consent{font-size:13px;color:var(--ink-muted);max-width:60ch}
.consent input{min-width:24px;min-height:24px;margin-right:8px}
footer{padding:32px 0;color:var(--ink-muted);font-size:14px;border-top:1px solid var(--border);margin-top:32px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.replace(/\n\s*/g, '').trim();
}
