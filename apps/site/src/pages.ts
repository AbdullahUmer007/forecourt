import { requireTenant } from './request.js';
import { loadDealer } from './data/vehicles.js';
import { renderStaticPage, type StaticPageId } from './render/static-page.js';
import type { EnquiryInput } from './data/enquiries.js';

export async function staticPageResponse(
  request: Request,
  id: StaticPageId,
  extras: { formError?: string; formOk?: boolean; formValues?: EnquiryInput; status?: number } = {},
): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const { tenantId, origin } = resolved.tenant;
  const dealer = await loadDealer(tenantId, origin);

  const html = renderStaticPage({
    id,
    origin,
    theme: dealer.theme,
    now: new Date(),
    ...(extras.formError ? { formError: extras.formError } : {}),
    ...(extras.formOk ? { formOk: extras.formOk } : {}),
    ...(extras.formValues ? { formValues: extras.formValues } : {}),
    dealer: {
      name: dealer.name,
      telephone: dealer.telephone,
      email: dealer.email,
      locality: dealer.locality,
      street: dealer.street,
      postcode: dealer.postcode,
      openingHours: dealer.openingHours,
      fcaReference: dealer.fcaFrn,
      legalName: null,
      logoUrl: dealer.logoUrl,
      about: dealer.siteTheme.copy.about,
      contactBlurb: dealer.siteTheme.copy.contactBlurb,
      footerLegal: dealer.siteTheme.copy.footerLegal,
    },
  });

  return new Response(html, {
    status: extras.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': extras.formOk || extras.formError
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
