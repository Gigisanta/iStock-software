---
name: r2-media
description: Pipeline de fotos - upload server-side, resize a variantes thumb/card/detail, keys opacas content-addressed en R2 y servido por CDN de Cloudflare con egress cero. Usar en cualquier código que toque imágenes.
---

# r2-media

**El motivo de R2 es egress $0.** Cualquier diseño que reintroduzca egress pago es un fallo de costo.

## Pipeline (única forma permitida)
```
celular del dueño (12MP, 4MB)
  → server action / route handler (upload server-side o presigned verificado)
  → sharp: 1600 / 800 / 200 px, WebP        (encode propio; NO transformaciones de CF Images)
  → istock-originals  (bucket PRIVADO)   master, sin public access, sin custom domain
  → istock-media      (bucket PÚBLICO)   v1/{ab}/{sha256_32}.webp  ← una key por variante
  → CDN Cloudflare (img.maat.work), Cache-Control immutable
  → <img> de la vidriera: `card` en grilla, `detail` en ficha
```
**Dos buckets, no uno.** El browser **nunca** ve credenciales de R2. El original **nunca** se sirve
—y desde el bucket privado tampoco es alcanzable.

## Variantes y presupuesto
| variante | lado mayor | techo | medido | uso |
|---|---|---|---|---|
| `thumb` | 200px | 25KB | | listas densas del panel |
| `card` | 800px | **150KB** | **49.5KB** | grilla de la vidriera |
| `detail` | 1600px | 400KB | | ficha |

Formato: **WebP** (calidad ~78). **AVIF ya se midió y se descartó**: con egress $0 el ahorro de bytes
no compra dólares, y cuesta 2-3× CPU de encode y duplica la cantidad de objetos. No lo re-abras sin
un número nuevo.

## Keys — opacas, content-addressed
```
v1/{ab}/{sha256_32}.webp
```
El hash es del byte de salida **de esa variante**. **Sin sufijo de variante, sin `tenant_id`, sin
`listing_id`**, sin IMEI, sin teléfono, sin nombre. Dos consecuencias, las dos son gate de review:

1. La vidriera deja de filtrar identificadores internos en su HTML. Una URL pública que **contenga
   o permita derivar** un identificador interno es rechazo (`CLAUDE.md` §2).
2. Desde la URL de `card` **no se puede derivar** la del master.

El mapeo `listing → keys` vive en Postgres con `tenant_id` + RLS. El hash permite cache inmutable
(`Cache-Control: public, max-age=31536000, immutable`), seteado con el parámetro **`CacheControl`
de `@aws-sdk/client-s3`** — `httpMetadata.cacheControl` es el binding de Workers y no existe en el
runtime Node de Vercel.

## Borrado: se borra el mapeo, no el byte
La key es content-addressed, así que **dos tenants que suban la misma foto comparten el objeto**.
Por lo tanto:

- Borrar un listing → `unlinkListingPhotos()`: borra **las filas del mapeo**.
- El objeto se recolecta aparte con `collectOrphanObjects()`, **sólo** cuando ningún tenant lo
  referencia.
- **`DeleteObjectCommand` por key en el camino de borrado de un listing es un borrado cruzado entre
  tenants y es rechazo automático** (`CLAUDE.md` §2).

"Huérfanos = storage que se paga para siempre" es cierto, pero se resuelve con el recolector, no
borrando el byte del vecino.

## Prohibiciones
- **Vercel Image Optimization** como default (se paga por transformación).
- **Supabase Storage** como CDN público de la vidriera.
- El master en un bucket R2 **público**.
- Subir la imagen sin resize "por ahora".
- Armar URLs de R2 a mano fuera de `packages/media`.
- Borrar un objeto de R2 por key al borrar un listing.

## API pública de `packages/media`
```ts
uploadListingPhoto(input): Promise<{ variants: Record<Variant, { key: string; bytes: number }> }>
variantUrl(key: string, v: Variant): string
variantUrls(...)  ·  cardSrcSet(...)  ·  publicUrlForKey(key: string): string
unlinkListingPhotos(listingId: string, deps): Promise<UnlinkListingPhotosResult>
collectOrphanObjects(deps): Promise<CollectOrphanObjectsResult>
```

## Métricas de costo a reportar
Class A ops (writes) por listing — **exactamente 4 `PutObject` por foto** · Class B ops (reads) por
pageview · GB almacenados por tenant · **bytes reales medidos** por variante (no los del techo).

## Aceptación
```
pnpm --filter @istock/media test
```
Con una imagen de referencia determinista: verifica que las 3 variantes se generan, que **ninguna**
supera su techo, y que la key **no contiene ningún identificador interno**. Los literales del techo
van duplicados dentro del test a propósito: leerlos de la constante hace que subir la constante
ponga el test en verde.
