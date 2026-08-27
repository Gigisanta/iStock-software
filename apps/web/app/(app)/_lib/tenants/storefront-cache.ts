import 'server-only';
import { revalidateTag, updateTag } from 'next/cache';
import { storefrontTag, tenantConfigTag } from '../../../(storefront)/_lib/cache-tags';
import { logEvent } from '../log';

/**
 * El único punto del panel que invalida el cache de una vidriera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué NO alcanza con `revalidateTag(tag, 'max')` — medido, no deducido
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La vidriera cachea el **404** de un slug inexistente con `cacheLife('max')`, a propósito: un
 * escaneo de subdominios cuesta una query y no una por request. La contracara es que el alta del
 * tenant tiene que borrar ese 404, o el dueño carga 15 equipos, pega el link en un estado de
 * Instagram y el link no muestra nada. Sin error, sin log, sin alerta.
 *
 * `revalidateTag(tag, 'max')` **no borra nada**. El segundo argumento no es "el perfil con el que
 * se guardó la entrada": es *cuánto tiempo se puede seguir sirviendo el contenido viejo* mientras
 * se regenera en background. Con `'max'` esa ventana es de **un año**
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`:
 * *"A one year window, long enough that requests are always served stale content while the
 * revalidation runs"*). O sea: el 404 se sigue sirviendo.
 *
 * Verificado en este repo contra `next build` + `next start` 16.3.3, con el e2e
 * `e2e/s1-alta-invalida-el-404-cacheado.spec.ts` y un 404 previamente cacheado (`x-nextjs-cache:
 * HIT`):
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
 *  Los DOS tags, siempre
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
 * Los nombres de los tags se importan de `(storefront)/_lib/cache-tags.ts` (owner:
 * `storefront-agent`) en vez de re-escribirse acá. Un tag que el panel arma distinto del que la
 * vidriera registró no invalida nada **y no falla**: es la misma clase de bug que dos listas de
 * slugs reservados. Se lee, no se escribe: el ownership es de escritura.
 */

/**
 * "Esta vidriera cambió: mostrala actualizada en la próxima visita."
 *
 * Se llama en **toda** mutación que cambia lo que ve un visitante: alta del negocio, publicar o
 * despublicar un equipo, reservar, vender, cambiar el TC o los datos del comercio.
 *
 * ## Sobre el `catch`
 * `updateTag` **sólo** se puede llamar desde una Server Action (tira `E872` en un Route Handler o
 * en un cron). Cuando eso pase, el fallback documentado es `revalidateTag(tag, { expire: 0 })`:
 * *"Stale content is never served, so the next request is a blocking revalidate/cache miss. Use it
 * when the caller needs the data gone immediately and you cannot use `updateTag`"*.
 *
 * El fallback existe porque acá la excepción llegaría **después** de que la escritura commiteó: el
 * negocio ya existe y hacer explotar la acción le mostraría un error a alguien cuyo alta salió
 * bien, dejando además el 404 cacheado. Degradar a la API equivalente y dejar rastro en el log es
 * estrictamente mejor. Si `revalidateTag` también falla, ahí sí propaga: eso ya no es "el contexto
 * equivocado", es el cache roto.
 */
export function invalidateStorefront(slug: string): void {
  for (const tag of [storefrontTag(slug), tenantConfigTag(slug)]) {
    try {
      updateTag(tag);
    } catch {
      // El slug no es PII y ya viaja en la URL pública. No se loguea nada más.
      logEvent('storefront.cache.update_tag_unavailable', { slug, tag });
      revalidateTag(tag, { expire: 0 });
    }
  }
}
