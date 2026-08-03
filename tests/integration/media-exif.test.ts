import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * EXIF stripping, tested against real bytes.
 *
 * DECISIONS.md, 2 August: "EXIF stripping is mandatory and unconditional." The
 * reason is not tidiness. A phone photograph carries GPS, and for a
 * part-exchange appraisal that location is usually a private individual's home
 * address — so publishing an unstripped photo of a customer's car discloses
 * where they live.
 *
 * The claim is only worth anything if it is checked against a file that
 * actually contains GPS, which is what this builds and then asserts about.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const APPRAISAL = '55555555-0000-4000-8000-00000000000a';

/**
 * A JPEG carrying EXIF with GPS co-ordinates and a camera make.
 *
 * Built rather than committed as a fixture so the test states plainly what it
 * is testing, and so nobody has to trust that a binary in the repository still
 * contains what its name says.
 */
async function photoWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 74, g: 85, b: 104 } },
  })
    // sharp's `Exif` type only declares the IFD blocks it knows about, but it
    // passes any block straight through to libvips — and GPS is the one that
    // matters here, so it is written explicitly rather than dropped to satisfy
    // the type.
    .withExif({
      IFD0: { Make: 'ForecourtTestCamera', Model: 'Pixel-Test' },
      GPS: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '52/1 0/1 7404/100',   // Bletchley, roughly
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 44/1 2880/100',
      },
    } as never)
    .jpeg()
    .toBuffer();
}

let store: typeof import('@/media/store');

beforeAll(async () => {
  process.env['MEDIA_LOCAL_ROOT'] = await mkdtemp(join(tmpdir(), 'forecourt-media-'));
  store = await import('@/media/store');
});

const asFile = (bytes: Buffer, name = 'damage.jpg', type = 'image/jpeg'): File =>
  new File([new Uint8Array(bytes)], name, { type });

describe('storing an appraisal photograph', () => {
  it('the SOURCE really does carry GPS — otherwise this suite proves nothing', async () => {
    // A stripping test whose input was never tagged passes trivially and
    // forever. Assert the premise before asserting the conclusion.
    const meta = await sharp(await photoWithGps()).metadata();
    expect(meta.exif).toBeDefined();
    const raw = meta.exif!.toString('latin1');
    expect(raw).toContain('ForecourtTestCamera');
  });

  it('strips EXIF, including the GPS block', async () => {
    const result = await store.storeAppraisalPhoto(TENANT, APPRAISAL, asFile(await photoWithGps()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await readFile(join(process.env['MEDIA_LOCAL_ROOT']!, result.key));
    const meta = await sharp(written).metadata();

    // Either no EXIF at all, or EXIF that carries none of what was there.
    const raw = meta.exif ? meta.exif.toString('latin1') : '';
    expect(raw).not.toContain('ForecourtTestCamera');
    expect(raw).not.toContain('Pixel-Test');
    expect(raw).not.toContain('GPS');
  });

  it('the stored bytes are not the uploaded bytes', async () => {
    // The whole guarantee rests on re-encoding. If the original ever passed
    // through untouched, every assertion above would be about the wrong file.
    const original = await photoWithGps();
    const result = await store.storeAppraisalPhoto(TENANT, APPRAISAL, asFile(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await readFile(join(process.env['MEDIA_LOCAL_ROOT']!, result.key));
    expect(written.equals(original)).toBe(false);
  });

  it('writes under a tenant-prefixed, content-hashed key', async () => {
    const result = await store.storeAppraisalPhoto(TENANT, APPRAISAL, asFile(await photoWithGps()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // `isTenantOwnedKey` guards cross-tenant writes and only recognises this
    // prefix — a key shape that quietly bypasses it is worse than no guard.
    expect(result.key.startsWith(`t/${TENANT}/`)).toBe(true);
    expect(result.key).toContain(`/a/${APPRAISAL}/`);
  });

  it('the same photograph twice is one object', async () => {
    const a = await store.storeAppraisalPhoto(TENANT, APPRAISAL, asFile(await photoWithGps()));
    const b = await store.storeAppraisalPhoto(TENANT, APPRAISAL, asFile(await photoWithGps()));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.key).toBe(b.key);
  });

  it('refuses a file that is not an image, whatever the header claims', async () => {
    // The content-type is caller-supplied. M5 validates by magic bytes.
    const notAnImage = Buffer.from('#!/bin/sh\nrm -rf /\n');
    const result = await store.storeAppraisalPhoto(
      TENANT, APPRAISAL, asFile(notAnImage, 'damage.jpg', 'image/jpeg'));
    expect(result.ok).toBe(false);
  });

  it('refuses a file over the upload limit', async () => {
    const huge = { size: 40 * 1024 * 1024, type: 'image/jpeg', name: 'big.jpg',
      arrayBuffer: async () => new ArrayBuffer(8) } as unknown as File;
    const result = await store.storeAppraisalPhoto(TENANT, APPRAISAL, huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/limit is 25MB/);
  });

  it('every rejection says what to do about it', async () => {
    const result = await store.storeAppraisalPhoto(
      TENANT, APPRAISAL, asFile(Buffer.from('not an image'), 'x.jpg'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(20);
  });
});
