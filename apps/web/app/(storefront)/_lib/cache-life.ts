import { cacheLife } from 'next/cache';

/**
 * **El perfil de cache del polo negativo de la vidriera: el slug que NO es de nadie.**
 *
 * Este archivo es la única declaración del perfil corto en todo `(storefront)`. El polo positivo
 * —el tenant que sí existe— usa `cacheLife('max')` y se invalida por evento; no vive acá.
 *
 * ## El porqué está en ADR-012, no acá
 * `docs/DECISIONS.md` → **ADR-012 · "Los dos polos del cache de la vidriera son asimétricos a
 * propósito"**. Ahí están, completos y en el lugar donde se los busca: los dos motivos por los que
 * `'max'` en el polo negativo es un bug (envenenamiento durable con slugs inventados · el tenant
 * que nace muerto), los números de costo del polo positivo (216× entre invalidar por evento e
 * invalidar por tiempo), el costo acotado de acortar el negativo (una query por `revalidate` **por
 * slug**, no por request) y la tabla de 6a–6e con qué chequea cada regla del guard.
 *
 * Este docblock no repite ese razonamiento a propósito: una segunda copia deriva, y la que deriva
 * es siempre la que nadie mira.
 *
 * ## Lo único que hay que saber para editar este archivo
 * `scripts/guard-leaks.sh` §6 lo chequea mecánicamente, y dos de sus reglas caen justo acá:
 * - **6b** — ningún otro archivo de la vidriera puede llamar `cacheLife({...})` inline.
 * - **6c** — cinco cosas, no cuatro: los tres enteros de abajo tienen que quedar dentro de
 *   **[30, 900] segundos**, contra un techo **duplicado dentro del guard a propósito** (si lo
 *   leyera de estas constantes, subirlas pondría el guard en verde y el guard dejaría de guardar),
 *   **y** el perfil tiene que seguir nombrado `MISS`. Lo segundo existe para que un TTL corto del
 *   camino positivo no pueda disfrazarse de perfil del miss: si renombrás algo acá, tenelo en
 *   cuenta.
 *
 * Los segundos están en constantes con nombre porque **los nombres dicen la unidad y el literal
 * no**. (Antes había además un motivo malo —esquivar un regex del guard que no distinguía polo—;
 * esa regla se reescribió en `96d0c67` y 6d ahora excluye este archivo de forma explícita.)
 */

/** Cuánto se puede servir la respuesta vieja desde el router/CDN sin preguntar. 60 s. */
const MISS_STALE_SECONDS = 60;

/** Cada cuánto se vuelve a preguntar si el slug ya es un tenant. 5 minutos. */
const MISS_REVALIDATE_SECONDS = 300;

/** A partir de acá la entrada se descarta y el próximo hit es un miss bloqueante. 15 minutos. */
const MISS_EXPIRE_SECONDS = 900;

/**
 * Perfil del camino negativo, para pasarle a `cacheLife` desde un scope `'use cache'`.
 *
 * Se exporta el objeto **y** el helper: el objeto es lo que consume `tenant.ts` (donde el perfil
 * se elige después de saber si hubo fila o no) y el helper es azúcar para los dos call sites de
 * `page.tsx`. Los números viven en un solo lugar; que diverjan entre la metadata y el cuerpo es
 * exactamente el bug de "la página se ve bien y el `<title>` sigue siendo el del miss".
 */
export const STOREFRONT_MISS_LIFE = {
  stale: MISS_STALE_SECONDS,
  revalidate: MISS_REVALIDATE_SECONDS,
  expire: MISS_EXPIRE_SECONDS,
} as const;

/**
 * Marca la entrada de cache actual como "esto es el miss, no lo guardes 30 días".
 *
 * Bajo ADR-011 el miss **no es un 404**: es la página legible de
 * `_components/storefront-miss.tsx`, servida con `200` y `noindex`. El problema que este perfil
 * resuelve es idéntico al que resolvía cuando era un 404 —una respuesta negativa que se queda
 * pegada 30 días le deja la vidriera muerta a un tenant que se dio de alta después—; lo único que
 * cambió es cómo se llama la respuesta.
 */
export function cacheStorefrontMiss(): void {
  cacheLife({
    stale: MISS_STALE_SECONDS,
    revalidate: MISS_REVALIDATE_SECONDS,
    expire: MISS_EXPIRE_SECONDS,
  });
}
