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
 * copias **divergen**, que es el único modo en que esta duplicación hace daño — y hace daño en las
 * dos direcciones, no en una:
 *
 * - La **DB acepta** y el **proxy rechaza** → un tenant que paga y no tiene vidriera.
 * - Al revés (**el proxy acepta lo que la DB nunca va a guardar**), el visitante no recibe un 404 sino la página de miss: legible, con `noindex, nofollow` y status **200** (ADR-011), cacheada con el perfil corto del polo negativo (`stale 60 s / revalidate 300 s / expire 900 s`, ADR-012) — minutos, no 30 días.
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Segunda familia: el slug de una FICHA (listing)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Son dos familias distintas con la misma pinta, y confundirlas hace **desaparecer equipos**.
 *
 * El slug de tenant (arriba) es un **label DNS**: vive en el host, `{slug}.maat.work`, y por eso
 * tiene techo 32. El slug de un listing vive en el **path** (`/p/{listingSlug}`): no es un label
 * DNS y no le aplica ese techo. Prueba concreta y viva: la **fila 207 del seed**
 * (`packages/db/src/seed-data.ts`) tiene el slug `iphone-15-pro-max-256-titanio-natural`, de
 * **37 caracteres**. Validar esa ficha con la regla del subdominio devuelve `404` sobre un equipo
 * publicado, legible por `anon`, que el dueño ve en el panel y el comprador no encuentra nunca.
 *
 * ── Por qué 64 y no más (decidido por el LEAD, no se re-abre) ──────────────────────────────────
 * El slug real más largo del seed son 37 caracteres. 64 deja aire para
 * `iphone-15-pro-max-1tb-titanio-natural`-y-algo sin permitir que alguien elija un path de 8 KB,
 * que bajo `'use cache'` es un **cache key de 8 KB por request elegido por quien pide la URL**.
 * El techo no es cosmético: es el límite de lo que un desconocido puede hacer entrar al cache.
 *
 * ── El generador es más angosto que el lector, A PROPÓSITO ─────────────────────────────────────
 * El panel **fabrica** slugs de hasta `SLUG_MAX_LENGTH` (32) y **eso se queda así**: un slug corto
 * es mejor para pegar en un estado de Instagram. El lector de la vidriera **acepta** hasta 64 para
 * tolerar filas sembradas, importadas o migradas. No es una inconsistencia que haya que limpiar:
 * es la asimetría deliberada entre lo que producimos y lo que estamos dispuestos a leer. **Si
 * alguien más adelante los "unifica" en 32, desaparecen equipos** — empezando por la fila 207.
 * Al revés tampoco: subir el generador a 64 no rompe nada técnico, pero alarga el link que el
 * dueño pega a mano.
 */

export const LISTING_SLUG_MIN_LENGTH = 3;
export const LISTING_SLUG_MAX_LENGTH = 64;

/** Mismo alfabeto que el slug de tenant; sólo cambia el largo. Sin guión en los bordes. */
export const LISTING_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/u;

/**
 * ¿Tiene **forma** de slug de ficha? **Pura y no tira.**
 *
 * No hay `assertListingSlug` y la ausencia es la decisión. `assertSlug` existe para el slug de
 * tenant porque ése lo escribe el dueño en un formulario y el throw se convierte en un mensaje de
 * campo. El slug de una ficha lo escribe **un desconocido en la barra de direcciones**: un input
 * malo se **contesta**, no se lanza. Bajo `cacheComponents` + PPR un throw de render no es un 500
 * — el shell ya salió con `200` y lo que queda es un stream que no cierra, o sea CPU facturada por
 * input basura. Es el mismo HIGH que documenta `apps/web/app/(storefront)/_lib/cache-tags.ts`.
 */
export function isListingSlugShaped(value: string): boolean {
  return LISTING_SLUG_PATTERN.test(value);
}
