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

## Resolución host → tenant
```
Request Host
  ├─ maat.work / www          → marketing
  ├─ {slug}.maat.work         → storefront del tenant
  └─ *.vercel.app / localhost → dev (wildcard local vía nip.io)
```
El middleware **no** consulta Postgres por request: cache de `slug → tenantId`.
Slug inexistente → **404 real**, no redirect al home.
`[FASE 1]` Mecanismo exacto de wildcard y de cache del mapa → `docs/research/wildcard-isr.md` (R1).

## Cache e invalidación
Tags: `storefront:{slug}` y `listing:{id}`. Ver skill `isr-revalidate` para la lista completa de
mutaciones que **deben** invalidar. `revalidate` por tiempo es piso de seguridad, no el mecanismo.
`[FASE 1]` Semántica vigente de ISR + tags en Next/Vercel → R1.

## Camino de una foto
```
celular del dueño (12MP, 4MB)
  → upload server-side (o presigned verificado)
  → sharp: 1600 / 800 / 200 px, WebP
  → R2: t/{tenantId}/l/{listingId}/{variant}/{hash}.webp
  → CDN Cloudflare, Cache-Control immutable
  → <img> de la vidriera: variante `card` en grilla, `detail` en ficha
```
El original **no se sirve nunca**. `[FASE 1]` ¿transformaciones sobre R2 o encode propio con sharp?
→ `docs/research/r2-images.md` (R2), decidido por costo medido.

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
