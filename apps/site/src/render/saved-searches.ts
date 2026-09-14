import { esc } from './html.js';
import { criticalCss } from './theme.js';
import { masthead, siteFooter } from './chrome.js';
import { parseBookmark } from '../search-bookmark.js';
import type { LoadedDealer } from '../data/vehicles.js';
import type { SearchBookmark } from '../data/saved-searches.js';
const label = (s: string) =>
  s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
function criteria(path: string): string[] {
  const { query: q } = parseBookmark(path);
  return [
    ...Object.entries(q.filters)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `${label(k)}: ${v.map(label).join(', ')}`),
    ...(q.minPricePence !== null
      ? [`From £${(q.minPricePence / 100n).toLocaleString('en-GB')}`]
      : []),
    ...(q.maxPricePence !== null
      ? [`Up to £${(q.maxPricePence / 100n).toLocaleString('en-GB')}`]
      : []),
    ...(q.minYear !== null ? [`${q.minYear} onwards`] : []),
    ...(q.maxMileage !== null
      ? [`Up to ${q.maxMileage.toLocaleString('en-GB')} miles`]
      : []),
    ...(q.keyword ? [`Search: ${q.keyword}`] : []),
    ...(q.siteSlug ? [`Branch: ${label(q.siteSlug)}`] : []),
  ];
}
export function renderSavedSearches(
  dealer: LoadedDealer,
  rows: SearchBookmark[],
  options: { message?: string; error?: boolean; unavailable?: boolean } = {},
): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Your saved searches | ${esc(dealer.name)}</title><style>${criticalCss(dealer.theme)}
.ss-skip{position:absolute;top:-100px;left:16px;z-index:100;padding:12px;background:var(--surface-1)}.ss-skip:focus{top:8px}.ss-wrap{max-width:1160px;margin:auto;padding:48px 24px 80px}.ss-head{display:flex;justify-content:space-between;align-items:start;gap:24px;margin-bottom:28px}.ss-head h1{font-size:clamp(32px,4vw,48px);letter-spacing:-.035em;line-height:1.12;margin:10px 0 16px}.ss-eyebrow{color:var(--brand-text);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em}.ss-muted{color:var(--ink-muted);max-width:64ch;line-height:1.7}.ss-tabs{display:flex;gap:24px;border-bottom:1px solid var(--border);margin-bottom:28px}.ss-tabs a{display:inline-flex;align-items:center;min-height:48px;color:var(--ink-muted);font-weight:600;text-decoration:none}.ss-tabs [aria-current]{color:var(--brand-text);border-bottom:3px solid var(--brand-text)}.ss-notice{padding:16px 20px;border:1px solid var(--border);border-left:4px solid var(--brand);border-radius:var(--radius-md);background:var(--surface-1);margin-bottom:24px}.ss-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.ss-card{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-1);padding:26px;display:flex;flex-direction:column;min-width:0}.ss-card h2{font-size:23px;line-height:1.3;margin:0 0 18px;overflow-wrap:anywhere}.ss-match{display:flex;align-items:baseline;gap:9px;margin-bottom:16px;color:var(--ink-muted)}.ss-match strong{font-size:36px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}.ss-chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0 0 24px}.ss-chips li{font-size:13px;background:var(--surface-2);border:1px solid var(--border);padding:6px 10px;border-radius:var(--radius-sm);overflow-wrap:anywhere;max-width:100%}.ss-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:auto}.ss-remove{min-height:44px;border:0;background:none;color:var(--ink-muted);font:inherit;text-decoration:underline;cursor:pointer;padding:8px}.ss-edit{border-top:1px solid var(--border);margin-top:20px;padding-top:8px}.ss-edit summary{cursor:pointer;min-height:44px;align-content:center;color:var(--brand-text);font-weight:600}.ss-edit label{display:block;font-size:14px;margin:12px 0 6px}.ss-edit input{box-sizing:border-box;display:block;width:100%;padding:12px;min-height:44px;background:var(--surface-2);color:var(--ink);border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;margin-bottom:12px}.ss-empty{text-align:center;background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-lg);padding:64px 24px}.ss-empty p{margin:16px auto 24px}.ss-info{display:flex;gap:24px;justify-content:space-between;margin-top:28px;border-top:1px solid var(--border);padding-top:16px}.ss-info p{margin:0;font-size:14px}.ss-wrap :focus-visible{outline:2px solid var(--brand-text);outline-offset:3px}
@media(max-width:650px){.ss-wrap{padding:28px 16px 48px}.ss-head,.ss-info{display:block}.ss-head>.btn{margin-top:12px}.ss-grid{grid-template-columns:1fr}.ss-card{padding:22px}.ss-info p+p{margin-top:12px}}
</style></head><body><a class="ss-skip" href="#main">Skip to saved searches</a>${masthead(dealer)}<main class="ss-wrap" id="main"><header class="ss-head"><div><span class="ss-eyebrow">Your next car, on your terms</span><h1>Your saved searches</h1><p class="ss-muted">Keep your preferences. Skip setting the filters again. See what matches whenever you return.</p></div><a class="btn btn-primary" href="/used-cars">Find a car</a></header><nav class="ss-tabs" aria-label="Your saved choices"><a href="/saved-cars">Saved cars</a><a href="/saved-searches" aria-current="page">Saved searches</a></nav>
${options.message ? `<p class="ss-notice" role="${options.error ? 'alert' : 'status'}">${esc(options.message)}</p>` : ''}
${
  options.unavailable
    ? '<p><a class="btn" href="/saved-searches">Try again</a></p>'
    : rows.length
      ? `<p class="ss-muted">${rows.length} of 20 searches saved · Matches checked just now</p><div class="ss-grid">${rows
          .map((r) => {
            const chips = criteria(r.path);
            return `<article class="ss-card" aria-labelledby="title-${r.id}"><h2 id="title-${r.id}">${esc(r.name)}</h2><div class="ss-match"><strong>${r.count}</strong><span>${r.count === 1 ? 'car matches now' : 'cars match now'}</span></div>${!r.count ? '<p class="ss-muted">Nothing today. Your preferences are saved for your next visit.</p>' : ''}<ul class="ss-chips" aria-label="Search filters">${(chips.length ? chips : ['All current stock']).map((c) => `<li>${esc(c)}</li>`).join('')}</ul><div class="ss-actions"><a class="btn btn-primary" href="${esc(r.path)}">${r.count ? 'View matches' : 'Review search'}</a><form method="post" action="/saved-searches"><input type="hidden" name="action" value="remove"><input type="hidden" name="id" value="${r.id}"><button class="ss-remove" type="submit" aria-label="Remove ${esc(r.name)}">Remove</button></form></div><details class="ss-edit"><summary>Rename search</summary><form method="post" action="/saved-searches"><input type="hidden" name="action" value="rename"><input type="hidden" name="id" value="${r.id}"><label for="name-${r.id}">Search name</label><input id="name-${r.id}" name="name" value="${esc(r.name)}" maxlength="80" required><button class="btn" type="submit">Save name</button></form></details></article>`;
          })
          .join('')}</div>`
      : '<section class="ss-empty"><h2>A shortcut to the cars you want</h2><p class="ss-muted">Choose your filters on the stock page, then select “Save this search”. Your searches will appear here with up-to-date matches.</p><a class="btn btn-primary" href="/used-cars">Explore the stock</a></section>'
}
<aside class="ss-info" aria-label="About saved searches"><p class="ss-muted">Private to this browser and this dealer. Clearing cookies removes access to your saved choices.</p><p class="ss-muted">Saving a search does not send email alerts. Return here to check new stock.</p></aside></main>${siteFooter(dealer)}</body></html>`;
}
