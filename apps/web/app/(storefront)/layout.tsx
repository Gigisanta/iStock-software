import type { Metadata } from 'next';

/**
 * Shell de la **vidriera pública**. Route group `(storefront)`: no agrega segmento a la URL.
 *
 * ## Reglas que este layout hereda y que nadie puede aflojar acá adentro
 * - **Cero `headers()`, cero `cookies()`, cero `set-cookie`.** Un solo `set-cookie` server-side
 *   saca a la respuesta de los criterios de cacheabilidad del CDN de Vercel y manda el **100%** de
 *   los pageviews a la función y a Postgres. Es el modo más barato de reventar el costo por tenant.
 *   Corolario para analytics: PostHog y compañía, **client-side y nada más**.
 * - **Cero Supabase Realtime, cero websocket, cero `useEffect` + `fetch` de listado.** El visitante
 *   es anónimo y el HTML ya viene con los datos.
 * - **Cero `"use client"`** salvo interacción real. Hoy: ninguna.
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
    <div className="mx-auto min-h-dvh w-full max-w-screen-sm px-4 pb-16 pt-6 sm:px-6">{children}</div>
  );
}
