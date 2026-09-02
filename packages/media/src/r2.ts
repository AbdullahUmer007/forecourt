import {
  GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import type { StorageBackend } from './backend.js';
import { isSafeObjectKey } from './keys.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

export type ObjectStoreClient = {
  send(command: PutObjectCommand | GetObjectCommand): Promise<unknown>;
};

const isMissingObject = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const named = 'name' in err ? String(err.name) : '';
  const coded = 'Code' in err ? String((err as { Code?: string }).Code) : '';
  const status = '$metadata' in err
    ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  return named === 'NoSuchKey' || named === 'NotFound' || coded === 'NoSuchKey' || status === 404;
};

export class R2Storage implements StorageBackend {
  private readonly client: ObjectStoreClient;

  constructor(private readonly config: R2Config, client?: ObjectStoreClient) {
    this.client = client ?? new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!isSafeObjectKey(key)) {
      throw new Error('Refusing a media key that escapes the store.');
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Content-hashed keys are immutable. Cache forever at the edge once
      // the /media route has already decided this object may be served.
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  async get(key: string): Promise<Buffer | null> {
    if (!isSafeObjectKey(key)) return null;
    try {
      const out = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
      const bytes = await out.Body?.transformToByteArray?.();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if (isMissingObject(err)) return null;
      throw err;
    }
  }
}
