import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { holds } from '@forecourt/domain';
import { renderWebsitePreview } from '@/data/website-preview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Website preview' };

export default async function WebsitePreviewPage() {
  const session = await requireSession();
  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'website.update')) notFound();

  const html = await renderWebsitePreview(session.tenantId);
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-ink-muted">
        This is your shopfront as a buyer would see it, rendered for this dealership — not looked up by hostname.
      </p>
      <iframe
        title="Website preview"
        srcDoc={html}
        className="min-h-[80vh] w-full rounded-md border border-edge bg-white"
      />
    </div>
  );
}
