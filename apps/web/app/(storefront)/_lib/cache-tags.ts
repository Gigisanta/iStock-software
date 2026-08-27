/**
 * Taxonomía de cache tags de la vidriera. **Normativa** (ADR-007 §"Taxonomía de tags").
 *
 * ## La regla que hay que entender antes de tocar este archivo
 * Los cache tags de Vercel están scopeados a **proyecto + environment, NO a dominio**.
 * Un tag genérico como `'storefront'` purga **todos los tenants a la vez**: con 100 tenants, una
 * edición de precio de uno solo dispara 100 re-renders y 100 tandas de ISR Writes. Por eso **todo
 * tag lleva el slug adentro**, sin excepción.
 *
 * ## Límites duros (fuente: Vercel · Purging Vercel CDN Cache, `@vercel/functions`)
 * - **256 bytes** por tag. Un tag más largo **se descarta con un warning en consola**: no invalida
 *   nada y no rompe nada. Es la peor falla posible — silenciosa y en producción.
 * - **128 tags** por respuesta cacheada; los que pasan de 128 en una llamada se **descartan**.
 * - **16 tags** por llamada bulk a la REST API.
 * - La coma es el delimitador del header `Vercel-Cache-Tag` → **un tag con coma es un tag partido**.
 * - Los tags son **case-sensitive**: `Acme` ≠ `acme`.
 *
 * Nada de esto tira una excepción sola. Por eso las tira este módulo.
 *
 * ## Estas excepciones son la ÚLTIMA barrera, nunca la primera (hallazgo HIGH del adversary, S1)
 * Durante S1 la validación del slug de la vidriera estaba *derivada* de este throw: nadie
 * chequeaba la forma del slug antes de llamar `storefrontTag()`, así que un slug basura se
 * convertía en una excepción **de render**. Bajo `cacheComponents` + PPR una excepción de render no
 * es un 500: el shell ya salió con `200` y lo que queda es un stream que nunca cierra, con
 * `no-store`, o sea CPU facturada que el CDN jamás absorbe. Una request bastaba.
 *
 * Regla que sale de ahí y que este módulo no puede hacer cumplir solo: **el que construye un tag ya
 * tiene que saber que el slug es válido.** Para eso está `isSlugShaped()` de `@istock/domain`, que
 * es una función pura que devuelve `false` en vez de tirar. Los throws de acá se quedan igual —
 * fallar cerrado en el borde es correcto, y un tag mal formado que se descarta en silencio es peor
 * que una excepción— pero llegar a ellos ya es un bug de quien llamó.
 */

import { isSlugShaped } from '@istock/domain';

const MAX_TAG_BYTES = 256;

function assertTag(tag: string): string {
  if (tag.includes(',')) {
    throw new Error(`cache tag inválido (la coma parte el header Vercel-Cache-Tag): "${tag}"`);
  }
  const bytes = new TextEncoder().encode(tag).length;
  if (bytes > MAX_TAG_BYTES) {
    throw new Error(`cache tag de ${bytes} bytes supera el máximo de ${MAX_TAG_BYTES}: "${tag}"`);
  }
  return tag;
}

/**
 * La forma del slug se pregunta a `@istock/domain` y **no se re-declara acá**.
 *
 * Antes este archivo tenía su propia copia del regex, idéntica carácter por carácter a la de
 * `_lib/host.ts`, y nada las ataba. Mientras coincidieran, un host bien formado nunca podía
 * disparar este throw. El día que una de las dos se aflojara —por ejemplo a 63 caracteres, para
 * alinearla con el límite de label DNS— el proxy iba a aceptar un host que este módulo rechaza, y
 * el throw pasaba a ser alcanzable **desde una URL de vidriera normal, en el camino caliente**.
 * Ese es el hallazgo LOW del adversary de S1, y es el mismo modo de falla que la lista de
 * subdominios reservados duplicada: dos copias que no rompen nada hasta que divergen.
 */
function assertSlug(slug: string): string {
  if (!isSlugShaped(slug)) {
    throw new Error(`cache tag: slug inválido "${slug}" (minúsculas, dígitos y guiones, 3–32)`);
  }
  return slug;
}

/**
 * `storefront:{slug}` — **todo** lo que ve un visitante de ese tenant.
 * Lo invalida el panel en cada mutación de stock visible (ver skill `isr-revalidate`).
 */
export function storefrontTag(slug: string): string {
  return assertTag(`storefront:${assertSlug(slug)}`);
}

/**
 * `tenant-config:{slug}` — TC, puntos de retiro, medios de pago, teléfono, nombre del comercio.
 * Cambia mucho menos seguido que el stock; separarlo evita re-renderizar la vidriera entera
 * cuando el dueño corrige un horario.
 */
export function tenantConfigTag(slug: string): string {
  return assertTag(`tenant-config:${assertSlug(slug)}`);
}

/**
 * `listing:{unitId}` — una ficha puntual.
 *
 * Ojo: este tag **no** lleva slug porque el `unitId` es un UUID globalmente único, así que no hay
 * colisión posible entre tenants. Es la única excepción a "todo tag lleva slug", y es segura por
 * el tipo del identificador, no por convención.
 */
export function listingTag(unitId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unitId)) {
    throw new Error(`cache tag: unitId no es un UUID: "${unitId}"`);
  }
  return assertTag(`listing:${unitId}`);
}

export const CACHE_TAG_LIMITS = {
  maxBytesPerTag: MAX_TAG_BYTES,
  maxTagsPerResponse: 128,
  maxTagsPerBulkPurge: 16,
} as const;
