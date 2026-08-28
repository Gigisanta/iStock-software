/**
 * Medición del byte que se sirve. Owner: `qa-agent`.
 *
 * ## La regla de este archivo
 * **Nada de acá importa `@istock/media`.** El gate de S2 es "el `card` que baja el visitante pesa
 * ≤ 150 KB": si el test leyera el techo, el regex de la key o el `Cache-Control` desde el código
 * bajo test, subir la constante pondría el test en verde y el guard dejaría de guardar. Todo lo
 * normativo se escribe acá **a mano**, duplicado a propósito. La divergencia entre las dos copias
 * es la señal.
 *
 * ## Por qué se mide el cuerpo HTTP y no la columna de la base
 * `listing_photos.card_bytes` es lo que el server **cree** que pesa. Entre esa creencia y el
 * visitante hay un CDN, un route handler y un `Content-Encoding`. Lo que le cuesta datos al
 * comprador parado en la calle es el cuerpo de la respuesta, así que eso es lo que se cuenta.
 */

import { createHash } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

/**
 * Forma de la key pública, escrita a mano: `v1/{ab}/{sha256_32}.webp` (ADR-006).
 *
 * Duplicada de `packages/media/src/keys.ts` a propósito — ver el docblock de arriba. Lo que la
 * forma garantiza es lo que S2 tiene que probar: sin `tenant_id`, sin `listing_id`, sin sufijo de
 * variante, o sea **nada desde donde derivar la key del master**.
 */
export const PUBLIC_KEY_RE = /^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/u;

/** Techo de bytes de cada variante pública, KiB, literal. El de `card` es el gate de S2. */
export const THUMB_MAX_BYTES = 25 * 1024;
export const CARD_MAX_BYTES = 150 * 1024;
export const DETAIL_MAX_BYTES = 250 * 1024;

/** Lo que el contrato exige en `/_media/[...key]`. Literal, no importado. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const WEBP_CONTENT_TYPE = 'image/webp';

/**
 * Bytes medidos por el LEAD sobre la fixture de referencia (`packages/media/README.md`).
 * **No son un techo**: son el punto de comparación que contesta "¿el panel rehace la imagen?".
 */
export const BASELINE_BYTES = { thumb: 7_718, card: 50_692, detail: 128_570 } as const;

/** Píxeles del lado mayor de cada variante, tal como los publicó el LEAD. */
export const BASELINE_SIZE = {
  thumb: { width: 200, height: 150 },
  card: { width: 800, height: 600 },
  detail: { width: 1600, height: 1200 },
} as const;

/**
 * SHA-256 truncado a 32 hex — la misma función que produce la key.
 *
 * Que la key sea el hash del byte de salida convierte la verificación en algo mucho más fuerte que
 * "pesa menos que X": si el hash del cuerpo descargado coincide con el de la key, el objeto que
 * llegó al browser es **exactamente** el que produjo el pipeline. Un re-encode, una recompresión
 * del CDN o una miniatura generada por otro camino cambian el hash y el test lo dice.
 */
export function contentHash32(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

/** Los 32 hex que la key lleva adentro. `null` si la key no tiene la forma pública. */
export function hashInKey(key: string): string | null {
  const match = /^v1\/[0-9a-f]{2}\/([0-9a-f]{32})\.webp$/u.exec(key);
  return match?.[1] ?? null;
}

// ── dimensiones del WebP, sin decodificar la imagen ───────────────────────────────────────────

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Lee el ancho y el alto de la cabecera del WebP.
 *
 * Hace falta porque el hash prueba que el byte **no se tocó**, pero no prueba que el pipeline
 * haya estado configurado con los tamaños correctos: un `card` de 1600px con hash consistente
 * sigue siendo un `card` que no es un `card`. Se parsea el contenedor RIFF a mano (tres formas:
 * `VP8 ` lossy, `VP8L` lossless, `VP8X` extendido) en vez de traer una dependencia de imagen a
 * los e2e.
 */
export function webpSize(bytes: Uint8Array): ImageSize | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 30) return null;
  if (view.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (view.toString('ascii', 8, 12) !== 'WEBP') return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const fourcc = view.toString('ascii', offset, offset + 4);
    const size = view.readUInt32LE(offset + 4);
    const data = offset + 8;

    if (fourcc === 'VP8X' && data + 10 <= view.byteLength) {
      const width = 1 + (view.readUInt16LE(data + 4) | (view[data + 6]! << 16));
      const height = 1 + (view.readUInt16LE(data + 7) | (view[data + 9]! << 16));
      return { width, height };
    }
    if (fourcc === 'VP8 ' && data + 10 <= view.byteLength) {
      // Frame tag (3 B) + start code 9d 01 2a (3 B) + ancho y alto de 14 bits.
      if (view[data + 3] !== 0x9d || view[data + 4] !== 0x01 || view[data + 5] !== 0x2a) return null;
      return {
        width: view.readUInt16LE(data + 6) & 0x3fff,
        height: view.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    if (fourcc === 'VP8L' && data + 5 <= view.byteLength) {
      if (view[data] !== 0x2f) return null;
      const bits = view.readUInt32LE(data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }

    offset = data + size + (size % 2); // los chunks RIFF van alineados a 2 bytes.
  }
  return null;
}

// ── descarga ──────────────────────────────────────────────────────────────────────────────────

export interface FetchedObject {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
  readonly contentType: string;
  readonly cacheControl: string;
  /** SHA-256/32 del cuerpo. Vacío si no hubo cuerpo. */
  readonly sha32: string;
  readonly size: ImageSize | null;
}

/**
 * `GET url` sin seguir redirects y midiendo el **cuerpo completo**.
 *
 * `maxRedirects: 0` porque un 302 hacia el original de 3 MB es exactamente cómo un pipeline roto
 * "cumple" el presupuesto: el test seguiría el redirect y mediría lo que quisiera medir.
 */
export async function fetchObject(
  request: APIRequestContext,
  url: string,
): Promise<FetchedObject> {
  const response = await request.get(url, { maxRedirects: 0 });
  const body = await response.body();
  const headers = response.headers();
  return {
    url,
    status: response.status(),
    bytes: body.byteLength,
    contentType: headers['content-type'] ?? '',
    cacheControl: headers['cache-control'] ?? '',
    sha32: body.byteLength > 0 ? contentHash32(body) : '',
    size: body.byteLength > 0 ? webpSize(body) : null,
  };
}

/** `GET` que sólo interesa por el status: se usa para probar que algo **no** está. */
export async function statusOf(request: APIRequestContext, url: string): Promise<number> {
  const response = await request.get(url, { maxRedirects: 0 });
  await response.dispose();
  return response.status();
}

// ── URLs ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Base pública del CDN, **derivada de lo que el panel emitió**, no de una env var del test.
 *
 * Si se hardcodeara `${APEX}/_media`, el test seguiría verde el día que el panel empiece a servir
 * las fotos desde otro lado. Se saca sacándole al `src` real de la miniatura la key real de la
 * miniatura: lo que queda es la base que el producto está usando de verdad.
 */
export function mediaBaseFromSrc(thumbSrc: string, thumbKey: string): string {
  const marker = `/${thumbKey}`;
  const at = thumbSrc.lastIndexOf(marker);
  if (at === -1) {
    throw new Error(
      `el src de la miniatura (${thumbSrc}) no termina en su thumb_key (${thumbKey}): el panel ` +
        'no está sirviendo la variante que dice la base',
    );
  }
  return thumbSrc.slice(0, at);
}

/** Resuelve un `src` (relativo o absoluto) contra la página que lo emitió. */
export function absoluteSrc(src: string, pageUrl: string): string {
  return new URL(src, pageUrl).toString();
}
