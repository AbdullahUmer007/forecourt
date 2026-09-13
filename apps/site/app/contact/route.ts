import { staticPageResponse } from '../../src/pages.js';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return staticPageResponse(request, 'contact', {
    formOk: new URL(request.url).searchParams.get('sent') === '1',
  });
}
