import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { PreviewFrame } from './preview-frame';
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
  return <div>
    <PageHeader title="Your shopfront" meta="Saved settings and current public stock. This preview is read-only; links and forms are disabled."
      action={<Link href="/settings/website" className="inline-flex min-h-11 items-center rounded-md border border-edge-strong px-4 font-medium">Back to website settings</Link>} />
    <PreviewFrame html={html} />
  </div>;
}
