/**
 * `uploadListingPhoto` — el ÚNICO camino de un byte de imagen hacia R2.
 *
 * Upload **server-side**: esta función corre en un Route Handler / Server Function con runtime
 * Node. El browser manda el archivo al server y nunca ve una credencial de R2 (regla 4 del oficio).
 * No hay presigned PUT directo a R2: sin verificación server-side, el browser podría subir un
 * original de 12MP sin pasar por resize, que es exactamente lo que la regla 1 prohíbe.
 *
 * Esta función **no escribe en Postgres.** Devuelve las keys; el DAL de `apps/web` inserta la fila
 * de `listing_photos` con `tenant_id` (RLS). Separar las dos cosas es lo que permite que
 * `packages/media` no dependa de la DB.
 *
 * ## Ops de R2 por foto
 * 4 `PutObject` (Class A): 1 master privado + 3 variantes públicas. 0 `GetObject`.
 * Es el valor de diseño que vigila la alarma de anomalía de `cost-auditor`
 * (`Class A del mes / fotos del mes > 5` ⇒ hay reprocesamiento).
 */

import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from './budgets';
import { ImageTooLargeError, MediaConfigError } from './errors';
import { assertPublicVariantKey, masterObjectKey, publicVariantKey } from './keys';
import { buildVariants, OUTPUT_CONTENT_TYPE, type BuildVariantsOptions } from './pipeline';
import { publicUrlForKey, type UrlOptions } from './url';
import { VARIANTS, type Variant, type UploadedListingPhoto, type VariantMeasurement } from './types';
import {
  getStorageDriver,
  IMMUTABLE_CACHE_CONTROL,
  PRIVATE_CACHE_CONTROL,
  type StorageDriver,
} from './storage';

const inputSchema = z.object({
  tenantId: z.uuid(),
  listingId: z.uuid(),
  data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'data debe ser Uint8Array/Buffer'),
});

export interface UploadListingPhotoInput {
  readonly tenantId: string;
  readonly listingId: string;
  /** Bytes crudos del archivo subido. */
  readonly data: Uint8Array;
}

export interface UploadListingPhotoDeps {
  readonly driver?: StorageDriver;
  readonly url?: UrlOptions;
  readonly build?: BuildVariantsOptions;
}

export async function uploadListingPhoto(
  input: UploadListingPhotoInput,
  deps: UploadListingPhotoDeps = {},
): Promise<UploadedListingPhoto> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new MediaConfigError(
      `uploadListingPhoto: input inválido — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')}`,
    );
  }
  const { data } = parsed.data;
  if (data.byteLength === 0) {
    throw new ImageTooLargeError(0, MAX_UPLOAD_BYTES);
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    // Se rechaza ANTES de decodificar: no se gasta CPU en un archivo que no vamos a aceptar.
    throw new ImageTooLargeError(data.byteLength, MAX_UPLOAD_BYTES);
  }

  const built = await buildVariants(data, deps.build ?? {});
  const driver = deps.driver ?? getStorageDriver();

  const masterKey = masterObjectKey({
    tenantId: parsed.data.tenantId,
    listingId: parsed.data.listingId,
    masterBytes: built.master.bytes,
  });

  const measurements = {} as Record<Variant, VariantMeasurement>;
  for (const variant of VARIANTS) {
    const encoded = built.variants[variant];
    const key = publicVariantKey(encoded.bytes);
    // Gate: nada con UUID, IMEI o sufijo de variante llega al bucket público.
    assertPublicVariantKey(key);
    measurements[variant] = {
      key,
      bytes: encoded.byteLength,
      width: encoded.width,
      height: encoded.height,
      quality: encoded.quality,
    };
  }

  // 3 PUT públicos + 1 PUT privado. Content-addressed ⇒ re-subir la misma foto es idempotente.
  for (const variant of VARIANTS) {
    const encoded = built.variants[variant];
    await driver.put({
      bucket: 'media',
      key: measurements[variant].key,
      body: encoded.bytes,
      contentType: OUTPUT_CONTENT_TYPE,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  }

  await driver.put({
    bucket: 'originals',
    key: masterKey,
    body: built.master.bytes,
    contentType: OUTPUT_CONTENT_TYPE,
    cacheControl: PRIVATE_CACHE_CONTROL,
  });

  const urls = Object.freeze({
    thumb: publicUrlForKey(measurements.thumb.key, deps.url),
    card: publicUrlForKey(measurements.card.key, deps.url),
    detail: publicUrlForKey(measurements.detail.key, deps.url),
  });

  return {
    masterKey,
    masterBytes: built.master.byteLength,
    thumbKey: measurements.thumb.key,
    cardKey: measurements.card.key,
    detailKey: measurements.detail.key,
    width: built.variants.detail.width,
    height: built.variants.detail.height,
    variants: Object.freeze(measurements),
    urls,
    classAOps: VARIANTS.length + 1,
  };
}
