import type { NextConfig } from 'next'

/**
 * Tres de estas opciones no son preferencias: son reglas del repo con consecuencia de plata o
 * de seguridad. Están comentadas para que nadie las "limpie" en un refactor.
 */
const nextConfig: NextConfig = {
  /**
   * Cache Components. Top-level en Next 16 — reemplaza a `experimental.dynamicIO` y a
   * `experimental.ppr`, que fueron REMOVIDOS en 16.0. Habilita `'use cache'`, `cacheLife` y
   * `cacheTag`, que es como la vidriera llega al objetivo de 95% de hits sin tocar Postgres.
   * Verificado contra el upgrade guide de Next 16.
   */
  cacheComponents: true,
  // La guia oficial de ISR with Cache Components pide los dos juntos: cacheComponents produce el
  // App Shell y partialPrefetching lo asciende a ruta completa cuando se conocen los params.
  //
  // Con una advertencia que NO es cosmetica y que decide una regla de lint: la doc dice que un
  // <Link prefetch={true}> sobre una ruta con partialPrefetching "costs a server invocation per
  // prefetchable link". En la grilla de la vidriera, con ~20 fichas visibles, eso son ~20
  // invocaciones por pageview en la unica pagina cuya economia depende de que el 95% de los hits
  // no invoquen nada. Por eso `prefetch={true}` esta PROHIBIDO en (storefront) — regla W008 de
  // scripts/web-lint.mjs. En el panel autenticado no aplica: ahi no hay grillas de 20 links y el
  // trafico es del duenio, no del mundo.
  partialPrefetching: true,

  /**
   * `taint` marca objetos que no pueden cruzar al cliente. Es la red de contención de
   * ARCHITECTURE.md §"Modelo de RLS": si un listing con `cost_usd` o `imei` se pasa a un
   * Client Component, el build rompe en vez de publicarlo.
   */
  experimental: {
    taint: true,
    // `forbidden()` renders the role boundary for a valid session with insufficient access.
    authInterrupts: true,

    /**
     * ════════════════════════════════════════════════════════════════════════════════════════
     *  Techo del body de las Server Actions. Cuatro techos, no uno, y el que manda NO es este.
     * ════════════════════════════════════════════════════════════════════════════════════════
     *
     * El default de Next es `'1 MB'` (`server/app-render/action-handler.js`: `defaultBodySizeLimit`),
     * y al pasarse tira `ApiError(413, 'Body exceeded ...')` — tambien en la rama multipart, que es
     * la que usa el alta con foto. O sea que sin esta linea una foto de celular no entra nunca.
     *
     * Pero subirlo no compra lo que parece. Debajo hay dos techos de plataforma que la config de la
     * app NO controla (verificados por el LEAD contra la doc oficial el 2026-08-27, no contra
     * memoria; ver `docs/research/vercel-request-body-limit.md`):
     *
     *   | techo                                    | valor  | quien lo pone                        |
     *   |------------------------------------------|--------|--------------------------------------|
     *   | este `bodySizeLimit`                     | 3.5 MB | nosotros                             |
     *   | Routing Middleware = nuestro `proxy.ts`   | **4 MB**   | Vercel (`/docs/routing-middleware`)  |
     *   | Vercel Function                          | 4.5 MB | Vercel (`/docs/functions/limitations`) |
     *
     * **El que manda es el de 4 MB**, no el de 4.5: el POST del alta no termina en una extension
     * conocida, asi que cae en el catch-all del `matcher` de `proxy.ts` y lo procesa el middleware.
     * Y NO lo sacamos del matcher para ganar esos 0.5 MB: el proxy es quien corre
     * `stripInboundTenantHeaders()`, y cambiar una defensa de tenant por medio mega es un mal
     * negocio. El 4 MB es el precio de esa defensa y se paga.
     *
     * Ninguno de los dos varia por plan: Vercel Pro no lo sube (la pagina que desglosa por plan,
     * `/docs/limits`, ni siquiera menciona el body size). Y **streaming no lo evade**: la frase
     * oficial "streaming functions don't have this limit" esta en la seccion del *response* body;
     * para el request, el remedio que documenta Vercel es subir directo al storage.
     *
     * Por eso 3.5 y no 4: queremos que el 413 lo tire **Next**, con nuestro mensaje, y no la
     * plataforma con una pagina en ingles. Y por eso el cap real por archivo es todavia mas bajo
     * (3 MB, en `_lib/listings/schema.ts`): Zod contesta en castellano antes que cualquier 413.
     *
     * Consecuencia de diseno, que es lo caro de todo esto: **entra UNA foto por request**. Tres
     * fotos de 3 MB son 9 MB y no comparten request ni con el techo mas alto de los cuatro.
     */
    serverActions: {
      bodySizeLimit: '3.5mb',
    },
  },

  /**
   * PROHIBIDO Vercel Image Optimization como default (CLAUDE.md §3). Las fotos ya salen de R2
   * redimensionadas a thumb/card/detail por `packages/media`, servidas por el CDN de Cloudflare
   * con egress $0. Pasarlas por el optimizador de Vercel sería pagar dos veces por el mismo byte.
   */
  images: {
    unoptimized: true,
  },

  typedRoutes: true,
  poweredByHeader: false,
  /**
   * Headers de seguridad globales para HTML, Server Actions y API routes. No agregamos CSP acá:
   * el login, Mercado Pago y los assets de R2 tienen orígenes externos que primero requieren un
   * inventario de runtime, y una CSP incompleta sería peor que no declararla.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
  reactStrictMode: true,
}

export default nextConfig
