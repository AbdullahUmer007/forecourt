import { authorize, parseSiteTheme, defaultSiteTheme, brandColourOk, darkenHex, mediaUrlPath,
  type SiteThemeId, type FontPairing, type ThemeRadius, type CardStyle } from '@forecourt/domain';
import { storeBrandLogo } from '@/media/store';
import { withSession } from './db';
import type { Session } from '@/auth/session';

export interface WebsiteSettings {
  brandId: string;
  siteId: string;
  themeId: SiteThemeId;
  brandPrimary: string;
  radius: ThemeRadius;
  cardStyle: CardStyle;
  fontPairing: FontPairing;
  homeHeadline: string;
  homeLead: string;
  about: string;
  contactBlurb: string;
  footerLegal: string;
  logoUrl: string | null;
  phone: string;
  email: string;
  line1: string;
  city: string;
  county: string;
  postcode: string;
  weekdayOpen: string;
  weekdayClose: string;
  saturdayOpen: string;
  saturdayClose: string;
}

export type WebsiteOutcome = { ok: true } | { ok: false; error: string };

export async function loadWebsiteSettings(session: Session): Promise<WebsiteSettings | null> {
  return withSession(session, async (tx) => {
    const [row] = await tx`
      SELECT b.id AS brand_id, b.theme, b.logo_light_key,
             s.id AS site_id, s.phone, s.email, s.address, s.opening_hours
        FROM brands b
        LEFT JOIN LATERAL (
          SELECT id, phone, email, address, opening_hours
            FROM sites ORDER BY created_at LIMIT 1
        ) s ON true
       ORDER BY b.is_default DESC, b.created_at
       LIMIT 1`;
    if (!row) return null;
    const theme = parseSiteTheme(row['theme']);
    const address = (row['address'] as Record<string, string> | null) ?? {};
    const hours = (row['opening_hours'] as { days?: string[]; opens?: string; closes?: string }[] | null) ?? [];
    const week = hours.find((h) => (h.days ?? []).includes('Monday'));
    const sat = hours.find((h) => (h.days ?? []).includes('Saturday') && !(h.days ?? []).includes('Monday'));
    const logoKey = row['logo_light_key'] === null || row['logo_light_key'] === undefined
      ? null : String(row['logo_light_key']);
    return {
      brandId: String(row['brand_id']),
      siteId: String(row['site_id'] ?? ''),
      themeId: theme.id,
      brandPrimary: theme.brandPrimary,
      radius: theme.radius,
      cardStyle: theme.cardStyle,
      fontPairing: theme.fontPairing,
      homeHeadline: theme.copy.homeHeadline,
      homeLead: theme.copy.homeLead,
      about: theme.copy.about,
      contactBlurb: theme.copy.contactBlurb,
      footerLegal: theme.copy.footerLegal,
      logoUrl: logoKey ? mediaUrlPath(logoKey) : null,
      phone: String(row['phone'] ?? ''),
      email: String(row['email'] ?? ''),
      line1: address['line1'] ?? '',
      city: address['city'] ?? '',
      county: address['county'] ?? '',
      postcode: address['postcode'] ?? '',
      weekdayOpen: week?.opens ?? '10:00',
      weekdayClose: week?.closes ?? '18:00',
      saturdayOpen: sat?.opens ?? week?.opens ?? '10:00',
      saturdayClose: sat?.closes ?? week?.closes ?? '16:00',
    };
  });
}

export async function saveWebsiteSettings(
  session: Session,
  form: FormData,
): Promise<WebsiteOutcome> {
  const decision = authorize({
    userId: session.userId, tenantId: session.tenantId, roleKey: session.roleKey,
    permissions: session.permissions, scope: session.scope, siteIds: session.siteIds,
    stepUpSatisfiedAt: session.stepUpSatisfiedAt, mfaSatisfiedAt: session.mfaSatisfiedAt,
  }, 'website.update');
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const themeId = String(form.get('themeId') ?? 'classic');
  if (themeId !== 'classic' && themeId !== 'studio' && themeId !== 'compact') {
    return { ok: false, error: 'Pick Classic, Studio or Compact.' };
  }
  const preset = defaultSiteTheme(themeId);
  const brandPrimary = String(form.get('brandPrimary') ?? preset.brandPrimary).trim();
  const colour = brandColourOk(brandPrimary);
  if (!colour.ok) return { ok: false, error: colour.reason };

  const fonts: FontPairing[] = ['inter', 'source_sans', 'ibm_plex', 'noto_sans', 'nunito_sans', 'work_sans'];
  const font = fonts.includes(String(form.get('fontPairing')) as FontPairing)
    ? String(form.get('fontPairing')) as FontPairing
    : preset.fontPairing;
  const radius = (['sharp', 'soft', 'rounded'] as const).includes(String(form.get('radius')) as ThemeRadius)
    ? String(form.get('radius')) as ThemeRadius
    : preset.radius;
  const cardStyle = (['bordered', 'elevated', 'flat'] as const).includes(String(form.get('cardStyle')) as CardStyle)
    ? String(form.get('cardStyle')) as CardStyle
    : preset.cardStyle;

  const theme = {
    id: themeId,
    brandPrimary,
    brandPrimaryHover: darkenHex(brandPrimary),
    radius,
    cardStyle,
    fontPairing: font,
    copy: {
      homeHeadline: String(form.get('homeHeadline') ?? ''),
      homeLead: String(form.get('homeLead') ?? ''),
      about: String(form.get('about') ?? ''),
      contactBlurb: String(form.get('contactBlurb') ?? ''),
      footerLegal: String(form.get('footerLegal') ?? ''),
    },
  };

  const hours = [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: String(form.get('weekdayOpen') ?? '10:00'),
      closes: String(form.get('weekdayClose') ?? '18:00') },
    { days: ['Saturday'],
      opens: String(form.get('saturdayOpen') ?? '10:00'),
      closes: String(form.get('saturdayClose') ?? '16:00') },
  ];
  const address = {
    line1: String(form.get('line1') ?? ''),
    city: String(form.get('city') ?? ''),
    county: String(form.get('county') ?? ''),
    postcode: String(form.get('postcode') ?? ''),
  };

  const logo = form.get('logo');
  let logoKey: string | null = null;
  if (logo instanceof File && logo.size > 0) {
    const stored = await storeBrandLogo(session.tenantId, 'logo-light', logo);
    if (!stored.ok) return stored;
    logoKey = stored.key;
  }

  try {
    await withSession(session, async (tx) => {
      const [brand] = await tx<{ id: string }[]>`
        SELECT id FROM brands ORDER BY is_default DESC, created_at LIMIT 1`;
      if (!brand) throw new Error('This dealership has no brand record yet.');
      await tx`
        UPDATE brands SET
          theme = ${tx.json(theme)},
          logo_light_key = coalesce(${logoKey}, logo_light_key),
          updated_at = now()
         WHERE id = ${brand.id}::uuid`;

      const [site] = await tx<{ id: string }[]>`
        SELECT id FROM sites ORDER BY created_at LIMIT 1`;
      if (site) {
        await tx`
          UPDATE sites SET
            phone = ${String(form.get('phone') ?? '') || null},
            email = ${String(form.get('email') ?? '') || null},
            address = ${tx.json(address)},
            opening_hours = ${tx.json(hours)},
            updated_at = now()
           WHERE id = ${site.id}::uuid`;
      }

      await tx`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, resource_type, resource_id, action, diff
        ) VALUES (
          ${session.tenantId}::uuid, 'user', ${session.userId}::uuid,
          'brand', ${brand.id}::uuid, 'update',
          ${tx.json({ after: { theme: themeId, brandPrimary } })}
        )`;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The website could not be saved.' };
  }
  return { ok: true };
}
