import type { Metadata } from 'next';
import { STOREFRONT_DOMAIN } from '@istock/domain';

/**
 * **El slug que no es de nadie.** Un único módulo con las dos mitades de esa respuesta: el DOM que
 * ve la persona y la metadata que ve Google. Están juntas a propósito — ver "Por qué un módulo y no
 * dos archivos", abajo.
 *
 * ## Qué respuesta es esta (ADR-011, variante B)
 * `s/[slug]/page.tsx` **no llama `notFound()`**: cuando el lookup del tenant devuelve `null`,
 * renderiza esto como contenido normal de la página. La consecuencia visible es que el status es
 * `200`, no `404`, y eso es una deuda declarada por el LEAD en ADR-011, no un descuido. El motivo
 * está medido y escrito en el docblock de `page.tsx`.
 *
 * Lo que reemplaza al status code, y lo que hay que sostener acá adentro:
 * - **DOM legible de verdad.** Un `<h1>` que la persona lee. Es lo único que `notFound()` no daba.
 * - **`noindex, nofollow`**, por dos caminos independientes (ver abajo).
 * - **Cero markup de vidriera.** Ni un `wa.me`, ni un precio, ni una tarjeta de equipo. Si esta
 *   pantalla se pareciera a una vidriera vacía, un `200` sería un soft 404 de verdad y nadie lo
 *   notaría. `scripts/accept-s1.sh` A3/A4 lo chequea con grep sobre el HTML servido.
 * - **Cero `set-cookie`, cero JS de cliente, cero fetch.** Es HTML estático y se cachea con el
 *   perfil corto (`STOREFRONT_MISS_LIFE`), no con `'max'`.
 *
 * ## Por qué un módulo y no dos archivos
 * El texto vive **una sola vez**. `page.tsx` lo renderiza en el camino negativo y
 * `s/[slug]/not-found.tsx` lo renderiza si alguna vez algo tira `notFound()` dentro del segmento
 * (hoy no lo tira nadie; mañana la ficha de S3/S4 sí puede, para un id de listing que no existe).
 * Dos copias del mismo párrafo derivan, y la que deriva es siempre la que nadie mira.
 *
 * ## El texto ya no dice "Error 404"
 * Decía `Error 404` cuando la respuesta era un 404. Bajo la variante B el status es `200`, así que
 * ese renglón habría pasado a ser lo único falso de la pantalla. Dice qué pasó ("dirección sin
 * vidriera"), que es lo que la persona necesita, y no finge un código de estado que no se emitió.
 *
 * ## `robots` por dos caminos, a propósito (defensa en profundidad, hallazgo MEDIUM-B)
 * `(storefront)/layout.tsx` declara `robots: { index: true, follow: true }` y **así se queda**: que
 * Google encuentre la vidriera real es parte del producto (`ARCHITECTURE.md`: la vidriera es
 * scrapeable por diseño, y servirle contenido distinto a Googlebot está prohibido). Entonces el
 * `noindex` del camino negativo tiene que **ganar**, y gana así:
 *
 * 1. `STOREFRONT_MISS_METADATA` lo devuelve `generateMetadata` en la rama `tenant === null`. La
 *    metadata de Next se mergea por campo y **el segmento más profundo pisa al layout**, así que
 *    `index: false` reemplaza al `index: true` del layout. Este es el camino principal.
 * 2. El propio componente emite `<meta name="robots" content="noindex, nofollow" />`, que React 19
 *    iza al `<head>`. Esto **no** es redundancia decorativa: el cuerpo y la metadata son
 *    **dos entradas de cache distintas** (Next resuelve la metadata en su propio boundary), con sus
 *    propios tiempos de vida. La rama de metadata puede resolverse desde una entrada distinta que
 *    la del cuerpo. Con (2), la directiva viaja **soldada al DOM que la necesita**: no existe el
 *    HTML que diga "no hay vidriera acá" sin decir también `noindex`.
 *
 * Hay un segundo motivo, y está en la doc de Next
 * (`node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md:119-127`):
 * *"For dynamically rendered pages, Next.js streams metadata separately, injecting it into the
 * HTML once `generateMetadata` resolves"*. La metadata del camino (1) llega **después** del cuerpo
 * en el stream; la del camino (2) sale con el cuerpo. Para los bots que Next detecta por
 * User-Agent el streaming se apaga y (1) alcanza — pero la lista de bots es un regex de terceros
 * que se actualiza sin avisarnos, y ese regex **no se puede tocar** acá: es el mismo que alimenta
 * `experimentalBypassFor` y ampliarlo apaga el cache de toda la vidriera (ver `page.tsx`).
 *
 * Sí, en el camino negativo salen dos `<meta name="robots">` idénticos. Es el mismo trato que
 * `where slug = ...` **además** de RLS (`CLAUDE.md` §5): dos capas que dicen lo mismo, y si una
 * falla, la otra sigue en pie. Ante directivas repetidas los buscadores toman la más restrictiva, y
 * acá las dos son la misma.
 */

/**
 * El `<title>` y el `<h1>` del miss son **el mismo string**, y por eso es una constante: si
 * divergen, la pestaña dice una cosa y la pantalla otra, y nadie lo mira nunca.
 */
export const STOREFRONT_MISS_TITLE = 'No hay ninguna vidriera en esta dirección';

/**
 * `title.absolute` y **no** `title`: el template del layout raíz es `'%s · iStock'`, e `iStock` es
 * **nombre código interno** (`CLAUDE.md`, encabezado). La vidriera es la marca del reseller; ni el
 * miss ni la home pueden pegarle nuestro nombre en la pestaña del visitante.
 */
export const STOREFRONT_MISS_METADATA: Metadata = {
  title: { absolute: STOREFRONT_MISS_TITLE },
  robots: { index: false, follow: false },
};

export function StorefrontMiss() {
  return (
    <main data-storefront="miss" className="flex min-h-[70dvh] flex-col justify-center">
      {/* Capa 2 del `noindex`. Ver el docblock de arriba: va con el cuerpo, no con la metadata. */}
      <meta name="robots" content="noindex, nofollow" />

      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        Dirección sin vidriera
      </p>
      <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
        {STOREFRONT_MISS_TITLE}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Revisá el link: cada negocio tiene su propia dirección con la forma{' '}
        <span className="font-mono text-neutral-900 dark:text-neutral-100">
          nombre.{STOREFRONT_DOMAIN}
        </span>
        . Si te lo pasó el vendedor por WhatsApp, pedile que te lo reenvíe completo.
      </p>
    </main>
  );
}
