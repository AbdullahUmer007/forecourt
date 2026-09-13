/**
 * Constrained public-site themes.
 *
 * A dealer picks one of three layouts and a small token set. They cannot
 * invent a font, a hex that fails AA, or a blank-canvas page — those are how
 * a shopfront becomes ugly and slow, and how we eat the support.
 */

import colours from '../../tokens/site-themes.json';

export type SiteThemeId = 'classic' | 'studio' | 'compact';
export type FontPairing = 'inter' | 'source_sans' | 'ibm_plex' | 'noto_sans' | 'nunito_sans' | 'work_sans';
export type ThemeRadius = 'sharp' | 'soft' | 'rounded';
export type CardStyle = 'bordered' | 'elevated' | 'flat';

export interface SiteCopy {
  homeHeadline: string;
  homeLead: string;
  about: string;
  contactBlurb: string;
  footerLegal: string;
}

export interface SiteThemeConfig {
  id: SiteThemeId;
  brandPrimary: string;
  brandPrimaryHover: string;
  radius: ThemeRadius;
  cardStyle: CardStyle;
  fontPairing: FontPairing;
  copy: SiteCopy;
}

export const FONT_STACKS: Record<FontPairing, string> = {
  inter: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  source_sans: '"Source Sans 3", Inter, system-ui, sans-serif',
  ibm_plex: '"IBM Plex Sans", Inter, system-ui, sans-serif',
  noto_sans: '"Noto Sans", Inter, system-ui, sans-serif',
  nunito_sans: '"Nunito Sans", Inter, system-ui, sans-serif',
  work_sans: '"Work Sans", Inter, system-ui, sans-serif',
};

export const THEME_PRESETS: Record<SiteThemeId, {
  label: string;
  description: string;
  radius: ThemeRadius;
  cardStyle: CardStyle;
  fontPairing: FontPairing;
  brandPrimary: string;
  brandPrimaryHover: string;
}> = {
  classic: {
    label: 'Classic',
    description: 'Traditional and trustworthy. The right default for a family independent.',
    radius: 'soft',
    cardStyle: 'bordered',
    fontPairing: 'inter',
    brandPrimary: colours.classic.primary,
    brandPrimaryHover: colours.classic.hover,
  },
  studio: {
    label: 'Studio',
    description: 'Editorial and photography-led. Suits prestige stock.',
    radius: 'sharp',
    cardStyle: 'flat',
    fontPairing: 'ibm_plex',
    brandPrimary: colours.studio.primary,
    brandPrimaryHover: colours.studio.hover,
  },
  compact: {
    label: 'Compact',
    description: 'Dense listings, value-focused. Suits a high-volume forecourt.',
    radius: 'rounded',
    cardStyle: 'elevated',
    fontPairing: 'source_sans',
    brandPrimary: colours.compact.primary,
    brandPrimaryHover: colours.compact.hover,
  },
};

export const emptyCopy = (): SiteCopy => ({
  homeHeadline: '',
  homeLead: '',
  about: '',
  contactBlurb: '',
  footerLegal: '',
});

export const defaultSiteTheme = (id: SiteThemeId = 'classic'): SiteThemeConfig => {
  const preset = THEME_PRESETS[id];
  return {
    id,
    brandPrimary: preset.brandPrimary,
    brandPrimaryHover: preset.brandPrimaryHover,
    radius: preset.radius,
    cardStyle: preset.cardStyle,
    fontPairing: preset.fontPairing,
    copy: emptyCopy(),
  };
};

const HEX = /^#([0-9a-fA-F]{6})$/;

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
};

export const contrastRatio = (fg: string, bg: string): number => {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/** White text on the brand fill, and brand-as-text on white, both AA. */
export function brandColourOk(hex: string): { ok: true } | { ok: false; reason: string } {
  if (!HEX.test(hex)) {
    return { ok: false, reason: `Use a six-digit hex colour, like ${colours.classic.primary}.` };
  }
  const onWhite = contrastRatio(hex, colours.onBrand);
  const whiteOn = contrastRatio(colours.onBrand, hex);
  if (onWhite < 4.5 && whiteOn < 4.5) {
    return {
      ok: false,
      reason:
        `That colour is ${onWhite.toFixed(2)}:1 on white and white is ${whiteOn.toFixed(2)}:1 on it. ` +
        'Both need 4.5:1. Pick a darker brand colour.',
    };
  }
  if (whiteOn < 4.5) {
    return {
      ok: false,
      reason:
        `White text on that colour is ${whiteOn.toFixed(2)}:1. The buttons on your site need 4.5:1. ` +
        'Pick a darker shade.',
    };
  }
  return { ok: true };
}

export function parseSiteTheme(raw: unknown): SiteThemeConfig {
  const fallback = defaultSiteTheme('classic');
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const id = o['id'] === 'studio' || o['id'] === 'compact' ? o['id'] : 'classic';
  const preset = THEME_PRESETS[id];
  const brand = typeof o['brandPrimary'] === 'string' && HEX.test(o['brandPrimary'])
    ? o['brandPrimary'] : preset.brandPrimary;
  const hover = typeof o['brandPrimaryHover'] === 'string' && HEX.test(o['brandPrimaryHover'])
    ? o['brandPrimaryHover'] : preset.brandPrimaryHover;
  const radius = o['radius'] === 'sharp' || o['radius'] === 'rounded' ? o['radius'] : preset.radius;
  const cardStyle = o['cardStyle'] === 'elevated' || o['cardStyle'] === 'flat'
    ? o['cardStyle'] : preset.cardStyle;
  const fontPairing = (['inter', 'source_sans', 'ibm_plex', 'noto_sans', 'nunito_sans', 'work_sans'] as const)
    .includes(o['fontPairing'] as FontPairing)
    ? o['fontPairing'] as FontPairing
    : preset.fontPairing;
  const copyRaw = (o['copy'] && typeof o['copy'] === 'object') ? o['copy'] as Record<string, unknown> : {};
  const str = (k: string): string => typeof copyRaw[k] === 'string' ? copyRaw[k] as string : '';
  return {
    id,
    brandPrimary: brand,
    brandPrimaryHover: hover,
    radius,
    cardStyle,
    fontPairing,
    copy: {
      homeHeadline: str('homeHeadline'),
      homeLead: str('homeLead'),
      about: str('about'),
      contactBlurb: str('contactBlurb'),
      footerLegal: str('footerLegal'),
    },
  };
}

export function brandThemeTokens(config: SiteThemeConfig): {
  brandPrimary: string;
  brandPrimaryHover: string;
  radius: ThemeRadius;
  cardStyle: CardStyle;
  fontStack: string;
} {
  return {
    brandPrimary: config.brandPrimary,
    brandPrimaryHover: config.brandPrimaryHover,
    radius: config.radius,
    cardStyle: config.cardStyle,
    fontStack: FONT_STACKS[config.fontPairing],
  };
}

export function darkenHex(hex: string, amount = 0.18): string {
  if (!HEX.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.round(c * (1 - amount))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
