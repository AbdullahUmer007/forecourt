import { NextResponse } from 'next/server';
import { requireSession } from '@/auth/session';
import { loadChannelPnl, pnlToCsv } from '@/data/dashboard';
import { holds } from '@forecourt/domain';

export const dynamic = 'force-dynamic';

/**
 * The P&L as a file.
 *
 * A route handler rather than a client-side download: the CSV is built by
 * `pnlToCsv` in the domain, from figures computed server-side, so the file and
 * the screen cannot disagree. A dealer who exports a table that differs from
 * what they were just looking at will trust neither again.
 *
 * `report.export` — separate from `report.read` on purpose. Reading a report on
 * screen and walking out with a file of it are different acts, and the second
 * is the one that ends up in somebody else's inbox.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await requireSession();

  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'report.export')) {
    return new NextResponse('Exporting reports is not on your role.', { status: 403 });
  }

  const url = new URL(request.url);
  const canSeeCost = holds(principal, 'vehicle.cost.read');

  const view = await loadChannelPnl(session, {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  }, canSeeCost);

  const csv = pnlToCsv(view.pnl);
  const from = view.pnl.from.toISOString().slice(0, 10);
  const to = view.pnl.to.toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      // `text/csv; charset=utf-8` and a BOM-free body: the £ signs are UTF-8,
      // and Excel on Windows reads them correctly from a declared charset.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="channel-pnl-${from}-to-${to}.csv"`,
      // A report about a specific dealer's trading is never cacheable by
      // anything in front of us.
      'cache-control': 'no-store, private',
    },
  });
}
