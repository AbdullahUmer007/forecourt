import { esc } from './html.js';
import type { EnquiryInput } from '../data/enquiries.js';

export function enquiryForm(values: Partial<EnquiryInput> = {}): string {
  return `<form class="enq-form" method="post" action="/enquiries">
    <input type="hidden" name="vehicle" value="${esc(values.vehicle ?? '')}">
    <label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name" value="${esc(values.name ?? '')}"></label>
    <label><span>Email</span><input name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(values.email ?? '')}"></label>
    <label class="full"><span>Phone <small>(optional)</small></span><input name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(values.phone ?? '')}"></label>
    <label class="full"><span>Your question</span><textarea name="message" required maxlength="4000" rows="5" placeholder="Ask about availability, arrange a viewing or request a video walkaround.">${esc(values.message ?? '')}</textarea></label>
    <div hidden aria-hidden="true"><label>Leave this blank<input name="company_website" tabindex="-1" autocomplete="off"></label></div>
    <button class="full" type="submit">Send enquiry</button>
    <p class="enq-note full">Your details will be used to answer this enquiry. This does not sign you up for marketing. <a href="/privacy-policy">Privacy policy</a></p>
  </form>`;
}

export const enquiryFormCss = `
.enq-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.enq-form .full{grid-column:1/-1}
.enq-form label{display:grid;gap:6px;font-size:14px;font-weight:500}
.enq-form small{font-weight:400;color:var(--ink-muted)}
.enq-form input,.enq-form textarea{width:100%;min-height:44px;border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;background:var(--surface-1);color:var(--ink);font:inherit}
.enq-form textarea{resize:vertical}
.enq-form button{min-height:48px;padding:12px 20px;background:var(--brand);color:var(--on-brand);border:0;border-radius:var(--radius-md);font:inherit;font-weight:600;cursor:pointer}
.enq-form button:hover{background:var(--brand-hover)}
.enq-note{font-size:13px;color:var(--ink-muted);line-height:1.6;margin:0}
@media(max-width:480px){.enq-form{grid-template-columns:1fr}}
`;
