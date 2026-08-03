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
/* The brand colour has TWO jobs and they need different values in dark mode.
   --brand fills a surface (white text sits on it); --brand-text IS the text.
   brand-600 is 7.80:1 on white but only 1.8:1 on the dark surface, so brand
   text on dark uses brand-300, which the design system validated at 9.03:1.
   Conflating the two is why dark mode looked broken. */
--brand-text:${theme.brandPrimary};--brand-text-hover:${theme.brandPrimaryHover};
--surface-1:#FFFFFF;--surface-2:#F8FAFC;--surface-3:#F1F5F9;
--border:#E2E8F0;--ink:#0F172A;--ink-muted:#475569;--ink-subtle:#64748B;
--good:#0CA30C;--warning:#FAB219;--critical:#D03B3B;
/* warning is sub-3:1 on white by design — this is its text-safe partner. */
--warning-ink:#B45309;
--brand-50:#E6F4F1;--series-1:#2A78D6;
/* accent-500 is a FILL only — 1.9:1 on white, so it never carries text on a
   light surface. Dark ink sits on it (11.4:1). accent-700 is its text-safe
   partner, already here as --warning-ink. One high-emphasis moment per page. */
--accent:#F59E0B;--accent-ink:#0F172A;
--plate-face:#FCD617;--plate-band:#0A3EA1;--plate-edge:#B8A400;--plate-ink:#111111;
--media-bg:#F1F5F9;
--radius-sm:${r.sm};--radius-md:${r.md};--radius-lg:${r.lg};
--font:${theme.fontStack};
--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
/* The DARK PLANE. Declared condition and the enquiry sit on it in BOTH colour
   modes — it is a deliberate change of surface, not a dark-mode artefact, and
   it is what stops every section reading as the same grey card. Brand as text
   on this plane must be brand-300; brand-600 is 1.8:1 here. */
--plane:#16181D;--plane-ink:#FFFFFF;--plane-muted:#94A3B8;
--plane-border:#2A2E36;--plane-well:#1D2027;--plane-link:#5EC7DC;
/* Hatched placeholder for a media box that has no photograph yet. */
--stripe:rgba(15,23,42,0.05);
--maxw:1280px;
/* Type scale. The previous build topped out at 28px and everything sat
   within 8px of everything else, so nothing had rank. These are the sizes
   the design annotated; the clamps carry them from 375px to 1920px. */
--t-display:clamp(40px,5.4vw,76px);
--t-h1:clamp(26px,3.1vw,44px);
--t-h2:clamp(20px,2.1vw,28px);
--t-h2-lg:clamp(26px,3.2vw,44px);
--t-lead:clamp(16px,1.5vw,20px);
--t-body:16px;--t-sm:14px;--t-xs:13px;--t-2xs:12px}
@media(prefers-color-scheme:dark){:root{
--surface-1:#16181D;--surface-2:#0E1013;--surface-3:#1D2027;
--border:#2A2E36;--ink:#FFFFFF;--ink-muted:#94A3B8;--ink-subtle:#7A8598;
--warning-ink:#FAB219;--brand-50:#0A2E38;--series-1:#3987E5;
--brand-text:#5EC7DC;--brand-text-hover:#8FDCEB;
/* Placeholder and empty-media surfaces, so a missing photograph is a dark
   hole rather than a white one. */
--media-bg:#1D2027;--stripe:rgba(255,255,255,0.05);
/* The plane is unchanged in dark mode — it is already the dark surface. What
   must change is its BORDER against a now-dark page, or the section edge
   disappears entirely. */
--plane-border:#333842}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:var(--font);color:var(--ink);background:var(--surface-2);
font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--brand-text);text-decoration-thickness:1px;text-underline-offset:2px}
a:hover{color:var(--brand-text-hover)}
/* Visible focus on everything interactive — design system rule 8. */
:where(a,button,input,select,textarea,summary):focus-visible{
outline:2px solid var(--brand-text);outline-offset:2px;border-radius:var(--radius-sm)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 clamp(16px,3vw,32px)}
/* ------------------------------------------------------------- masthead
   A dealer's own website with no logo, no phone number and no navigation
   looks like nobody's. The page used to begin at the breadcrumb. */
.masthead{position:sticky;top:0;z-index:30;background:var(--surface-1);
border-bottom:1px solid var(--border)}
.masthead-in{max-width:var(--maxw);margin:0 auto;padding:8px clamp(16px,3vw,32px);
display:flex;align-items:center;gap:12px}
.brand{display:flex;flex-direction:column;justify-content:center;min-height:44px;
min-width:0;flex:1 1 auto;text-decoration:none;color:inherit}
.brand:hover{color:inherit}
.brand-name{font-size:clamp(15px,1.7vw,21px);font-weight:700;letter-spacing:-.022em;
line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand-open{display:flex;align-items:center;gap:5px;font-size:var(--t-2xs);line-height:15px;
font-weight:500;color:var(--ink-subtle);white-space:nowrap}
.dot{width:7px;height:7px;border-radius:999px;background:var(--good);flex:none}
.dot-shut{background:var(--ink-subtle)}
/* On a narrow phone the full number pushed the brand block off the edge and
   clipped the town out of the opening line. Below 480px the button collapses
   to the icon alone — it is still a 44px target and still the highest-intent
   control on the page, and the number itself is in the footer and the CTA. */
.masthead-tel{flex:none;display:flex;align-items:center;justify-content:center;gap:6px;
min-height:44px;min-width:44px;padding:0 11px;border-radius:var(--radius-md);
background:var(--brand);color:#fff;font-size:15px;font-weight:600;
white-space:nowrap;text-decoration:none}
@media(max-width:479px){.masthead-tel .tel-no{position:absolute;width:1px;height:1px;
padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}}
.masthead-tel:hover{background:var(--brand-hover);color:#fff}
.mainnav{background:var(--surface-1);border-bottom:1px solid var(--border)}
.mainnav-in{max-width:var(--maxw);margin:0 auto;padding:0 clamp(16px,3vw,32px);
display:flex;gap:clamp(14px,1.6vw,24px);overflow-x:auto}
.mainnav a{display:flex;align-items:center;min-height:40px;font-size:var(--t-sm);font-weight:500;
white-space:nowrap;color:var(--ink-muted);text-decoration:none}
.mainnav a:hover{color:var(--brand-text)}
.crumbs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 0;
font-size:var(--t-xs);line-height:18px;color:var(--ink-subtle)}
.crumbs a{color:inherit;text-decoration:none;min-height:24px;display:flex;align-items:center}
.crumbs a:hover{color:var(--brand-text)}
/* ------------------------------------------------------------------ hero */
.hero{max-width:var(--maxw);margin:0 auto;padding:0 clamp(16px,3vw,32px) 40px;
display:flex;flex-wrap:wrap;gap:clamp(16px,2.5vw,32px);align-items:start}
.hero-media{flex:1 1 min(100%,620px);min-width:0}
.hero-buy{flex:1 1 min(100%,340px);min-width:0;display:flex;flex-direction:column;
gap:clamp(16px,2vw,24px)}
.gallery-frame{position:relative;border-radius:var(--radius-lg);overflow:hidden;
background:var(--media-bg);border:1px solid var(--border)}
/* CSS scroll-snap: a swipeable gallery with no JavaScript at all. */
.gallery-rail{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}
.gallery-rail figure{margin:0;flex:0 0 100%;scroll-snap-align:center}
/* aspect-ratio reserves the box before the image loads: CLS budget is 0.1. */
.vdp-hero{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--media-bg);display:block}
@media(min-width:768px){.vdp-hero{aspect-ratio:3/2}}
.gallery-badges{position:absolute;top:12px;left:12px;display:flex;gap:8px;flex-wrap:wrap;margin:0}
.gallery-all{position:absolute;bottom:12px;right:12px;display:flex;align-items:center;gap:8px;
min-height:44px;padding:0 14px;border-radius:var(--radius-md);background:var(--plane);
color:#fff;font-size:var(--t-sm);font-weight:600;text-decoration:none}
.gallery-all:hover{background:var(--brand-hover);color:#fff}
.gallery-dots{display:flex;gap:6px;justify-content:center;padding-top:10px}
.gallery-dots span{width:28px;height:4px;border-radius:999px;background:var(--border)}
.vdp-title{margin:0;font-size:var(--t-h1);line-height:1.06;letter-spacing:-.022em;font-weight:600}
.vdp-title .yr{font-weight:400;color:var(--ink-muted)}
.vdp-deriv{margin:6px 0 0;font-size:var(--t-lead);line-height:1.35;font-weight:500;color:var(--ink-muted)}
.vdp-ids{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:12px}
.stock-no{font-family:var(--mono);font-size:var(--t-2xs);line-height:16px;color:var(--ink-subtle)}
/* The price is the second thing a buyer looks for and it was the same size as
   the car's name. It is now display type. */
.vdp-price{font-size:var(--t-display);line-height:.94;letter-spacing:-.03em;font-weight:700;
margin:0;font-variant-numeric:proportional-nums}
.vdp-poa{font-size:clamp(28px,3.4vw,46px);line-height:1.02;letter-spacing:-.025em;font-weight:700;margin:0}
.key-specs{list-style:none;margin:0;padding:0;display:grid;
grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:1px;background:var(--border);
border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}
.key-specs li{background:var(--surface-1);padding:10px 12px}
.key-specs .k{display:block;font-size:var(--t-2xs);line-height:16px;font-weight:500;
letter-spacing:.02em;color:var(--ink-subtle)}
.key-specs .v{display:block;font-size:15px;line-height:20px;font-weight:600;padding-top:2px}
.reassure{list-style:none;margin:0;padding:14px 16px;display:flex;flex-direction:column;gap:8px;
background:var(--brand-50);border-radius:var(--radius-md)}
.reassure li{display:flex;gap:10px;align-items:flex-start;font-size:var(--t-sm);line-height:20px}
.reassure .tick{color:var(--good);font-weight:700;flex:none}
/* ------------------------------------------------- section planes
   Not every section is a bordered card any more. Three surfaces: the page
   plane, a white band, and the dark plane for the two sections that carry
   the most weight. */
.band{background:var(--surface-1);border-top:1px solid var(--border);
border-bottom:1px solid var(--border);padding:clamp(28px,3.5vw,56px) 0}
.band-3{background:var(--surface-3);padding:clamp(28px,3.5vw,56px) 0}
.plane{background:var(--plane);color:var(--plane-ink);padding:clamp(32px,4vw,64px) 0}
.plane h2,.plane h3{color:var(--plane-ink)}
.plane p{color:var(--plane-muted)}
.plane a{color:var(--plane-link)}
.plane-eyebrow{margin:0;font-size:var(--t-2xs);line-height:16px;font-weight:500;letter-spacing:.06em;
text-transform:uppercase;color:var(--plane-link)}
.section{max-width:var(--maxw);margin:0 auto;padding:clamp(28px,3.5vw,56px) clamp(16px,3vw,32px)}
.section-head{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;
justify-content:space-between;padding-bottom:16px}
.section-note{font-size:var(--t-xs);line-height:18px;color:var(--ink-subtle)}
h2{font-size:var(--t-h2);line-height:1.2;letter-spacing:-.015em;font-weight:600;margin:0}
.h2-lg{font-size:var(--t-h2-lg);line-height:1.08;letter-spacing:-.02em}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-lg);
padding:clamp(18px,2vw,28px)}
/* A proper GB plate: yellow field, blue UK band. Car people notice. */
.reg{display:inline-flex;height:30px;border:1px solid var(--plate-edge);border-radius:4px;
overflow:hidden;vertical-align:middle;background:var(--plate-face)}
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
/* ------------------------------------------------- declared condition
   Our biggest differentiator: no competitor shows damage voluntarily. It sits
   on the dark plane, at full bleed, with a count — it must read as confidence
   rather than apology, so it cannot be a grey box halfway down the page. */
.declared-head{display:flex;flex-wrap:wrap;gap:clamp(12px,2vw,32px);align-items:flex-end;
justify-content:space-between;padding-bottom:clamp(20px,2.5vw,32px)}
.declared-intro{flex:1 1 min(100%,520px)}
.declared-lead{margin:12px 0 0;font-size:clamp(15px,1.4vw,18px);line-height:1.5;max-width:60ch}
.declared-count{flex:0 0 auto;display:flex;align-items:baseline;gap:12px}
.declared-count b{font-size:clamp(44px,5vw,68px);line-height:.9;font-weight:700;letter-spacing:-.03em}
.declared-count span{font-size:var(--t-sm);line-height:20px;color:var(--plane-muted);max-width:12ch}
.marks{list-style:none;margin:0;padding:0;display:grid;
grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:clamp(12px,1.5vw,20px)}
.mark{background:var(--plane);border:1px solid var(--plane-border);
border-radius:var(--radius-lg);overflow:hidden}
.mark img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block;background:var(--plane-well)}
.mark-body{padding:16px 18px 18px}
.mark-sev{display:flex;align-items:center;gap:8px;padding-bottom:8px;font-size:var(--t-2xs);
line-height:16px;font-weight:500;letter-spacing:.02em;color:var(--plane-muted)}
.mark-body h3{margin:0;font-size:clamp(17px,1.7vw,22px);line-height:1.25;font-weight:600}
.mark-body p{margin:8px 0 0;font-size:var(--t-sm);line-height:20px}
/* Legacy single-column form, still used where a mark has no photograph. */
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
border:1px solid var(--brand-text);color:var(--brand-text);background:var(--surface-1)}
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
/* ------------------------------------------------------ finance promotion
   CONC 3.5.6R: the representative APR must be given greater prominence than
   any other cost-of-credit figure in the promotion — including the monthly
   payment that triggered it. That is why .fp-prominent dd is LARGER than
   .fp-payment-amount, and a test compares the two font sizes rather than
   trusting whoever edits this next. */
.finance{background:var(--brand-50);border-radius:var(--radius-lg);
padding:clamp(18px,2.2vw,32px);display:flex;flex-wrap:wrap;
gap:clamp(16px,2.5vw,40px);align-items:flex-start}
.fp-lead{flex:1 1 min(100%,300px)}
.fp-label{margin:0;font-size:var(--t-2xs);line-height:16px;font-weight:500;letter-spacing:.02em;
color:var(--ink-subtle)}
/* The APR is the LOUDEST figure on the page — louder than the payment that
   triggered it. That is CONC 3.5.6R, not a taste decision, and the size
   relationship below is asserted by a test that parses this stylesheet. */
.fp-apr{margin:2px 0 0;font-size:clamp(52px,7.4vw,104px);line-height:.86;font-weight:700;
letter-spacing:-.035em;font-variant-numeric:proportional-nums}
.fp-apr-sub{margin:6px 0 0;font-size:clamp(17px,1.8vw,22px);line-height:1.2;font-weight:600}
.fp-apr-note{margin:10px 0 0;font-size:var(--t-sm);line-height:20px;color:var(--ink-muted);max-width:40ch}
/* The payment sits in a quieter card BELOW the APR. It is what sells; it is
   not what the rule gives prominence to. */
.fp-payment{margin-top:clamp(16px,2vw,24px);background:var(--surface-1);
border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px}
.fp-payment-amount{font-size:26px;line-height:30px;font-weight:600;letter-spacing:-.02em}
.fp-payment-period{font-size:15px;font-weight:500;color:var(--ink-muted)}
.fp-payment-terms{margin:4px 0 0;font-size:var(--t-sm);line-height:20px;color:var(--ink-muted)}
.fp-lender{margin:8px 0 0;font-size:var(--t-xs);line-height:18px;color:var(--ink-subtle)}
.fp-example{flex:1 1 min(100%,340px);background:var(--surface-1);border:1px solid var(--border);
border-radius:var(--radius-lg);padding:clamp(14px,1.6vw,20px)}
.fp-example-head{font-size:15px;line-height:21px;font-weight:600;margin:0 0 4px}
.fp-example-note{margin:0 0 12px;font-size:var(--t-xs);line-height:18px;color:var(--ink-subtle)}
.fp-rows{margin:0}
.fp-row{display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:space-between;align-items:baseline;
padding:9px 0;border-bottom:1px solid var(--border)}
.fp-row:last-child{border-bottom:0}
.fp-row dt{flex:1 1 auto;min-width:0;font-size:var(--t-sm);line-height:1.35;color:var(--ink-muted)}
/* A one-line plain-English gloss under each mandated item. The example is
   legally required; a buyer reading it is not, and that is the difference
   between compliance and disclosure. It follows the dt/dd pair in source and
   is pulled onto its own full-width line by order, so the label text stays
   exactly the rule's wording. */
.fp-gloss{order:3;flex:1 0 100%;margin:2px 0 0;font-size:var(--t-2xs);line-height:16px;
color:var(--ink-subtle);font-weight:400}
.fp-row dd{flex:none;margin:0;font-family:var(--mono);font-size:var(--t-sm);line-height:1.25;
font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.fp-prominent{background:var(--brand-50);border-left:3px solid var(--brand);
padding-left:12px;margin-left:-12px}
.fp-prominent dt{color:var(--ink);font-weight:600;font-size:15px}
.fp-prominent dd{font-size:32px;font-weight:700;line-height:1.2}
.fp-small{font-size:var(--t-2xs);line-height:16px;color:var(--ink-subtle);margin:12px 0 0;max-width:70ch}
/* The absent state. No approved example means no figure of any kind may
   appear — it must still invite the conversation and read as deliberate. */
.fp-absent{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-lg);
padding:clamp(20px,2.5vw,32px);display:flex;flex-wrap:wrap;gap:24px;align-items:center}
.fp-absent-main{flex:1 1 min(100%,340px)}
.fp-absent-eyebrow{display:flex;align-items:center;gap:8px;padding-bottom:10px;
font-size:var(--t-2xs);line-height:16px;font-weight:500;letter-spacing:.02em;color:var(--ink-muted)}
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
.chip-clear{background:transparent;color:var(--brand-text)}
.facet{margin:0 0 16px}
.facet-head{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--ink-subtle);margin:0 0 4px}
.facet-list{list-style:none;margin:0;padding:0}
.facet-opt a,.facet-opt span{display:flex;justify-content:space-between;gap:12px;
min-height:32px;align-items:center;padding:2px 4px;font-size:14px;
color:var(--ink);text-decoration:none;border-radius:var(--radius-sm)}
.facet-opt a:hover{background:var(--surface-3);color:var(--ink)}
.facet-opt.is-selected a{font-weight:600;color:var(--brand-text)}
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
/* The photograph runs to the card edge — a 12px inset around a car makes a
   £46,000 vehicle look like a database thumbnail. */
.v-card{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-lg);
display:flex;flex-direction:column;overflow:hidden}
.v-card-link{text-decoration:none;color:inherit;display:block}
.v-card-link:hover{color:inherit}
.v-card-body{padding:14px 16px 0}
.v-media{position:relative}
.v-thumb{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--media-bg);display:block}
.v-thumb-empty{display:block;aspect-ratio:4/3;background:var(--media-bg)}
.v-name{font-size:16px;line-height:22px;font-weight:600;margin:0}
.v-deriv{margin:4px 0 0;font-size:var(--t-xs);line-height:18px;color:var(--ink-subtle)}
/* On the photograph, so a card with badges and one without still line up. */
.v-badges{position:absolute;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;margin:0;max-width:calc(100% - 16px)}
.badge-reduced{color:var(--good)}
.badge-reserved{color:var(--warning-ink)}
.badge-just-arrived,.badge-low-mileage{color:var(--ink-muted)}
.v-price{font-size:22px;line-height:26px;font-weight:700;letter-spacing:-.02em;margin:10px 0 0}
.v-specs{display:flex;flex-wrap:wrap;gap:4px 12px;list-style:none;margin:8px 0 0;padding:0;
font-size:var(--t-xs);color:var(--ink-muted)}
/* Pinned to the bottom, so the save button is on one line across the row
   however long the vehicle names run. */
.v-save{margin-top:auto;padding:12px 16px 16px}
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
.section-count{font-weight:400;color:var(--ink-subtle)}
.prose{font-size:var(--t-body);line-height:1.6;color:var(--ink-muted);max-width:70ch;margin:0}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:8px}
.photo-grid img,.photo-grid picture{border-radius:var(--radius-md);overflow:hidden}
.photo-grid img{width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--media-bg)}
.gallery-empty{aspect-ratio:4/3;border-radius:var(--radius-lg);border:1px dashed var(--border);
background:var(--surface-3);display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:12px;padding:24px;text-align:center}
.gallery-empty-head{margin:0;font-size:clamp(17px,1.6vw,20px);line-height:1.4;font-weight:600;max-width:34ch}
.gallery-empty-note{margin:0;font-size:var(--t-sm);line-height:20px;color:var(--ink-muted);max-width:44ch}
.badge-accent{background:var(--accent);color:var(--accent-ink);border-color:transparent;font-weight:600}
.badge-bad{color:var(--critical)}
.btn-accent{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.btn-accent:hover{filter:brightness(.94);color:var(--accent-ink)}
.mot-split{display:flex;flex-wrap:wrap;gap:clamp(16px,2vw,32px);padding-top:clamp(18px,2vw,28px)}
.mot-split>*{flex:1 1 min(100%,360px)}
.mot-date{font-size:15px;font-weight:600}
.mot-none{font-size:var(--t-sm);line-height:20px;color:var(--ink-muted);max-width:60ch;margin:8px 0 0}
.adv-mark{color:var(--warning-ink);font-weight:700;flex:none}
.adv-none{color:var(--good);font-weight:700;flex:none}
.trust-foot{display:flex;flex-wrap:wrap;gap:clamp(12px,1.5vw,20px);padding-top:clamp(12px,1.5vw,20px)}
.trust-foot>*{flex:1 1 min(100%,300px)}
.trust-label{margin:0 0 14px;font-size:var(--t-2xs);line-height:16px;font-weight:500;
letter-spacing:.02em;color:var(--ink-subtle)}
.trust-addr{margin:0;font-size:15px;line-height:22px;font-weight:600}
/* --------------------------------------------------- provenance / battery */
.split{max-width:var(--maxw);margin:0 auto;padding:clamp(28px,3.5vw,56px) clamp(16px,3vw,32px);
display:flex;flex-wrap:wrap;gap:clamp(16px,2vw,28px)}
.split>*{flex:1 1 min(100%,360px)}
.prov-list{list-style:none;margin:0;padding:0;display:grid;gap:1px;background:var(--border);
border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden}
.prov-list li{background:var(--surface-1);display:flex;align-items:center;gap:10px;
padding:11px 14px;min-height:44px;font-size:var(--t-sm);line-height:20px;font-weight:500}
.prov-out{margin-left:auto;font-size:var(--t-2xs);line-height:16px;color:var(--ink-subtle);white-space:nowrap}
.well{background:var(--brand-50);border-radius:var(--radius-lg);padding:clamp(18px,2vw,28px);
display:flex;flex-direction:column}
.big-figure{margin:16px 0 0;font-size:clamp(44px,6vw,80px);line-height:.9;font-weight:700;
letter-spacing:-.03em;font-variant-numeric:proportional-nums}
.meter{margin-top:14px;height:8px;border-radius:999px;background:rgba(15,23,42,.1);overflow:hidden}
.meter b{display:block;height:100%;background:var(--good)}
/* ------------------------------------------------------------- MOT cards */
.mot-list{display:flex;flex-direction:column;gap:10px}
.mot-item{border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;
background:var(--surface-1)}
.mot-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.mot-miles{margin-left:auto;font-family:var(--mono);font-size:var(--t-xs);color:var(--ink-muted);
font-variant-numeric:tabular-nums}
.mot-adv{padding-top:10px;display:flex;gap:8px;align-items:flex-start;font-size:var(--t-sm);
line-height:20px;color:var(--ink-muted);margin:0}
.mot-adv b{color:var(--ink)}
.chart-card{margin:0;background:var(--surface-3);border-radius:var(--radius-lg);padding:clamp(16px,2vw,24px)}
.chart-card figcaption{font-size:var(--t-sm);line-height:20px;font-weight:600;padding-bottom:4px}
/* --------------------------------------------------------- trust signals */
.trust-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));
gap:clamp(12px,1.5vw,20px)}
.trust-card{background:var(--surface-1);border:1px solid var(--border);
border-radius:var(--radius-lg);padding:20px}
.trust-figure{margin:0;font-size:clamp(28px,3vw,40px);line-height:1;font-weight:700;letter-spacing:-.025em}
.trust-figure-lg{font-size:clamp(36px,4vw,52px);line-height:.95}
.stars{display:flex;gap:3px;padding-top:8px;color:var(--warning-ink);font-size:15px}
.trust-title{margin:8px 0 0;font-size:15px;line-height:21px;font-weight:600}
.trust-detail{margin:4px 0 0;font-size:var(--t-sm);line-height:20px;color:var(--ink-muted)}
.bodies{display:flex;flex-wrap:wrap;gap:8px}
.bodies span{display:inline-flex;align-items:center;height:44px;padding:0 14px;
border-radius:var(--radius-md);background:var(--surface-3);border:1px solid var(--border);
font-family:var(--mono);font-size:var(--t-2xs);font-weight:600;letter-spacing:.04em;color:var(--ink-muted)}
/* ------------------------------------------------------------ enquiry form */
.enq{max-width:var(--maxw);margin:0 auto;padding:0 clamp(16px,3vw,32px);
display:flex;flex-wrap:wrap;gap:clamp(20px,3vw,48px)}
.enq>*{flex:1 1 min(100%,300px)}
.enq-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}
.enq-form label{display:flex;flex-direction:column;gap:6px}
.enq-form .full{grid-column:1/-1}
.enq-form span{font-size:var(--t-2xs);line-height:16px;font-weight:500;letter-spacing:.02em;
color:var(--plane-muted)}
.enq-form input,.enq-form textarea{min-height:48px;border-radius:var(--radius-md);
border:1px solid var(--plane-border);background:var(--plane-well);color:var(--plane-ink);
padding:12px 14px;font-size:16px;font-family:inherit}
.enq-form textarea{resize:vertical}
.enq-form button{min-height:52px;border:none;border-radius:var(--radius-md);background:var(--accent);
color:#0F172A;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
.enq-note{grid-column:1/-1;margin:0;font-size:var(--t-2xs);line-height:16px;color:var(--plane-muted)}
/* ------------------------------------------------------ similar / carousel */
.rail{list-style:none;margin:0;padding:0 0 4px;display:flex;gap:clamp(10px,1.5vw,16px);
overflow-x:auto;scroll-snap-type:x mandatory}
.rail>li{flex:0 0 min(78%,280px);scroll-snap-align:start}
@media(min-width:768px){.rail>li{flex:0 0 280px}}
/* ------------------------------------------------------------- home page */
.home-hero{background:var(--plane);color:var(--plane-ink);padding:clamp(36px,5vw,80px) 0}
.home-hero h1{margin:0;font-size:clamp(30px,4.2vw,60px);line-height:1.04;letter-spacing:-.025em;
font-weight:700;max-width:18ch}
.home-hero p{margin:14px 0 0;font-size:clamp(16px,1.6vw,20px);line-height:1.5;max-width:52ch}
.home-search{margin:clamp(20px,2.5vw,32px) 0 0;display:flex;flex-wrap:wrap;gap:10px;max-width:640px}
.home-search input,.home-search select{flex:1 1 160px;min-height:52px;padding:0 14px;font-size:16px;
border-radius:var(--radius-md);border:1px solid var(--plane-border);background:var(--plane-well);
color:var(--plane-ink);font-family:inherit}
.home-search button{flex:0 0 auto;min-height:52px;padding:0 24px;border:none;
border-radius:var(--radius-md);background:var(--accent);color:var(--accent-ink);font-size:16px;
font-weight:600;cursor:pointer;font-family:inherit}
.home-stats{display:flex;flex-wrap:wrap;gap:clamp(16px,3vw,48px);padding-top:clamp(20px,2.5vw,32px)}
.home-stat b{display:block;font-size:clamp(24px,2.6vw,34px);line-height:1;font-weight:700;letter-spacing:-.02em}
.home-stat span{display:block;font-size:var(--t-sm);line-height:20px;color:var(--plane-muted);padding-top:4px}
.browse{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px}
.browse a{display:flex;flex-direction:column;justify-content:center;min-height:76px;padding:14px 16px;
background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);
text-decoration:none;color:var(--ink);font-weight:600}
.browse a:hover{border-color:var(--brand-text);color:var(--ink)}
.browse .n{font-size:var(--t-xs);font-weight:500;color:var(--ink-subtle);padding-top:2px}
.why{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));
gap:clamp(12px,1.5vw,20px)}
.why-item{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px}
.browse-groups{display:flex;flex-direction:column;gap:clamp(18px,2vw,28px);padding-top:16px}
.browse-group h3{margin:0 0 10px}
.why-item h3{margin:0;font-size:17px;line-height:24px;font-weight:600}
.why-item p{margin:8px 0 0;font-size:var(--t-sm);line-height:20px;color:var(--ink-muted)}
/* ---------------------------------------------------------------- footer */
footer{background:var(--surface-1);border-top:1px solid var(--border);
padding:clamp(28px,3vw,48px) 0 96px;color:var(--ink-muted);font-size:var(--t-sm)}
@media(min-width:768px){footer{padding-bottom:48px}}
.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));
gap:clamp(20px,2.5vw,40px)}
.footer-grid h2{font-size:var(--t-2xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;
color:var(--ink-subtle);margin:0 0 10px}
.footer-grid ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.footer-grid a{color:var(--ink-muted);text-decoration:none}
.footer-grid a:hover{color:var(--brand-text)}
.footer-legal{margin:clamp(20px,2.5vw,32px) 0 0;padding-top:20px;border-top:1px solid var(--border);
font-size:var(--t-2xs);line-height:16px;color:var(--ink-subtle);max-width:90ch}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.replace(/\n\s*/g, '').trim();
}
