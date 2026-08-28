/**
 * Slug de la **ficha** de un equipo: `/{slug-del-tenant}/p/{slug-del-listing}`.
 *
 * Es un namespace distinto del slug del tenant y por eso **no** se reusa `suggestSlug()` de
 * `@istock/domain`: esa función rechaza los slugs reservados porque el slug del tenant es un
 * subdominio (`www`, `api`, `app` no pueden serlo). El slug de una ficha vive debajo del tenant,
 * así que un equipo titulado "App" no colisiona con nada.
 *
 * Lo que sí se reusa es la **forma** (`SLUG_PATTERN`, `SLUG_MAX_LENGTH`), porque sigue siendo un
 * segmento de path: nada de `.`, `/` ni `%`.
 *
 * ## El sufijo
 * Dos iPhone 14 Pro 256 Grafito en el mismo tenant son dos filas distintas con el mismo título, y
 * `listings_tenant_slug_key` es un unique index. El sufijo aleatorio los separa. **No sale del
 * `id` del listing**: el slug es público y el id no tiene por qué serlo.
 */

import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, isSlugShaped } from '@istock/domain';

const SUFFIX_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const SLUG_SUFFIX_LENGTH = 5;

/** Lo que queda para el título: el máximo menos el guión y el sufijo. */
const MAX_BASE_LENGTH = SLUG_MAX_LENGTH - SLUG_SUFFIX_LENGTH - 1;

/** Cuando el título no deja ni una letra utilizable (emojis, sólo signos, otro alfabeto). */
const FALLBACK_BASE = 'equipo';

/** `"iPhone 14 Pro 256 Grafito"` → `"iphone-14-pro-256-grafi"`. Sin sufijo. */
export function listingSlugBase(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/gu, '');

  return base.length >= SLUG_MIN_LENGTH ? base : FALLBACK_BASE;
}

/**
 * Sufijo aleatorio. Recibe el generador por parámetro para que el test sea determinista y para
 * que el módulo no dependa de `crypto` (el caller le pasa `crypto.getRandomValues`).
 */
export function slugSuffix(randomBytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i += 1) {
    const byte = randomBytes[i] ?? 0;
    out += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
  }
  return out;
}

/**
 * Slug final. Siempre devuelve algo con forma válida: si por un caso raro no la tuviera, cae al
 * fallback en vez de dejar que Postgres guarde un segmento de path que después no se puede rutear.
 */
export function buildListingSlug(title: string, randomBytes: Uint8Array): string {
  const candidate = `${listingSlugBase(title)}-${slugSuffix(randomBytes)}`;
  return isSlugShaped(candidate) ? candidate : `${FALLBACK_BASE}-${slugSuffix(randomBytes)}`;
}
