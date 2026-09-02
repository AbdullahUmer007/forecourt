import sharp from 'sharp';
import { createHash } from 'node:crypto';
import {
  validateUpload, MAX_UPLOAD_BYTES, isTenantOwnedKey, appraisalMediaKey,
  storageKey, brandMediaKey, mediaUrlPath,
} from '@forecourt/domain';
import { localMediaRoot, mediaBackend } from '@forecourt/media';

/**
 * Storing an appraisal photograph.
 *
 * Three rules from M5 apply here and none of them is optional:
 *
 *   1. VALIDATION IS BY MAGIC BYTES, not the content-type header. The header
 *      is caller-supplied and therefore untrustworthy.
 *
 *   2. EXIF STRIPPING IS MANDATORY AND UNCONDITIONAL. A phone photograph
 *      carries GPS. For an appraisal that is usually the customer's home
 *      address, and publishing it would disclose where a private individual
 *      lives. `vehicle_media` enforces this with a CHECK constraint; here the
 *      pipeline simply cannot produce an unstripped output, because the only
 *      path to bytes on disk goes through re-encoding.
 *
 *   3. THE KEY IS TENANT-PREFIXED AND CONTENT-HASHED. Two dealers' photographs
 *      never share a path, and the same image uploaded twice is one object.
 *
 * Bytes go through `@forecourt/media`. R2 when the four `R2_*` variables are
 * set; local disk otherwise. The dealer is waiting on this request, EXIF
 * must run first, and `workers/` does not exist yet — so PutObject happens
 * here, not on a queue.
 */

export interface StoredPhoto {
  ok: true;
  key: string;
  bytes: number;
  width: number;
  height: number;
}
export interface PhotoRejected {
  ok: false;
  error: string;
}

export const mediaRoot = (): string => localMediaRoot();

export const readStoredPhoto = (key: string): Promise<Buffer | null> =>
  mediaBackend().get(key);

/**
 * Validate, strip and store. Returns the key to record on the damage mark.
 */
export async function storeAppraisalPhoto(
  tenantId: string,
  appraisalId: string,
  file: File,
): Promise<StoredPhoto | PhotoRejected> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That photo is ${(file.size / 1_048_576).toFixed(1)}MB. The limit is ` +
        `${MAX_UPLOAD_BYTES / 1_048_576}MB — most phones let you send a smaller copy.`,
    };
  }

  const raw = Buffer.from(await file.arrayBuffer());

  // Magic bytes, not the header. M5's validator owns the signature table and
  // its HEIC/AVIF exemptions; the processor below rejects anything that turns
  // out not to be an image after all.
  const verdict = validateUpload({
    size: raw.byteLength,
    mimeType: file.type,
    head: new Uint8Array(raw.subarray(0, 32)),
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  let processed: Buffer;
  let width: number;
  let height: number;
  try {
    // `rotate()` with no argument applies the EXIF orientation and then drops
    // it, so a portrait photo does not come out sideways once the metadata is
    // gone. Re-encoding is what strips everything else: there is no metadata
    // to carry across because the output is built from pixels.
    const pipeline = sharp(raw, { failOn: 'error' }).rotate().jpeg({ quality: 82, mozjpeg: true });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    processed = data;
    width = info.width;
    height = info.height;
  } catch {
    return {
      ok: false,
      error: 'That file has an image extension but is not an image we can read. ' +
        'Try taking the photo again, or send it as a JPEG.',
    };
  }

  // Hash the PROCESSED bytes: two uploads of the same photograph with
  // different EXIF are the same picture and should be one object.
  const digest = createHash('sha256').update(processed).digest('hex');
  const key = appraisalMediaKey({ tenantId, appraisalId, contentHash: digest });

  // Belt and braces. A key that does not start with this tenant's prefix is a
  // cross-tenant write, and it is cheaper to assert it than to find it later.
  if (!isTenantOwnedKey(key, tenantId)) {
    throw new Error('Refusing to store media under a key that is not this tenant’s.');
  }

  await mediaBackend().put(key, processed, 'image/jpeg');
  return { ok: true, key, bytes: processed.byteLength, width, height };
}

async function processUpload(file: File): Promise<
  | { ok: true; processed: Buffer; width: number; height: number; digest: string }
  | PhotoRejected
> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That photo is ${(file.size / 1_048_576).toFixed(1)}MB. The limit is ` +
        `${MAX_UPLOAD_BYTES / 1_048_576}MB — most phones let you send a smaller copy.`,
    };
  }
  const raw = Buffer.from(await file.arrayBuffer());
  const verdict = validateUpload({
    size: raw.byteLength,
    mimeType: file.type,
    head: new Uint8Array(raw.subarray(0, 32)),
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason };
  try {
    const pipeline = sharp(raw, { failOn: 'error' }).rotate().jpeg({ quality: 82, mozjpeg: true });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      processed: data,
      width: info.width,
      height: info.height,
      digest: createHash('sha256').update(data).digest('hex'),
    };
  } catch {
    return {
      ok: false,
      error: 'That file has an image extension but is not an image we can read. ' +
        'Try taking the photo again, or send it as a JPEG.',
    };
  }
}

export async function storeVehiclePhoto(
  tenantId: string,
  vehicleId: string,
  mediaId: string,
  file: File,
): Promise<StoredPhoto | PhotoRejected> {
  const processed = await processUpload(file);
  if (!processed.ok) return processed;
  const key = storageKey({
    tenantId, vehicleId, mediaId, contentHash: processed.digest, format: 'original',
  });
  if (!isTenantOwnedKey(key, tenantId)) {
    throw new Error('Refusing to store media under a key that is not this tenant’s.');
  }
  await mediaBackend().put(key, processed.processed, 'image/jpeg');
  return { ok: true, key, bytes: processed.processed.byteLength, width: processed.width, height: processed.height };
}

export async function storeBrandLogo(
  tenantId: string,
  kind: 'logo-light' | 'logo-dark',
  file: File,
): Promise<StoredPhoto | PhotoRejected> {
  const processed = await processUpload(file);
  if (!processed.ok) return processed;
  const key = brandMediaKey({ tenantId, kind, contentHash: processed.digest });
  if (!isTenantOwnedKey(key, tenantId)) {
    throw new Error('Refusing to store media under a key that is not this tenant’s.');
  }
  await mediaBackend().put(key, processed.processed, 'image/jpeg');
  return { ok: true, key, bytes: processed.processed.byteLength, width: processed.width, height: processed.height };
}

export { mediaUrlPath };
