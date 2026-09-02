import { NextResponse } from 'next/server';
import { getSession } from '@/auth/session';
import { isTenantOwnedKey } from '@forecourt/domain';
import { readStoredPhoto } from '@/media/store';

export const dynamic = 'force-dynamic';

/**
 * Serve a stored object to a signed-in member of the tenant that owns it.
 *
 * The key is tenant-prefixed. A session for dealer A asking for dealer B's
 * path is refused here, before the disk is touched — RLS cannot help a
 * filesystem.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse('Sign in to see this photograph.', { status: 401 });

  const key = (await params).key.join('/');
  if (!isTenantOwnedKey(key, session.tenantId)) {
    return new NextResponse('That photograph is not yours.', { status: 404 });
  }

  const body = await readStoredPhoto(key);
  if (!body) return new NextResponse('That photograph is not here.', { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=3600',
    },
  });
}
