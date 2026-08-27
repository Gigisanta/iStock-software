---
name: r2-media
description: Pipeline de fotos - upload server-side, resize a variantes thumb/card/detail, keys deterministas en R2 y servido por CDN de Cloudflare con egress cero. Usar en cualquier código que toque imágenes.
---

# r2-media

**El motivo de R2 es egress $0.** Cualquier diseño que reintroduzca egress pago es un fallo de costo.

## Pipeline (única forma permitida)
```
browser  →  server action / route handler  →  sharp resize  →  R2 (3 variantes)  →  CDN CF  →  <img>
```
El browser **nunca** ve credenciales de R2. El original de 12MP **nunca** se sirve.

## Variantes y presupuesto
| variante | lado mayor | techo | uso |
|---|---|---|---|
| `thumb` | 200px | 25KB | listas densas del panel |
| `card` | 800px | **150KB** | grilla de la vidriera |
| `detail` | 1600px | 400KB | ficha |

Formato: **WebP** (calidad ~78, ajustar midiendo). AVIF sólo si el costo de CPU del encode
se justifica contra el ahorro de bytes — **medilo antes de cambiar**.
El original se descarta o se archiva en clase fría; **jamás** se sirve.

## Keys
```
t/{tenantId}/l/{listingId}/{variant}/{contentHash}.webp
```
Sin IMEI, sin nombre de persona, sin teléfono en la key. El hash permite cache inmutable
(`Cache-Control: public, max-age=31536000, immutable`).

## Prohibiciones
- **Vercel Image Optimization** como default (se paga por transformación).
- **Supabase Storage** como CDN público de la vidriera.
- Subir la imagen sin resize "por ahora".
- Armar URLs de R2 a mano fuera de `packages/media`.
- Borrar un listing sin borrar sus objetos (huérfanos = storage que se paga para siempre).

## API pública de `packages/media`
```ts
uploadListingPhoto(input): Promise<{ key: string; variants: Record<Variant, string>; bytes: Record<Variant, number> }>
variantUrl(key: string, v: Variant): string
deleteListingPhotos(listingId: string): Promise<void>
```

## Métricas de costo a reportar
Class A ops (writes) por listing · Class B ops (reads) por pageview · GB almacenados por tenant ·
**bytes reales medidos** por variante (no los del techo).

## Aceptación
```
pnpm --filter @istock/media test
```
Con una imagen de referencia de 12MP: verifica que las 3 variantes se generan, que **ninguna** supera
su techo, y que la key no contiene datos sensibles.
