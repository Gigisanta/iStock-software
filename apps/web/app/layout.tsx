import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * Root layout COMPARTIDO por las tres caras (marketing, panel, vidriera). Lo escribe el LEAD
 * a proposito: es el unico archivo de `app/` que tres owners distintos necesitan, y dejarlo sin
 * dueño garantizaba una carrera entre `app-agent` y `storefront-agent`.
 *
 * Regla que hereda toda la vidriera: aca NO se leen `headers()`, NO se leen cookies y NO se
 * escribe `set-cookie`. Un solo `set-cookie` server-side en `(storefront)` apaga el cache del
 * CDN entero y manda el 100% de los pageviews a la funcion y a Postgres
 * (ARCHITECTURE.md §"Presupuesto de performance").
 *
 * Cada grupo de rutas pone su propio `metadata`; el de aca es el piso, no el titulo real.
 */
export const metadata: Metadata = {
  title: { default: 'iStock', template: '%s · iStock' },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  )
}
