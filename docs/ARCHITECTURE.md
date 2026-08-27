# ARCHITECTURE

_Owner: `architect`. **Se completa en FASE 1** con la síntesis de `docs/research/*.md`._
_Estado: esqueleto + invariantes ya decididas. Las secciones marcadas `[FASE 1]` esperan research._

## Invariantes (ya decididas, no dependen del research)

1. **Un solo proyecto Supabase** para todos los tenants. Aislamiento por `tenant_id` + RLS.
   Nunca schema-per-tenant, nunca un proyecto por cliente.
2. **La vidriera es casi estática.** Objetivo: **95% de los hits no tocan Postgres.**
3. **Las fotos salen de Cloudflare R2** por CDN de Cloudflare. Egress $0. Jamás de Vercel ni
   de Supabase Storage.
4. **Realtime sólo en el panel autenticado.** Cero conexiones persistentes para anónimos.
5. **`packages/domain` es TS puro.** Es el único lugar donde vive una regla de negocio.
6. **El LLM nunca está en el camino de un pageview.** Sólo responde a un mensaje explícito.

## Mapa del monorepo
```
apps/web
  app/(marketing)      /            público, estático
  app/(storefront)     por host     público, ISR, cero JS de datos
  app/(app)            /app/*       autenticado, RSC + server actions
  app/(billing)        /billing/*   MP + webhooks
  app/api/*                         handlers, Zod en el borde
  middleware.ts                     host → tenant (storefront-agent)
packages/db            Drizzle, migraciones, RLS, seed        (db-agent)
packages/domain        TS puro, cero I/O                      (domain-agent)
packages/ai            chatbot, dieta, tools, evals           (ai-agent)
packages/media         R2 + variantes                         (media-agent)
```

## Resolución host → tenant  ·  **cerrado en FASE 1 (ADR-007, R1 PASS)**
```
Request Host                          proxy.ts (Node.js, O(1), 0 I/O)
  ├─ maat.work / www          →  passthrough        → marketing
  ├─ {slug}.maat.work         →  rewrite /s/{slug}  → app/(storefront)/s/[slug]/...
  └─ *.localhost / *.nip.io   →  idem               → dev
```
- El archivo es **`proxy.ts`**, no `middleware.ts` (renombrado en Next 16.0; runtime Node.js, no
  configurable).
- **El proxy no consulta nada y no cachea nada en memoria.** No hay `Map` de `slug → tenantId`:
  el proxy corre fuera del runtime de la app y la doc dice explícito que no dependas de módulos
  ni globals compartidos. Parsea el host, valida el slug con un regex, reescribe. Nada más.
- **El slug viaja como segmento de path, jamás como header.** `headers()` dentro de `'use cache'`
  vuelve la ruta dinámica y mata el ISR; y el key de `'use cache'` **no incluye el host**, así que
  sin el slug en los argumentos dos tenants comparten entrada de cache. Ver ADR-007 §4.
- El slug se resuelve a tenant **dentro de la página cacheada**: 1 query en el miss, 0 en el hit.
- Slug inexistente → **404 real** y cacheable. Corolario operativo: **el alta de un tenant tiene
  que invalidar el tag de su propio slug**, o el 404 negativo queda cacheado y la vidriera nace
  muerta.
- El proxy corre **antes** del cache → se factura en el 100% de los pageviews, incluso en HIT.
  Presupuesto: **< 2 ms de CPU, 0 red**. Es un assert de `cost-auditor`.
- El proxy **no es un control de acceso**: un `matcher` que excluye un path también saltea las
  Server Functions de ese path. La autorización va dentro de cada Server Function.

## Cache e invalidación  ·  **cerrado en FASE 1 (ADR-007, R1 PASS)**
`cacheComponents: true` · `'use cache'` · `cacheTag(...)` · `cacheLife('max')` ·
`revalidateTag(tag, perfil)` (la forma de 1 argumento está deprecada) · `updateTag(tag)` en Server
Actions para read-your-writes del panel.

Tags: `storefront:{slug}` · `listing:{unit_id}` · `tenant-config:{slug}`.
Los tags están scopeados a **proyecto + environment, no a dominio** → **un tag sin slug purga a
todos los tenants**. Límites: 128 tags/respuesta, 256 bytes/tag, 16 tags por bulk REST.

**`cacheLife` es una decisión de costo, no de UX:** `'max'` + invalidación por evento ≈
USD 0.012/tenant/mes en ISR Writes; `revalidate: 60` ≈ USD 2.59/tenant/mes — 13% del plan Base,
solo eso ya revienta el objetivo de < USD 0.50.

**Un `set-cookie` server-side en la vidriera desactiva el cache del CDN entero** y manda el 100%
de los pageviews a la función y a Postgres. Grep de `set-cookie` en `(storefront)` = cero.

Ver skill `isr-revalidate` para la lista completa de mutaciones que **deben** invalidar.

> **Riesgo abierto (confianza media en R1):** dos docs oficiales de Vercel se contradicen sobre si
> `revalidateTag` está scopeado por dominio. Se dirime con un test de 20 min en el primer deploy
> con wildcard, **antes de S3**. Si estuviera scopeado por dominio, la invalidación cross-host
> desde el panel es un no-op silencioso y la mutación tiene que golpear un Route Handler en el
> host del tenant.

## Camino de una foto  ·  **cerrado en FASE 1 (ADR-006, R2 PASS)**
```
celular del dueño (12MP, 4MB)
  → upload server-side (o presigned verificado)
  → sharp: 1600 / 800 / 200 px, WebP           (encode propio; NO transformaciones de CF Images)
  → istock-originals  (bucket PRIVADO)   master, sin public access, sin custom domain
  → istock-media      (bucket PÚBLICO)   v1/{ab}/{sha256_32}.webp   ← una key por variante
  → CDN Cloudflare (img.maat.work), Cache-Control immutable
  → <img> de la vidriera: `card` en grilla, `detail` en ficha
```
**Dos buckets, no uno.** El master vive en un bucket privado alcanzable sólo por S3 API
server-side. El original **no se sirve nunca** — y ahora tampoco es *alcanzable*.

**La key pública es opaca y no dice nada.** El hash es del byte output **de esa variante**, sin
sufijo de variante, sin `tenant_id` y sin `listing_id`. Dos consecuencias: la vidriera deja de
filtrar identificadores internos en su HTML, y desde la URL de `card` **no se puede derivar** la
del master. El mapeo `listing → keys` vive en Postgres con `tenant_id` + RLS.

**Trampa conocida de la key content-addressed:** dos tenants que suban la *misma* foto comparten
el mismo objeto. Por lo tanto **el borrado de un listing nunca borra el objeto de R2 directamente**:
se borra la fila del mapeo y el objeto sólo se recolecta cuando ningún tenant lo referencia.
Borrar por key es un borrado cruzado entre tenants. Es gate de review de S2.

**`Cache-Control` se setea con el parámetro `CacheControl` de `@aws-sdk/client-s3`**, no con
`httpMetadata.cacheControl` (eso es el binding de Workers y no existe en el runtime Node de
Vercel). Hacerlo mal deja los objetos sin `Cache-Control` y con edge TTL default de 120 min.

Costo: USD 0.00–0.09/mes a 100 tenants; USD 2.16/mes esperado a 1.000 (tope USD 14.76 con 0% de
cache hit). Cloudflare Images se descartó: USD 165–465/mes a la misma escala.

## Modelo de RLS
Toda tabla de negocio: `tenant_id` + RLS forzada + policies de las 4 operaciones con `with check`.
`[FASE 1]` Forma exacta del claim de tenant (JWT custom claim vs `memberships` + `auth.uid()`)
→ ADR en `DECISIONS.md`, informada por R7.

## Jobs
Vercel Cron (o Inngest free) para expirar reservas. **Sin worker 24/7.**
Idempotente: correr el cron dos veces no rompe nada.

## Límites de confianza
| desde | hacia | qué puede cruzar |
|---|---|---|
| DB | vidriera | **sólo** `publicListingDTO` |
| DB | seller | todo menos `cost_usd`/margen |
| dueño (texto libre) | prompt del LLM | **sanitizado y delimitado** |
| cliente | server | **nada** sin Zod |

## Presupuesto de performance de la ficha pública
| ítem | techo |
|---|---|
| imagen `card` | 200KB |
| DB hits en caso cacheado | 0 |
| JS de cliente | mínimo (RSC) |
| LCP mobile 4G | `[FASE 1]` número concreto a fijar |

## Pendiente de FASE 1
`[R1]` wildcard + ISR · `[R2]` costo de imágenes · `[R3]` IDs y precios de LLM ·
`[R4]` MP Subscriptions · `[R5]` ENACOM · `[R6]` catálogo AR · `[R7]` amenazas.
