/**
 * M5 — the media pipeline.
 *
 * Vehicle photography is the single biggest driver of click-through on a
 * listing, and the heaviest thing on the page. This module decides what to
 * shoot, what to generate from it, where it lives, and what counts as evidence.
 *
 * Three things here are not merely cosmetic:
 *
 *  1. **EXIF stripping is a privacy control, not an optimisation.** A phone
 *     photo carries GPS coordinates. Publishing them tells the world where the
 *     dealer's stock sits overnight, and where a part-exchange was appraised —
 *     which is usually a customer's home address.
 *
 *  2. **Damage photographs are disclosure evidence.** A photograph of a scuff,
 *     shown to the buyer before sale, is a defence under the Consumer Rights
 *     Act. It must be immutable, versioned, and written to the Deal Evidence
 *     Ledger — not quietly replaceable when the car is re-photographed.
 *
 *  3. **The published photo count gates go-live** (see `vehicle-lifecycle.ts`).
 *     This module is what makes that gate satisfiable.
 */

// ---------------------------------------------------------------- capture plan

export type ShotKind =
  | 'front_three_quarter' | 'rear_three_quarter' | 'front' | 'rear'
  | 'nearside' | 'offside' | 'interior_front' | 'interior_rear'
  | 'dashboard' | 'odometer' | 'boot' | 'engine_bay'
  | 'wheels' | 'keys' | 'service_book' | 'v5c' | 'damage' | 'other';

export interface Shot {
  kind: ShotKind;
  label: string;
  /** Without these a vehicle cannot go Live. */
  required: boolean;
  /** Guidance shown over the camera on mobile. */
  guidance: string;
  /** Ghost-overlay hint so every car on the forecourt is shot the same way. */
  overlay: 'vehicle_angled' | 'vehicle_side' | 'vehicle_front' | 'interior' | 'closeup' | 'document' | null;
}

/**
 * The standard shoot. Ordered as a photographer would actually walk round the
 * car, not alphabetically — the mobile capture flow follows this sequence.
 */
export const CAPTURE_PLAN: readonly Shot[] = [
  { kind: 'front_three_quarter', label: 'Front three-quarter', required: true,
    guidance: 'Stand at the front nearside corner. Get the whole car in frame with the wheels turned towards you.',
    overlay: 'vehicle_angled' },
  { kind: 'nearside', label: 'Nearside profile', required: true,
    guidance: 'Square on to the passenger side, whole car in frame, wheels straight.',
    overlay: 'vehicle_side' },
  { kind: 'rear_three_quarter', label: 'Rear three-quarter', required: true,
    guidance: 'Rear offside corner, mirroring the front three-quarter so the pair look like a set.',
    overlay: 'vehicle_angled' },
  { kind: 'offside', label: 'Offside profile', required: false,
    guidance: 'Square on to the driver side, whole car in frame, matching the nearside shot.',
    overlay: 'vehicle_side' },
  { kind: 'front', label: 'Front', required: false,
    guidance: 'Straight on and centred, level with the badge. Keep the whole width in frame.',
    overlay: 'vehicle_front' },
  { kind: 'rear', label: 'Rear', required: false,
    guidance: 'Straight on and centred, level with the boot handle. Include the badge and any trim lettering.',
    overlay: 'vehicle_front' },
  { kind: 'interior_front', label: 'Front interior', required: true,
    guidance: 'From the driver door, showing both front seats.', overlay: 'interior' },
  { kind: 'dashboard', label: 'Dashboard', required: true,
    guidance: 'Centred on the screen and controls. Ignition on if the screen is a selling point.', overlay: 'interior' },
  { kind: 'odometer', label: 'Odometer', required: true,
    guidance: 'Close and legible. This backs up the advertised mileage.', overlay: 'closeup' },
  { kind: 'interior_rear', label: 'Rear interior', required: false,
    guidance: 'From the rear door, showing the back seats and the legroom behind the front seats.',
    overlay: 'interior' },
  { kind: 'boot', label: 'Boot', required: false,
    guidance: 'Boot open and empty, parcel shelf in place, showing the full load space.',
    overlay: 'interior' },
  { kind: 'wheels', label: 'Wheels and tyres', required: false,
    guidance: 'One wheel close up, straight on. If the tread is good, angle to show it — buyers look for this.',
    overlay: 'closeup' },
  { kind: 'engine_bay', label: 'Engine bay', required: false,
    guidance: 'Bonnet fully up and propped, engine bay wiped down. Buyers read a clean bay as a cared-for car.',
    overlay: 'closeup' },
  { kind: 'keys', label: 'Keys', required: false,
    guidance: 'Lay all the keys out together on a clean surface. Two keys is worth advertising.',
    overlay: 'closeup' },
  { kind: 'service_book', label: 'Service history', required: false,
    guidance: 'Photograph the stamped pages so the dates and dealer stamps are legible. One of the strongest trust signals you have.',
    overlay: 'document' },
];

export const REQUIRED_SHOTS: readonly ShotKind[] = CAPTURE_PLAN.filter((s) => s.required).map((s) => s.kind);
/** Below this the advert underperforms badly; used by advertStrength in M3. */
export const RECOMMENDED_PHOTO_COUNT = 12;

export interface CaptureProgress {
  captured: ShotKind[];
  missingRequired: Shot[];
  remainingOptional: Shot[];
  /** Percentage of the REQUIRED set, so the dealer sees a meaningful number. */
  percentComplete: number;
  canGoLive: boolean;
  nextShot: Shot | null;
}

export function captureProgress(captured: readonly ShotKind[]): CaptureProgress {
  const have = new Set(captured);
  const missingRequired = CAPTURE_PLAN.filter((s) => s.required && !have.has(s.kind));
  const remainingOptional = CAPTURE_PLAN.filter((s) => !s.required && !have.has(s.kind));
  const doneRequired = REQUIRED_SHOTS.filter((k) => have.has(k)).length;

  return {
    captured: [...captured],
    missingRequired,
    remainingOptional,
    percentComplete: Math.round((doneRequired / REQUIRED_SHOTS.length) * 100),
    // At least one published photo is the hard gate; the required set is the
    // quality bar. Both are reported so the UI can distinguish them.
    canGoLive: captured.length > 0,
    nextShot: missingRequired[0] ?? remainingOptional[0] ?? null,
  };
}

// ---------------------------------------------------------------- ordering

export interface MediaItem {
  id: string;
  kind: ShotKind;
  position: number;
  isHero: boolean;
  published: boolean;
  isDisclosureEvidence: boolean;
}

/**
 * Buyers scan the first three thumbnails and little else, so the hero and the
 * opening sequence matter more than everything after them.
 *
 * Damage photographs are deliberately pushed to the END of the published set:
 * they must be present and visible (that is the CRA defence), but leading with
 * a scuffed bumper loses the click that the defence would have protected.
 */
export function suggestedOrder(items: readonly MediaItem[]): MediaItem[] {
  const rank = new Map<ShotKind, number>(CAPTURE_PLAN.map((s, i) => [s.kind, i]));
  const damageRank = CAPTURE_PLAN.length + 10;

  return [...items].sort((a, b) => {
    if (a.kind === 'damage' !== (b.kind === 'damage')) return a.kind === 'damage' ? 1 : -1;
    const ra = a.kind === 'damage' ? damageRank : rank.get(a.kind) ?? CAPTURE_PLAN.length;
    const rb = b.kind === 'damage' ? damageRank : rank.get(b.kind) ?? CAPTURE_PLAN.length;
    if (ra !== rb) return ra - rb;
    return a.position - b.position;
  });
}

/** The hero is the front three-quarter if we have one — it is the shot that sells. */
export function selectHero(items: readonly MediaItem[]): MediaItem | null {
  const published = items.filter((i) => i.published && i.kind !== 'damage');
  if (published.length === 0) return null;
  const explicit = published.find((i) => i.isHero);
  if (explicit) return explicit;
  for (const preferred of ['front_three_quarter', 'nearside', 'front'] as ShotKind[]) {
    const match = published.find((i) => i.kind === preferred);
    if (match) return match;
  }
  return suggestedOrder(published)[0] ?? null;
}

/** Exactly one hero, and never a damage photograph. */
export function normaliseHero(items: readonly MediaItem[]): MediaItem[] {
  const hero = selectHero(items);
  return items.map((i) => ({ ...i, isHero: hero !== null && i.id === hero.id }));
}

// ---------------------------------------------------------------- variants

export type ImageFormat = 'avif' | 'webp' | 'jpeg';

/**
 * Responsive breakpoints. AVIF first, WebP as fallback, JPEG last for the
 * long tail — which is the ordering the performance budget in
 * `04-design-system.md` §6.4 depends on (LCP < 2.0s, page weight < 500KB).
 */
export const BREAKPOINTS = [320, 640, 960, 1440, 1920] as const;
export const FORMATS: readonly ImageFormat[] = ['avif', 'webp', 'jpeg'];

export interface VariantSpec {
  width: number;
  format: ImageFormat;
  quality: number;
}

/** Smaller renditions tolerate more compression — they are seen smaller. */
const qualityFor = (format: ImageFormat, width: number): number => {
  const base = format === 'avif' ? 55 : format === 'webp' ? 72 : 80;
  return width <= 640 ? base : base + 5;
};

export function variantPlan(sourceWidth: number): VariantSpec[] {
  // Never upscale — enlarging a small photo makes it worse and heavier.
  const widths = BREAKPOINTS.filter((w) => w <= sourceWidth);
  if (widths.length === 0) widths.push(Math.min(sourceWidth, BREAKPOINTS[0]));
  return widths.flatMap((width) =>
    FORMATS.map((format) => ({ width, format, quality: qualityFor(format, width) })),
  );
}

export const buildSrcSet = (
  variants: readonly { width: number; format: ImageFormat; url: string }[],
  format: ImageFormat,
): string =>
  variants
    .filter((v) => v.format === format)
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');

// ---------------------------------------------------------------- storage keys

/**
 * Object-storage keys.
 *
 * Tenant-prefixed and content-hashed, per the tenancy checklist: a guessable
 * storage URL is a cross-tenant leak that bypasses the database entirely. The
 * content hash also makes keys immutable, so they can be cached forever.
 */
export interface StorageKeyParts {
  tenantId: string;
  vehicleId: string;
  mediaId: string;
  contentHash: string;
  width?: number;
  format?: ImageFormat | 'original';
}

export function storageKey(p: StorageKeyParts): string {
  const suffix = p.format === 'original' || p.format === undefined
    ? 'original'
    : `${p.width}.${p.format}`;
  // Short hash prefix keeps object listings shallow without losing uniqueness.
  return `t/${p.tenantId}/v/${p.vehicleId}/m/${p.mediaId}/${p.contentHash.slice(0, 12)}/${suffix}`;
}

export const isTenantOwnedKey = (key: string, tenantId: string): boolean =>
  key.startsWith(`t/${tenantId}/`);

// ---------------------------------------------------------------- processing

export type ProcessingStep =
  | 'validate' | 'strip_exif' | 'fix_orientation' | 'normalise_colour'
  | 'blur_plate' | 'replace_background' | 'watermark' | 'generate_variants' | 'hash';

export interface ProcessingOptions {
  blurPlate: boolean;
  replaceBackground: boolean;
  watermark: boolean;
  normaliseColour: boolean;
}

/**
 * The pipeline, in order.
 *
 * `strip_exif` and `fix_orientation` are NOT optional and always run first.
 * Orientation must be applied before anything crops or resizes, or a portrait
 * photo is silently mangled. EXIF must go before anything is published, because
 * a phone photo carries GPS — publishing it discloses where the stock is kept,
 * and for a part-exchange appraisal, usually a customer's home address.
 */
export function processingSteps(options: ProcessingOptions): ProcessingStep[] {
  const steps: ProcessingStep[] = ['validate', 'fix_orientation', 'strip_exif'];
  if (options.normaliseColour) steps.push('normalise_colour');
  if (options.blurPlate) steps.push('blur_plate');
  if (options.replaceBackground) steps.push('replace_background');
  if (options.watermark) steps.push('watermark');
  steps.push('generate_variants', 'hash');
  return steps;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']);
/** Magic bytes, because a content-type header is caller-supplied and lies. */
const MAGIC: Array<{ mime: string; bytes: number[]; offset: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

export type ValidationResult = { ok: true; detected: string } | { ok: false; reason: string };

export function validateUpload(file: { size: number; mimeType: string; head: Uint8Array }): ValidationResult {
  if (file.size <= 0) return { ok: false, reason: 'The file is empty' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `Images must be under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB — this one is ${(file.size / 1024 / 1024).toFixed(1)}MB` };
  }
  if (!ACCEPTED.has(file.mimeType)) {
    return { ok: false, reason: `${file.mimeType} is not an image format we accept. Use JPEG, PNG, WebP, AVIF or HEIC.` };
  }
  const match = MAGIC.find((m) =>
    m.bytes.every((b, i) => file.head[m.offset + i] === b));
  // HEIC and AVIF are ISO-BMFF and share a container signature we do not sniff
  // here; the processor rejects them if they turn out not to be images.
  if (!match && !['image/heic', 'image/heif', 'image/avif'].includes(file.mimeType)) {
    return { ok: false, reason: 'This file is not the image type it claims to be' };
  }
  return { ok: true, detected: match?.mime ?? file.mimeType };
}

// ---------------------------------------------------------------- evidence

/**
 * A photograph tagged as damage and shown at the point of sale is a defence
 * under the Consumer Rights Act. Once it has been shown to a buyer it must
 * never be silently replaced — so it is immutable and written to the Deal
 * Evidence Ledger.
 */
export const isDisclosureEvidence = (kind: ShotKind, tags: readonly string[] = []): boolean =>
  kind === 'damage' || tags.includes('damage') || tags.includes('disclosure');

export const canDeleteMedia = (item: MediaItem, hasBeenShownToBuyer: boolean): { allowed: boolean; reason?: string } =>
  item.isDisclosureEvidence && hasBeenShownToBuyer
    ? {
        allowed: false,
        reason:
          'This photograph was shown to a buyer as a declared condition disclosure. It is evidence ' +
          'under the Consumer Rights Act and cannot be deleted. Unpublish it instead — the record is kept.',
      }
    : { allowed: true };

/** Alt text generated from the vehicle, so it is never empty and never generic. */
export function altTextFor(
  vehicle: { year: number | null; make: string | null; model: string | null; derivative: string | null },
  kind: ShotKind,
): string {
  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.derivative].filter(Boolean).join(' ');
  const shot = CAPTURE_PLAN.find((s) => s.kind === kind);
  const view = kind === 'damage' ? 'declared condition' : (shot?.label.toLowerCase() ?? 'view');
  return name ? `${name}, ${view}` : `Vehicle, ${view}`;
}
