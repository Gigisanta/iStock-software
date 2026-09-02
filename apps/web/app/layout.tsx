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
  metadataBase: new URL('https://istock.maat.work'),
  title: { default: 'iStock', template: '%s · iStock' },
  description:
    'Stock y vidriera online para revendedores de celulares: cargá tus equipos una vez y recibí consultas informadas.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  icons: {
    icon: [
      { url: '/icon-mw.svg?v=maatwork-mw-20260901', type: 'image/svg+xml' },
      { url: '/favicon-mw-32.png?v=maatwork-mw-20260901', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-mw.ico?v=maatwork-mw-20260901', type: 'image/x-icon' },
    ],
    shortcut: ['/favicon-mw.ico?v=maatwork-mw-20260901'],
    apple: [{ url: '/apple-touch-mw.png?v=maatwork-mw-20260901', sizes: '180x180', type: 'image/png' }],
    other: [{ rel: 'mask-icon', url: '/mask-mw.svg?v=maatwork-mw-20260901', color: '#0A0A11' }],
  },
  manifest: '/manifest.webmanifest?v=maatwork-mw-20260901',
  openGraph: {
    type: 'website',
    siteName: 'MaatWork',
    title: 'iStock — vidriera y stock para revendedores de celulares',
    description:
      'Stock y vidriera online para revendedores de celulares: cargá tus equipos una vez y recibí consultas informadas.',
    images: [{ url: '/og-image.png?v=maatwork-mw-20260901', width: 1200, height: 630, alt: 'iStock · MaatWork' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'iStock — vidriera y stock para revendedores de celulares',
    description:
      'Stock y vidriera online para revendedores de celulares: cargá tus equipos una vez y recibí consultas informadas.',
    images: ['/twitter-image.png?v=maatwork-mw-20260901'],
  },
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
