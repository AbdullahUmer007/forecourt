/**
 * Shared page furniture — masthead, navigation and footer.
 *
 * Every public page carries the same chrome. It lives here rather than in each
 * renderer because the design review's first finding was that the site had no
 * masthead at all: the vehicle page began at a breadcrumb, so a dealer's own
 * website had no logo, no phone number, no opening status and no navigation.
 * A buyer could not tell whose site they were on.
 *
 * Zero JavaScript, like everything else in this layer. The opening status is
 * computed server-side from the dealer's hours, so it is correct at render
 * time and cached with the page.
 */

import { html, raw, when, esc } from './html.js';

/**
 * The same shape `StructuredDealer` already carries, so the opening hours are
 * stored once and feed both the schema.org `OpeningHoursSpecification` and
 * this masthead. Days are schema.org names, times are `HH:MM` 24-hour.
 */
export interface OpeningHoursView {
  days: readonly string[];
  opens: string;
  closes: string;
}

export interface ChromeDealer {
  name: string;
  telephone: string | null;
  locality: string | null;
  street?: string | null;
  postcode?: string | null;
  openingHours?: readonly OpeningHoursView[];
  fcaReference?: string | null;
  companyNumber?: string | null;
  legalName?: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** `"16:30"` → `990`. Returns null on anything that is not `HH:MM`. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** `990` → `4:30pm`. Whole hours drop the `:00`, as a person would say it. */
export function clockLabel(hhmm: string): string {
  const total = toMinutes(hhmm);
  if (total === null) return hhmm;
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * "Open until 6pm", or "Opens 10am tomorrow".
 *
 * Returned as a discriminated result rather than a string so the caller can
 * colour the status dot AND print the words — a colour never carries meaning
 * on its own (design system rule 2).
 */
export function openingStatus(
  hours: readonly OpeningHoursView[] | undefined,
  now: Date,
): { open: boolean; label: string } | null {
  if (!hours || hours.length === 0) return null;
  const forDay = (d: number): OpeningHoursView | undefined =>
    hours.find((h) => h.days.some((name) => name.toLowerCase() === DAY_NAMES[d]!.toLowerCase()));

  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  const today = forDay(day);
  if (today) {
    const opens = toMinutes(today.opens), closes = toMinutes(today.closes);
    if (opens !== null && closes !== null) {
      if (minute >= opens && minute < closes) {
        return { open: true, label: `Open until ${clockLabel(today.closes)}` };
      }
      if (minute < opens) return { open: false, label: `Opens ${clockLabel(today.opens)}` };
    }
  }
  // Next day that has any hours at all, searching forward a full week.
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const next = forDay(d);
    if (next) {
      return { open: false, label: `Opens ${clockLabel(next.opens)} ${i === 1 ? 'tomorrow' : DAY_NAMES[d]}` };
    }
  }
  return null;
}

export interface NavItem { label: string; href: string }

export const DEFAULT_NAV: readonly NavItem[] = [
  { label: 'All stock', href: '/used-cars' },
  { label: 'Finance', href: '/finance' },
  { label: 'Part-exchange', href: '/part-exchange' },
  { label: 'About us', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

/**
 * The masthead: who this is, whether they are open, and how to ring them.
 *
 * The telephone number is a button rather than a link in a list because on a
 * phone it is the single highest-intent control on the page, and it must be
 * reachable without scrolling on every page of the site.
 */
export function masthead(dealer: ChromeDealer, opts: { now?: Date; nav?: readonly NavItem[] } = {}): string {
  const status = openingStatus(dealer.openingHours, opts.now ?? new Date());
  const nav = opts.nav ?? DEFAULT_NAV;
  const place = dealer.locality ? ` · ${dealer.locality}` : '';
  return html`<header class="masthead">
  <div class="masthead-in">
    <a class="brand" href="/">
      <span class="brand-name">${dealer.name}</span>
      ${raw(status
        ? `<span class="brand-open"><span class="dot${status.open ? '' : ' dot-shut'}" aria-hidden="true"></span>${esc(status.label)}${esc(place)}</span>`
        : (dealer.locality ? `<span class="brand-open">${esc(dealer.locality)}</span>` : ''))}
    </a>
    ${when(dealer.telephone,
      `<a class="masthead-tel" href="tel:${esc(dealer.telephone ?? '')}" aria-label="Call ${esc(dealer.name)} on ${esc(dealer.telephone ?? '')}"><span aria-hidden="true">✆</span><span class="tel-no">${esc(dealer.telephone ?? '')}</span></a>`)}
  </div>
  <nav class="mainnav" aria-label="Main">
    <div class="mainnav-in">
      ${raw(nav.map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join(''))}
    </div>
  </nav>
</header>`;
}

/**
 * The footer, with the regulated disclosures as PAGES rather than PDFs.
 *
 * The FCA reference number and the credit-broker statement are required
 * wherever the firm is holding itself out as a credit broker, which on this
 * site is every page — the finance block is not the only place a buyer meets
 * the claim.
 */
export function siteFooter(dealer: ChromeDealer): string {
  const legalName = dealer.legalName ?? dealer.name;
  const addr = [dealer.street, dealer.locality, dealer.postcode].filter(Boolean).join(', ');
  return html`<footer>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <h2>Stock</h2>
        <ul>
          <li><a href="/used-cars">All used cars</a></li>
          <li><a href="/used-cars?sort=just-arrived">Just arrived</a></li>
          <li><a href="/saved">Saved cars</a></li>
        </ul>
      </div>
      <div>
        <h2>Buying</h2>
        <ul>
          <li><a href="/finance">Car finance</a></li>
          <li><a href="/part-exchange">Part-exchange</a></li>
          <li><a href="/warranty">Warranty</a></li>
        </ul>
      </div>
      <div>
        <h2>Legal</h2>
        <ul>
          <li><a href="/initial-disclosure">Initial disclosure</a></li>
          <li><a href="/complaints-procedure">Complaints procedure</a></li>
          <li><a href="/privacy-policy">Privacy policy</a></li>
          <li><a href="/terms">Terms and conditions</a></li>
        </ul>
      </div>
      <div>
        <h2>Visit us</h2>
        <ul>
          ${raw(addr ? `<li>${esc(addr)}</li>` : '')}
          ${raw(dealer.telephone ? `<li><a href="tel:${esc(dealer.telephone)}">${esc(dealer.telephone)}</a></li>` : '')}
        </ul>
      </div>
    </div>
    <p class="footer-legal">
      ${legalName}${dealer.companyNumber ? `, registered in England and Wales, company number ${dealer.companyNumber}` : ''}.
      ${raw(dealer.fcaReference
        ? `Authorised and regulated by the Financial Conduct Authority, FRN ${esc(dealer.fcaReference)}. We are a credit broker, not a lender, and we introduce you to a limited number of finance providers. We may receive a commission from the lender for introducing you.`
        : '')}
    </p>
  </div>
</footer>`;
}
