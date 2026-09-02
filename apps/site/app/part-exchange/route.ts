import { requireTenant } from '../../src/request.js';
import { staticPageResponse } from '../../src/pages.js';
import { submitPartExchange } from '../../src/data/part-exchange.js';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return staticPageResponse(request, 'part-exchange');
}

export async function POST(request: Request): Promise<Response> {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;

  const form = await request.formData();
  const result = await submitPartExchange(resolved.tenant.tenantId, {
    registration: String(form.get('registration') ?? ''),
    mileage: String(form.get('mileage') ?? ''),
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
    email: String(form.get('email') ?? ''),
  });

  if (!result.ok) {
    return staticPageResponse(request, 'part-exchange', { formError: result.error });
  }
  return staticPageResponse(request, 'part-exchange', { formOk: true });
}
