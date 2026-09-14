import { renderWebsitePreview } from '@/data/website-preview';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { holds } from '@forecourt/domain';
import { loadWebsiteSettings } from '@/data/website';
import { PageHeader, Card } from '@/components/ui';
import { WebsiteForm } from './website-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Website' };

export default async function WebsiteSettingsPage() {
  const session = await requireSession();
  const principal = {
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
  };
  if (!holds(principal, 'website.update')) notFound();

  const settings = await loadWebsiteSettings(session);
  if (!settings) {
    return (
      <Card title="Website">
        <p className="text-ink-muted">This dealership has no brand record yet. Ask platform admin to provision one.</p>
      </Card>
    );
  }

  const previews = await Promise.all((["classic", "studio", "compact"] as const).map(id => renderWebsitePreview(session.tenantId, id)));
  return (
    <>
      <PageHeader
        title="Your website"
        meta="Make your shopfront feel like your dealership. Manage its appearance, contact details and page content here."
        action={
          <Link
            href="/settings/website/preview"
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong px-4 font-medium hover:bg-surface-3"
          >
            Preview saved website ↗
          </Link>
        }
      />
      <Card>
        <WebsiteForm settings={settings} previews={previews} />
      </Card>
    </>
  );
}
