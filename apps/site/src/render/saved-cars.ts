import { esc } from './html.js';
import { criticalCss } from './theme.js';
import { masthead, siteFooter } from './chrome.js';
import { vehicleUrlPath } from '../../../../packages/domain/src/seo.js';
import type { LoadedDealer } from '../data/vehicles.js';
import type { SavedCar } from '../data/shortlist.js';
import type { ResultVehicle } from './results.js';
const title = (v: ResultVehicle) =>
  [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Used car';
const price = (p: bigint | null) =>
  p === null
    ? 'Price on application'
    : `£${(p / 100n).toLocaleString('en-GB')}${p % 100n ? '.' + (p % 100n).toString().padStart(2, '0') : ''}`;
export function renderSavedCars(
  dealer: LoadedDealer,
  rows: SavedCar[],
  options: {
    message?: string;
    error?: boolean;
    compare?: string[];
    compareRequested?: boolean;
    back?: string;
  } = {},
): string {
  const selected = options.compare ?? [],
    comparing = selected.length >= 2 && selected.length <= 3;
  const available = rows.filter((r) => r.vehicle !== null),
    shown = comparing
      ? available.filter((r) => selected.includes(r.vehicleId))
      : [];
  const compare = comparing && shown.length === selected.length;
  const photo = (v: ResultVehicle) =>
    v.thumbnail
      ? `<img src="${esc(v.thumbnail.url)}" alt="${esc(v.thumbnail.alt)}" width="600" height="450" loading="lazy">`
      : '<div class="sl-photo-empty">Photograph coming soon</div>';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${compare ? 'Compare saved cars' : 'Your saved cars'} | ${esc(dealer.name)}</title><style>${criticalCss(dealer.theme)}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.sl-skip{position:absolute;top:-100px;left:16px;z-index:100;padding:12px;background:var(--surface-1)}.sl-skip:focus{top:8px}.sl-wrap{max-width:1200px;margin:auto;padding:44px 24px 72px}.sl-head{display:flex;justify-content:space-between;align-items:start;gap:24px;margin-bottom:28px}.sl-head h1{font-size:clamp(30px,4vw,46px);letter-spacing:-.035em;line-height:1.15;margin:8px 0 16px}.sl-eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:var(--brand-text)}.sl-muted{color:var(--ink-muted);max-width:65ch}.sl-notice{padding:16px 20px;border:1px solid var(--border);border-left:4px solid var(--brand);border-radius:var(--radius-md);background:var(--surface-1);margin:0 0 24px}.sl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.sl-card{border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface-1);display:flex;flex-direction:column;min-width:0}.sl-card img,.sl-photo-empty{width:100%;aspect-ratio:4/3;object-fit:cover;height:auto;background:var(--surface-3)}.sl-photo-empty{display:grid;place-items:center;color:var(--ink-muted)}.sl-body{padding:22px;flex:1;display:flex;flex-direction:column;gap:12px}.sl-body h2{font-size:21px;line-height:1.3;margin:0}.sl-price{font-size:26px;font-weight:700;margin:0}.sl-specs{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}.sl-specs dt{font-size:12px;color:var(--ink-muted)}.sl-specs dd{margin:3px 0 0;font-weight:500;overflow-wrap:anywhere}.sl-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:12px}.sl-remove{border:0;background:transparent;text-decoration:underline;cursor:pointer;color:var(--ink-muted);min-height:44px;padding:8px;font:inherit}.sl-select{display:flex;gap:10px;align-items:center;min-height:44px;border-top:1px solid var(--border);padding:12px 22px;font-weight:600}.sl-select input{width:20px;height:20px;accent-color:var(--brand)}.sl-bar{position:sticky;bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px 20px;margin-top:24px}.sl-bar p{margin:0}.sl-empty{text-align:center;padding:64px 24px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-1)}.sl-empty h2{font-size:26px}.sl-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-lg)}.sl-table-wrap:focus-visible{outline:2px solid var(--brand-text);outline-offset:2px}.sl-table{border-collapse:collapse;width:100%;background:var(--surface-1);min-width:650px}.sl-table th,.sl-table td{padding:20px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.sl-table thead th{width:28%}.sl-table thead th:first-child{width:16%}.sl-table img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-md)}.sl-table h2{font-size:20px}.sl-table tbody th{font-size:14px;color:var(--ink-muted)}
@media(max-width:950px){.sl-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.sl-wrap{padding:28px 16px 48px}.sl-head{display:block}.sl-head>.btn{margin-top:12px}.sl-grid{grid-template-columns:1fr}.sl-bar{position:static}.sl-body{padding:20px}.sl-table-wrap{margin:0 -4px}.sl-table th,.sl-table td{padding:14px}}
</style></head><body><a class="sl-skip" href="#main">Skip to saved cars</a>${masthead(dealer)}<main class="sl-wrap" id="main"><header class="sl-head"><div><span class="sl-eyebrow">Your next car</span><h1>${compare ? 'A closer look at your favourites' : 'Your saved cars'}</h1><p class="sl-muted">${compare ? 'Compare the current prices and key details, then explore the car that feels right.' : 'Keep the cars you like together. Your choices stay in this browser, ready when you return.'}</p></div><a class="btn" href="${esc(options.back ?? '/used-cars')}">Continue browsing</a></header>
<p><a href="/saved-searches">Your saved searches →</a></p>
${options.message ? `<p class="sl-notice" role="${options.error ? 'alert' : 'status'}">${esc(options.message)}</p>` : ''}
${(selected.length || options.compareRequested) && !compare ? '<p class="sl-notice" role="alert">Choose two or three available saved cars to compare. A selected car may no longer be available.</p>' : ''}
${
  compare
    ? `<p><a href="/saved-cars">← Back to all saved cars</a></p><p class="sl-muted">On a small screen, scroll the comparison sideways to see every car.</p><div class="sl-table-wrap" role="region" aria-label="Car comparison" tabindex="0"><table class="sl-table"><caption class="visually-hidden">Comparison of your selected saved cars</caption><thead><tr><th scope="col">Vehicle</th>${shown.map((r) => `<th scope="col">${photo(r.vehicle!)}<h2>${esc(title(r.vehicle!))}</h2><p class="sl-muted">${esc(r.vehicle!.derivative ?? '')}</p><a class="btn" href="${esc(vehicleUrlPath(r.vehicle!))}">View car</a></th>`).join('')}</tr></thead><tbody>${(
        ['Price', 'Mileage', 'Fuel', 'Gearbox', 'Availability'] as const
      )
        .map(
          (label) =>
            `<tr><th scope="row">${label}</th>${shown
              .map((r) => {
                const v = r.vehicle!;
                const value =
                  label === 'Price'
                    ? price(v.pricePence)
                    : label === 'Mileage'
                      ? v.mileage === null
                        ? 'Not provided'
                        : v.mileage.toLocaleString('en-GB') + ' miles'
                      : label === 'Fuel'
                        ? (v.fuelType ?? 'Not provided')
                        : label === 'Gearbox'
                          ? (v.transmission ?? 'Not provided')
                          : v.state === 'reserved'
                            ? 'Reserved — ask about availability'
                            : 'Available';
                return `<td>${esc(value)}</td>`;
              })
              .join('')}</tr>`,
        )
        .join(
          '',
        )}<tr><th scope="row">Next step</th>${shown.map((r) => `<td><a class="btn btn-primary" href="${esc(vehicleUrlPath(r.vehicle!))}#enquire">Enquire about this car</a></td>`).join('')}</tr></tbody></table></div>`
    : rows.length
      ? `<p class="sl-muted">${rows.length} saved · ${available.length} currently listed</p><form id="sl-compare" method="get" action="/saved-cars"><input type="hidden" name="mode" value="compare"></form><div class="sl-grid">${rows
          .map((r) => {
            const v = r.vehicle;
            return `<article class="sl-card">${v ? `<a href="${esc(vehicleUrlPath(v))}" aria-label="View ${esc(title(v))}">${photo(v)}</a>` : '<div class="sl-photo-empty">No longer listed</div>'}<div class="sl-body"><h2>${v ? esc(title(v)) : 'This saved car is no longer available'}</h2>${v ? `<p class="sl-muted">${esc(v.derivative ?? '')}</p><p class="sl-price">${esc(price(v.pricePence))}</p><dl class="sl-specs"><div><dt>Mileage</dt><dd>${v.mileage === null ? 'Not provided' : esc(v.mileage.toLocaleString('en-GB')) + ' miles'}</dd></div><div><dt>Gearbox</dt><dd>${esc(v.transmission ?? 'Not provided')}</dd></div><div><dt>Fuel</dt><dd>${esc(v.fuelType ?? 'Not provided')}</dd></div><div><dt>Availability</dt><dd>${v.state === 'reserved' ? 'Reserved' : 'Available'}</dd></div></dl>` : '<p class="sl-muted">It may have sold or been withdrawn. Browse the current stock to find another option.</p>'}<div class="sl-actions">${v ? `<a class="btn" href="${esc(vehicleUrlPath(v))}">View car</a>` : '<a class="btn" href="/used-cars">Find another car</a>'}<form method="post" action="/saved-cars"><input type="hidden" name="vehicle" value="${esc(r.vehicleId)}"><button class="sl-remove" name="action" value="remove" aria-label="Remove ${v ? esc(title(v)) : 'unavailable car'} from saved cars">Remove</button></form></div></div>${v ? `<label class="sl-select"><input type="checkbox" name="compare" value="${esc(r.vehicleId)}" form="sl-compare"${selected.includes(r.vehicleId) ? ' checked' : ''}>Compare<span class="visually-hidden"> ${esc(title(v))}</span></label>` : ''}</article>`;
          })
          .join(
            '',
          )}</div>${available.length >= 2 ? '<div class="sl-bar"><p>Choose two or three cars for a closer look.</p><button class="btn btn-primary" type="submit" form="sl-compare">Compare selected cars</button></div>' : '<p class="sl-muted">Save another car to compare your choices.</p>'}`
      : '<section class="sl-empty"><h2>A little space for your favourites</h2><p class="sl-muted" style="margin:0 auto 24px">See something you like? Choose “Save this car” on a stock card or vehicle page. You can compare your choices here without creating an account.</p><a class="btn btn-primary" href="/used-cars">Explore the cars</a></section>'
}
<p class="sl-muted" style="margin-top:28px;font-size:14px">Saved cars use a necessary cookie after you choose to save. Clearing cookies removes access to this browser’s list. Saving a car does not reserve it or sign you up for messages.</p></main>${siteFooter(dealer)}</body></html>`;
}
