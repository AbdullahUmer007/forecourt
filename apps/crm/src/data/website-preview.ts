import { requireSession } from '@/auth/session';
import { loadWebsiteSettings } from './website';
import { renderHomePage } from '../../../site/src/render/home.js';

/**
 * Authenticated preview: same home template as the public host, no host lookup.
 */
export async function renderWebsitePreview(tenantId: string): Promise<string> {
  const session = await requireSession();
  if (session.tenantId !== tenantId) {
    throw new Error('Preview is only for the signed-in dealership.');
  }
  const settings = await loadWebsiteSettings(session);
  const name = session.tenantName;

  return renderHomePage({
    dealer: {
      name,
      url: '',
      logoUrl: settings?.logoUrl ?? null,
      telephone: settings?.phone || null,
      email: settings?.email || null,
      whatsapp: null,
      street: settings?.line1 ?? '',
      locality: settings?.city ?? '',
      region: settings?.county ?? '',
      postcode: settings?.postcode ?? '',
      country: 'GB',
      latitude: null,
      longitude: null,
      openingHours: [
        { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: settings?.weekdayOpen ?? '10:00',
          closes: settings?.weekdayClose ?? '18:00' },
        { days: ['Saturday'],
          opens: settings?.saturdayOpen ?? '10:00',
          closes: settings?.saturdayClose ?? '16:00' },
      ],
      ratingValue: null,
      reviewCount: null,
      priceRange: '££',
    },
    theme: {
      brandPrimary: settings?.brandPrimary ?? '#0E5A6B',
      brandPrimaryHover: settings?.brandPrimary ?? '#0B4553',
      radius: settings?.radius ?? 'soft',
      cardStyle: settings?.cardStyle ?? 'bordered',
      fontStack: 'Inter, system-ui, sans-serif',
    },
    ...(settings?.homeHeadline ? { headline: settings.homeHeadline } : {}),
    ...(settings?.homeLead ? { lead: settings.homeLead } : {}),
    stockCount: 0,
    fromPricePence: null,
    justArrived: [],
    browseByBody: [],
    browseByMake: [],
    now: new Date(),
  });
}
