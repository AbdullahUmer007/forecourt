import { requireTenant } from './request.js';
import { loadDealer } from './data/vehicles.js';
import { loadSavedSearches, changeSavedSearch } from './data/saved-searches.js';
import { mintVisitorToken } from './data/shortlist.js';
import { visitorCookie, savedHeaders } from './saved-cars.js';
import { renderSavedSearches } from './render/saved-searches.js';
import { readForm } from './enquiries.js';
import { shortlistCookie } from '../../../packages/domain/src/shortlist.js';
export async function getSavedSearches(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;
  const dealer = await loadDealer(tenantId, origin);
  try {
    const rows = await loadSavedSearches(tenantId, visitorCookie(request));
    const notices: Record<string, string> = {
      save: 'Search saved. Check back here for current matches.',
      rename: 'Search name saved.',
      remove: 'Search removed.',
    };
    const message =
      notices[new URL(request.url).searchParams.get('notice') ?? ''];
    return new Response(
      renderSavedSearches(dealer, rows, message ? { message } : {}),
      { headers: savedHeaders },
    );
  } catch {
    return new Response(
      renderSavedSearches(dealer, [], {
        error: true,
        unavailable: true,
        message:
          'Your saved searches could not be loaded. Try again shortly. Your searches have not been cleared.',
      }),
      { status: 503, headers: savedHeaders },
    );
  }
}
export async function postSavedSearch(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(request.headers.get('origin') ?? '').host === host;
  } catch {
    /* Refuse absent or malformed origins. */
  }
  if (!sameOrigin || request.headers.get('sec-fetch-site') === 'cross-site')
    return new Response('Open this form on the dealer website and try again.', {
      status: 403,
      headers: savedHeaders,
    });
  const form = await readForm(request).catch(() => null);
  if (!form)
    return new Response(
      'The form could not be read. Return to the stock page and try again.',
      { status: 400, headers: savedHeaders },
    );
  const action = form.get('action') ?? '',
    existing = visitorCookie(request);
  const { tenantId, origin } = resolved.tenant;
  const token = existing ?? mintVisitorToken();
  try {
    const result = await changeSavedSearch(tenantId, token, {
      action,
      search: form.get('search') ?? '',
      id: form.get('id') ?? '',
      name: form.get('name') ?? '',
    });
    if (!result.ok) {
      const [dealer, rows] = await Promise.all([
        loadDealer(tenantId, origin),
        loadSavedSearches(tenantId, existing),
      ]);
      return new Response(
        renderSavedSearches(dealer, rows, {
          error: true,
          message: result.message,
        }),
        { status: 422, headers: savedHeaders },
      );
    }
    const headers = new Headers({
      ...savedHeaders,
      location: `/saved-searches?notice=${action}`,
    });
    if (!existing && action === 'save') {
      const spec = shortlistCookie(),
        local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      headers.set(
        'set-cookie',
        `${spec.name}=${token}; Path=/; Max-Age=${spec.maxAgeSeconds}; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`,
      );
    }
    return new Response(null, { status: 303, headers });
  } catch {
    return new Response(
      'Your saved searches could not be updated. Go back and try again.',
      { status: 503, headers: savedHeaders },
    );
  }
}
