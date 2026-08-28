/**
 * Achicar una foto en el navegador **antes** de subirla. Mejora, no requisito.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA REGLA QUE NO SE NEGOCIA: bajo el cap, el byte original viaja intacto.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Si `file.size <= maxBytes`, esta función devuelve `'untouched'` y **nadie toca el archivo**. No
 * es una optimización de performance: es honestidad del gate.
 *
 * El criterio de aceptación de S2 mide **bytes de salida del pipeline** (`card` ≤ 150 KB, medido
 * descargando el objeto). Si el navegador re-encodeara siempre, al pipeline le entraría un JPEG
 * de 1600px ya masticado por Chrome, y el gate estaría midiendo a Chrome. El día que
 * `packages/media` se degrade —una escalera de calidad mal tocada, un `effort` bajado para ahorrar
 * CPU— el número seguiría dando verde porque la entrada ya venía chica. Un gate que no puede
 * fallar no es un gate.
 *
 * Así que el downscale es estrictamente un **rescate**: existe para el JPEG de 50 MP de un Android
 * de gama media, que pesa 5–12 MB y que sin esto el server rechaza. Sin él, "el dueño carga 15
 * equipos en una tarde" (el *done cobrable* de `CLAUDE.md` §1) no pasa: pasa "el dueño abandona en
 * el tercero".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Sin JavaScript esto no corre, y el formulario tiene que seguir andando igual
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El `<form>` es un form de verdad, sin `preventDefault`. Sin JS no hay downscale y el server
 * rechaza lo que pase de `MAX_PHOTO_BYTES` con un mensaje en castellano. Una foto chica se sube
 * igual. Eso es degradación, no rotura.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Todo lo que puede fallar devuelve `'failed'` y deja pasar el original
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HEIC no lo decodifica ningún navegador que no sea Safari; `createImageBitmap` tira. Un canvas
 * "tainted" no puede exportar. Un teléfono sin memoria devuelve `null` en `toBlob`. En todos esos
 * casos preferimos que el archivo original llegue al server y que el server conteste con su
 * mensaje, antes que romper el alta con un error de canvas que no le dice nada a nadie.
 *
 * `1600px` de lado mayor es el mismo `MAX_OUTPUT_EDGE` del pipeline (`packages/media`): achicar
 * más sería tirar píxeles que `detail` va a querer.
 */

/** Lado mayor del resultado. Igual a `MAX_OUTPUT_EDGE` de `@istock/media`. */
export const DOWNSCALE_MAX_EDGE = 1600;

/**
 * Escalera de calidad JPEG. Se prueba de mejor a peor y se corta en la primera que entra bajo el
 * cap. Tres escalones y no diez: cada intento es un encode entero y esto corre en un teléfono.
 */
const QUALITY_LADDER = [0.82, 0.7, 0.6] as const;

export type DownscaleResult =
  /** El archivo ya estaba bajo el cap. **No se tocó.** Se sube el byte original. */
  | { readonly kind: 'untouched' }
  /** Se re-encodeó. `file` es el que hay que subir. */
  | { readonly kind: 'resized'; readonly file: File }
  /** No se pudo (formato que el navegador no decodifica, sin canvas, sin memoria). */
  | { readonly kind: 'failed' };

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

/** `foto.heic` → `foto.jpg`. El contenido pasó a ser JPEG; el nombre no puede mentir. */
function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/u, '');
  return `${base === '' ? 'foto' : base}.jpg`;
}

export async function downscalePhoto(
  file: File,
  maxBytes: number,
  maxEdge: number = DOWNSCALE_MAX_EDGE,
): Promise<DownscaleResult> {
  // ── La regla. Primera línea, sin excepciones. ───────────────────────────────────────────────
  if (file.size <= maxBytes) return { kind: 'untouched' };

  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return { kind: 'failed' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { kind: 'failed' };
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return { kind: 'failed' };
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITY_LADDER) {
      const blob = await toBlob(canvas, quality);
      if (blob === null) return { kind: 'failed' };
      if (blob.size <= maxBytes) {
        return {
          kind: 'resized',
          file: new File([blob], jpegName(file.name), {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          }),
        };
      }
    }

    // Ni al 60% entró. Que conteste el server: es una foto rarísima y el mensaje ya está escrito.
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  } finally {
    bitmap.close();
  }
}
