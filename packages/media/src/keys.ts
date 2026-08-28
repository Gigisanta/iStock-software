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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el escáner de PII NO mira el segmento de hash (defecto medido, 2026-08-28)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `IMEI_RE = /\d{15}/` corría sobre la key ENTERA. Una key content-addressed es hexadecimal, y en
 * hex un dígito sale con probabilidad 10/16: la chance de que 32 hex contengan 15 dígitos seguidos
 * es **0,633 %** (medido: 12.665 de 2.000.000 de hashes; el cálculo cerrado da
 * `0.625^15 + 17 · 0.375 · 0.625^15` = 0,639 %). Eso es **1 de cada 158 variantes**, **1,89 % de
 * las fotos** (3 variantes cada una) y **57,6 % de los onboardings de 15 equipos × 3 fotos**.
 *
 * Y no era un error transitorio: la key es un hash del byte, así que reintentar la misma foto da
 * la misma key y el mismo rechazo. Esa foto **no se podía subir nunca**, y el mensaje le hablaba
 * de IMEI al reseller por una foto de un celular.
 *
 * El arreglo **no afloja el escáner**: lo aplica sobre la parte de la key que no generamos
 * nosotros. Ver `parseCanonicalVariantKey` y `publicVariantKeyProblem`, donde está escrito por qué
 * la exención es por **estructura y posición** y no por "esto parece un hash".
 *
 * `contentHash` y `publicVariantKey` **no cambiaron una coma**: los mismos bytes siguen dando la
 * misma key, y dos tenants con la misma foto siguen compartiendo el objeto.
 */

import { createHash } from 'node:crypto';
import { UnsafeMediaKeyError } from './errors';

export const PUBLIC_KEY_VERSION = 'v1';

/** Extensión de toda variante pública. WebP: AVIF se midió y se descartó (ADR-006). */
const PUBLIC_KEY_EXT = '.webp';

/** Largo del segmento de hash: `contentHash` trunca SHA-256 a 32 hex. */
const HASH_HEX_LENGTH = 32;

/** `v1/{2 hex}/{32 hex}.webp` y nada más. */
const PUBLIC_KEY_RE = /^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/;

/**
 * El segmento que genera **este archivo**, y el único que queda exento del escáner de PII.
 *
 * Está escrito aparte de `PUBLIC_KEY_RE` **a propósito**: la exención se ancla a este regex y al
 * round-trip de `parseCanonicalVariantKey`, no al regex de forma de la key. Aflojar `PUBLIC_KEY_RE`
 * (agregar un sufijo, aceptar mayúsculas, aceptar otro largo) **no** extiende la exención: la key
 * deja de round-trippear y vuelve a escanearse entera.
 */
const HASH_SEGMENT_RE = /^[0-9a-f]{32}$/;

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
  return createHash('sha256').update(bytes).digest('hex').slice(0, HASH_HEX_LENGTH);
}

/**
 * Key pública de una variante. **Depende sólo del byte de salida de esa variante.**
 * No recibe `tenantId` ni `listingId` a propósito: no puede filtrarlos ni queriendo.
 */
export function publicVariantKey(variantBytes: Uint8Array): string {
  const hash = contentHash(variantBytes);
  const shard = hash.slice(0, 2);
  return `${PUBLIC_KEY_VERSION}/${shard}/${hash}${PUBLIC_KEY_EXT}`;
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
  return `originals/${tenantId}/${listingId}/${contentHash(params.masterBytes)}${PUBLIC_KEY_EXT}`;
}

export function isPublicVariantKey(key: string): boolean {
  return PUBLIC_KEY_RE.test(key);
}

export function isMasterObjectKey(key: string): boolean {
  return MASTER_KEY_RE.test(key);
}

/** Una key que es, carácter por carácter, la salida de `publicVariantKey` para algún hash. */
interface CanonicalVariantKey {
  /** El segmento generado por nosotros. */
  readonly hash: string;
  /**
   * La key **menos** el segmento de hash, recortado por índice: `v1/{ab}` + `.webp`.
   * Es lo único que el escáner de PII mira cuando la key es canónica.
   */
  readonly skeleton: string;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El corazón del arreglo: la exención es por ESTRUCTURA Y POSICIÓN, no por parecido
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Devuelve no-`null` sólo si `key` es **exactamente** lo que `publicVariantKey` habría escrito:
 *
 *   1. tres segmentos separados por `/`, ni uno más;
 *   2. el primero es `PUBLIC_KEY_VERSION` literal;
 *   3. el tercero termina en `.webp` y lo que queda es 32 hex minúsculas (`HASH_SEGMENT_RE`);
 *   4. el shard es **derivado** del hash (`shard === hash.slice(0, 2)`), no un segmento libre;
 *   5. **round-trip**: re-armar la key desde `(version, shard, hash)` da el string original.
 *
 * (5) es lo que hace la exención inextensible por accidente. No se exime "un pedazo que parece un
 * hash": se exime el rango de índices que ocupa el hash **en una key que ya se demostró idéntica a
 * la que produce nuestro constructor**. Si mañana alguien acepta `v1/{ab}/{hash}-{loQueSea}.webp`,
 * el round-trip falla, `parseCanonicalVariantKey` devuelve `null` y el escáner vuelve a correr
 * sobre la key **entera**, `{loQueSea}` incluido.
 *
 * Lo que la exención sí concede, dicho sin maquillaje: alguien que escriba a mano un constructor
 * de keys que concatene un IMEI con 17 hex y respete la forma canónica pasaría. Eso no es un
 * accidente, es un `publicVariantKey` paralelo — y `guard-r2.sh` R5 + `media-lint` M003 existen
 * justamente para que no haya un segundo constructor de keys en el repo.
 */
function parseCanonicalVariantKey(key: string): CanonicalVariantKey | null {
  const segments = key.split('/');
  if (segments.length !== 3) return null;
  const [version, shard, file] = segments;
  if (version !== PUBLIC_KEY_VERSION || shard === undefined || file === undefined) return null;
  if (!file.endsWith(PUBLIC_KEY_EXT)) return null;

  const hash = file.slice(0, file.length - PUBLIC_KEY_EXT.length);
  if (!HASH_SEGMENT_RE.test(hash)) return null;
  if (shard !== hash.slice(0, 2)) return null;
  if (`${PUBLIC_KEY_VERSION}/${shard}/${hash}${PUBLIC_KEY_EXT}` !== key) return null;

  const hashStart = key.length - PUBLIC_KEY_EXT.length - hash.length;
  return {
    hash,
    skeleton: key.slice(0, hashStart) + key.slice(hashStart + hash.length),
  };
}

/**
 * Gate de la key pública en forma **total**: devuelve el motivo del rechazo, o `null` si la key
 * es servible. No tira.
 *
 * Existe separado de `assertPublicVariantKey` porque el camino de **render** no puede tirar: bajo
 * `cacheComponents` una excepción adentro de un render cacheado no es un 500, es un 200 que nunca
 * cierra el stream — la ficha queda colgada hasta el timeout. Ver `./url.ts`.
 *
 * ## Qué se escanea
 * - Key **canónica** (la que produce `publicVariantKey`): se escanea el esqueleto `v1/{ab}.webp`.
 *   Los otros tres escáneres son, sobre 32 hex, literalmente imposibles de disparar —`[0-9a-f]`
 *   no tiene `@`, ni `-`, ni las letras de `master`/`original`/`imei`/`tenant`/`listing`/`cost`/
 *   `margin`— así que el único que podía prender era `IMEI_RE`, y cuando prendía **siempre** era
 *   un falso positivo. No se aflojó nada: se dejó de preguntar donde la respuesta no significaba
 *   nada.
 * - Key **no canónica**: se escanea **entera**, con los cuatro escáneres, y además se rechaza por
 *   forma. Ahí es donde el guard vale, porque ahí es donde puede haber texto que no generamos.
 */
export function publicVariantKeyProblem(key: unknown): string | null {
  if (typeof key !== 'string' || key.length === 0) {
    return 'key vacía';
  }
  if (isMasterObjectKey(key)) {
    return 'es la key del master; el bucket privado no se sirve nunca';
  }

  const canonical = parseCanonicalVariantKey(key);
  const scanned = (canonical?.skeleton ?? key).toLowerCase();

  if (UUID_RE.test(scanned)) {
    return 'contiene un UUID (tenant_id / listing_id)';
  }
  if (IMEI_RE.test(scanned)) {
    return 'contiene 15 dígitos seguidos fuera del segmento de hash (posible IMEI)';
  }
  if (EMAIL_RE.test(scanned)) {
    return 'contiene algo con forma de email';
  }
  for (const word of LEAKY_WORDS) {
    if (scanned.includes(word)) {
      return `contiene el token "${word}"`;
    }
  }
  if (canonical === null) {
    return `no matchea v1/{ab}/{sha256_32}.webp (recibido: ${String(key.length)} chars)`;
  }
  return null;
}

/**
 * Gate de la key pública, en forma **assert**. Se corre antes de cada PUT al bucket público y en
 * `publicUrlForKey` (camino de escritura). El camino de render usa `publicVariantKeyProblem`.
 */
export function assertPublicVariantKey(key: string): asserts key is string {
  const problem = publicVariantKeyProblem(key);
  if (problem !== null) {
    throw new UnsafeMediaKeyError(problem);
  }
}
