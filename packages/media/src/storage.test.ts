import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalDriver, createR2Driver, createStorageDriver, R2Driver } from './storage';
import { parseMediaEnv } from './env';
import { MediaConfigError, MediaStorageError } from './errors';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'istock-media-storage-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('selección de driver', () => {
  it('sin MEDIA_DRIVER usa el local (B1 no bloquea S2)', () => {
    expect(createStorageDriver(parseMediaEnv({})).name).toBe('local');
  });

  it('con MEDIA_DRIVER=r2 y credenciales, usa R2', () => {
    const env = parseMediaEnv({
      MEDIA_DRIVER: 'r2',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      NEXT_PUBLIC_MEDIA_BASE_URL: 'https://img.maat.work',
    });
    expect(createStorageDriver(env).name).toBe('r2');
  });

  it('createR2Driver sin credenciales falla con un mensaje que dice qué hacer', () => {
    expect(() => createR2Driver(parseMediaEnv({}))).toThrow(MediaConfigError);
  });

  it('R2Driver rechaza usar un solo bucket', () => {
    expect(
      () =>
        new R2Driver({
          accountId: 'a',
          accessKeyId: 'b',
          secretAccessKey: 'c',
          bucketMedia: 'uno',
          bucketOriginals: 'uno',
        }),
    ).toThrow(MediaConfigError);
  });
});

describe('driver local', () => {
  it('guarda, lee y borra', async () => {
    const driver = createLocalDriver({ root });
    const key = 'v1/ab/0123456789abcdef0123456789abcdef.webp';
    await driver.put({
      bucket: 'media',
      key,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect((await driver.head('media', key))?.bytes).toBe(3);
    expect(await driver.get('media', key)).toEqual(new Uint8Array([1, 2, 3]));
    await driver.delete('media', key);
    expect(await driver.head('media', key)).toBeNull();
  });

  it('los buckets están aislados en disco', async () => {
    const driver = createLocalDriver({ root });
    const key = 'v1/cd/0123456789abcdef0123456789abcdee.webp';
    await driver.put({
      bucket: 'media',
      key,
      body: new Uint8Array([9]),
      contentType: 'image/webp',
      cacheControl: 'x',
    });
    expect(await driver.head('originals', key)).toBeNull();
  });

  it('bloquea path traversal', async () => {
    const driver = createLocalDriver({ root });
    await expect(
      driver.put({
        bucket: 'media',
        key: '../../../etc/passwd',
        body: new Uint8Array([1]),
        contentType: 'image/webp',
        cacheControl: 'x',
      }),
    ).rejects.toBeInstanceOf(MediaStorageError);
  });

  it('head de algo inexistente devuelve null, no explota', async () => {
    const driver = createLocalDriver({ root });
    expect(await driver.head('media', 'v1/zz/nada.webp')).toBeNull();
    expect(await driver.get('media', 'v1/zz/nada.webp')).toBeNull();
  });
});
