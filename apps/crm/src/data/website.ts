import {
  authorize,
  parseSiteTheme,
  defaultSiteTheme,
  brandColourOk,
  darkenHex,
  mediaUrlPath,
  type SiteThemeId,
  type FontPairing,
  type ThemeRadius,
  type CardStyle,
} from '@forecourt/domain';
import { storeBrandLogo } from '@/media/store';
import { writeAudit } from './audit';
import { withSession } from './db';
import type { Session } from '@/auth/session';

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export interface DayHours {
  day: string;
  open: boolean;
  opens: string;
  closes: string;
}

export interface WebsiteSettings {
  weeklyHours: DayHours[];
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

export async function loadWebsiteSettings(
  session: Session,
): Promise<WebsiteSettings | null> {
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
    const hours =
      (row['opening_hours'] as
        { days?: string[]; opens?: string; closes?: string }[] | null) ?? [];
    const week = hours.find((h) => (h.days ?? []).includes('Monday'));
    const sat = hours.find(
      (h) =>
        (h.days ?? []).includes('Saturday') &&
        !(h.days ?? []).includes('Monday'),
    );
    const logoKey =
      row['logo_light_key'] === null || row['logo_light_key'] === undefined
        ? null
        : String(row['logo_light_key']);
    return {
      weeklyHours: WEEK_DAYS.map((day) => {
        const entry = hours.find((h) => h.days?.includes(day));
        return {
          day,
          open: !!entry,
          opens: entry?.opens ?? '09:00',
          closes: entry?.closes ?? '17:00',
        };
      }),
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
  const decision = authorize(
    {
      userId: session.userId,
      tenantId: session.tenantId,
      roleKey: session.roleKey,
      permissions: session.permissions,
      scope: session.scope,
      siteIds: session.siteIds,
      stepUpSatisfiedAt: session.stepUpSatisfiedAt,
      mfaSatisfiedAt: session.mfaSatisfiedAt,
    },
    'website.update',
  );
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const limits: Record<string, number> = {
    phone: 40,
    email: 254,
    line1: 200,
    city: 100,
    county: 100,
    postcode: 12,
    homeHeadline: 160,
    homeLead: 600,
    about: 10000,
    contactBlurb: 2000,
    footerLegal: 4000,
  };
  for (const [field, max] of Object.entries(limits)) {
    if (String(form.get(field) ?? '').length > max)
      return {
        ok: false,
        error: `The ${field} field must be ${max} characters or fewer.`,
      };
  }
  const email = String(form.get('email') ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: 'Enter a valid contact email address.' };
  const weekly = form.get('hoursMode') === 'weekly';
  const hours: { days: string[]; opens: string; closes: string }[] = [];
  const timeOk = (from: string, to: string) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(from) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(to) &&
    from < to;
  if (weekly) {
    for (const day of WEEK_DAYS) {
      const status = form.get(`${day}Status`);
      if (status !== 'open' && status !== 'closed')
        return { ok: false, error: `Choose open or closed for ${day}.` };
      if (status === 'closed') continue;
      const opens = String(form.get(`${day}Open`) ?? ''),
        closes = String(form.get(`${day}Close`) ?? '');
      if (!timeOk(opens, closes))
        return {
          ok: false,
          error: `${day} closing time must be after opening time. Use 24-hour times such as 09:00.`,
        };
      hours.push({ days: [day], opens, closes });
    }
  } else {
    for (const [label, open, close, days] of [
      ['Weekday', 'weekdayOpen', 'weekdayClose', WEEK_DAYS.slice(0, 5)],
      ['Saturday', 'saturdayOpen', 'saturdayClose', ['Saturday']],
    ] as const) {
      const opens = String(form.get(open) ?? ''),
        closes = String(form.get(close) ?? '');
      if (!timeOk(opens, closes))
        return {
          ok: false,
          error: `${label} closing time must be after opening time. Use 24-hour times such as 09:00.`,
        };
      hours.push({ days: [...days], opens, closes });
    }
  }
  const themeId = String(form.get('themeId') ?? 'classic');
  if (themeId !== 'classic' && themeId !== 'studio' && themeId !== 'compact') {
    return { ok: false, error: 'Pick Classic, Studio or Compact.' };
  }
  const preset = defaultSiteTheme(themeId);
  const brandPrimary = String(
    form.get('brandPrimary') ?? preset.brandPrimary,
  ).trim();
  const colour = brandColourOk(brandPrimary);
  if (!colour.ok) return { ok: false, error: colour.reason };

  const fonts: FontPairing[] = [
    'inter',
    'source_sans',
    'ibm_plex',
    'noto_sans',
    'nunito_sans',
    'work_sans',
  ];
  const font = fonts.includes(String(form.get('fontPairing')) as FontPairing)
    ? (String(form.get('fontPairing')) as FontPairing)
    : preset.fontPairing;
  const radius = (['sharp', 'soft', 'rounded'] as const).includes(
    String(form.get('radius')) as ThemeRadius,
  )
    ? (String(form.get('radius')) as ThemeRadius)
    : preset.radius;
  const cardStyle = (['bordered', 'elevated', 'flat'] as const).includes(
    String(form.get('cardStyle')) as CardStyle,
  )
    ? (String(form.get('cardStyle')) as CardStyle)
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

  const address = {
    line1: String(form.get('line1') ?? ''),
    city: String(form.get('city') ?? ''),
    county: String(form.get('county') ?? ''),
    postcode: String(form.get('postcode') ?? ''),
  };

  const current = await loadWebsiteSettings(session);
  if (!current?.siteId)
    return {
      ok: false,
      error:
        'This dealership needs a brand and main site before its website can be edited.',
    };
  if (
    session.scope !== 'all_sites' &&
    !session.siteIds.includes(current.siteId)
  )
    return {
      ok: false,
      error: 'You need access to the main dealership site to edit its website.',
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
      const [brand] = await tx`
        SELECT id, theme, logo_light_key FROM brands ORDER BY is_default DESC, created_at LIMIT 1 FOR UPDATE`;
      if (!brand) throw new Error('This dealership has no brand record yet.');
      const [site] =
        await tx`SELECT id, address, opening_hours, phone, email FROM sites ORDER BY created_at LIMIT 1 FOR UPDATE`;
      if (!site) throw new Error('This dealership has no site record yet.');
      if (
        session.scope !== 'all_sites' &&
        !session.siteIds.includes(String(site['id']))
      )
        throw new Error(
          'You need access to the main dealership site to edit its website.',
        );
      const originalAddress =
        (site['address'] as Record<string, unknown> | null) ?? {};
      const originalHours =
        (site['opening_hours'] as
          { days: string[]; opens: string; closes: string }[] | null) ?? [];
      const editedDays = new Set<string>(
        weekly ? WEEK_DAYS : WEEK_DAYS.slice(0, 6),
      );
      const preservedHours = originalHours
        .map((h) => ({
          ...h,
          days: h.days.filter((day) => !editedDays.has(day)),
        }))
        .filter((h) => h.days.length > 0);
      const nextAddress = { ...originalAddress, ...address };
      const nextHours = [...hours, ...preservedHours];
      await tx`
        UPDATE brands SET
          theme = ${tx.json(theme)},
          logo_light_key = coalesce(${logoKey}, logo_light_key),
          updated_at = now(), updated_by = ${session.userId}::uuid
         WHERE id = ${String(brand['id'])}::uuid`;

      if (site) {
        await tx`
          UPDATE sites SET
            phone = ${String(form.get('phone') ?? '') || null},
            email = ${email || null},
            address = ${tx.json(nextAddress)},
            opening_hours = ${tx.json(nextHours)},
            updated_at = now(), updated_by = ${session.userId}::uuid
           WHERE id = ${String(site['id'])}::uuid`;
      }

      await writeAudit({
        tx,
        session,
        resourceType: 'brand',
        resourceId: String(brand['id']),
        action: 'website_updated',
        before: {
          theme: brand['theme'],
          logoKey: brand['logo_light_key'],
          address: originalAddress,
          hours: originalHours,
          phone: site['phone'],
          email: site['email'],
        },
        after: {
          theme,
          logoKey: logoKey ?? brand['logo_light_key'],
          address: nextAddress,
          hours: nextHours,
          phone: String(form.get('phone') ?? '') || null,
          email: email || null,
        },
        siteId: String(site['id']),
      });
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'The website could not be saved.',
    };
  }
  return { ok: true };
}
