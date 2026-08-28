import type { Metadata } from 'next';
import { STOREFRONT_HOME_PATH } from '../_lib/routes';

/**
 * **El equipo que ya no está.** El gemelo de `_components/storefront-miss.tsx`, un nivel más
 * abajo: aquél contesta *"¿existe esta vidriera?"* y éste contesta *"¿existe este equipo en esta
 * vidriera?"*. Un módulo con las dos mitades de la respuesta —el DOM que ve la persona y la
 * metadata que ve Google— por el mismo motivo que el otro: si el `<title>` y el `<h1>` viven en
 * archivos distintos, en tres meses dicen cosas distintas y nadie se entera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto es contenido de página y no un `notFound()`. Medido por el LEAD el 2026-08-28.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `s/[slug]/p/[listing]/page.tsx` **no llama `notFound()`**: cuando el loader devuelve `null`
 * renderiza esto como render normal. No es una preferencia de estilo — es lo que dio la medición
 * sobre el build de `eaccfee`, con `next start` bajo host de tenant y dos requests por caso:
 *
 * | caso | req 1 | req 2 | texto visible | robots |
 * |---|---|---|---|---|
 * | ficha real (`/p/iphone-13-128-medianoche`) | 200 | 200 | 974 chars | `index, follow` |
 * | slug inventado (`/p/iphone-99-pro-max-oro`) | **200** | 404 | **0 chars** | `noindex` |
 *
 * O sea: **exactamente el patológico de ADR-011, un nivel más abajo**. Bajo `cacheComponents` +
 * PPR el `notFound()` no pinta nada en el primer hit y recién es 404 en el segundo. El `<h1>` del
 * boundary viajaba sólo dentro del payload de Flight, JSON-escapado; en pantalla no había una
 * palabra.
 *
 * **Y el primer hit es el único que importa acá.** El caso real no es un bot probando ids: es el
 * link que el dueño pegó en un estado de WhatsApp hace tres semanas, abierto por alguien que nunca
 * entró a esta vidriera. Para esa persona *toda* request es la primera. Antes recibía `200` y
 * pantalla en blanco, que es la peor combinación posible: ni le decimos qué pasó, ni le ofrecemos
 * el resto del stock, ni el buscador se entera de que no hay nada.
 *
 * La salida es la que ya tomó ADR-011 en la raíz y la que el propio comentario de
 * `s/[slug]/p/[listing]/not-found.tsx` había fijado por adelantado: dejar de lanzar y devolver
 * este contenido. Se paga la misma deuda declarada — el miss deja de distinguirse por status code
 * en los logs de acceso — y se compra lo mismo: que la persona lea algo.
 *
 * ## Lo que hay que sostener acá adentro
 * - **DOM legible en la primera request.** Es todo el punto. `scripts/accept-s3.sh` M7 lo mide
 *   sobre el **texto visible** (strippea `<script>`/`<style>`/`<head>` y los tags), nunca sobre
 *   bytes: el HTML de un miss pesa ~20 KB de payload de RSC y "hay bytes" no prueba que haya una
 *   palabra.
 * - **El camino de vuelta al stock, también en texto visible.** El texto no se disculpa: el equipo
 *   se vendió, el negocio existe y tiene más. Cerrar la pestaña acá es perder la venta siguiente.
 * - **`noindex, nofollow` por dos caminos independientes.** Ver abajo.
 * - **Cero botón de WhatsApp.** No hay equipo ni precio que nombrar, así que no hay mensaje que
 *   escribir: el texto canónico de `CLAUDE.md` §1 nombra modelo y precio. Un `wa.me` genérico acá
 *   es exactamente el mensaje sin contexto que el producto existe para eliminar.
 * - **Cero JS de cliente, cero `set-cookie`, cero fetch.** HTML estático, cacheado con el perfil
 *   corto (`_lib/cache-life.ts`), no con `'max'`: el equipo puede volver a publicarse mañana.
 *
 * ## `robots` por dos caminos, igual que el miss de la raíz
 * `(storefront)/layout.tsx` declara `index: true` y así se queda (que Google encuentre la ficha
 * real es medio producto). El `noindex` del camino negativo gana por dos lados:
 * 1. `LISTING_MISS_METADATA` desde `generateMetadata` — la metadata de Next se mergea por campo y
 *    el segmento más profundo pisa al layout;
 * 2. el `<meta>` que emite este componente, que React 19 iza al `<head>`.
 *
 * No es redundancia decorativa: el cuerpo y la metadata son **dos entradas de cache distintas**,
 * con sus propios tiempos de vida, y la metadata además se stremea aparte del cuerpo. Con (2) la
 * directiva viaja soldada al DOM que la necesita — no existe el HTML que diga "este equipo ya no
 * está" sin decir también `noindex`. `accept-s3.sh` M7 chequea las dos polaridades: que el miss
 * vaya `noindex` **y** que la ficha real no.
 */

/**
 * El `<title>` y el `<h1>` del miss son **el mismo string**, y por eso es una constante: si
 * divergen, la pestaña dice una cosa y la pantalla otra, y nadie lo mira nunca.
 */
export const LISTING_MISS_TITLE = 'Este equipo ya no está publicado';

/**
 * `title.absolute` y **no** `title`: el template del layout raíz es `'%s · iStock'`, e `iStock` es
 * nombre código interno (`CLAUDE.md`, encabezado). Ni la ficha ni su miss pueden pegarle nuestro
 * nombre en la pestaña al cliente de un reseller.
 */
export const LISTING_MISS_METADATA: Metadata = {
  title: { absolute: LISTING_MISS_TITLE },
  robots: { index: false, follow: false },
};

export function ListingMiss() {
  return (
    <main data-storefront="listing-miss">
      {/* Capa 2 del `noindex`. Ver el docblock: va con el cuerpo, no con la metadata. */}
      <meta name="robots" content="noindex, nofollow" />

      <h1 className="mt-6 text-xl font-semibold leading-tight">{LISTING_MISS_TITLE}</h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Puede que se haya vendido o que el local lo haya dado de baja. El resto del stock sigue
        acá, con fotos, condición, batería, garantía y precio.
      </p>
      <p className="mt-5">
        {/*
          `STOREFRONT_HOME_PATH` y no `/` escrito a mano, y no una URL absoluta: bajo el host del
          tenant esto es la vidriera de ESTE negocio (el proxy reescribe `/` a `/s/{slug}`), nunca
          el apex de marketing. El porqué está una sola vez, en `_lib/routes.ts`.

          Mínimo 3rem de alto: es el objetivo táctil de alguien parado en la calle con una mano.
        */}
        <a
          href={STOREFRONT_HOME_PATH}
          className="inline-flex min-h-[3rem] items-center rounded-xl border border-neutral-300 px-4 text-sm font-semibold dark:border-neutral-700"
        >
          Ver el resto de la vidriera
        </a>
      </p>
    </main>
  );
}
