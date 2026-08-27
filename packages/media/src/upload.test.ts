/**
 * Upload server-side end-to-end contra el driver local (sin credenciales de R2 — B1 abierto).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadListingPhoto } from './upload';
import { createLocalDriver, IMMUTABLE_CACHE_CONTROL, PRIVATE_CACHE_CONTROL } from './storage';
import type { MediaBucket, PutObjectInput, StorageDriver } from './storage';
import { isMasterObjectKey, isPublicVariantKey } from './keys';
import { ImageTooLargeError, MediaConfigError } from './errors';
import { VARIANTS } from './types';
import { referencePhotoJpeg, tinyPng } from './fixtures/reference-image';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const LISTING = '33333333-3333-4333-8333-333333333333';
const URL_OPTS = { baseUrl: 'https://img.maat.work' };

class RecordingDriver implements StorageDriver {
  readonly name = 'recording';
  readonly puts: PutObjectInput[] = [];
  readonly deletes: { bucket: MediaBucket; key: string }[] = [];

  async put(input: PutObjectInput): Promise<void> {
    this.puts.push(input);
  }
  async head(): Promise<null> {
    return null;
  }
  async get(): Promise<null> {
    return null;
  }
  async delete(bucket: MediaBucket, key: string): Promise<void> {
    this.deletes.push({ bucket, key });
  }
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'istock-media-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('uploadListingPhoto', () => {
  it('devuelve las 3 keys públicas + la del master', async () => {
    const driver = new RecordingDriver();
    const result = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );

    expect(isPublicVariantKey(result.thumbKey)).toBe(true);
    expect(isPublicVariantKey(result.cardKey)).toBe(true);
    expect(isPublicVariantKey(result.detailKey)).toBe(true);
    expect(isMasterObjectKey(result.masterKey)).toBe(true);
    expect(new Set([result.thumbKey, result.cardKey, result.detailKey]).size).toBe(3);
  });

  it('hace exactamente 4 PutObject: 3 públicos + 1 privado', async () => {
    const driver = new RecordingDriver();
    const result = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );

    // Valor de diseño de la alarma de anomalía de cost-auditor (Class A / fotos > 5 ⇒ reproceso).
    expect(driver.puts).toHaveLength(4);
    expect(result.classAOps).toBe(4);
    expect(driver.puts.filter((p) => p.bucket === 'media')).toHaveLength(3);
    expect(driver.puts.filter((p) => p.bucket === 'originals')).toHaveLength(1);
  });

  it('el master va SÓLO al bucket privado', async () => {
    const driver = new RecordingDriver();
    await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );
    for (const put of driver.puts.filter((p) => p.bucket === 'media')) {
      expect(isPublicVariantKey(put.key)).toBe(true);
      expect(isMasterObjectKey(put.key)).toBe(false);
    }
    const master = driver.puts.find((p) => p.bucket === 'originals');
    expect(master).toBeDefined();
    expect(isMasterObjectKey(master?.key ?? '')).toBe(true);
  });

  it('setea Cache-Control inmutable en las variantes públicas', async () => {
    const driver = new RecordingDriver();
    await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );
    for (const put of driver.puts.filter((p) => p.bucket === 'media')) {
      // Sin esto el edge TTL default es 120 min y se paga Class B evitable.
      expect(put.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(put.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(put.contentType).toBe('image/webp');
    }
    const master = driver.puts.find((p) => p.bucket === 'originals');
    expect(master?.cacheControl).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('ninguna key subida al bucket público contiene tenant_id ni listing_id', async () => {
    const driver = new RecordingDriver();
    await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );
    for (const put of driver.puts.filter((p) => p.bucket === 'media')) {
      expect(put.key).not.toContain(TENANT_A);
      expect(put.key).not.toContain(LISTING);
      expect(put.key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
  });

  it('las URLs salen del CDN público y no del bucket', async () => {
    const driver = new RecordingDriver();
    const result = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver, url: URL_OPTS },
    );
    for (const v of VARIANTS) {
      expect(result.urls[v]).toBe(`https://img.maat.work/${result.variants[v].key}`);
      expect(result.urls[v]).not.toContain('r2.cloudflarestorage.com');
      expect(result.urls[v]).not.toContain('.r2.dev');
    }
    expect(JSON.stringify(result.urls)).not.toContain(result.masterKey);
  });

  it('el mismo byte subido por dos tenants produce la MISMA key pública', async () => {
    // La trampa de la key content-addressed, verificada. De acá sale la regla del unlink.
    const jpeg = await referencePhotoJpeg();
    const a = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: jpeg },
      { driver: new RecordingDriver(), url: URL_OPTS },
    );
    const b = await uploadListingPhoto(
      { tenantId: TENANT_B, listingId: LISTING, data: jpeg },
      { driver: new RecordingDriver(), url: URL_OPTS },
    );
    expect(b.cardKey).toBe(a.cardKey);
    expect(b.thumbKey).toBe(a.thumbKey);
    expect(b.detailKey).toBe(a.detailKey);
    // El master sí es por tenant: vive en el bucket privado.
    expect(b.masterKey).not.toBe(a.masterKey);
  });

  it('reporta los bytes medidos de cada variante', async () => {
    const result = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await referencePhotoJpeg() },
      { driver: new RecordingDriver(), url: URL_OPTS },
    );
    expect(result.variants.card.bytes).toBeGreaterThan(0);
    expect(result.variants.card.bytes).toBeLessThanOrEqual(150 * 1024);
    expect(result.variants.card.width).toBe(800);
    expect(result.variants.thumb.width).toBe(200);
    expect(result.variants.detail.width).toBe(1600);
    expect(result.width).toBe(1600);
  });

  it('nunca sube el original: lo que va a R2 pesa mucho menos que el archivo del celular', async () => {
    const jpeg = await referencePhotoJpeg();
    const driver = new RecordingDriver();
    await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: jpeg },
      { driver, url: URL_OPTS },
    );
    for (const put of driver.puts) {
      expect(put.body.byteLength).toBeLessThan(jpeg.byteLength);
      // Ninguno de los 4 objetos es el JPEG original.
      expect(Buffer.compare(Buffer.from(put.body), jpeg)).not.toBe(0);
    }
    const publicBytes = driver.puts
      .filter((p) => p.bucket === 'media')
      .reduce((acc, p) => acc + p.body.byteLength, 0);
    expect(publicBytes).toBeLessThan(jpeg.byteLength / 4);
  });

  it('rechaza input sin UUID (Zod en el borde)', async () => {
    await expect(
      uploadListingPhoto(
        { tenantId: 'gigi', listingId: LISTING, data: await tinyPng() },
        { driver: new RecordingDriver() },
      ),
    ).rejects.toBeInstanceOf(MediaConfigError);
  });

  it('rechaza archivos gigantes antes de decodificar', async () => {
    await expect(
      uploadListingPhoto(
        { tenantId: TENANT_A, listingId: LISTING, data: new Uint8Array(26 * 1024 * 1024) },
        { driver: new RecordingDriver() },
      ),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('rechaza un archivo vacío', async () => {
    await expect(
      uploadListingPhoto(
        { tenantId: TENANT_A, listingId: LISTING, data: new Uint8Array(0) },
        { driver: new RecordingDriver() },
      ),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});

describe('driver local en disco (default sin credenciales de R2)', () => {
  it('escribe los 4 objetos y conserva el Cache-Control', async () => {
    const driver = createLocalDriver({ root });
    const result = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: await tinyPng(300) },
      { driver, url: URL_OPTS },
    );

    const head = await driver.head('media', result.cardKey);
    expect(head?.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(head?.contentType).toBe('image/webp');
    expect(head?.bytes).toBe(result.variants.card.bytes);

    const stored = await readFile(join(root, 'media', result.cardKey));
    expect(stored.byteLength).toBe(result.variants.card.bytes);
    // WebP: RIFF....WEBP
    expect(stored.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(stored.subarray(8, 12).toString('ascii')).toBe('WEBP');

    expect(await driver.head('originals', result.masterKey)).not.toBeNull();
    // El master NO está en el bucket público.
    expect(await driver.head('media', result.masterKey)).toBeNull();
  });

  it('es idempotente: re-subir la misma foto no cambia las keys', async () => {
    const driver = createLocalDriver({ root });
    const png = await tinyPng(301);
    const a = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: png },
      { driver, url: URL_OPTS },
    );
    const b = await uploadListingPhoto(
      { tenantId: TENANT_A, listingId: LISTING, data: png },
      { driver, url: URL_OPTS },
    );
    expect(b.cardKey).toBe(a.cardKey);
    expect(b.masterKey).toBe(a.masterKey);
  });
});
