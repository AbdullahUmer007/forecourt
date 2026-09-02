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

  return (
    <>
      <PageHeader
        title="Website"
        meta="Classic, Studio or Compact — then logo, colour and copy. Not a blank canvas."
        action={
          <Link
            href="/settings/website/preview"
            className="inline-flex min-h-11 items-center rounded-md border border-edge-strong px-4 font-medium hover:bg-surface-3"
          >
            Preview
          </Link>
        }
      />
      <Card>
        <WebsiteForm settings={settings} />
      </Card>
    </>
  );
}
