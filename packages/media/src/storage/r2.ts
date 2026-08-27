/**
 * Driver de Cloudflare R2 vía S3 API. **Server-side, Node runtime.**
 *
 * Tres cosas que no son detalles:
 * 1. `Cache-Control` se manda con el parámetro **`CacheControl`** del comando de
 *    `@aws-sdk/client-s3`. `httpMetadata.cacheControl` es el binding de Workers y no existe acá.
 *    Hacerlo mal deja los objetos sin `Cache-Control` → edge TTL default 120 min → Class B evitable.
 * 2. El SDK se carga con `import()` dinámico: con `MEDIA_DRIVER=local` no se paga ni el require.
 * 3. Guard de browser: si este módulo se instancia con `window` definido, explota. Las
 *    credenciales de R2 no salen del server.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { MediaConfigError, MediaStorageError } from '../errors';
import type { MediaEnv } from '../env';
import type { MediaBucket, ObjectHead, PutObjectInput, StorageDriver } from './driver';

export interface R2DriverOptions {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucketMedia: string;
  readonly bucketOriginals: string;
  /** Sólo para tests de integración contra otro endpoint S3. */
  readonly endpoint?: string;
}

export class R2Driver implements StorageDriver {
  readonly name = 'r2';
  private readonly options: R2DriverOptions;
  private clientPromise: Promise<S3Client> | null = null;

  constructor(options: R2DriverOptions) {
    if ((globalThis as { window?: unknown }).window !== undefined) {
      throw new MediaConfigError(
        'El driver de R2 no corre en el browser: las credenciales son server-only.',
      );
    }
    if (options.bucketMedia === options.bucketOriginals) {
      throw new MediaConfigError('ADR-006: `istock-media` e `istock-originals` son dos buckets.');
    }
    this.options = options;
  }

  private bucketName(bucket: MediaBucket): string {
    return bucket === 'media' ? this.options.bucketMedia : this.options.bucketOriginals;
  }

  private async client(): Promise<S3Client> {
    this.clientPromise ??= (async () => {
      const { S3Client: Ctor } = await import('@aws-sdk/client-s3');
      return new Ctor({
        region: 'auto',
        endpoint:
          this.options.endpoint ?? `https://${this.options.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.options.accessKeyId,
          secretAccessKey: this.options.secretAccessKey,
        },
      });
    })();
    return this.clientPromise;
  }

  async put(input: PutObjectInput): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucketName(input.bucket),
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          // ⚠️ `CacheControl`, NO `httpMetadata.cacheControl`.
          CacheControl: input.cacheControl,
        }),
      );
    } catch (cause) {
      throw new MediaStorageError('PutObject falló contra R2', { cause });
    }
  }

  async head(bucket: MediaBucket, key: string): Promise<ObjectHead | null> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      return {
        bytes: out.ContentLength ?? 0,
        cacheControl: out.CacheControl,
        contentType: out.ContentType,
      };
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new MediaStorageError('HeadObject falló contra R2', { cause });
    }
  }

  async get(bucket: MediaBucket, key: string): Promise<Uint8Array | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      if (!out.Body) return null;
      return await out.Body.transformToByteArray();
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new MediaStorageError('GetObject falló contra R2', { cause });
    }
  }

  /** @internal Sólo `collectOrphanObjects`, con prueba de refcount 0. */
  async delete(bucket: MediaBucket, key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
    } catch (cause) {
      throw new MediaStorageError('DeleteObject falló contra R2', { cause });
    }
  }
}

function isNotFound(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const name = (cause as { name?: unknown }).name;
  const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

export function createR2Driver(env: MediaEnv, overrides?: Partial<R2DriverOptions>): StorageDriver {
  const accountId = overrides?.accountId ?? env.R2_ACCOUNT_ID;
  const accessKeyId = overrides?.accessKeyId ?? env.R2_ACCESS_KEY_ID;
  const secretAccessKey = overrides?.secretAccessKey ?? env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new MediaConfigError('Faltan credenciales de R2 (B1). Usá MEDIA_DRIVER=local mientras tanto.');
  }
  return new R2Driver({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketMedia: overrides?.bucketMedia ?? env.R2_BUCKET_MEDIA,
    bucketOriginals: overrides?.bucketOriginals ?? env.R2_BUCKET_ORIGINALS,
    ...(overrides?.endpoint ? { endpoint: overrides.endpoint } : {}),
  });
}
