import type { SiteThemeId } from '@forecourt/domain/site-theme';
import { authorize } from '@forecourt/domain';
import { requireSession } from '@/auth/session';
import { renderTenantHome } from '../../../site/src/data/home.js';

/** Uses the public read-only role and the same homepage as the dealer domain. */
export async function renderWebsitePreview(tenantId: string, preset?: SiteThemeId): Promise<string> {
  const session = await requireSession();
  if (session.tenantId !== tenantId || !authorize(session, 'website.update').allowed) {
    throw new Error('Preview is only available to this dealership’s website managers.');
  }
  return renderTenantHome(session.tenantId, '', preset);
}
