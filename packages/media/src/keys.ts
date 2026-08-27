/**
 * Esquema de keys — **ADR-006, cerrado. No se re-decide acá.**
 *
 * ## Dos buckets
 * - `istock-media`     PÚBLICO,  detrás de `img.maat.work`. Sólo thumb/card/detail.
 * - `istock-originals` PRIVADO,  sin public access ni custom domain. Sólo masters.
 *   Un bucket público expone su contenido **entero**, no por prefijo: por eso el master no
 *   puede vivir en el mismo bucket.
 *
 * ## Key pública: opaca y content-addressed
 * ```
 * v1/{ab}/{sha256_32}.webp
 * ```
 * `sha256_32` = primeros 32 hex del SHA-256 **del byte de salida de esa variante**.
 * `ab` = sus 2 primeros caracteres (sharding).
 *
 * Consecuencias que son el punto de todo el esquema:
 * - **No hay sufijo de variante.** Con la URL de `card` no se puede derivar la de `detail`
 *   ni la del master. No hay `-card`, no hay `-master`, no hay nada que adivinar.
 * - **No hay `tenant_id` ni `listing_id`.** La vidriera deja de filtrar identificadores
 *   internos en su HTML. El mapeo `listing → keys` vive en Postgres con `tenant_id` + RLS.
 * - **Inmutable.** Cambia el byte → cambia la key → cero purge de CDN.
 *
 * ## La trampa
 * Dos tenants que suben la MISMA foto producen el MISMO hash y comparten el objeto.
 * Por eso `unlinkListingPhotos` borra la fila del mapeo y **nunca** el objeto de R2.
 */

import { createHash } from 'node:crypto';
import { UnsafeMediaKeyError } from './errors';

export const PUBLIC_KEY_VERSION = 'v1';

/** `v1/{2 hex}/{32 hex}.webp` y nada más. */
const PUBLIC_KEY_RE = /^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/;

/** `originals/{uuid}/{uuid}/{32 hex}.webp`. Sólo bucket privado, nunca en una URL. */
const MASTER_KEY_RE =
  /^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}\.webp$/;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** IMEI: 15 dígitos seguidos. Nunca en una key (CLAUDE.md §1.8). */
const IMEI_RE = /\d{15}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+/;
const LEAKY_WORDS = ['master', 'original', 'imei', 'tenant', 'listing', 'cost', 'margin'];

/** SHA-256 del contenido, truncado a 32 hex. Determinista por definición. */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/**
 * Key pública de una variante. **Depende sólo del byte de salida de esa variante.**
 * No recibe `tenantId` ni `listingId` a propósito: no puede filtrarlos ni queriendo.
 */
export function publicVariantKey(variantBytes: Uint8Array): string {
  const hash = contentHash(variantBytes);
  const shard = hash.slice(0, 2);
  return `${PUBLIC_KEY_VERSION}/${shard}/${hash}.webp`;
}

/**
 * Key del master en el bucket **privado**. Acá sí es jerárquica (`tenantId`/`listingId`)
 * porque nunca sale del server: facilita auditoría e inventario por tenant.
 */
export function masterObjectKey(params: {
  tenantId: string;
  listingId: string;
  masterBytes: Uint8Array;
}): string {
  const tenantId = params.tenantId.toLowerCase();
  const listingId = params.listingId.toLowerCase();
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(listingId)) {
    throw new UnsafeMediaKeyError('tenantId y listingId deben ser UUID');
  }
  return `originals/${tenantId}/${listingId}/${contentHash(params.masterBytes)}.webp`;
}

export function isPublicVariantKey(key: string): boolean {
  return PUBLIC_KEY_RE.test(key);
}

export function isMasterObjectKey(key: string): boolean {
  return MASTER_KEY_RE.test(key);
}

/**
 * Gate de la key pública. Se corre antes de cada PUT al bucket público y antes de armar
 * cualquier URL. El chequeo de "tokens sensibles" es redundante con el regex — es defensa en
 * profundidad, por si alguien afloja el regex algún día.
 */
export function assertPublicVariantKey(key: string): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new UnsafeMediaKeyError('key vacía');
  }
  if (isMasterObjectKey(key)) {
    throw new UnsafeMediaKeyError('es la key del master; el bucket privado no se sirve nunca');
  }
  const lower = key.toLowerCase();
  if (UUID_RE.test(lower)) {
    throw new UnsafeMediaKeyError('contiene un UUID (tenant_id / listing_id)');
  }
  if (IMEI_RE.test(lower)) {
    throw new UnsafeMediaKeyError('contiene 15 dígitos seguidos (posible IMEI)');
  }
  if (EMAIL_RE.test(lower)) {
    throw new UnsafeMediaKeyError('contiene algo con forma de email');
  }
  for (const word of LEAKY_WORDS) {
    if (lower.includes(word)) {
      throw new UnsafeMediaKeyError(`contiene el token "${word}"`);
    }
  }
  if (!PUBLIC_KEY_RE.test(key)) {
    throw new UnsafeMediaKeyError(`no matchea v1/{ab}/{sha256_32}.webp (recibido: ${key.length} chars)`);
  }
}
