# ARCHITECTURE

_Qué es: cómo está armado el sistema — monorepo, host→tenant, cache, camino de una foto, RLS y
límites de confianza. Para quién: el que va a escribir código y necesita saber dónde encaja._
_Owner: **`docs-keeper`**. **FASE 1 la escribió el LEAD** (excepción declarada en `CLAUDE.md` §4),
sintetizando `docs/research/*.md`. Fecha: 2026-08-27._
_Corregido el 2026-08-28: esta línea decía `architect` **a partir de FASE 2** y contradecía la tabla
de `CLAUDE.md` §4. **Manda la tabla:** el rol `architect` era de FASE 1 y está dormido. Era la última
de las tres fuentes que decían cosas distintas — `INDEX.md` y el contrato de `docs-keeper` ya se
habían alineado._
_Cuándo se actualiza: cuando una slice cambia una invariante de arquitectura, o cuando una ADR nueva
la toca._
_Estado: **FASE 1 cerrada.** Todo lo que quedó abierto está nombrado en `## Pendiente`, con el
bloqueador y el experimento que lo cierra. Nada quedó sin decidir por olvido._

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
  proxy.ts                          host → tenant (storefront-agent)
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
- Slug inexistente → **página legible con `noindex, nofollow` y status 200**, cacheada con perfil
  corto (**ADR-011**). El 404 duro en la primera request es inalcanzable bajo `cacheComponents`:
  el status se decide antes de que resuelva el lookup del slug, y la única salida que sugiere Next
  —chequear en el proxy— cuesta una query a Postgres por pageview. **Deuda declarada de ADR-011:
  el miss deja de ser distinguible por status code en los logs de acceso.** Lo que se chequea en su
  lugar (`scripts/accept-s1.sh` A3/A4): `<h1` literal, `noindex`, título propio, cero markup de
  vidriera, req2 en `HIT`. Corolario operativo **intacto**: **el alta de un tenant tiene que
  invalidar el tag de su propio slug**, o la respuesta negativa queda cacheada y la vidriera nace
  muerta.
- El proxy corre **antes** del cache → se factura en el 100% de los pageviews, incluso en HIT.
  Presupuesto: **< 2 ms de CPU, 0 red**. Es un assert de `cost-auditor`.
- El proxy **no es un control de acceso**: un `matcher` que excluye un path también saltea las
  Server Functions de ese path. La autorización va dentro de cada Server Function.

### Qué NO se reescribe, aunque el host sea de un tenant  ·  agregado en S2
Tres espacios de URL son **globales al deploy** y el proxy los deja pasar antes de mirar el host
(`proxy.ts`, guardas en `(storefront)/_lib/host.ts`):

| path | qué pasa | por qué |
|---|---|---|
| `/_next/**`, `/__nextjs*` | passthrough | es el runtime de la app; reescribirlo rompe el RSC payload |
| `/_media/**` (y la forma `%5Fmedia`) | passthrough | la key es content-addressed (ADR-006): sin `tenant_id` adentro, **dos tenants comparten el objeto**. Reescribir a `/s/{slug}/_media/…` deja sin fotos a **todas** las vidrieras |
| `/s/**` | 404 del proxy, sin invocar la app | es el destino interno del rewrite, no una URL pública |

**`/api/**` bajo un host de tenant se reescribe a `/s/{slug}/api/…` y da 404. Eso es querido, no
una fuga.** El panel y sus endpoints viven en el apex; `app` y `api` son labels reservados
(`host.test.ts`), así que no hay un `api.maat.work` que sea tenant. Si alguien lo reporta como bug,
la respuesta es esta línea: no se "arregla" agregando `/api` a los passthrough — eso haría que la
API del apex sea alcanzable desde el dominio de cualquier tenant.

**Los file conventions de metadata sí se reescriben — cerrado el 2026-08-28 (ADR-015, commit
`117c4f0`).** El hueco que esta sección declaraba abierto (un `icon.png` por tenant caía en la
exclusión por extensión del `matcher` y el visitante de `acme.maat.work` recibía el ícono del apex)
está corregido. **El criterio del matcher ya no es el sufijo: es el nombre**, que es el mismo que
usa Next para decidir una convención. `/icon.png` es ruta de la app y entra al proxy; `/logo.png` es
un asset y no entra — por sufijo esas dos URLs son indistinguibles, y ése era el bug. Las 25 URLs de
metadata siguen entonces la regla general de host, y bajo un host de tenant dan **404 mientras S3 no
las implemente: eso es correcto y está argumentado en ADR-015**, no es un pendiente. Dato que
sostiene todo el análisis: **`apps/web/public/` no existe**, así que la exclusión por sufijo que
había antes no protegía ningún archivo.

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

## Modelo de RLS  ·  **cerrado en FASE 1 (ADR-005, R7 PASS)**
Toda tabla de negocio: `tenant_id` + RLS **forzada** + policies de las 4 operaciones con `with check`.

`tenant_id` viaja en `auth.jwt() -> 'app_metadata'`, alimentado por el Custom Access Token Hook
desde `memberships`, que es la fuente de verdad.

Forma obligatoria de toda policy: `(select auth.jwt() ...)` **siempre en subquery** · `TO
authenticated` **siempre** · índice en `tenant_id` **siempre** · `WITH CHECK` en INSERT/UPDATE
**siempre**. Vistas con `security_invoker = on`. **Vistas materializadas y foreign tables no se
exponen a la API** — RLS no aplica sobre ellas.

**`tenant_id` jamás en `user_metadata`**: el usuario puede escribirlo, es escalación de tenant
directa (lint `0015`, ERROR).

**Deuda declarada: el claim queda stale hasta 3600 s.** Toda operación de membresía o billing
**re-lee `memberships`** en vez de confiar en el claim; un usuario expulsado conserva acceso hasta
que rote su token.

**Gate de merge, sin excepción:** los seis lints de Supabase de severidad ERROR — `0002`, **`0007`**,
`0010`, `0013`, `0015`, `0023`. `0007` (policies escritas + RLS apagado) es el que más se parece a
"ya está hecho"; es el que hay que mirar primero.

**Defensa en profundidad además de RLS:** DAL único en `server-only` · DTOs como `class`, para que
bajar el objeto entero **rompa el build** · `experimental.taint: true` · filtro de tenant explícito
en la query (`CLAUDE.md` §5).

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
| LCP mobile 4G | **≤ 2.5 s** (umbral "good" de Core Web Vitals) |
| CPU del proxy por pageview | **< 2 ms**, 0 llamadas de red |
| `set-cookie` en `(storefront)` | **cero** — uno solo apaga el CDN entero |

## Seguridad de la vidriera y del chatbot (R7 PASS)
- Anti-bot vive **en el edge de Vercel** (managed rulesets + WAF rate limit), **nunca en la app**:
  filtrar dentro de la app fragmenta el cache ISR. Presupuesto: **2 reglas**.
  **Corregido el 2026-08-28 contra `config/firewall-rules.json` (T1): las 2 reglas son `/api/track`
  y `/api/chat`, no "vidriera + chatbot".** La regla de vidriera —condición por `host`— se propuso y
  **se rechazó**: el rate limit se factura por *allowed requests*, o sea los que matchean **y
  pasan**, así que le cobraría peaje a cada pageview de la vidriera, que es exactamente lo que la
  viñeta de abajo declara scrapeable a propósito. Para abuso masivo del HTML la palanca es **Attack
  Challenge Mode**, gratis. Las reglas **no** van en `vercel.json` (su schema no tiene `rate_limit`)
  y se aplican por CLI, que no es parte del build: `SLICE_BOARD.md` §T1.
- **Cloudflare es sólo R2.** Nunca un proxy delante de Vercel: rompe Bot Protection.
- **La vidriera es scrapeable por diseño.** Se defiende lo que cuesta plata (chatbot, queries a
  Postgres), no el HTML público. **Prohibido servir contenido distinto a Googlebot** (cloaking).
- Chatbot: **sin memoria persistente, sin tools de escritura, sin embeddings por tenant.** El
  `tenant_id` **no es argumento de ninguna tool** — se inyecta server-side desde el host. La salida
  se renderiza como **texto plano**: sin markdown, sin imágenes, sin links. Sanitizador de Unicode
  invisible en el ingest de descripciones y en el render.
- Los contadores del WAF son **por región** → el límite global efectivo es N×límite. El cap de costo
  de LLM necesita **además** un contador de tokens por tenant en DB — en rutas autenticadas, nunca
  en la vidriera.

## Pendiente
| qué | bloqueado por | cómo se cierra |
|---|---|---|
| Modelo de integración con MP | **B3** · ADR-008 | 4 experimentos de sandbox |
| Región de funciones (`iad1` vs `gru1`) | ADR-010 | medir latencia real contra el Alto Valle |
| ¿`revalidateTag` scopeado por dominio? | primer deploy con wildcard | test de 20 min, **antes de S3** |
| Precio de Supabase Pro | **B2** | mirarlo al crear el proyecto |
| Supuestos de tráfico de `COST.md` | primera vidriera real | medir, no estimar |

Research cerrado: `[R1]` `[R2]` `[R3]` `[R5]` `[R6]` `[R7]` PASS · **`[R4]` PARCIAL** (regla 3).
