import { requireTenant } from './request.js';
import { staticPageResponse } from './pages.js';
import { submitEnquiry, type EnquiryInput } from './data/enquiries.js';

const LIMIT = 65_536;

export async function readForm(request: Request): Promise<URLSearchParams | null> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(body));
}

export async function postEnquiry(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let originMatches = false;
  try { originMatches = !origin || new URL(origin).host === host; } catch { /* Refuse invalid Origin. */ }
  if (!originMatches || request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Open the enquiry form on the dealer website and try again.', { status: 403 });
  }
  const form = await readForm(request).catch(() => null);
  if (!form) {
    return staticPageResponse(request, 'contact', {
      formError: 'The form could not be read. Keep your question under 4,000 characters and try again.', status: 400,
    });
  }
  const values: EnquiryInput = {
    name: form.get('name') ?? '', email: form.get('email') ?? '', phone: form.get('phone') ?? '',
    message: form.get('message') ?? '', vehicle: form.get('vehicle') ?? '',
  };
  if (form.get('company_website')) {
    return new Response(null, { status: 303, headers: { location: '/contact?sent=1', 'cache-control': 'no-store' } });
  }
  const result = await submitEnquiry(resolved.tenant.tenantId, values);
  if (!result.ok) return staticPageResponse(request, 'contact', { formError: result.error, formValues: values, status: 422 });
  return new Response(null, { status: 303, headers: { location: '/contact?sent=1', 'cache-control': 'no-store' } });
}
