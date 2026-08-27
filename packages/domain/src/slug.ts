/**
 * El **formato** del slug del tenant. La lista de reservados vive al lado, en `reserved-slugs.ts`.
 *
 * El slug es tres cosas a la vez, y por eso no se valida "para que quede lindo":
 *
 * 1. Un **subdominio**: `{slug}.maat.work` → tiene que ser un label DNS válido (RFC 1035, ≤63).
 * 2. Un **cache tag**: `storefront:{slug}`. Los tags están scopeados al proyecto, no al dominio:
 *    un slug que colisiona purga la vidriera de **otro** tenant.
 * 3. Un **segmento de path** en el rewrite del proxy: `/s/{slug}` → nada de `.`, `/` ni `%`.
 *
 * El mismo regex vive además en el `CHECK tenants_slug_format` de `packages/db` (SQL, no puede
 * importar TypeScript) y en los bordes de `apps/web`, que necesitan mensajes en castellano por
 * campo mientras el dominio tira `DomainError`. `scripts/guard-leaks.sh` regla 14 falla si esas
 * copias **divergen**, que es el único modo en que esta duplicación hace daño: un slug que la DB
 * acepta y el proxy rechaza es un tenant que paga y no tiene vidriera; al revés, es un 404
 * cacheado 30 días.
 */

import { DomainError } from './errors';
import { isReservedSlug } from './reserved-slugs';

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;

/**
 * Minúsculas, dígitos y guiones. 3–32 caracteres. Sin guión en los bordes.
 *
 * El máximo está **por debajo** del límite de label DNS (63) y muy por debajo del límite de un
 * cache tag (256 bytes), a propósito: el margen es para prefijos (`storefront:`, `tenant-config:`)
 * y para el día que haya un sufijo de entorno.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/u;

/**
 * ¿Tiene **forma** de slug? No dice nada sobre si está reservado ni sobre si el tenant existe.
 * Son tres preguntas distintas y mezclarlas es cómo se termina consultando Postgres por `www`.
 */
export function isSlugShaped(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * `"  MiTienda "` → `"mitienda"`. Se normaliza **antes** de validar, nunca después: validar y
 * después normalizar deja pasar `"WWW"` a la base como `"www"`, esquivando la lista de reservados.
 *
 * `NFKC` colapsa las formas de compatibilidad Unicode (fullwidth `ｗｗｗ` → `www`), que es la
 * variante barata de homoglifo para hacerse pasar por un subdominio nuestro.
 */
export function normalizeSlug(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

/** El slug tiene forma válida **y** no está reservado. */
export function isUsableSlug(value: string): boolean {
  return isSlugShaped(value) && !isReservedSlug(value);
}

export function assertSlug(slug: string): void {
  if (!isSlugShaped(slug)) {
    throw new DomainError(
      'SLUG_INVALID',
      `slug inválido: "${slug}" (minúsculas, números y guiones, ${String(SLUG_MIN_LENGTH)}–${String(SLUG_MAX_LENGTH)} caracteres, sin guión al borde)`,
    );
  }
}

/**
 * Sugerencia a partir del nombre del negocio: `"Norte Cel Cipolletti"` → `"norte-cel-cipolletti"`.
 *
 * Es **sólo** una ayuda de UI: devuelve `''` cuando no hay una sugerencia válida, en vez de
 * devolver algo "casi" bueno. Lo que se guarda es lo que pasa por la validación del borde,
 * siempre. Vive acá y no en el formulario porque depende de la lista de reservados, y una
 * sugerencia que propone un nombre reservado es una promesa que el submit rompe.
 */
export function suggestSlug(businessName: string): string {
  const base = businessName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/gu, '');

  return isUsableSlug(base) ? base : '';
}
