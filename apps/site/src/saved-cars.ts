import { requireTenant } from './request.js';
import { loadDealer } from './data/vehicles.js';
import {
  loadSavedCars,
  changeSavedCar,
  validVisitorToken,
  mintVisitorToken,
} from './data/shortlist.js';
import { renderSavedCars } from './render/saved-cars.js';
import {
  shortlistCookie,
  SHORTLIST_COOKIE,
} from '../../../packages/domain/src/shortlist.js';
import { readForm } from './enquiries.js';
export const savedHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  vary: 'Cookie',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'same-origin',
};
export function visitorCookie(request: Request): string | null {
  const raw =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(SHORTLIST_COOKIE + '='))
      ?.slice(SHORTLIST_COOKIE.length + 1) ?? null;
  return validVisitorToken(raw) ? raw : null;
}
export function safeBack(value: string | null): string {
  if (
    !value ||
    value.length > 2000 ||
    !/^\/used-cars(?:[/?]|$)/.test(value) ||
    /[\\\r\n]/.test(value)
  )
    return '/used-cars';
  return value;
}
export async function getSavedCars(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant,
    url = new URL(request.url);
  const dealer = await loadDealer(tenantId, origin);
  try {
    const rows = await loadSavedCars(tenantId, visitorCookie(request));
    const notices: Record<string, string> = {
      saved: 'Car saved. Your shortlist is ready below.',
      removed: 'Car removed from your saved cars.',
    };
    const message = notices[url.searchParams.get('notice') ?? ''];
    return new Response(
      renderSavedCars(dealer, rows, {
        ...(message ? { message } : {}),
        compareRequested: url.searchParams.get('mode') === 'compare',
        compare: [...new Set(url.searchParams.getAll('compare'))].slice(0, 4),
        back: safeBack(url.searchParams.get('back')),
      }),
      { headers: savedHeaders },
    );
  } catch {
    return new Response(
      renderSavedCars(dealer, [], {
        error: true,
        message:
          'Your saved cars could not be loaded. Please refresh to try again. Your choices have not been cleared.',
      }),
      { status: 503, headers: savedHeaders },
    );
  }
}
export async function postSavedCar(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const host = request.headers.get('host') ?? new URL(request.url).host,
    origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && new URL(origin).host === host;
  } catch {
    /* Refuse malformed origins. */
  }
  if (!sameOrigin || request.headers.get('sec-fetch-site') === 'cross-site')
    return new Response(
      'Open the saved-car form on this dealer website and try again.',
      { status: 403, headers: savedHeaders },
    );
  const form = await readForm(request).catch(() => null);
  if (!form)
    return new Response(
      'The form could not be read. Return to the stock list and try again.',
      { status: 400, headers: savedHeaders },
    );
  const action = form.get('action') ?? '',
    existing = visitorCookie(request);
  if (!['save', 'remove'].includes(action))
    return new Response('Choose save or remove.', {
      status: 400,
      headers: savedHeaders,
    });
  if (!existing && action === 'remove')
    return new Response(null, {
      status: 303,
      headers: { ...savedHeaders, location: '/saved-cars' },
    });
  const token = existing ?? mintVisitorToken(),
    { tenantId, origin: dealerOrigin } = resolved.tenant;
  try {
    const result = await changeSavedCar(
      tenantId,
      token,
      form.get('vehicle') ?? '',
      action,
    );
    if (!result.ok) {
      const [dealer, rows] = await Promise.all([
        loadDealer(tenantId, dealerOrigin),
        loadSavedCars(tenantId, existing),
      ]);
      return new Response(
        renderSavedCars(dealer, rows, { error: true, message: result.message }),
        { status: 422, headers: savedHeaders },
      );
    }
    const headers = new Headers({
      ...savedHeaders,
      location: `/saved-cars?notice=${action === 'save' ? 'saved' : 'removed'}&back=${encodeURIComponent(safeBack(form.get('return')))}`,
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
      'Your saved cars could not be updated. Please go back and try again.',
      { status: 503, headers: savedHeaders },
    );
  }
}
