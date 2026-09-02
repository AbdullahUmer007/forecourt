/**
 * Templated public pages driven by brand copy — not a CMS.
 */

import { html, raw, esc } from './html.js';
import { criticalCss, DEFAULT_THEME, type BrandTheme } from './theme.js';
import { masthead, siteFooter, type ChromeDealer } from './chrome.js';
import { renderFinanceUnavailable } from './finance.js';
import { canonicalUrl } from '../../../../packages/domain/src/seo.js';

export type StaticPageId =
  | 'about' | 'contact' | 'finance' | 'part-exchange'
  | 'privacy-policy' | 'complaints-procedure' | 'initial-disclosure'
  | 'terms' | 'warranty';

export interface StaticPageDealer extends ChromeDealer {
  email?: string | null;
  about?: string;
  contactBlurb?: string;
  footerLegal?: string;
  fcaReference?: string | null;
}

export interface StaticPageInput {
  id: StaticPageId;
  dealer: StaticPageDealer;
  theme?: BrandTheme;
  origin: string;
  now?: Date;
  formError?: string;
  formOk?: boolean;
}

const TITLES: Record<StaticPageId, string> = {
  about: 'About us',
  contact: 'Contact',
  finance: 'Car finance',
  'part-exchange': 'Part-exchange',
  'privacy-policy': 'Privacy policy',
  'complaints-procedure': 'Complaints procedure',
  'initial-disclosure': 'Initial disclosure',
  terms: 'Terms and conditions',
  warranty: 'Warranty',
};

function paragraphs(text: string, fallback: string): string {
  const body = text.trim() || fallback;
  return body.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
}

function body(input: StaticPageInput): string {
  const d = input.dealer;
  const name = d.name;
  const addr = [d.street, d.locality, d.postcode].filter(Boolean).join(', ');

  switch (input.id) {
    case 'about':
      return html`<h1>About ${name}</h1>
        ${raw(paragraphs(d.about ?? '', `${name} is an independent used-car dealer. Every car is history-checked before it goes on sale, and any declared mark is photographed and named.`))}
        ${raw(addr ? `<p>You will find us at ${esc(addr)}.</p>` : '')}`;

    case 'contact':
      return html`<h1>Contact ${name}</h1>
        ${raw(paragraphs(d.contactBlurb ?? '', 'Ring or email and we will come back to you. If you are asking about a car, quote the registration.'))}
        <ul class="plain">
          ${raw(d.telephone ? `<li>Phone: <a href="tel:${esc(d.telephone)}">${esc(d.telephone)}</a></li>` : '')}
          ${raw(d.email ? `<li>Email: <a href="mailto:${esc(d.email)}">${esc(d.email)}</a></li>` : '')}
          ${raw(addr ? `<li>${esc(addr)}</li>` : '')}
        </ul>`;

    case 'finance':
      return html`<h1>Car finance</h1>
        <p>We can introduce you to finance. A monthly figure only appears with a representative example that is in date and signed off. This page does not invent one.</p>
        ${raw(renderFinanceUnavailable({ name, fcaReference: d.fcaReference ?? null }))}
        ${raw(d.fcaReference
          ? `<p>${esc(name)} is authorised and regulated by the Financial Conduct Authority, FRN ${esc(d.fcaReference)}. We are a credit broker, not a lender.</p>`
          : `<p>Ask us on the forecourt if you want a quote written by hand for a specific car.</p>`)}`;

    case 'part-exchange':
      return html`<h1>Part-exchange</h1>
        <p>Tell us the registration, the mileage and how to reach you. We will ring with a figure. This form does not value the car on the spot — a number invented here is how a complaint starts.</p>
        ${raw(input.formOk
          ? '<p role="status">Thank you. We have your details and will ring you with a figure.</p>'
          : '')}
        ${raw(input.formError ? `<p role="alert">${esc(input.formError)}</p>` : '')}
        <form method="post" action="/part-exchange" class="px-form">
          <label>Registration <input name="registration" required autocomplete="off"></label>
          <label>Mileage <input name="mileage" type="number" min="0" required></label>
          <label>Your name <input name="name" required></label>
          <label>Phone <input name="phone" type="tel" required></label>
          <label>Email <input name="email" type="email" required></label>
          <button type="submit">Ask us to ring</button>
        </form>`;

    case 'privacy-policy':
      return html`<h1>Privacy policy</h1>
        <p>${esc(name)} is the controller of personal data you give us when you enquire, part-exchange or buy a car.</p>
        <p>We use it to answer you, to complete a sale, and where the law requires a record — invoices, the VAT stock book, and consent for marketing. We do not sell your details.</p>
        <p>To ask what we hold, or to object to marketing, use the contact details on this site.</p>
        ${raw(d.footerLegal ? `<p>${esc(d.footerLegal)}</p>` : '')}`;

    case 'complaints-procedure':
      return html`<h1>Complaints procedure</h1>
        <p>If something has gone wrong, tell us first. Write to ${esc(name)}${raw(addr ? ` at ${esc(addr)}` : '')} or ring ${esc(d.telephone ?? 'the number on this site')}.</p>
        <p>We will acknowledge a written complaint and set out what happens next. If we introduced finance and you remain unhappy, you may be able to refer the matter to the Financial Ombudsman Service.</p>`;

    case 'initial-disclosure':
      return html`<h1>Initial disclosure</h1>
        <p>${esc(d.legalName ?? name)} ${d.fcaReference
          ? `is authorised and regulated by the Financial Conduct Authority, FRN ${esc(d.fcaReference)}.`
          : 'can introduce you to finance where we hold the right permission.'}</p>
        <p>We are a credit broker, not a lender. We introduce you to a limited number of finance providers and may receive a commission from the lender for that introduction. Commission does not change the amount you repay.</p>
        <p>This page is information, not a personal recommendation. Ask us if anything is unclear before you apply.</p>`;

    case 'terms':
      return html`<h1>Terms and conditions</h1>
        <p>Cars are sold as described on this website and on the invoice. A declared mark that was photographed and shown to you before sale is part of that description.</p>
        <p>A consumer sale is covered by the Consumer Rights Act. A business sale is on the terms we agree in writing.</p>
        ${raw(d.footerLegal ? `<p>${esc(d.footerLegal)}</p>` : '')}`;

    case 'warranty':
      return html`<h1>Warranty</h1>
        <p>What is included with a car is written on its page and on the invoice. This site does not invent cover. Ask us about a specific car if you want the wording in front of you.</p>`;
  }
}

export function renderStaticPage(input: StaticPageInput): string {
  const theme = input.theme ?? DEFAULT_THEME;
  const title = `${TITLES[input.id]} — ${input.dealer.name}`;
  const url = canonicalUrl(input.origin, `/${input.id}`);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="${esc(url)}">
<style>${criticalCss(theme)}
main{max-width:42rem;margin:0 auto;padding:24px 16px 64px}
main h1{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:0 0 16px}
main p,main li{color:var(--ink-muted);margin:0 0 12px}
.plain{list-style:none;padding:0}
.px-form{display:grid;gap:12px;margin-top:24px;max-width:24rem}
.px-form label{display:grid;gap:4px;font-size:13px}
.px-form input{min-height:44px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-md);font:inherit}
.px-form button{min-height:44px;border:0;border-radius:var(--radius-md);background:var(--brand);color:#fff;font:inherit;font-weight:600}
</style>
</head>
<body>
<a class="visually-hidden" href="#main">Skip to content</a>
${masthead(input.dealer, input.now ? { now: input.now } : {})}
<main id="main">${body(input)}</main>
${siteFooter(input.dealer)}
<style>.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
</body>
</html>`;
}
