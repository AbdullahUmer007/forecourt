import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMediaBackend, localMediaRoot, mediaBackend, parseR2Jurisdiction,
  r2ConfigFrom, r2EndpointFor, resetMediaBackendForTests, R2Storage,
} from './index.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

afterEach(() => {
  resetMediaBackendForTests();
});

const completeR2 = {
  R2_ACCOUNT_ID: 'acct_abc',
  R2_ACCESS_KEY_ID: 'key_id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'rixdrive-media',
};

describe('backend selection', () => {
  it('uses local disk when no R2 variables are set', () => {
    const backend = createMediaBackend({ MEDIA_LOCAL_ROOT: '/var/media' });
    expect(backend.constructor.name).toBe('LocalDiskStorage');
    expect(localMediaRoot({})).toMatch(/\.media$/);
  });

  it('uses R2 when all four variables are set', () => {
    const backend = createMediaBackend(completeR2);
    expect(backend).toBeInstanceOf(R2Storage);
  });

  it('refuses a half-configured R2 — falling back to disk would look like it worked', () => {
    expect(() => createMediaBackend({ R2_ACCOUNT_ID: 'acct_abc', R2_BUCKET: 'rixdrive-media' }))
      .toThrow(/half-configured/);
  });

  it('points at the EU host when the bucket is jurisdictional', () => {
    expect(r2EndpointFor('acct_abc', { R2_JURISDICTION: 'eu' }))
      .toBe('https://acct_abc.eu.r2.cloudflarestorage.com');
    expect(r2ConfigFrom({ ...completeR2, R2_JURISDICTION: 'EU' })?.endpoint)
      .toBe('https://acct_abc.eu.r2.cloudflarestorage.com');
  });

  it('lets R2_ENDPOINT win over the jurisdiction default', () => {
    expect(r2EndpointFor('acct_abc', {
      R2_JURISDICTION: 'eu',
      R2_ENDPOINT: 'https://acct_abc.eu.r2.cloudflarestorage.com/',
    })).toBe('https://acct_abc.eu.r2.cloudflarestorage.com');
  });

  it('rejects an unknown jurisdiction rather than talking to the wrong host', () => {
    expect(() => parseR2Jurisdiction('apac')).toThrow(/eu, us or fedramp/);
  });
});

describe('local disk', () => {
  it('round-trips a tenant-prefixed key and refuses a path escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forecourt-media-'));
    const backend = createMediaBackend({ MEDIA_LOCAL_ROOT: root });
    const key = 't/11111111-1111-4111-8111-111111111111/b/logo-light/abc123def456.jpg';
    await backend.put(key, Buffer.from('jpeg-bytes'), 'image/jpeg');
    expect(await backend.get(key)).toEqual(Buffer.from('jpeg-bytes'));
    await expect(backend.put('../outside', Buffer.from('x'), 'image/jpeg'))
      .rejects.toThrow(/escapes the store/);
    expect(await backend.get('../outside')).toBeNull();
  });
});

describe('R2 backend', () => {
  it('puts and gets through the S3 client under the given key', async () => {
    const objects = new Map<string, Buffer>();
    const client = {
      send: async (command: PutObjectCommand | GetObjectCommand) => {
        if (command instanceof PutObjectCommand) {
          const key = command.input.Key!;
          const body = command.input.Body;
          objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
          return {};
        }
        const key = command.input.Key!;
        const body = objects.get(key);
        if (!body) {
          throw Object.assign(new Error('missing'), {
            name: 'NoSuchKey',
            $metadata: { httpStatusCode: 404 },
          });
        }
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      },
    };

    const store = new R2Storage({
      accountId: 'acct_abc',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'rixdrive-media',
      endpoint: 'https://acct_abc.eu.r2.cloudflarestorage.com',
    }, client);

    const key = 't/11111111-1111-4111-8111-111111111111/v/veh/m/mid/deadbeefcafe/original';
    await store.put(key, Buffer.from('photo'), 'image/jpeg');
    expect(objects.has(key)).toBe(true);
    expect(await store.get(key)).toEqual(Buffer.from('photo'));
    expect(await store.get('t/other/missing')).toBeNull();
    await expect(store.put('../escape', Buffer.from('x'), 'image/jpeg'))
      .rejects.toThrow(/escapes the store/);
  });
});

describe('process-wide backend', () => {
  it('recreates when the env fingerprint changes', async () => {
    const a = await mkdtemp(join(tmpdir(), 'forecourt-media-a-'));
    const b = await mkdtemp(join(tmpdir(), 'forecourt-media-b-'));
    await mkdir(join(a, 't'), { recursive: true });
    await writeFile(join(a, 't', 'one'), Buffer.from('a'));

    const first = mediaBackend({ MEDIA_LOCAL_ROOT: a });
    expect(await first.get('t/one')).toEqual(Buffer.from('a'));

    const second = mediaBackend({ MEDIA_LOCAL_ROOT: b });
    expect(second).not.toBe(first);
    expect(await second.get('t/one')).toBeNull();
  });
});
