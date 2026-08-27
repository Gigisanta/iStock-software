/**
 * Puerto de storage. El pipeline no sabe si atrás hay R2 o un directorio.
 *
 * `delete` existe pero **no se exporta** desde el índice del paquete: el único camino a un
 * `DeleteObject` es `collectOrphanObjects`, que exige probar que ningún tenant referencia la key.
 */

export type MediaBucket = 'media' | 'originals';

/** Objetos inmutables con hash en la key: un año, `immutable`, cero purge. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** El master no se sirve nunca. Si algún día se sirviera por error, que no se cachee. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

export interface PutObjectInput {
  readonly bucket: MediaBucket;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  /**
   * OJO: con `@aws-sdk/client-s3` esto viaja como el parámetro **`CacheControl`**.
   * `httpMetadata.cacheControl` es el binding de Workers y **no existe** en el runtime Node de
   * Vercel: usarlo deja los objetos sin `Cache-Control` y con edge TTL default de 120 minutos.
   */
  readonly cacheControl: string;
}

export interface ObjectHead {
  readonly bytes: number;
  readonly cacheControl?: string | undefined;
  readonly contentType?: string | undefined;
}

export interface StorageDriver {
  readonly name: string;
  put(input: PutObjectInput): Promise<void>;
  head(bucket: MediaBucket, key: string): Promise<ObjectHead | null>;
  get(bucket: MediaBucket, key: string): Promise<Uint8Array | null>;
  /** @internal Sólo `collectOrphanObjects`. Ver `unlink.ts`. */
  delete(bucket: MediaBucket, key: string): Promise<void>;
}
