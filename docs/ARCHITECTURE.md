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

1. **Un solo proyecto Neon Postgres** para todos los tenants, con Neon Auth como identidad canónica.
   Aislamiento por `tenant_id` + RLS; `auth.users` sólo conserva un espejo UUID compatible para las FK.
   Nunca schema-per-tenant, nunca un proyecto por cliente.
2. **La vidriera es casi estática.** Objetivo: **95% de los hits no tocan Postgres.**
3. **Las fotos salen de Cloudflare R2** por CDN de Cloudflare. Egress $0. Jamás de Vercel ni
   de Supabase Storage.
4. **Sin Realtime en el camino crítico.** El panel usa Server Components/Actions; cero conexiones
   persistentes para anónimos.
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
packages/db            Drizzle, migraciones, RLS, seed        (db-agent; scripts/ del LEAD)
packages/domain        TS puro, cero I/O                      (domain-agent)
packages/ai            chatbot, dieta, tools, evals           (ai-agent; scripts/ del LEAD)
packages/media         R2 + variantes                         (media-agent)
```
**Los `scripts/` de un paquete no son del paquete.** Es del **LEAD** todo script que un
`package.json` del repo corra como `lint`, `guard`, `check`, `verify` o `audit`, viva donde viva
(`CLAUDE.md` §4, **ADR-022** + su enmienda del 2026-08-28). **La regla no mira el nombre del archivo,
mira qué hace** — y por eso es censable en un comando en vez de ser una lista que hay que recordar.
Censado el 2026-08-28 son **seis**, y **cinco viven adentro del directorio del writer que auditan**:

| gate | lo corre | audita el código de | lo escribió | se declara |
|---|---|---|---|---|
| `apps/web/scripts/web-lint.mjs` | `apps/web` `lint` | `app-agent` + `storefront-agent` | LEAD (`d37e6b3`) | `gate-owner: LEAD` |
| `packages/db/scripts/rls-lint.mjs` | `packages/db` `lint` | `db-agent` | `db-agent` (`63abcb7`) | `gate-owner: LEAD` |
| `packages/ai/scripts/ai-lint.mjs` | `packages/ai` `lint` | `ai-agent` | `ai-agent` (`d42fac9`) | `gate-owner: LEAD` |
| `packages/media/scripts/media-lint.mjs` | `packages/media` `lint` | `media-agent` | `media-agent` (`2027fc9`) | `gate-owner: LEAD` |
| `tests/scripts/qa-lint.mjs` | `tests` y `e2e` `lint` | `qa-agent` | `qa-agent` (`81da33f`) | `gate-owner: LEAD` |
| `packages/domain/scripts/purity-check.mjs` | `packages/domain` `lint` | `domain-agent` | `domain-agent` (`9843902`, slice D1) | `gate-owner: LEAD` |

**La sexta fila es la que obligó a reescribir la regla.** `purity-check.mjs` **no termina en
`-lint.mjs`**, así que la versión anterior de ADR-022 —que nombraba ese sufijo— no lo alcanzaba y lo
dejaba adentro de `packages/domain/**`, o sea del writer cuya pureza audita. Una regla que nombra un
sufijo falla igual que la que nombraba un archivo.

Los cinco de abajo son **anteriores** a `6952393`, así que ninguno es una infracción; desde ese
commit los seis son del LEAD y sus autores **piden en vez de editar**. El corte no es jerárquico: un
gate no puede ser del writer que audita.

**Y no se sostiene en que alguien lea este párrafo.** Los seis llevan la marca literal
`gate-owner: LEAD` en su encabezado, y la exige la sección **G3** de `scripts/guard-gates.sh`, que
enumera los `package.json`, resuelve el target de cada script de gate y falla si la marca no está en
las primeras 40 líneas. Censa **siete** targets: los seis de acá más `scripts/guard-artifacts.sh`
—que corre desde el `guard` de la raíz y está **exento** de marca, porque `scripts/**` ya es del LEAD
por fila propia de §4—. También es `FAIL` el gate fantasma (el `package.json` lo corre y el archivo
no está) y el censo vacío. Un gate nuevo escrito por el writer que audita rompe **el día que nace**.
Al 2026-08-28 esto está **en el árbol de trabajo, sin commitear** (fila **T28** del board).

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

**`/api/**` bajo un host de tenant se reescribe a `/s/{slug}/api/…`.** El panel y sus endpoints
viven en el apex; `app` y `api` son labels reservados (`host.test.ts`), así que no hay un
`api.maat.work` que sea tenant. **No se "arregla" agregando `/api` a los passthrough** — eso haría
que la API del apex sea alcanzable desde el dominio de cualquier tenant.

**Esta línea decía *"y da 404"*, y desde S4 eso es falso — corregido el 2026-08-28 al cerrar S8.**
El destino del rewrite **existe** para las rutas que la vidriera tiene a propósito, y hoy son dos:
`/s/[slug]/api/track` (el beacon de WhatsApp, S4) y `/s/[slug]/api/tradein` (el formulario de canje,
S8). El 404 sigue siendo la respuesta para todo lo demás, y **el mecanismo no cambió**: el rewrite
lleva el slug en el **path**, así que un endpoint de la vidriera sólo existe si alguien lo escribió
bajo `(storefront)/s/[slug]/api/`. Lo que cambió es que ahora hay dos, las dos son escrituras **sin
autenticar**, y las dos tienen techo de WAF declarado en `config/firewall-rules.json`. Es un dato
que hay que tener a mano antes de leer *"la vidriera no tiene DB propia"* como *"la vidriera no
escribe"*: escribe, en dos tablas, como `anon` y a través de una policy — ver §"La superficie de
escritura sin autenticar".

**El panel entero (`/app/**`) entra al matcher desde S8 (`ab3af3a`), y no por routing.** El proxy no
tiene nada que reescribirle al panel; entra porque **`stripInboundTenantHeaders()` no puede ser
opcional en el subárbol autenticado**. `/app/canjes/[id]` fue la primera ruta de `/app` con el
segmento dinámico al final, así que `/app/canjes/basura-991.json` matchea la ruta **y** caía en la
exclusión por sufijo del matcher: **16 URLs medidas que la app atendía y el proxy no veía**, o sea un
`x-tenant-*` puesto por el cliente sobreviviendo hasta el panel. Es la **cuarta** instancia de la
clase *segmento-vs-sufijo* (S1, S2, P2, S8) y por eso se arregló por **subárbol** y no con un
lookahead por ruta: la fila que sigue abierta es la de la **clase**, `T37`.

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

### Quién registra qué tag  ·  **fijado en S6.2 (`f504d69`, 2026-08-28)**

**Un tag es un OR: una entrada cacheada muere si se purga *cualquiera* de los tags que registró.** De
ahí que el radio de una invalidación no se lea en el emisor sino en el cruce entre lo que se emite y
lo que cada página registró. Esta tabla es ese cruce, y **es contraintuitiva en dos filas**:

| entrada de cache | tags que registra |
|---|---|
| **grilla** (`(storefront)/_lib/listings.ts` · `getStorefrontCatalog`) | `storefront:{slug}` + `tenant-config:{slug}` |
| **ficha, camino de HIT** (`getStorefrontListing`, sus dos `cacheTag()`) | `tenant-config:{slug}` + `listing:{uuid}` |
| **ficha, camino de MISS** (`getStorefrontListing` → `listingMiss()`) | `tenant-config:{slug}` + `storefront:{slug}` |
| **`page.tsx` de la ficha**, sus **dos** entradas (`generateMetadata` y el cuerpo) | los mismos, registrados **explícitamente** en cada rama |

| emisor (panel) | tags que emite | cuándo |
|---|---|---|
| `invalidateStorefront(slug)` | `storefront` + `tenant-config` | cambió **el tenant**: alta, TC, punto de retiro, medios de pago, teléfono |
| `invalidateStorefrontUnit(slug, id)` | `storefront` + `listing:{uuid}` | cambió **una unidad y la grilla**: publicar, despublicar, reservar, vender, la 1ª foto |
| `invalidateListing(slug, id)` | `listing:{uuid}` | cambió **sólo la ficha**: la 2ª y 3ª foto de una unidad ya publicada |

**Las tres cosas que hay que saber antes de tocar cualquiera de esas líneas:**

1. **El camino de MISS de la ficha conserva `storefront:{slug}` a propósito.** La ficha registra
   `listing:{uuid}` **después del `await`** y sólo si la unidad es públicamente visible, así que una
   ficha cacheada como miss —el equipo todavía en `draft`, el link ya circulando— no quedaría bajo
   ningún tag que el panel emita al publicarla. Sin ese tag, publicar la deja mostrando *"este equipo
   ya no está publicado"* **hasta 15 minutos, sin error y sin log**.
2. **`page.tsx` es un cuarto registrante, y es el que decide la métrica.** Los tags de un `'use cache'`
   interno propagan **hacia afuera**, nunca al revés. Arreglar el loader sin tocar las dos entradas
   de `page.tsx` mata el amplificador de Postgres y **no mueve el cold-hit rate**.
3. **Las dos ramas de `page.tsx` registran su tag explícitamente en vez de heredarlo.** La propagación
   funciona, pero sale de un interno de Next sin contrato público (`use-cache-wrapper.js`), y §3 nos
   obliga a subir Next. Un `pnpm up` que cambie el orden **no rompería ningún test nuestro**.

> **Trampa con dueño, que hay que leer antes de tocar configuración visible.**
> Desde S6.2, `tenant-config:{slug}` es el **único** tag de alcance tenant que le queda a la ficha en
> su camino de HIT. `invalidateStorefront()` tiene callers en `create-tenant.ts` y
> `update-settings.ts`; el editor de configuración ya existe en `/app/ajustes`. Toda mutación futura
> que cambie nombre, teléfono, retiro, medios de pago, canje o FX debe llamar la función completa:
> emitir `storefront:{slug}` a mano actualiza la grilla y deja cada ficha del tenant con el dato viejo
> hasta un año (`cacheLife('max')`), sin error y sin log. El recorrido actual queda cubierto por la
> E2E de S12, que guarda y vuelve a leer el nombre desde el host público.

**`cacheLife` es una decisión de costo, no de UX:** `'max'` + invalidación por evento ≈
USD 0.012/tenant/mes en ISR Writes; `revalidate: 60` ≈ USD 2.59/tenant/mes — 13% del plan Base,
solo eso ya revienta el objetivo de costo marginal.

> **El objetivo es por plan y no es un número único** (LEAD, `ea26a02`, `.claude/agents/cost-auditor.md`):
> **Base ≤ USD 0,50 · Negocio ≤ USD 1,50**, donde el 1,50 es *0,50 + hasta 1,00 atribuible al chat*.
> Una slice de **vidriera, panel o media se mide contra 0,50 aunque el tenant esté en Negocio** — si
> no, "Negocio ≤ 1,50" licencia en silencio una vidriera de 1,40 y el chat se queda sin lugar el día
> que exista. Corolario operativo: **un número por tenant que no dice qué parte es chat no se puede
> comparar contra ninguno de los dos techos.** Los números vivos los mantiene `cost-auditor` en
> `docs/COST.md`; este doc no los duplica.

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

**Quién lo sostiene del lado del repo, y de quién es.** Los seis se afirman sobre las migraciones con
`packages/db/scripts/rls-lint.mjs`. **Ese archivo es del LEAD, no de `db-agent`** — `CLAUDE.md` §4 y
**ADR-022**: todo script de gate, viva donde viva, es del LEAD, porque el gate no puede ser del mismo
writer que el código que audita. Consecuencia práctica para el que va a escribir una policy:
**`db-agent` pide una regla nueva, no la agrega.** El caso que lo cerró vale como advertencia
concreta: hasta `63abcb7` el lint leía sólo `CREATE POLICY`, y `0006` trajo el primer `ALTER POLICY`
del repo — un `ALTER POLICY … WITH CHECK (true)` pasaba en verde por la regla `0007`, que es
justamente la que esta sección llama la más engañosa.

**Defensa en profundidad además de RLS:** DAL único en `server-only` · DTOs como `class`, para que
bajar el objeto entero **rompa el build** · `experimental.taint: true` · filtro de tenant explícito
en la query (`CLAUDE.md` §5).

### La superficie de escritura **sin autenticar**  ·  dos tablas, y la segunda trae PII de un tercero

`anon` escribe en **exactamente dos** tablas de negocio, y en ninguna lee. Están acá porque son el
único lugar del producto donde un desconocido mueve bytes a Postgres, y porque la segunda cambió una
regla de gate:

| tabla | slice | qué escribe | qué lee |
|---|---|---|---|
| `wa_click_events` | S4 | 3 columnas de ancho fijo (`tenant_id`, `listing_id`, `source`), **sin PII** | nada |
| `tradein_leads` | S8 | **9** columnas, incluidas `customer_name` y `customer_wa_phone` — **la primera PII de un tercero del producto** | nada |

**La mitad que más importa se sostiene por una ausencia:** `anon` no lee `tradein_leads` porque
**nadie le otorgó `SELECT`**, no porque una policy se lo prohíba. No hay policy que auditar, así que
ningún lint de policies tiene sujeto — la afirmación la construye **V2 de `accept-s8.sh`** censando
el árbol **entero** de migraciones (cero `GRANT SELECT`, cero policy de `SELECT … TO anon` sobre esa
tabla) y la mide la probe con `returning_desde_anon=0`: un `insert … returning` es la forma exacta en
que esa PII volvería **por la misma puerta por la que entró**, sin necesidad de un `select`.
El razonamiento completo, con las alternativas descartadas, es **ADR-026**.

**Lo que las migraciones actuales sostienen sobre esa tabla, dicho acá porque es donde se busca:** las
migraciones `0012_owner_sensitive_read_functions.sql` y `0016_furry_champions.sql` revocan el
`SELECT` directo sensible de `authenticated`, dejan allowlists explícitas y exponen las lecturas
financieras sólo por RPC `SECURITY DEFINER` owner-only. `seller-authorization.test.ts` prueba las dos
polaridades: seller y owner fallan en `SELECT` directo; el owner obtiene sus filas por RPC y el seller
no obtiene ninguna. Es **P5** del board, cerrada el 2026-09-04.

**El flag `accepts_trade_in` sí bajó al motor** (migración `0009`, fila **S8.1** cerrada el
2026-08-28): entró **adentro** del `WITH CHECK` de la policy de `INSERT` de `anon`, vía el primer
`ALTER POLICY` del repo. El `where` del handler lo sigue chequeando — dos capas, como el filtro de
tenant. Y la bandera **cierra la puerta de la vidriera, no el mostrador**: la policy de
`authenticated` no la mira, a propósito (`DOMAIN.md` §"Qué significa `accepts_trade_in`").

La misma migración trajo `listings.acquisition_channel` y el
`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` que ata `accepted` a *hay unidad*. **No es un
`CHECK` y no puede serlo** — un `CHECK` no se difiere y habría roto la primera sentencia de
`acceptToStock()`; el razonamiento está en `DOMAIN.md`. Lo censa `scripts/guard-tradein-engine.sh`
(**LEAD**), que camina el árbol de `.sql` **commiteado** y no la base, porque el migrador de Drizzle
compara `created_at` y no el hash (`CLAUDE.md` §3).

## Jobs
**Vercel Cron** para expirar reservas — la disyuntiva *"o Inngest free"* la cerró S6 y está en
**ADR-017**. **Sin worker 24/7.** Idempotente: correr el cron dos veces no rompe nada, y eso **es**
la política de reintento, porque Vercel **no reintenta** una corrida fallida.

Uno solo hoy: `GET /api/cron/expire-reservations`, `*/5 * * * *`, declarado en `vercel.json` —el
único contenido de ese archivo, ver ADR-016 y ADR-017—. Dos cosas que no son obvias y tienen gate
propio (`accept-s6.sh` V1/V2): **un 3xx apaga el job en silencio** (la corrida figura completa) y
**sin `CRON_SECRET` válido el handler no toca Postgres**, que es una afirmación sobre el orden y no
sobre el status code.

## Límites de confianza
| desde | hacia | qué puede cruzar |
|---|---|---|
| DB | vidriera | **sólo** `publicListingDTO` |
| DB | seller | todo menos `cost_usd`/margen |
| dueño (texto libre) | prompt del LLM | **sanitizado y delimitado** |
| cliente | server | **nada** sin Zod |
| visitante anónimo | DB | **sólo** las 9 columnas del `GRANT` de `tradein_leads` y las 3 de `wa_click_events`, **y en un solo sentido**: escribe, no lee (**ADR-026**) |
| visitante anónimo | prompt del LLM | **nada**, y desde el 2026-08-28 **está afirmado por un test**: `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts` (`qa-agent`, 16 casos) censa `packages/ai/**` y `packages/domain/**` y prohíbe por **forma** —no por nombre de columna— lo que llega a un sink adentro del perímetro del canje (fila `T43`, **cerrada**). Lo que **sigue** sin cubrir es la otra cadena, que es de contenido y no de PII: `model_text` del formulario → el dueño acepta → `listings.title` → prompt, y `title` no pasa por `sanitizeForPrompt` mientras `description` sí (**S8.2**, abierta) |

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
  filtrar dentro de la app fragmenta el cache ISR.
  **Re-medido contra `config/firewall-rules.json` el 2026-08-28 al cerrar S8: hoy son TRES reglas.**
  Esta viñeta decía *"Presupuesto: 2 reglas"* y ese número quedó viejo — son `/api/track`
  (`active`, S4), `/api/tradein` (`active`, S8) y `/api/chat` (`planned`). **No rompe ningún techo:**
  `$plan` del propio archivo declara el límite de Pro en **40 reglas**, y `guard-firewall.sh` lo hace
  cumplir. Se corrige el número en vez de re-derivar el criterio, porque el criterio no era un cupo
  sino el de abajo: **se defiende lo que cuesta plata.** *(De dónde salía el 2 no consta acá;
  `CLAUDE.md` §3 lo menciona como el motivo por el que Hobby no alcanza, y esa línea es del LEAD.)*
  Deuda conocida de **las tres**: cuentan **por IP y no por método** (fila **T38**) — bajo CGNAT
  móvil varias personas comparten cupo y el `deny` devuelve un **403 de plataforma**, no la página
  que la app diseñó.
  **El aviso anterior sigue en pie:** la regla de vidriera —condición por `host`— se propuso y
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
| Costo de Neon Postgres/Auth + Vercel Pro | **producción** | medir con el primer tenant real |
| Supuestos de tráfico de `COST.md` | primera vidriera real | medir, no estimar |

Research cerrado: `[R1]` `[R2]` `[R3]` `[R5]` `[R6]` `[R7]` PASS · **`[R4]` PARCIAL** (regla 3).
