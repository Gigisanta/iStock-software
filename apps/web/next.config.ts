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

  /**
   * `taint` marca objetos que no pueden cruzar al cliente. Es la red de contención de
   * ARCHITECTURE.md §"Modelo de RLS": si un listing con `cost_usd` o `imei` se pasa a un
   * Client Component, el build rompe en vez de publicarlo.
   */
  experimental: {
    taint: true,
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
  reactStrictMode: true,
}

export default nextConfig
