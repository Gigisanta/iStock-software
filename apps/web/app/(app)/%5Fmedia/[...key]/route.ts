import { z } from 'zod';
import {
  IMMUTABLE_CACHE_CONTROL,
  OUTPUT_CONTENT_TYPE,
  getStorageDriver,
  isPublicVariantKey,
  mediaEnv,
} from '@istock/media';

/**
 * `GET /_media/{key}` — **el CDN de mentira que usamos mientras B1 está abierto.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué la carpeta se llama `%5Fmedia` y no `_media`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * En el App Router, una carpeta que empieza con `_` es una **carpeta privada**: queda fuera del
 * ruteo por completo. `app/_media/[...key]/route.ts` no serviría absolutamente nada, en silencio.
 * `%5F` es la forma URL-encodeada del guión bajo y es la vía documentada para tener un segmento de
 * URL que empieza con `_` (`project-structure.md`: *"You can create URL segments that start with
 * an underscore by prefixing the folder name with `%5F`"*). La URL pública resultante es
 * `/_media/…`, que es lo que `NEXT_PUBLIC_MEDIA_BASE_URL` trae por default.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Con `MEDIA_DRIVER=r2` esta ruta devuelve 404, y es intencional
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * En producción las fotos las sirve el CDN de Cloudflare desde `img.maat.work`, con egress $0.
 * Servirlas desde una función de Vercel sería pagar ancho de banda por cada foto de cada visita a
 * cada vidriera — exactamente el gasto que `CLAUDE.md` §3 prohíbe. Si algún día
 * `NEXT_PUBLIC_MEDIA_BASE_URL` queda mal configurada apuntando acá en producción, queremos fotos
 * rotas y evidentes, no una factura.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Esta ruta NO puede alcanzar un master. No por cuidado: por construcción.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. El bucket está **hardcodeado** a `'media'`. `'originals'` no aparece en este archivo.
 * 2. La key tiene que matchear `v1/{ab}/{sha256_32}.webp` (`isPublicVariantKey`). La key de un
 *    master es `originals/{uuid}/{uuid}/{hash}.webp`: no matchea, no hay forma de que matchee, y
 *    ni siquiera llega al driver.
 * 3. El driver local además bloquea `..` y paths absolutos por su cuenta.
 *
 * Las tres capas dicen lo mismo. Es a propósito: si mañana alguien afloja el regex, el bucket
 * sigue siendo `media`.
 *
 * ── Sin sesión, y está bien ──────────────────────────────────────────────────────────────────
 * La vidriera es pública y anónima: sus fotos también. Lo que protege el esquema de ADR-006 no es
 * el acceso, es la **derivación**: la key es un hash del byte de salida, sin `tenant_id`, sin
 * `listing_id` y sin sufijo de variante, así que tener la URL de una `card` no permite adivinar
 * ninguna otra. Pedir sesión acá rompería la vidriera y no agregaría nada.
 */

/** Zod en el borde, también para los params de ruta (`CLAUDE.md` §5). */
const paramsSchema = z.object({ key: z.array(z.string().min(1)).min(1).max(8) });

const notFound = (): Response =>
  new Response('No encontramos esa imagen.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (mediaEnv().MEDIA_DRIVER === 'r2') return notFound();

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return notFound();

  const key = parsed.data.key.join('/');
  if (!isPublicVariantKey(key)) return notFound();

  const driver = getStorageDriver();
  const bytes = await driver.get('media', key);
  if (bytes === null) return notFound();

  // El `Content-Type` real del objeto sale del sidecar que escribió el driver, no de la extensión.
  const head = await driver.head('media', key);

  /**
   * `BodyInit` exige `BufferSource`, o sea un `ArrayBuffer` de verdad; el driver devuelve
   * `Uint8Array<ArrayBufferLike>`, que podría estar respaldado por un `SharedArrayBuffer`.
   * `Uint8Array.from` copia a un buffer propio. Son ≤250 KB y esta ruta sólo existe en desarrollo:
   * en producción el byte lo sirve el CDN de Cloudflare y esta función ni se invoca.
   */
  const body = Uint8Array.from(bytes);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': head?.contentType ?? OUTPUT_CONTENT_TYPE,
      'content-length': String(bytes.byteLength),
      // La key es un hash del contenido: cambiar el byte cambia la URL. Nunca hay que purgar.
      'cache-control': IMMUTABLE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    },
  });
}
