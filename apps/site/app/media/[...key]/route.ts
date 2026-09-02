import { NextResponse } from 'next/server';
import { isTenantOwnedKey } from '@forecourt/domain';
import { requireTenant } from '../../../src/request.js';
import { withTenant } from '../../../src/data/db.js';
import { readPublicMedia } from '../../../src/media/disk.js';

export const dynamic = 'force-dynamic';

/**
 * Public photographs for the resolved tenant only.
 *
 * Two gates, both required:
 *   1. the Host header resolved to this tenant (unknown hosts 404)
 *   2. the key is that tenant's, AND the row is published (or it is a brand logo)
 *
 * An unpublished interior shot must not leak because someone guessed the hash.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const resolved = await requireTenant(request);
  if (!resolved.ok) return resolved.response;

  const key = (await params).key.join('/');
  const tenantId = resolved.tenant.tenantId;
  if (!isTenantOwnedKey(key, tenantId)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const allowed = await withTenant(tenantId, async (tx) => {
    if (key.includes('/b/logo-')) {
      const [brand] = await tx`
        SELECT id FROM brands
         WHERE tenant_id = ${tenantId}::uuid
           AND (logo_light_key = ${key} OR logo_dark_key = ${key})`;
      return Boolean(brand);
    }
    const [row] = await tx`
      SELECT id FROM vehicle_media
       WHERE storage_key = ${key}
         AND published AND deleted_at IS NULL`;
    return Boolean(row);
  });

  if (!allowed) return new NextResponse('Not found', { status: 404 });

  const body = await readPublicMedia(key);
  if (!body) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400, immutable',
    },
  });
}
