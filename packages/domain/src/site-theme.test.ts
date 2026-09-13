/* eslint-disable forecourt/no-raw-hex -- Fixed independent colour inputs test contrast and parsing, not UI styling. */
import { describe, it, expect } from 'vitest';
import {
  brandColourOk, contrastRatio, darkenHex, defaultSiteTheme, parseSiteTheme,
} from './site-theme.js';

describe('brandColourOk', () => {
  it('accepts the Classic teal — 7.80:1 on white, white 7.80:1 on it', () => {
    expect(brandColourOk('#0E5A6B').ok).toBe(true);
  });

  it('refuses a pale brand colour that fails AA as a button fill', () => {
    const result = brandColourOk('#A5D8FF');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/4\.5:1/);
  });

  it('refuses a non-hex', () => {
    expect(brandColourOk('teal').ok).toBe(false);
  });
});

describe('parseSiteTheme', () => {
  it('falls back to Classic on empty jsonb', () => {
    const theme = parseSiteTheme({});
    expect(theme.id).toBe('classic');
    expect(theme.brandPrimary).toBe(defaultSiteTheme('classic').brandPrimary);
  });

  it('keeps a valid Studio colour and drops an unknown font', () => {
    const theme = parseSiteTheme({
      id: 'studio',
      brandPrimary: '#1E3A5F',
      fontPairing: 'comic_sans',
      copy: { homeHeadline: 'Used cars, sold straight.' },
    });
    expect(theme.id).toBe('studio');
    expect(theme.fontPairing).toBe(defaultSiteTheme('studio').fontPairing);
    expect(theme.copy.homeHeadline).toBe('Used cars, sold straight.');
  });
});

describe('contrast helpers', () => {
  it('reports a ratio above 4.5 for brand-600 on white', () => {
    expect(contrastRatio('#0E5A6B', '#FFFFFF')).toBeGreaterThan(4.5);
  });

  it('darkens a hex without leaving the six-digit form', () => {
    expect(darkenHex('#0E5A6B')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
