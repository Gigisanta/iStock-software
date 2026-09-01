import type { MetadataRoute } from 'next'

const BRAND_ASSET_VERSION = 'maatwork-mw-20260901'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'iStock · MaatWork',
    short_name: 'iStock',
    description: 'Stock y vidriera online para revendedores de celulares.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#0A0A11',
    icons: [
      { src: `/icon-mw.svg?v=${BRAND_ASSET_VERSION}`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: `/icon-mw-192.png?v=${BRAND_ASSET_VERSION}`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: `/apple-touch-mw.png?v=${BRAND_ASSET_VERSION}`, sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  }
}
