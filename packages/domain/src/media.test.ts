import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CAPTURE_PLAN, REQUIRED_SHOTS, BREAKPOINTS, FORMATS, MAX_UPLOAD_BYTES,
  captureProgress, suggestedOrder, selectHero, normaliseHero,
  variantPlan, buildSrcSet, storageKey, isTenantOwnedKey,
  processingSteps, validateUpload, isDisclosureEvidence, canDeleteMedia, altTextFor,
  type MediaItem, type ShotKind, type ImageFormat,
} from './media.js';

const item = (over: Partial<MediaItem> & { id: string; kind: ShotKind }): MediaItem => ({
  position: 0, isHero: false, published: true, isDisclosureEvidence: false, ...over,
});

const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('the capture plan', () => {
  it('has a required core and optional extras', () => {
    expect(REQUIRED_SHOTS.length).toBeGreaterThanOrEqual(5);
    expect(CAPTURE_PLAN.length).toBeGreaterThan(REQUIRED_SHOTS.length);
  });

  it('every shot has guidance a person can actually follow', () => {
    for (const s of CAPTURE_PLAN) {
      expect(s.guidance.length, `${s.kind} has no usable guidance`).toBeGreaterThan(20);
      expect(s.label).toBeTruthy();
    }
  });

  it('opens with the front three-quarter — the shot that sells the car', () => {
    expect(CAPTURE_PLAN[0]!.kind).toBe('front_three_quarter');
  });

  it('requires the odometer, which backs up the advertised mileage', () => {
    expect(REQUIRED_SHOTS).toContain('odometer');
  });

  it('reports progress against the REQUIRED set, not the whole plan', () => {
    const half = REQUIRED_SHOTS.slice(0, Math.ceil(REQUIRED_SHOTS.length / 2));
    const p = captureProgress(half);
    expect(p.percentComplete).toBeGreaterThan(40);
    expect(p.percentComplete).toBeLessThan(75);
    expect(p.missingRequired.length).toBe(REQUIRED_SHOTS.length - half.length);
  });

  it('reaches 100% on the required set alone', () => {
    expect(captureProgress(REQUIRED_SHOTS).percentComplete).toBe(100);
  });

  it('points at the next shot to take, prioritising required ones', () => {
    const p = captureProgress(['front_three_quarter']);
    expect(p.nextShot?.required).toBe(true);
    expect(p.nextShot?.kind).toBe('nearside');
  });

  it('one published photo satisfies the go-live gate even if the set is incomplete', () => {
    // The hard gate is ">= 1 published photo"; the required set is the quality bar.
    const p = captureProgress(['front_three_quarter']);
    expect(p.canGoLive).toBe(true);
    expect(p.missingRequired.length).toBeGreaterThan(0);
  });

  it('has nothing left to suggest when everything is captured', () => {
    expect(captureProgress(CAPTURE_PLAN.map((s) => s.kind)).nextShot).toBeNull();
  });
});

describe('ordering and hero selection', () => {
  it('orders as a photographer walks round the car', () => {
    const shuffled = [
      item({ id: '1', kind: 'boot' }),
      item({ id: '2', kind: 'front_three_quarter' }),
      item({ id: '3', kind: 'dashboard' }),
      item({ id: '4', kind: 'nearside' }),
    ];
    expect(suggestedOrder(shuffled).map((i) => i.kind))
      .toEqual(['front_three_quarter', 'nearside', 'dashboard', 'boot']);
  });

  it('pushes damage photographs to the end', () => {
    // They must be present — that is the CRA defence — but leading with a
    // scuffed bumper loses the click the defence was meant to protect.
    const items = [
      item({ id: '1', kind: 'damage' }),
      item({ id: '2', kind: 'front_three_quarter' }),
      item({ id: '3', kind: 'damage' }),
      item({ id: '4', kind: 'interior_front' }),
    ];
    const ordered = suggestedOrder(items);
    expect(ordered[0]!.kind).toBe('front_three_quarter');
    expect(ordered.at(-1)!.kind).toBe('damage');
    expect(ordered.filter((i) => i.kind === 'damage')).toHaveLength(2);
  });

  it('picks the front three-quarter as hero by default', () => {
    const items = [item({ id: '1', kind: 'nearside' }), item({ id: '2', kind: 'front_three_quarter' })];
    expect(selectHero(items)?.id).toBe('2');
  });

  it('respects an explicit hero choice', () => {
    const items = [
      item({ id: '1', kind: 'front_three_quarter' }),
      item({ id: '2', kind: 'interior_front', isHero: true }),
    ];
    expect(selectHero(items)?.id).toBe('2');
  });

  it('never makes a damage photograph the hero, even if it is the only published one', () => {
    const items = [item({ id: '1', kind: 'damage', isHero: true })];
    expect(selectHero(items)).toBeNull();
  });

  it('ignores unpublished media when choosing a hero', () => {
    const items = [
      item({ id: '1', kind: 'front_three_quarter', published: false }),
      item({ id: '2', kind: 'nearside' }),
    ];
    expect(selectHero(items)?.id).toBe('2');
  });

  it('normalisation leaves exactly one hero', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            kind: fc.constantFrom(...CAPTURE_PLAN.map((s) => s.kind)),
            isHero: fc.boolean(),
            published: fc.boolean(),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (raw) => {
          const items = raw.map((r, i) => item({ ...r, position: i }));
          const heroes = normaliseHero(items).filter((i) => i.isHero);
          expect(heroes.length).toBeLessThanOrEqual(1);
          if (items.some((i) => i.published && i.kind !== 'damage')) expect(heroes).toHaveLength(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns null rather than throwing when there is nothing published', () => {
    expect(selectHero([])).toBeNull();
    expect(selectHero([item({ id: '1', kind: 'front', published: false })])).toBeNull();
  });
});

describe('responsive variants', () => {
  it('generates every format at every usable breakpoint', () => {
    const plan = variantPlan(4000);
    expect(plan).toHaveLength(BREAKPOINTS.length * FORMATS.length);
    expect(new Set(plan.map((v) => v.format))).toEqual(new Set(FORMATS));
  });

  it('never upscales — enlarging a small photo makes it worse AND heavier', () => {
    const plan = variantPlan(800);
    expect(Math.max(...plan.map((v) => v.width))).toBeLessThanOrEqual(800);
    expect(plan.every((v) => v.width <= 800)).toBe(true);
  });

  it('still produces something for a very small source', () => {
    expect(variantPlan(200).length).toBeGreaterThan(0);
  });

  it('compresses small renditions harder than large ones', () => {
    const plan = variantPlan(4000);
    const smallAvif = plan.find((v) => v.format === 'avif' && v.width === 320)!;
    const largeAvif = plan.find((v) => v.format === 'avif' && v.width === 1920)!;
    expect(smallAvif.quality).toBeLessThan(largeAvif.quality);
  });

  it('gives AVIF the lowest quality number — it needs the least for the same result', () => {
    const plan = variantPlan(1920);
    const at = (f: ImageFormat) => plan.find((v) => v.format === f && v.width === 1920)!.quality;
    expect(at('avif')).toBeLessThan(at('webp'));
    expect(at('webp')).toBeLessThan(at('jpeg'));
  });

  it('builds a width-ascending srcset per format', () => {
    const variants = [
      { width: 960, format: 'avif' as const, url: '/a-960.avif' },
      { width: 320, format: 'avif' as const, url: '/a-320.avif' },
      { width: 320, format: 'webp' as const, url: '/a-320.webp' },
    ];
    expect(buildSrcSet(variants, 'avif')).toBe('/a-320.avif 320w, /a-960.avif 960w');
    expect(buildSrcSet(variants, 'webp')).toBe('/a-320.webp 320w');
  });
});

// ---------------------------------------------------------------------------
// A guessable storage URL is a cross-tenant leak that bypasses the database
// entirely — no RLS policy can help you there.
// ---------------------------------------------------------------------------
describe('storage keys', () => {
  const parts = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    vehicleId: '22222222-2222-4222-8222-222222222222',
    mediaId: '33333333-3333-4333-8333-333333333333',
    contentHash: 'abcdef0123456789abcdef0123456789',
  };

  it('is tenant-prefixed', () => {
    expect(storageKey(parts).startsWith(`t/${parts.tenantId}/`)).toBe(true);
  });

  it('includes a content hash, so the key is unguessable and cacheable forever', () => {
    expect(storageKey(parts)).toContain('abcdef012345');
  });

  it('distinguishes variants from the original', () => {
    expect(storageKey(parts)).toMatch(/\/original$/);
    expect(storageKey({ ...parts, width: 640, format: 'avif' })).toMatch(/\/640\.avif$/);
  });

  it('recognises only its own tenant\'s keys', () => {
    const key = storageKey(parts);
    expect(isTenantOwnedKey(key, parts.tenantId)).toBe(true);
    expect(isTenantOwnedKey(key, '99999999-9999-4999-8999-999999999999')).toBe(false);
  });

  it('two tenants never collide, even on identical content', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (a, b) => {
        fc.pre(a !== b);
        expect(storageKey({ ...parts, tenantId: a })).not.toBe(storageKey({ ...parts, tenantId: b }));
      }),
      { numRuns: 100 },
    );
  });
});

describe('the processing pipeline', () => {
  const all = { blurPlate: true, replaceBackground: true, watermark: true, normaliseColour: true };
  const none = { blurPlate: false, replaceBackground: false, watermark: false, normaliseColour: false };

  it('always strips EXIF — it is a privacy control, not an optimisation', () => {
    // A phone photo carries GPS. Publishing it discloses where stock is kept,
    // and for a part-exchange appraisal, usually a customer's home address.
    expect(processingSteps(none)).toContain('strip_exif');
    expect(processingSteps(all)).toContain('strip_exif');
  });

  it('fixes orientation BEFORE anything resizes or crops', () => {
    const steps = processingSteps(all);
    expect(steps.indexOf('fix_orientation')).toBeLessThan(steps.indexOf('generate_variants'));
    expect(steps.indexOf('fix_orientation')).toBeLessThan(steps.indexOf('strip_exif'));
  });

  it('generates variants and hashes last', () => {
    const steps = processingSteps(all);
    expect(steps.at(-1)).toBe('hash');
    expect(steps.at(-2)).toBe('generate_variants');
  });

  it('skips optional steps when not requested', () => {
    const steps = processingSteps(none);
    expect(steps).not.toContain('blur_plate');
    expect(steps).not.toContain('watermark');
    expect(steps).not.toContain('replace_background');
  });

  it('always validates first', () => {
    expect(processingSteps(all)[0]).toBe('validate');
    expect(processingSteps(none)[0]).toBe('validate');
  });
});

describe('upload validation', () => {
  it('accepts a real JPEG', () => {
    expect(validateUpload({ size: 2_000_000, mimeType: 'image/jpeg', head: jpegHead })).toEqual({ ok: true, detected: 'image/jpeg' });
  });

  it('rejects a file lying about its type', () => {
    // A content-type header is caller-supplied and therefore untrustworthy.
    const notAnImage = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = validateUpload({ size: 1000, mimeType: 'image/jpeg', head: notAnImage });
    expect(r.ok).toBe(false);
  });

  it('rejects an oversized file and says how big it is', () => {
    const r = validateUpload({ size: MAX_UPLOAD_BYTES + 1, mimeType: 'image/jpeg', head: jpegHead });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/MB/);
  });

  it('rejects an empty file', () => {
    expect(validateUpload({ size: 0, mimeType: 'image/jpeg', head: jpegHead }).ok).toBe(false);
  });

  it('names the format when refusing an unsupported one', () => {
    const r = validateUpload({ size: 1000, mimeType: 'application/pdf', head: jpegHead });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('application/pdf');
    expect(r.ok === false && r.reason).toMatch(/JPEG|WebP/);
  });

  it('accepts HEIC, which iPhones produce by default', () => {
    expect(validateUpload({ size: 3_000_000, mimeType: 'image/heic', head: new Uint8Array(12) }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('disclosure evidence', () => {
  it('classifies damage photographs as evidence', () => {
    expect(isDisclosureEvidence('damage')).toBe(true);
    expect(isDisclosureEvidence('other', ['damage'])).toBe(true);
    expect(isDisclosureEvidence('other', ['disclosure'])).toBe(true);
    expect(isDisclosureEvidence('front_three_quarter')).toBe(false);
  });

  it('refuses deletion once shown to a buyer, and explains why', () => {
    const evidence = item({ id: '1', kind: 'damage', isDisclosureEvidence: true });
    const r = canDeleteMedia(evidence, true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Consumer Rights Act/);
    // The message must offer the lawful alternative, not just refuse.
    expect(r.reason).toMatch(/[Uu]npublish/);
  });

  it('allows deletion before it has been shown to anyone', () => {
    expect(canDeleteMedia(item({ id: '1', kind: 'damage', isDisclosureEvidence: true }), false).allowed).toBe(true);
  });

  it('allows ordinary photographs to be deleted freely', () => {
    expect(canDeleteMedia(item({ id: '1', kind: 'boot' }), true).allowed).toBe(true);
  });
});

describe('alt text', () => {
  const tesla = { year: 2022, make: 'Tesla', model: 'Model X', derivative: 'Dual Motor Long Range' };

  it('describes the vehicle and the view', () => {
    expect(altTextFor(tesla, 'front_three_quarter')).toBe('2022 Tesla Model X Dual Motor Long Range, front three-quarter');
  });

  it('describes damage as declared condition, not as damage', () => {
    expect(altTextFor(tesla, 'damage')).toContain('declared condition');
  });

  it('is never empty, even with no vehicle data', () => {
    const alt = altTextFor({ year: null, make: null, model: null, derivative: null }, 'boot');
    expect(alt.length).toBeGreaterThan(0);
    expect(alt).toContain('Vehicle');
  });
});
