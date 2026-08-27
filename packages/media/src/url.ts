/**
 * Armado de URLs públicas. **Nadie fuera de `packages/media` arma una URL de R2 a mano.**
 *
 * `variantUrl` recibe el mapeo (`listing_photos`), no una key + variante, porque con el esquema
 * de key opaca de ADR-006 **no se puede derivar** una variante desde otra. Esa imposibilidad es
 * la feature, no un obstáculo.
 */

import { UnsafeMediaKeyError } from './errors';
import { assertPublicVariantKey } from './keys';
import { mediaEnv, type MediaEnv } from './env';
import type { ListingPhotoKeys, Variant } from './types';

export interface UrlOptions {
  /** Base del CDN. Por defecto sale de `NEXT_PUBLIC_MEDIA_BASE_URL`. */
  readonly baseUrl?: string;
  readonly env?: MediaEnv;
}

function resolveBaseUrl(options?: UrlOptions): string {
  const raw = options?.baseUrl ?? (options?.env ?? mediaEnv()).NEXT_PUBLIC_MEDIA_BASE_URL;
  const base = raw.replace(/\/+$/, '');
  if (/\.r2\.dev(\/|$)/i.test(base)) {
    throw new UnsafeMediaKeyError('r2.dev no se sirve en producción (rate-limited, sin cache)');
  }
  return base;
}

/** URL pública de una key de variante. Valida la key antes de exponerla. */
export function publicUrlForKey(key: string, options?: UrlOptions): string {
  assertPublicVariantKey(key);
  return `${resolveBaseUrl(options)}/${key}`;
}

const FIELD: Readonly<Record<Variant, keyof ListingPhotoKeys>> = {
  thumb: 'thumbKey',
  card: 'cardKey',
  detail: 'detailKey',
};

/**
 * URL de la variante pedida a partir de la fila de `listing_photos`.
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
  const key = photo[FIELD[variant]];
  if (typeof key !== 'string') {
    throw new UnsafeMediaKeyError(`la foto no tiene ${FIELD[variant]}`);
  }
  return publicUrlForKey(key, options);
}

/** Las tres URLs de una foto. Útil para `srcset` fijo o para el DTO público. */
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
 * `srcset` de la grilla de vidriera: `card` como base, `detail` para DPR 2x.
 * No genera transformaciones on-the-fly: son dos objetos ya guardados. Costo marginal $0.
 */
export function cardSrcSet(photo: ListingPhotoKeys, options?: UrlOptions): string {
  return `${variantUrl(photo, 'card', options)} 800w, ${variantUrl(photo, 'detail', options)} 1600w`;
}
