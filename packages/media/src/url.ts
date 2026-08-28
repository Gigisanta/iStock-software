/**
 * Armado de URLs públicas. **Nadie fuera de `packages/media` arma una URL de R2 a mano.**
 *
 * `variantUrl` recibe el mapeo (`listing_photos`), no una key + variante, porque con el esquema
 * de key opaca de ADR-006 **no se puede derivar** una variante desde otra. Esa imposibilidad es
 * la feature, no un obstáculo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Dos superficies, y la diferencia NO es estilística
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * | función                                     | tira | quién la llama            |
 * |---------------------------------------------|------|---------------------------|
 * | `publicUrlForKey`                           |  SÍ  | `uploadListingPhoto`      |
 * | `variantUrl` · `variantUrls` · `cardSrcSet` |  NO  | render (panel + vidriera) |
 * | `renderableVariantUrls`                     |  NO  | render, cuando quiere omitir |
 *
 * **Escritura**: tirar es lo correcto. El alta falla, el reseller ve un error, nada malo se
 * guarda. Ruidoso y honesto.
 *
 * **Render**: tirar es lo peor que se puede hacer. Bajo `cacheComponents` una excepción adentro de
 * un render cacheado no produce un 500: produce un **200 que nunca cierra el stream**, y la ficha
 * queda colgada hasta el timeout (300 s medidos por `qa-agent`, con un mensaje que no hablaba de
 * media). Una foto con una key inválida tiene que **degradar**: se omite la foto y se reporta el
 * evento por `./incidents.ts`. Nunca colgar la ficha entera de un reseller por una fila rota.
 *
 * Por eso el camino de render usa `publicVariantKeyProblem` (total) y no `assertPublicVariantKey`
 * (assert): el chequeo es **el mismo**, lo que cambia es qué se hace con el resultado.
 */

import { UnsafeMediaKeyError } from './errors';
import { assertPublicVariantKey, publicVariantKeyProblem } from './keys';
import { mediaEnv, type MediaEnv } from './env';
import {
  keyPrefix,
  reportMediaIncident,
  type MediaIncidentReporter,
} from './incidents';
import type { ListingPhotoKeys, Variant } from './types';

export interface UrlOptions {
  /** Base del CDN. Por defecto sale de `NEXT_PUBLIC_MEDIA_BASE_URL`. */
  readonly baseUrl?: string;
  readonly env?: MediaEnv;
  /** Sink de incidentes sólo para esta llamada. Por defecto, el global de `./incidents.ts`. */
  readonly onIncident?: MediaIncidentReporter;
}

/**
 * Lo que devuelve una variante que no se puede servir.
 *
 * Es el **piso**, no el objetivo: para omitir la foto de verdad está `renderableVariantUrls`. Pero
 * el piso hay que elegirlo bien, porque este string termina en `<img src>` **y en `srcset` que
 * arma otra gente** (`apps/web/app/(storefront)/_lib/photo.ts` concatena
 * `` `${photo.card} 800w, ${photo.detail} 1600w` ``).
 *
 * Por eso NO es `''`. Con string vacío ese `srcset` queda `" 800w, 1600w"`, y el parser de
 * `srcset` lee `800w` y `1600w` como **URLs relativas**: el browser pediría
 * `/s/{slug}/p/{listing}/800w` contra la función de Next. Cambiar una ficha colgada por dos
 * requests basura por foto rota no es degradar, es mover el costo de lugar (`CLAUDE.md` §0.12).
 *
 * `about:invalid` es la URL que el propio CSS usa para "esto no es una URL": no tiene coma ni
 * espacio (así que es un candidato válido de `srcset` y no rompe el parseo de los demás), es
 * absoluta (así que no resuelve contra nuestro origen), **no dispara ningún request** y falla al
 * cargar, con lo cual el `<img>` muestra el `alt` — que en la vidriera es el título del equipo.
 */
export const UNRENDERABLE_VARIANT_URL = 'about:invalid';

const R2_DEV_RE = /\.r2\.dev(\/|$)/i;

/** Camino de escritura: tira. */
function resolveBaseUrl(options?: UrlOptions): string {
  const raw = options?.baseUrl ?? (options?.env ?? mediaEnv()).NEXT_PUBLIC_MEDIA_BASE_URL;
  const base = raw.replace(/\/+$/, '');
  if (R2_DEV_RE.test(base)) {
    throw new UnsafeMediaKeyError('r2.dev no se sirve en producción (rate-limited, sin cache)');
  }
  return base;
}

/**
 * Camino de render: no tira. `null` = no hay base servible.
 *
 * El `try` es la frontera donde "tirar" se convierte en "degradar", y cubre también a `mediaEnv()`:
 * una env mal configurada se resuelve la primera vez **adentro** del render, así que su
 * `MediaConfigError` colgaría la ficha igual que una key rota. La env sigue fallando fuerte donde
 * corresponde —en el boot, en `env.ts`, y en `media-lint` M002— no adentro de un componente.
 */
function tryResolveBaseUrl(options: UrlOptions | undefined, variant: Variant | null): string | null {
  try {
    return resolveBaseUrl(options);
  } catch (error) {
    reportMediaIncident(
      {
        code: 'MEDIA_CONFIG',
        reason: error instanceof Error ? error.message : 'base de media no resoluble',
        keyPrefix: '',
        variant,
      },
      options?.onIncident,
    );
    return null;
  }
}

/**
 * URL pública de una key de variante. **Tira** si la key no pasa el gate.
 * Camino de escritura (`uploadListingPhoto`). Para render, `variantUrl`.
 */
export function publicUrlForKey(key: string, options?: UrlOptions): string {
  assertPublicVariantKey(key);
  return `${resolveBaseUrl(options)}/${key}`;
}

const FIELD: Readonly<Record<Variant, keyof ListingPhotoKeys>> = {
  thumb: 'thumbKey',
  card: 'cardKey',
  detail: 'detailKey',
};

/** URL servible de una variante, o `null` + incidente reportado. Nunca tira. */
function tryVariantUrl(
  photo: ListingPhotoKeys,
  variant: Variant,
  options?: UrlOptions,
): string | null {
  const field = FIELD[variant];
  // `unknown` y no `string`: el tipo dice que está, pero esto viene de una fila de Postgres y la
  // pregunta que hay que contestar en render es qué pasa cuando el tipo miente.
  const key: unknown = photo[field];

  if (typeof key !== 'string' || key.length === 0) {
    reportMediaIncident(
      {
        code: 'MEDIA_UNSAFE_KEY',
        reason: `la foto no tiene ${field}`,
        keyPrefix: keyPrefix(key),
        variant,
      },
      options?.onIncident,
    );
    return null;
  }

  const problem = publicVariantKeyProblem(key);
  if (problem !== null) {
    reportMediaIncident(
      { code: 'MEDIA_UNSAFE_KEY', reason: problem, keyPrefix: keyPrefix(key), variant },
      options?.onIncident,
    );
    return null;
  }

  const base = tryResolveBaseUrl(options, variant);
  if (base === null) return null;
  return `${base}/${key}`;
}

/**
 * URL de la variante pedida a partir de la fila de `listing_photos`.
 *
 * **No tira.** Una key inválida devuelve `UNRENDERABLE_VARIANT_URL` y reporta el incidente.
 *
 * @example
 * ```ts
 * <img src={variantUrl(photo, 'card')} />   // grilla de la vidriera
 * <img src={variantUrl(photo, 'detail')} /> // ficha
 * ```
 */
export function variantUrl(
  photo: ListingPhotoKeys,
  variant: Variant,
  options?: UrlOptions,
): string {
  return tryVariantUrl(photo, variant, options) ?? UNRENDERABLE_VARIANT_URL;
}

/** Las tres URLs de una foto. Útil para `srcset` fijo o para el DTO público. No tira. */
export function variantUrls(
  photo: ListingPhotoKeys,
  options?: UrlOptions,
): Readonly<Record<Variant, string>> {
  return Object.freeze({
    thumb: variantUrl(photo, 'thumb', options),
    card: variantUrl(photo, 'card', options),
    detail: variantUrl(photo, 'detail', options),
  });
}

/**
 * Las tres URLs, o **`null` si alguna no se puede servir**. Es la primitiva de omisión: el caller
 * saltea esa foto de la lista en vez de renderizar un `<img>` roto.
 *
 * ```ts
 * const urls = renderableVariantUrls(row);
 * if (urls === null) continue;            // la ficha se arma con las fotos que sí sirven
 * ```
 *
 * Es todo-o-nada por foto a propósito: las tres keys salen del **mismo** `uploadListingPhoto`, así
 * que una sola rota no es "falta un tamaño", es una fila que no se puede creer.
 */
export function renderableVariantUrls(
  photo: ListingPhotoKeys,
  options?: UrlOptions,
): Readonly<Record<Variant, string>> | null {
  const thumb = tryVariantUrl(photo, 'thumb', options);
  const card = tryVariantUrl(photo, 'card', options);
  const detail = tryVariantUrl(photo, 'detail', options);
  if (thumb === null || card === null || detail === null) return null;
  return Object.freeze({ thumb, card, detail });
}

/**
 * `srcset` de la grilla de vidriera: `card` como base, `detail` para DPR 2x.
 * No genera transformaciones on-the-fly: son dos objetos ya guardados. Costo marginal $0.
 *
 * No tira: los candidatos que no se pueden servir **no se emiten**. Un candidato con URL vacía
 * rompería el parseo del `srcset` entero, así que se omite en vez de emitirse vacío.
 */
export function cardSrcSet(photo: ListingPhotoKeys, options?: UrlOptions): string {
  const card = tryVariantUrl(photo, 'card', options);
  const detail = tryVariantUrl(photo, 'detail', options);
  const candidates: string[] = [];
  if (card !== null) candidates.push(`${card} 800w`);
  if (detail !== null) candidates.push(`${detail} 1600w`);
  return candidates.join(', ');
}
