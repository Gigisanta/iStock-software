import 'server-only';
import { revalidateTag, updateTag } from 'next/cache';
import { listingTag, storefrontTag, tenantConfigTag } from '../../../(storefront)/_lib/cache-tags';
import { logEvent } from '../log';

/**
 * El único punto del panel que invalida el cache de una vidriera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué NO alcanza con `revalidateTag(tag, 'max')` — medido, no deducido
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La vidriera cachea la **respuesta negativa** de un slug que no es de nadie —bajo **ADR-011** una
 * página legible con `noindex, nofollow` y status 200, no un 404 duro— con el perfil corto de
 * ADR-012, a propósito: un escaneo de subdominios cuesta una query cada tanto y no una por
 * request. La contracara es que el alta del tenant tiene que borrar esa entrada, o el dueño carga
 * 15 equipos, pega el link en un estado de Instagram y el link no muestra nada. Sin error, sin
 * log, sin alerta.
 *
 * `revalidateTag(tag, 'max')` **no borra nada**. El segundo argumento no es "el perfil con el que
 * se guardó la entrada": es *cuánto tiempo se puede seguir sirviendo el contenido viejo* mientras
 * se regenera en background. Con `'max'` esa ventana es de **un año**
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`:
 * *"A one year window, long enough that requests are always served stale content while the
 * revalidation runs"*). O sea: la respuesta negativa se sigue sirviendo.
 *
 * Verificado en este repo contra `next build` + `next start` 16.3.3, con el e2e
 * `e2e/s1-alta-invalida-el-miss-cacheado.spec.ts` y una respuesta negativa previamente cacheada
 * (`x-nextjs-cache: HIT`). La medición es **anterior a ADR-011**, cuando el miss todavía era un
 * 404 duro: por eso la tabla dice `404`. Lo que se midió es el comportamiento de `revalidateTag`
 * frente a `updateTag`, que no cambió — cambió cómo se llama la respuesta que quedaba pegada:
 *
 * | invalidación en el alta | secuencia de visitas después del alta |
 * |---|---|
 * | `revalidateTag(tag, 'max')` | `[404, 404, 404, 404, 404]` |
 * | `updateTag(tag)`            | `[200, …]` |
 *
 * `updateTag` es la API de **read-your-own-writes**: *"immediately expires the cached data […]
 * The next request will wait to fetch fresh data rather than serving stale content"*. Es lo que
 * necesita este caso y no es una optimización: el primer visitante después del alta es, muy
 * seguido, el propio dueño probando su link.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los DOS tags de tenant, siempre juntos
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * - `storefront:{slug}`    → el cuerpo de la vidriera.
 * - `tenant-config:{slug}` → `generateMetadata` (`<title>`, `robots`), que se cachea **aparte**.
 *
 * Invalidar uno solo deja el caso peor de todos: la página se ve perfecta y el `<title>` sigue
 * siendo *"No hay ninguna vidriera en esta dirección"* con `robots: noindex`. La vidriera anda
 * para quien tenga el link y es invisible para Google — y "pegá el link en un estado" es la mitad
 * del producto.
 *
 * **"Siempre juntos" vale para lo que cambia el tenant**: el alta, el TC, un punto de retiro, el
 * teléfono. **No** para lo que cambia una unidad: reservar un iPhone no toca el `<title>` ni el TC,
 * y emitir `tenant-config:{slug}` ahí purgaba las 60 fichas hermanas por nada. Ver
 * `invalidateStorefrontUnit()`.
 *
 * Los nombres de los tags se importan de `(storefront)/_lib/cache-tags.ts` (owner:
 * `storefront-agent`) en vez de re-escribirse acá. Un tag que el panel arma distinto del que la
 * vidriera registró no invalida nada **y no falla**: es la misma clase de bug que dos listas de
 * slugs reservados. Se lee, no se escribe: el ownership es de escritura.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Y el TERCER tag: `listing:{uuid}`, el de la unidad (S3.2)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un tag de Vercel es un OR: una entrada cacheada muere si se purga **cualquiera** de los tags que
 * registró. Quién registra qué (`(storefront)/_lib/listings.ts`, owner: `storefront-agent`):
 *
 * - **la grilla** → `storefront:{slug}` + `tenant-config:{slug}`;
 * - **la ficha**  → `tenant-config:{slug}` + `listing:{uuid}`.
 *
 * La ficha registró `storefront:{slug}` hasta S6 y ya no: era el otro extremo del mismo cable que
 * hacía que una reserva purgara el catálogo entero. Lo que queda compartido entre grilla y fichas es
 * `tenant-config:{slug}`, y ese es el que se emite cuando de verdad cambió algo del tenant. Eso
 * convierte a `listing:{uuid}` en un bisturí:
 *
 * | mutación | qué cambia de verdad | qué se emite |
 * |---|---|---|
 * | alta del negocio, TC, punto de retiro | **todo** | los dos de tenant |
 * | publicar / despublicar / reservar / vender | la grilla **y** la ficha | `storefront:{slug}` + `listing:{uuid}` |
 * | 2ª y 3ª foto de una unidad publicada | **sólo** la ficha (la grilla pinta `photos[0]`) | sólo `listing:{uuid}` |
 *
 * La fila de abajo es la que paga la slice: con 200 equipos, agregar una foto emitía
 * `storefront:{slug}` y tiraba abajo la vidriera entera — 200 fichas más la grilla— para que
 * cambiara **una**. Ahora es una revalidación. Es exactamente el objetivo de `CLAUDE.md` §3
 * ("95% de los hits no tocan Postgres"), que no se cumple regenerando 200 páginas por foto.
 *
 * La primera foto **sí** cambia la grilla (la card pasa de placeholder a foto), así que ahí se
 * emite también `storefront:{slug}`. Lo decide `addUnitPhoto` con el `count(*)` de adentro de su
 * transacción, no este módulo: la pregunta "¿esta foto es la que se ve en la card?" es de quien
 * escribió la fila.
 *
 * ── El UUID se valida, y si no es un UUID no se explota ─────────────────────────────────────
 * `listingTag()` **tira** con un id que no tiene forma de UUID, y acá una excepción llegaría
 * **después** de que la mutación commiteó. Misma política que el `catch` de `updateTag`: degradar
 * a lo más ancho (los tags de tenant) y dejar rastro, nunca romperle la pantalla a alguien cuya
 * escritura salió bien ni —peor— dejar la ficha vieja pegada en el CDN.
 */

/**
 * "Esta vidriera **entera** cambió: mostrala actualizada en la próxima visita."
 *
 * Es la invalidación más ancha y es la correcta cuando lo que cambió no es una unidad: el alta del
 * negocio, el TC, los medios de pago, un punto de retiro, el teléfono. Todo eso reescribe las 200
 * fichas a la vez y no hay nada más chico que purgar.
 *
 * Si lo que cambió es **una unidad**, esta no es la función: son `invalidateStorefrontUnit()` y
 * `invalidateListing()`, acá abajo.
 *
 * ## Sobre el `catch`
 * `updateTag` **sólo** se puede llamar desde una Server Action (tira `E872` en un Route Handler o
 * en un cron). Cuando eso pase, el fallback documentado es `revalidateTag(tag, { expire: 0 })`:
 * *"Stale content is never served, so the next request is a blocking revalidate/cache miss. Use it
 * when the caller needs the data gone immediately and you cannot use `updateTag`"*.
 *
 * El fallback existe porque acá la excepción llegaría **después** de que la escritura commiteó: el
 * negocio ya existe y hacer explotar la acción le mostraría un error a alguien cuyo alta salió
 * bien, dejando además cacheada la página de miss (que bajo **ADR-011** ya no es un 404: es un 200
 * con `noindex`, y por eso no se nota mirando status codes). Degradar a la API equivalente y dejar
 * rastro en el log es estrictamente mejor. Si `revalidateTag` también falla, ahí sí propaga: eso ya
 * no es "el contexto equivocado", es el cache roto.
 */
export function invalidateStorefront(slug: string): void {
  emit(tenantTags(slug));
}

/**
 * "Esta unidad cambió **y** la grilla también": publicar, despublicar, vender, reservar, la
 * primera foto. Emite **dos** tags: `storefront:{slug}` y `listing:{uuid}`.
 *
 * ## Por qué dos y no tres — el radio se mide, no se estima (S6)
 * Hasta S6 esta función emitía además `tenant-config:{slug}`. Un tag es un OR y la ficha registra
 * los dos tags de tenant, así que **una reserva en un tenant de 60 equipos purgaba las 61
 * páginas**: la grilla y las 60 fichas, 59 de las cuales no habían cambiado en nada. La función
 * que dice `Unit` en el nombre invalidaba el catálogo entero, y se vio en el cold-hit rate:
 * ~39% contra una alarma de 5% (`cost-auditor` sobre S6, `docs/COST.md` §2.4).
 *
 * Qué purga cada tag que **sí** se emite, y por qué no sobra ninguno de los dos:
 *
 * | tag | qué purga | por qué hace falta acá |
 * |---|---|---|
 * | `storefront:{slug}` | la grilla | reservar sí cambia la card: aparece el badge "Reservado". Sacarlo dejaría la grilla diciendo "Disponible" sobre una unidad reservada — la regresión que `adversary-reviewer` rechazó en S6. |
 * | `listing:{uuid}` | esa ficha, y sólo esa | es el bisturí: la ficha muere sin arrastrar a las hermanas. |
 *
 * El que se cayó es `tenant-config:{slug}`, que cachea el TC, los puntos de retiro, los medios de
 * pago y el teléfono. **Reservar una unidad no cambia nada de eso.** Estaba puramente de más, y
 * era exactamente el que hacía que la purga alcanzara a las 60 fichas hermanas.
 * **Radio: 2 páginas en vez de 61.**
 *
 * Si lo que cambió es config del tenant, la función no es esta: es `invalidateStorefront()`, que
 * sigue emitiendo los dos tags de tenant a propósito.
 *
 * ## El id que no tiene forma de UUID: se ensancha (misma decisión que `invalidateListing()`)
 * `unitTagOrWiden()` devuelve `[]` con un id que no es UUID. Antes ese caso quedaba tapado por los
 * tags de tenant; con la emisión de dos tags dejaría **sólo `storefront:{slug}`**, o sea: la grilla
 * se actualiza y la ficha queda pegada en el CDN con `cacheLife('max')` — hasta un año mostrando
 * "Disponible" sobre algo que se vendió. Esa asimetría es peor que la purga ancha, así que esa rama
 * ensancha a `tenantTags(slug)`: cuando el panel no puede **nombrar** la ficha, el tag de tenant es
 * lo único que le queda para alcanzarla. Purgar de más en un caso que no debería ocurrir nunca es
 * estrictamente mejor que servir una ficha mentirosa; es la misma política que el `catch` de
 * `updateTag`, y por eso también deja rastro en el log.
 */
export function invalidateStorefrontUnit(slug: string, listingId: string): void {
  const unit = unitTagOrWiden(slug, listingId);
  emit(unit.length === 0 ? tenantTags(slug) : [storefrontTag(slug), ...unit]);
}

/**
 * "Cambió **sólo** la ficha de esta unidad": la 2ª y 3ª foto de un equipo ya publicado, que la
 * grilla no muestra (pinta `photos[0]`).
 *
 * Emite **un** tag y ese es el punto: con 200 equipos, la alternativa era purgar 201 páginas.
 *
 * `slug` no se emite — se usa sólo como red de contención si `listingId` no fuera un UUID, en
 * cuyo caso es preferible purgar de más que dejar la ficha vieja servida por un año.
 */
export function invalidateListing(slug: string, listingId: string): void {
  const unit = unitTagOrWiden(slug, listingId);
  emit(unit.length === 0 ? tenantTags(slug) : unit);
}

function tenantTags(slug: string): readonly string[] {
  return [storefrontTag(slug), tenantConfigTag(slug)];
}

/**
 * El tag de la unidad, o `[]` si el id no tiene forma de UUID. **No propaga**: acá ya commiteó la
 * escritura y una excepción sería romperle la pantalla a alguien que hizo todo bien.
 */
function unitTagOrWiden(slug: string, listingId: string): readonly string[] {
  try {
    return [listingTag(listingId)];
  } catch {
    // Ni el slug ni el id son PII, pero se loguea el slug (ya público en la URL) y no el id crudo,
    // que es justo el valor que no tiene la forma que esperábamos.
    logEvent('storefront.cache.listing_tag_invalid', { slug });
    return [];
  }
}

function emit(tags: readonly string[]): void {
  for (const tag of tags) {
    try {
      updateTag(tag);
    } catch {
      // El slug no es PII y ya viaja en la URL pública. No se loguea nada más.
      logEvent('storefront.cache.update_tag_unavailable', { tag });
      revalidateTag(tag, { expire: 0 });
    }
  }
}
