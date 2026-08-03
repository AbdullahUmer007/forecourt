import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  validateUpload, MAX_UPLOAD_BYTES, isTenantOwnedKey, appraisalMediaKey,
} from '@forecourt/domain';

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
 * The storage backend is an interface with a local-disk implementation. R2 is
 * the production one and is not wired up — there are no credentials — but
 * nothing above this line knows the difference, so it slots in.
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

export interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

/**
 * Local disk, for development. Deliberately writes under the SAME key shape
 * production will use, so a bug in the key scheme shows up here rather than
 * the first time a real bucket is attached.
 */
class LocalDiskStorage implements StorageBackend {
  constructor(private readonly root: string) {}
  async put(key: string, body: Buffer): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}

const backend: StorageBackend = new LocalDiskStorage(
  process.env['MEDIA_LOCAL_ROOT'] ?? join(process.cwd(), '.media'),
);

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

  await backend.put(key, processed, 'image/jpeg');
  return { ok: true, key, bytes: processed.byteLength, width, height };
}
