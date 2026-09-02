import { NextResponse } from 'next/server';
import { getSession } from '@/auth/session';
import { listMakes, listModels, listVariants } from '@/data/catalogue';

export const dynamic = 'force-dynamic';

/**
 * Cascading make / model / variant for the book-in and appraisal forms.
 * Session-gated. The catalogue itself is platform data — the session is
 * what stops the open internet enumerating it, not tenancy.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to search the catalogue.' }, { status: 401 });

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'makes';
  const q = url.searchParams.get('q') ?? '';
  const makeId = url.searchParams.get('makeId') ?? '';
  const modelId = url.searchParams.get('modelId') ?? '';

  if (kind === 'makes') {
    return NextResponse.json({ makes: await listMakes(session, q) });
  }
  if (kind === 'models') {
    if (!makeId) return NextResponse.json({ models: [] });
    return NextResponse.json({ models: await listModels(session, makeId, q) });
  }
  if (kind === 'variants') {
    if (!modelId) return NextResponse.json({ variants: [] });
    return NextResponse.json({ variants: await listVariants(session, modelId, q) });
  }
  return NextResponse.json({ error: 'Unknown catalogue kind.' }, { status: 400 });
}
