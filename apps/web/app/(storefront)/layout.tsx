import type { Metadata } from 'next';

/**
 * Shell de la **vidriera pública**. Route group `(storefront)`: no agrega segmento a la URL.
 *
 * ## Reglas que este layout hereda y que nadie puede aflojar acá adentro
 * - **Cero `headers()`, cero `cookies()`, cero `set-cookie`.** Un solo `set-cookie` server-side
 *   saca a la respuesta de los criterios de cacheabilidad del CDN de Vercel y manda el **100%** de
 *   los pageviews a la función y a Postgres. Es el modo más barato de reventar el costo por tenant.
 *   Corolario para analytics: PostHog y compañía, **client-side y nada más**.
 * - **Cero realtime, cero websocket, cero `useEffect` + `fetch` de listado.** El visitante
 *   es anónimo y el HTML ya viene con los datos.
 * - **Cero `"use client"`** salvo interacción real. Hoy: ninguna.
 *
 * ## `robots` acá es el PISO, y el camino negativo lo pisa (hallazgo MEDIUM-B)
 * `index: true` se queda. La vidriera real **se indexa a propósito**: `ARCHITECTURE.md` dice
 * explícito que es scrapeable por diseño y que servirle contenido distinto a Googlebot está
 * prohibido, y que Google la encuentre es parte del producto. Apagar el índice acá para tapar el
 * caso del slug muerto sería apagar la mitad del producto para arreglar un 404.
 *
 * Quién gana en el camino negativo, y por qué no es un accidente de qué rama corrió:
 * 1. `s/[slug]/page.tsx` → `generateMetadata()` devuelve `STOREFRONT_MISS_METADATA` con
 *    `robots: { index: false, follow: false }` cuando el tenant es `null`. La metadata de Next se
 *    mergea **por campo** y el segmento más profundo pisa al layout: `page` > `(storefront)/layout`
 *    > `app/layout`. Este es el camino principal y es determinista.
 * 2. `_components/storefront-miss.tsx` **además** renderiza `<meta name="robots"
 *    content="noindex, nofollow" />` dentro del propio `<main>` del miss, que React 19 iza al
 *    `<head>`. El cuerpo y la metadata son dos entradas de cache separadas con vidas propias, así
 *    que la capa 2 existe para que la directiva viaje soldada al DOM que la necesita.
 *
 * Corolario para el que edite este archivo: **cambiar `robots` acá no alcanza para cambiar el
 * comportamiento del miss**, y no tiene que alcanzar.
 *
 * ## Mobile-first de verdad
 * El caso de uso es una persona parada en la calle, con una mano, con 4G malo. De ahí:
 * `max-w-screen-sm` como base (el escritorio es la excepción), padding chico, tipografía grande y
 * cero layout shift por fuentes externas — se usa la `system-ui` de `globals.css`, que no descarga
 * un solo byte.
 */
export const metadata: Metadata = {
  // La vidriera SÍ se indexa: que Google la encuentre es parte del producto.
  robots: { index: true, follow: true },
  referrer: 'strict-origin-when-cross-origin',
};

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="storefront-shell mx-auto min-h-dvh w-full pb-16 pt-6">
      {children}
    </div>
  );
}
