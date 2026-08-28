/**
 * La foto que sube el dueño. Owner: `qa-agent`.
 *
 * ## Por qué no hay un `.jpg` comiteado
 * Un binario en git es un fixture que nadie puede auditar: el día que alguien lo reemplace por
 * una foto de 40 KB "para que el test corra más rápido", el gate de `card ≤ 150 KB` pasa a estar
 * midiendo el aire y nadie se entera. Acá la foto se **genera**, es determinista (`mulberry32` +
 * hash entero, cero `Math.random()`) y el spec afirma su tamaño antes de subirla.
 *
 * ## Por qué es EXACTAMENTE la fixture de `packages/media` y no una propia
 * El LEAD midió el pipeline con `packages/media/src/fixtures/reference-image.ts` y publicó la
 * tabla de bytes que este e2e usa como baseline (`packages/media/README.md` §"Bytes medidos"):
 *
 * ```
 * fuente  4000×3000 JPEG q88   3.006.369 B
 * thumb    200×150                 7.718 B
 * card     800×600               50.692 B   ← el gate de S2
 * detail  1600×1200             128.570 B
 * master  1600×1200             313.980 B   (bucket privado)
 * ```
 *
 * Si el e2e subiera **otra** foto, esos números dejarían de ser comparables y la única pregunta
 * que S2 tiene que contestar —*¿el camino del panel degrada o rehace la imagen respecto de lo que
 * el paquete ya produce?*— quedaría sin forma de contestarse. Por eso se importa por path
 * relativo: el `exports` de `@istock/media` (a propósito) no publica las fixtures, y **duplicar el
 * generador acá sería garantizar que las dos copias diverjan** justo cuando el baseline importe.
 *
 * El acoplamiento es declarado y frágil de una sola manera —si `media-agent` mueve el archivo,
 * este import rompe en `--list`, o sea en segundos y con un mensaje claro— que es exactamente el
 * modo de falla que se quiere.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import {
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
  referencePhotoJpeg,
} from '../../packages/media/src/fixtures/reference-image';

export const SOURCE_WIDTH = REFERENCE_WIDTH;
export const SOURCE_HEIGHT = REFERENCE_HEIGHT;

/**
 * Piso del archivo fuente. **No es el valor medido**, es el piso por debajo del cual el test
 * dejaría de probar el pipeline.
 *
 * El valor medido por el LEAD (y reproducido en esta máquina) es 3.006.369 B. Se afirma un piso
 * y no una igualdad porque el byte exacto del JPEG depende de la libjpeg que trae sharp, y un
 * rojo por "actualizaron sharp" sería ruido; un rojo por "alguien cambió la fixture por una
 * miniatura" es la señal que interesa, y ésa la da el piso.
 */
export const SOURCE_MIN_BYTES = 2_500_000;

/** Nombre del archivo tal como lo mandaría el celular del dueño. */
export const SOURCE_FILE_NAME = 'IMG_20260827_iphone14pro.jpg';
export const SOURCE_MIME_TYPE = 'image/jpeg';

/**
 * JPEG de 12 MP, ~3 MB. Memoizado por el propio módulo de la fixture: generarlo cuesta ~4 s de
 * CPU y se hace una sola vez por proceso de worker.
 */
export async function ownersPhotoJpeg(): Promise<Buffer> {
  return referencePhotoJpeg();
}

/** Lo que Playwright le pasa a `setInputFiles`. */
export async function ownersPhotoUpload(): Promise<{
  name: string;
  mimeType: string;
  buffer: Buffer;
}> {
  return {
    name: SOURCE_FILE_NAME,
    mimeType: SOURCE_MIME_TYPE,
    buffer: await ownersPhotoJpeg(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  RONDA 2 · la cadena de techos, escrita a mano, y la foto que vive ENTRE dos de ellos
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Abajo nuestro hay cuatro techos de request body y sólo uno es nuestro. Verificados por el LEAD
// contra la doc oficial de Vercel el 2026-08-27 (`docs/research/vercel-request-body-limit.md`):
//
// ```
//   3   MiB  MAX_PHOTO_BYTES        cap de la app · Zod · mensaje en castellano   ← nuestro
//   3.5 MiB  serverActions.bodySizeLimit                                          ← nuestro
//   4   MB   Routing Middleware = proxy.ts        lo pone Vercel, NO varía por plan
//   4.5 MB   Vercel Function                     lo pone Vercel
// ```
//
// Los tres números que siguen están **duplicados a propósito** respecto de `schema.ts` y de
// `next.config.ts`, por la misma razón que los techos de bytes de `_lib/media.ts`: si el test
// leyera la constante del código bajo test, subirla pondría el test en verde y el guard dejaría de
// guardar. La divergencia entre las dos copias es la señal.

/** `MAX_PHOTO_BYTES` de `apps/web/app/(app)/_lib/listings/schema.ts`. 3 MiB, a mano. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** `experimental.serverActions.bodySizeLimit: '3.5mb'`. Next lo parsea con `bytes`: MiB, no MB. */
export const SERVER_ACTION_BODY_LIMIT_BYTES = 3.5 * 1024 * 1024;

/** Routing Middleware de Vercel (nuestro `proxy.ts`). El techo que manda de verdad en producción. */
export const MIDDLEWARE_BODY_LIMIT_BYTES = 4_000_000;

export const OVER_CAP_FILE_NAME = 'IMG_20260827_iphone14pro_alta.jpg';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La foto que NO entra: pesada a propósito, pero pesada **con puntería**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Vive en la única banda donde se puede probar el rechazo del server de verdad:
 *
 * ```
 *   MAX_PHOTO_BYTES  <  esta fixture  <  serverActions.bodySizeLimit  <  4 MB del middleware
 *      3.145.728         ~3.415.000         3.670.016                     4.000.000
 * ```
 *
 * Por qué la banda importa, y por qué es el diseño lo que la vuelve angosta:
 *
 * - **Por debajo del cap** no hay nada que rechazar: el archivo es válido.
 * - **Por encima de `bodySizeLimit`** el que contesta es **Next**, con un `413 Body exceeded` que
 *   no es nuestro mensaje, o directamente Vercel con una página en inglés. Un test que caiga ahí
 *   estaría midiendo el manejo de errores de la plataforma y no el nuestro.
 * - **Adentro de la banda** el request llega entero al handler, nuestro Zod lo mira y contesta en
 *   castellano. Ésa es la afirmación de producto: *el dueño parado en el mostrador lee una frase
 *   que entiende, no un stack ni un 413.* Y es una banda **real de producción**, no un artificio
 *   del banco de pruebas: 3.4 MB es una foto de iPhone perfectamente común.
 *
 * La banda entera mide 512 KiB. La fixture apunta al centro para tener aire de los dos lados; los
 * specs **afirman** que sigue adentro, porque el día que se corra de banda los tests que dependen
 * de ella dejarían de probar lo que dicen probar y hay que enterarse por un rojo, no por un
 * silencio.
 *
 * ── Cómo se construye ────────────────────────────────────────────────────────────────────────
 * Es la **misma escena** que `ownersPhotoJpeg()`, re-encodeada a q92: misma foto, más bytes. No es
 * otra imagen, así que ningún resultado cambia por "cambió el contenido". Se re-encodea desde el
 * JPEG ya memoizado (~100 ms) en vez de re-sintetizar la escena (~4 s de CPU).
 *
 * `sharp` no está declarado en `e2e/package.json` y se importa igual: ya entra a este proceso por
 * `packages/media/src/fixtures/reference-image`, que es de donde sale la escena. El repo usa
 * `node-linker=hoisted` (`.npmrc`) para los binarios nativos, así que resuelve desde la raíz.
 * Declararlo de nuevo sería inventar una segunda versión de sharp para el mismo proceso.
 */
let overCapCache: Promise<Buffer> | null = null;

export async function overCapPhotoJpeg(): Promise<Buffer> {
  overCapCache ??= (async () => {
    const { default: sharp } = await import('sharp');
    return sharp(await ownersPhotoJpeg())
      .jpeg({ quality: 92, chromaSubsampling: '4:2:0', mozjpeg: false })
      .toBuffer();
  })();
  return overCapCache;
}

export async function overCapPhotoUpload(): Promise<{
  name: string;
  mimeType: string;
  buffer: Buffer;
}> {
  return {
    name: OVER_CAP_FILE_NAME,
    mimeType: SOURCE_MIME_TYPE,
    buffer: await overCapPhotoJpeg(),
  };
}
