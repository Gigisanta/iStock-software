# R1 - Wildcard de subdominios + ISR en Next.js App Router sobre Vercel (vigente 2026)
_Consultado: 2026-08-27 - Agente: researcher_

Versiones verificadas en el momento de la consulta: **Next.js 16.3.3** (header `version:` de nextjs.org/docs, `lastUpdated: 2026-08-25`) y docs de Vercel con `last_updated` entre 2026-07-28 y 2026-08-25.

## Pregunta

Cómo se sirve HOY (2026-08) un SaaS multi-tenant con subdominio por tenant (`{slug}.maat.work`) en Next.js App Router sobre Vercel: wildcard + certificado, resolución host→tenant sin DB por request, APIs de cache vigentes, invalidación por tenant, testing local y trampas conocidas.

## Respuesta corta

- **`middleware.ts` ya no es el nombre vigente.** Next.js 16 renombró el convention a **`proxy.ts`** (función exportada `proxy`), corre en **runtime Node.js** y **tirar `runtime` en el config es un error**. `middleware.ts` sigue funcionando (Edge) pero está **deprecado y se elimina en una versión futura**. Codemod: `npx @next/codemod@canary middleware-to-proxy .`  → **hay que actualizar `CLAUDE.md` §4 y `AGENTS.md`**, que hoy dicen `middleware.ts`.
- **Wildcard: soportado en TODOS los planes** (Hobby incluido), pero **obliga a usar los nameservers de Vercel** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) porque el cert wildcard se emite por DNS-01. Cert **automático** (Let's Encrypt), **cero pasos manuales**. Hobby: **50 dominios custom/proyecto**; Pro: ilimitados con soft limit **100.000/proyecto**.
- **Cero DB en el proxy.** La doc de Next dice literal que el proxy "puede desplegarse a tu CDN" y que **no confíes en módulos compartidos ni globals** → un `Map` a nivel de módulo **no es un cache válido**. Para iStock: el proxy **sólo parsea el host y reescribe a `/s/{slug}`**, sin I/O. Si hiciera falta lookup, la opción de plataforma es **Global Config** (ex Edge Config, renombrado): **1 MB máx por store en todos los planes**, propagación de escritura **hasta 10 s**, máx **3 stores por proyecto** en Pro.
- **APIs de cache vigentes en 16.3.3** (con `cacheComponents: true`): `'use cache'` · `cacheLife(perfil)` · `cacheTag(...tags)` · **`revalidateTag(tag, perfil)`** (la forma de **1 solo argumento quedó deprecada** en 16.0) · **`updateTag(tag)`** (nuevo, sólo Server Actions, read-your-writes) · **`refresh()`** (nuevo, sólo Server Actions: *"refresh the client router from within a Server Action"*) · `revalidatePath(path)`. `experimental.ppr` y `experimental.dynamicIO` **fueron eliminados/renombrados** en 16.0.
- **Sí se puede invalidar un tenant sin tocar los demás. La granularidad real es el string del tag.** Límites duros: **128 tags por respuesta cacheada**, **256 caracteres/bytes por tag**, **16 tags por llamada bulk a la REST API**. Los tags están **scopeados a proyecto + environment, NO a dominio** → el tag DEBE llevar el slug: `storefront:{slug}`.
- **El cache key del CDN de Vercel SÍ incluye el host domain** (método + URL + host + deployment URL + scheme). Pero el key de `'use cache'` y el del ISR durable **no incluyen el host**: se derivan de build ID + function ID + argumentos + path. → **si no reescribís a un path que contenga el slug, dos tenants comparten entrada de ISR/`use cache`. Es la trampa #1.**
- **El proxy corre ANTES del cache** ("Routing Middleware ... runs globally before the cache") → se factura en el **100%** de los requests de vidriera, incluso en cache HIT. Tiene que ser O(1) y sin red.
- **Costo (Pro, región de función `iad1`):** ISR Reads **$0.40 / 1M unidades de 8 KB**, ISR Writes **$4.00 / 1M**, Edge Requests **10M incluidos, después $2.00/1M**, Fast Data Transfer **1 TB incluido, después $0.15/GB**. En `gru1` (São Paulo) todo es ~1.6x más caro: ISR Reads $0.64/1M, Writes $6.40/1M, FDT $0.22/GB, Fast Origin Transfer **$0.41/GB vs $0.06/GB en iad1**.

## Detalle

### 1. Wildcard domain en Vercel: plan, DNS y certificado

**Plan.** La tabla de *Multi-tenant Limits* (`last_updated: 2026-08-11`) es explícita:

| Feature | Hobby | Pro | Enterprise |
|---|---|---|---|
| Custom Domains | 50 | Unlimited* | Unlimited* |
| Multi-tenant preview URLs | Enterprise only | Enterprise only | Enterprise only |
| Custom SSL certificates | Enterprise only | Enterprise only | Enterprise only |

`*` "soft limits of 100,000 domains per project for the Pro plan and 1,000,000 domains for the Enterprise plan".

Y para wildcard: **"All plans: Support for wildcard domains (e.g. `*.acme.com`)"**. O sea: `*.maat.work` **no requiere Pro**. Pro se necesita por otras razones (seats, dominios custom ilimitados para el upsell de landing propia), no por el wildcard.

**DNS.** No hay opción: *"This requires using Vercel's nameservers so that Vercel can manage the DNS challenges necessary for generating wildcard SSL certificates."* Pasos de la quickstart (`last_updated: 2026-08-25`):

1. Apuntar `maat.work` a `ns1.vercel-dns.com` y `ns2.vercel-dns.com`.
2. Agregar el apex `maat.work` al proyecto.
3. Agregar el wildcard `*.maat.work`.

La doc de *Adding a Custom Domain* lo repite como warning: *"If using your custom domain as a wildcard domain, you **must use the nameservers method for verification**"* y *"If you choose to use a wildcard domain Vercel's nameservers will be automatically enabled for you on saving the domain settings."*

⚠️ Consecuencia operativa: al mover los NS a Vercel **hay que re-crear a mano todos los registros DNS que quieras conservar** (MX de mail, TXT de SPF/DKIM, etc.). La doc lo dice: *"If you are verifying your domain by changing nameservers, you will need to add any DNS records to Vercel that you wish to keep from your previous DNS provider."*

**Certificado: automático, cero pasos manuales.** *"Vercel automatically issues SSL certificates for all domains using Let's Encrypt ... Automatic renewal before expiration. No configuration required."*

**Contradicción — y está DENTRO de la misma página oficial** (*Multi-Tenant Platform Concepts*, `last_updated: 2026-08-20`, re-verificada hoy):
- Sección *Wildcard domains*: "Vercel issues SSL certificates **for each subdomain on the fly**".
- Sección *SSL certificate issuance*, unos párrafos más abajo: "Wildcard domains: **Single wildcard certificate** covers all subdomains".

No es un choque entre dos páginas distintas: la **misma** página dice las dos cosas. Pesa más la primera, porque describe el comportamiento observable (cada `{slug}.maat.work` empieza a servir apenas se crea, sin que nadie re-emita nada) y porque es la que repite la *Quickstart* (`last_updated: 2026-08-25`, más reciente). La segunda parece la descripción del modelo mental, no de la implementación. Para iStock **da igual**: en ningún caso hay intervención manual. Lo anoto porque cambia el diagnóstico si algún día un subdominio nuevo tarda en tener TLS.

**Otros números que importan acá:**
- Propagación DNS: *"DNS typically takes 24-48 hours to propagate globally"*. El onboarding self-serve no puede prometer "tu vidriera está online en 30 segundos" el día que se migran los NS. Después de eso, cada subdominio nuevo es instantáneo (el wildcard ya resuelve).
- Longitud de label DNS: **63 caracteres** por label → el `slug` del tenant tiene que validarse ≤63 chars (en la práctica ≤40).
- Rate limits de la API de dominios: **100 altas/hora/team**, **50 verificaciones/hora/team**, **100 bajas/hora/team**. Sólo relevante para el upsell de dominio propio, no para el wildcard.

**Public Suffix List (seguridad, no cosmética).** La quickstart: *"If tenants can publish content or run code on your subdomains, submit your shared domain to the Public Suffix List so browsers isolate cookies between tenants."* En iStock el dueño del tenant **sí publica contenido** (descripciones, fotos, nombre de comercio) en `{slug}.maat.work`. Sin PSL, una cookie seteada con `Domain=.maat.work` es legible por todos los tenants. → **acción concreta**: o se somete `maat.work` a la PSL, o **ninguna cookie de sesión del panel se setea a nivel de dominio padre** (el panel vive en `maat.work/app/*`, cookie `__Host-` sin `Domain=` → no viaja a los subdominios). La segunda opción es gratis y es la que corresponde acá.

### 2. Host → tenant en el proxy, sin DB por request

**Primero, el cambio de nombre.** Next.js 16 (release 2025-10-21):

> `proxy.ts` replaces `middleware.ts` and makes the app's network boundary explicit. `proxy.ts` runs on the Node.js runtime.
> **Note:** The `middleware.ts` file is still available for Edge runtime use cases, but it is deprecated and will be removed in a future version.

Version history del API reference: `v16.0.0` — *"Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime"*. Y: *"The `runtime` config option is not available in Proxy files. Setting the `runtime` config option in Proxy will throw an error."*

**Qué opciones de cache existen en ese runtime y cuáles son sus límites reales:**

| Opción | ¿Sobrevive entre invocaciones? | Tamaño | TTL / propagación | Costo | Veredicto para iStock |
|---|---|---|---|---|---|
| Global scope / `Map` a nivel de módulo | **No confiable.** Doc de proxy: *"you should not attempt relying on shared modules or globals"*. Doc de `use cache`: en serverless *"Cache entries typically don't persist across requests (each request can be a different instance)"* | RAM de la instancia | n/a | $0 | **No usar como fuente de verdad.** Sirve como micro-optimización oportunista dentro de una misma instancia caliente, nada más |
| **Global Config** (ex Edge Config) | Sí, es un store global replicado | **1 MB por store** (Hobby, Pro y Enterprise igual) | escritura propaga **hasta 10 s globalmente** | Reads **$3.00**, Writes **$5.00** (unidad no publicada en la página → ver UNVERIFIED) | Viable. 1 MB alcanza para miles de `{slug: uuid}`. Pero **para iStock es innecesario** si el proxy no valida |
| **Runtime Cache** (`getCache()` de `@vercel/functions`) | Sí, persiste entre deploys, aislado por environment | **2 MB por ítem**, 128 tags, tag ≤256 bytes | TTL propio; `expireTag` propaga **<300 ms global** | iad1: **$0.40/1M reads, $4.00/1M writes** | Sirve en routing middleware, pero **no tiene integración con ISR**: *"Next.js's `revalidatePath` and `revalidateTag` API does not invalidate the Runtime Cache"* |
| Query a Postgres/Supabase desde el proxy | — | — | — | conexión + fila **por cada request, incluso en cache HIT** | **Prohibido.** Mata el objetivo de "95% de los hits no tocan Postgres" |

**El patrón correcto para iStock — y el por qué:**

Vercel documenta dos formas de pasar el tenant al app:

(a) **Headers** (`x-tenant-id` vía `NextResponse.next({ request: { headers } })`) — es lo que muestra *Proxy and Routing*.
(b) **Rewrite a un path** (`/domains/{host}`, `/s/{slug}`) — es lo que usa el **Multi-Tenant Template** oficial:

```ts
// proxy.ts (ejemplo oficial de Vercel, recortado)
if (pathname === '/') {
  return NextResponse.rewrite(new URL(`/domains/${hostname}`, request.url));
}
```

**Para una vidriera cacheada hay que usar (b), no (a).** Razón dura, de la doc de `'use cache'`:

> Cached functions and components **cannot** access runtime APIs like `cookies()`, `headers()`, or `searchParams` ... with the [`next-request-in-use-cache`](https://nextjs.org/docs/messages/next-request-in-use-cache) error. On a dynamically rendered route this surfaces when the route runs, **so it can pass `next build` and fail under `next start`**.

Si la página lee `headers().get('x-tenant-id')`, la ruta se vuelve dinámica y **no se puede prerenderizar ni meter en el shell estático** → adiós ISR, adiós 95% sin Postgres. Con rewrite a `/s/[slug]`, el slug llega como `params` (serializable) y la página entera es cacheable.

**Y el proxy no necesita validar nada.** El flujo con **cero I/O en el hot path**:

1. `proxy.ts` lee `host`, le saca el puerto, corta el primer label, valida contra `^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$`, descarta reservados (`www`, `app`, `admin`, `api`, `demo`).
2. `NextResponse.rewrite(new URL('/s/' + slug + pathname, request.url))`.
3. `app/(storefront)/s/[slug]/page.tsx` con `'use cache'` + `cacheTag('storefront:' + slug)` + `cacheLife('max')` hace **una** query y devuelve 404 si el slug no existe.
4. Ese 404 también se cachea (el CDN de Vercel cachea 404 y 410) → un slug inexistente no genera carga repetida.

Resultado: **0 lecturas de DB en cache HIT**, **0 lecturas de Global Config**, **0 costo extra** más allá del Edge Request y el Active CPU del proxy.

**Seguridad (esto es gate de `adversary-reviewer`).** La doc de Vercel es tajante:

> Tenant headers must come from the proxy, never from the client. Any caller can attach an `x-tenant-id` header to a request, and if the proxy forwards that value untouched, your app trusts it and serves data for whichever tenant the caller picked.
> Delete or overwrite inbound `x-tenant-*` headers on every path through the proxy, **including on paths that skip tenant resolution**.

Con el patrón de rewrite esto se vuelve casi trivial, pero **el proxy igual tiene que borrar cualquier `x-tenant-*` entrante** por defensa en profundidad, y **hay que verificar que el visitante no pueda pegarle directo a `/s/{otro-slug}`** — como `/s/{slug}` es una ruta real y pública, eso está bien (es la misma vidriera pública), pero **cualquier ruta autenticada NO puede vivir bajo ese árbol**.

**Trampa de las Server Actions** (doc de proxy):

> Server Functions are not separate routes in this chain. They are handled as POST requests to the route where they are used, so a Proxy matcher that excludes a path will also skip Proxy coverage. **Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone.**

### 3. Estado VIGENTE de ISR y cache tags en App Router

**Hay DOS modelos soportados hoy en 16.3.3, y hay que elegir uno explícitamente.**

**Modelo A — Cache Components (el vigente / el que Vercel empuja).** Se activa con:

```ts
// next.config.ts
const nextConfig = { cacheComponents: true }
export default nextConfig
```

Semántica: *"All dynamic code in any page, layout, or API route is executed at request time by default"* — el cache es **opt-in**. Tres cosas del API reference (`lastUpdated: 2026-06-22`) que hay que saber antes de prenderlo:

> **Cache Components requires the Node.js runtime.**
> `16.0.0` — `cacheComponents` introduced. This flag controls the `ppr`, `useCache`, and `dynamicIO` flags **as a single, unified configuration**.
> `cacheComponents` implements Partial Prerendering (PPR) as the **default behavior** in the App Router. This means the `experimental.ppr` configuration flag and the `experimental_ppr` route segment configuration are no longer necessary and **have been removed**.

O sea: un flag reemplaza a los tres experimentales viejos, PPR ya no se prende (viene puesto), y el runtime Node.js es requisito — lo cual encaja con que `proxy.ts` también sea Node.js only. Las APIs:

| API | Import | Firma vigente | Dónde | Semántica |
|---|---|---|---|---|
| `'use cache'` | directiva | top de archivo/función/componente | server | marca cacheable; la fn debe ser `async` |
| `'use cache: private'` | directiva | idem | server | para cuando NO podés sacar los runtime APIs del scope |
| `'use cache: remote'` | directiva | idem | server | delega a un cache handler de plataforma (Redis/KV); **roundtrip de red + fees** |
| `cacheLife` | `next/cache` | `cacheLife('max')` o `cacheLife({stale,revalidate,expire})` | dentro de `use cache` | TTL |
| `cacheTag` | `next/cache` | `cacheTag('a','b')` | dentro de `use cache` | etiqueta la entrada |
| **`revalidateTag`** | `next/cache` | **`revalidateTag(tag, perfil)`** | Server Actions **y** Route Handlers | **stale-while-revalidate** |
| **`updateTag`** | `next/cache` | `updateTag(tag)` | **sólo Server Actions** | expira ya; **read-your-own-writes** |
| **`refresh`** | `next/cache` | `refresh()` | **sólo Server Actions** | *"refresh the client router from within a Server Action"*: re-ejecuta lo dinámico y trae el árbol nuevo. **No invalida entradas de `'use cache'`** |
| `revalidatePath` | `next/cache` | `revalidatePath('/x')` | Actions y Route Handlers | invalida todo el path |

**Lo que cambió y rompe código viejo (Next 16.0):**

> `revalidateTag()` now requires a **`cacheLife` profile** as the second argument to enable stale-while-revalidate (SWR) behavior.
> ```ts
> revalidateTag('blog-posts', 'max');   // ✅ recomendado
> revalidateTag('products', { expire: 3600 });  // objeto inline también vale
> revalidateTag('blog-posts');          // ⚠️ Deprecated - single argument form
> ```

Eliminados en 16.0: **`experimental.ppr`**, **`export const experimental_ppr`**, **`experimental.dynamicIO`** (renombrado a `cacheComponents`), `unstable_rootParams()`. También: `params`/`searchParams`/`cookies()`/`headers()`/`draftMode()` **son async obligatorio**.

Perfiles de `cacheLife` (tabla oficial):

| Profile | stale | revalidate | expire |
|---|---|---|---|
| `default` | 5m | 15m | never |
| `seconds` | 30s | 1s | 60s |
| `minutes` | 5m | 1m | 1h |
| `hours` | 5m | 1h | 1d |
| `days` | 5m | 1d | 1w |
| `weeks` | 5m | 1w | 30d |
| `max` | 5m | 30d | 1y |

⚠️ *"A cache is considered 'short-lived' when it uses the `seconds` profile, `revalidate: 0`, or `expire` under 5 minutes. Short-lived caches are automatically excluded from prerenders and become dynamic holes instead."* → **nunca uses `seconds` en la vidriera**, te saca del shell estático sin avisar.

**Modelo B — el previo (route segment config).** `export const revalidate = N` sigue existiendo; la doc lo movió a la guía *"Caching and Revalidating (Previous Model)"* (`/docs/app/guides/caching-without-cache-components`). Vercel lo sigue listando como la forma de habilitar ISR para Next.js App Router: *"Export `revalidate` from a route segment"*.

**Cuál conviene para iStock: Modelo A (Cache Components).** Razones concretas, no de gusto:

1. **`updateTag` sólo existe en el modelo nuevo** y es exactamente lo que necesita el panel: el dueño toca "publicar" y **ve su propio cambio ya**, sin esperar SWR. Con `revalidateTag(tag,'max')` el propio dueño vería su vidriera vieja en el primer request, y eso se reporta como bug el día 1.
2. **El camino de PPR viejo está muerto** (`experimental.ppr` removido). Arrancar hoy con el modelo previo es arrancar con deuda.
3. **`cacheTag` + `cacheLife('max')` + invalidación por evento** es literalmente el patrón que la doc recomienda para contenido tipo CMS: *"use `cacheTag` and a long `cacheLife` like `max` ... Configure the content source to trigger a webhook ... that calls `revalidateTag` when the content changes. This reduces unnecessary time-based revalidation for content that hasn't changed."* Eso es la vidriera de iStock tal cual.
4. **Costo:** con `cacheLife('max')` (revalidate 30d) el stock que no se toca **no genera ISR Writes**. Además: *"When revalidation runs and the content hasn't changed from the previous version, no ISR write units are incurred."*

Costo de adoptarlo: `cacheComponents: true` obliga a `generateStaticParams` con al menos un valor por root param, obliga a sacar `headers()`/`cookies()` de todo scope cacheado, y rompe el build si anidás un cache corto dentro de uno sin `cacheLife` explícito. Es trabajo real, **pero es trabajo que se hace una vez y ahora, no después de 40 tenants**.

**`next/root-params` (nuevo en 16.3.0) — relevante si el árbol fuera `app/[slug]/...`.** Permite leer el param raíz desde cualquier Server Component sin prop drilling, **y sí se puede llamar dentro de `'use cache'`**: *"Only those root parameters become part of the cache key, so cache entries are not split across unrelated parameter values."* Restricciones: sólo Server Components (no Client, no Server Actions, **no Route Handlers todavía**), y **tira error dentro de `unstable_cache`**. Para iStock es opcional: con `/s/[slug]` bajo un root layout compartido, `slug` NO es root param y se pasa por `params`. Sólo importa si algún día el layout raíz se parte por tenant.

**Cómo interactúa con el CDN de Vercel.**

Arquitectura de dos niveles, textual de la doc:
- **CDN cache** (región del request): efímero, *"no guaranteed retention ... typically for minutes to hours, and can evict it under memory pressure"*. **Reads gratis.**
- **ISR cache durable** (región de la función): *"guarantees retention for the duration you specify, until it goes unaccessed for 31 days"*. **Reads y writes facturados**, medidos en **unidades de 8 KB**.

Flujo: CDN hit → la función **no corre**. CDN miss → request collapsing (una invocación por región) → se lee el ISR durable → si tampoco está, corre la función.

Purga: *"When you purge by cache tag, Vercel purges **all three types of cache: CDN cache, Runtime Cache, and Data Cache**"* y *"all caches across all regions update within **300ms**"*, purgando *"HTML and data payloads atomically"* (esto último importa: si no fuera atómico, una navegación client-side mostraría datos nuevos con HTML viejo).

Si la revalidación falla, Vercel **sigue sirviendo lo viejo** y pone un TTL de retry de **30 s**. Considera fallo: errores de red, y cualquier status que no sea 200/301/302/307/308/404/410.

### 4. ¿Se puede invalidar por tenant sin tocar a los demás?

**Sí. La granularidad real es el string del tag.** No hay granularidad por dominio, ni por path automático: es exactamente el tag que vos escribís.

**Límites duros (tabla oficial de Vercel, *Purging Vercel CDN Cache*):**

| | Máximo |
|---|---|
| Caracteres por tag | **256** |
| Tags por respuesta cacheada | **128** |
| Tags por llamada bulk a la REST API | **16** |

Y de `@vercel/functions`: *"The maximum tag length is 256 **bytes** (UTF-8 encoded)"*. La doc de `cacheTag` de Next: *"A single `cacheTag()` call accepts up to 128 tags, each with a maximum length of 256 characters. Tags longer than 256 characters are skipped, and any tags past the 128th in one call are **dropped**. Both cases log a console warning."*
→ **Falla silenciosa-ish**: un tag de 300 chars **no invalida nada** y sólo deja un warning en consola. Con slugs `[a-z0-9-]{3,40}` estamos a años luz del límite, pero **el tag NO puede contener comas** (`,` es el delimitador de `Vercel-Cache-Tag`) y **es case-sensitive** (`Product` ≠ `product`).

**Scope del tag: proyecto + environment. NO dominio.**

> Cache tags are scoped to your project and environment (production or preview).

→ Corolario duro: **un tag genérico como `'storefront'` purga TODOS los tenants**. El esquema para iStock tiene que ser:

| Tag | Cuándo se invalida | Alcance |
|---|---|---|
| `storefront:{slug}` | cualquier mutación de stock del tenant | sólo ese tenant |
| `listing:{unit_id}` | edición de una unidad | sólo esa ficha |
| `tenant-config:{slug}` | cambio de TC, puntos de retiro, branding | vidriera del tenant |

**Contradicción que hay que resolver con un test, no con fe.** La doc de ISR (`last_updated: 2026-08-11`) dice:

> **On-demand revalidation limits.** On-demand revalidation applies to the domain and deployment where you trigger it, and doesn't affect subdomains or other deployments. For example, if you trigger on-demand revalidation for `example-domain.com/example-page`, Vercel won't revalidate `sub.example-domain.com/example-page`.

Y la doc de purga (mismo `last_updated`) dice que los tags son de **proyecto + environment**. Las dos son fuente primaria de Vercel y **aparentan chocar**.

Lectura más probable (y la que pesa): el párrafo de ISR habla de **revalidación por path** (`revalidatePath`, que es inherentemente URL-scoped), mientras que el de purga habla de **tags**, que son un índice global del proyecto. Pesa más el de purga para el caso de tags porque es la página **específica** del mecanismo y describe el modelo de datos (los tags son un índice, el path es una URL).

**Pero el riesgo para iStock es concreto y asimétrico:** si el párrafo de ISR también aplica a tags, entonces **`revalidateTag('storefront:acme','max')` llamado desde el panel en `maat.work/app/...` NO purgaría `acme.maat.work`** — o sea, el dueño edita el stock y la vidriera no se actualiza nunca hasta que expire el `cacheLife`. Con `cacheLife('max')` eso son **30 días**. Es un bug de producto, no de infra.

**Mitigación obligatoria (dos capas):**
1. **La mutación dispara la revalidación desde el host del tenant.** El Server Action del panel hace `updateTag(...)` (para el read-your-writes del propio panel) y además llama a un Route Handler servido en `{slug}.maat.work/api/revalidate` (con secret), que ahí sí corre `revalidateTag('storefront:{slug}','max')` en el dominio correcto. Alternativa equivalente: `invalidateByTag(tag)` de `@vercel/functions`, cuyo scope documentado es *"the function's current environment ... derived from the deployment url that invoked the function"* — o sea environment, no dominio.
2. **Test de aceptación de `qa-agent`, en un deploy real** (no en `next dev`, ver §5): mutar tenant A → assert que `A.maat.work` devuelve `x-vercel-cache: STALE|MISS` y contenido nuevo, y que `B.maat.work` devuelve `HIT` con contenido **sin cambios**. **Sin ese test, esto queda `UNVERIFIED`.**

### 5. Cómo se prueba wildcard en local, y qué rompe

**Opción recomendada: `*.localhost`.** Es lo que usa el template oficial de Vercel — su `extractSubdomain` tiene una rama explícita para `localhost`:

```ts
if (url.includes('localhost') || url.includes('127.0.0.1')) {
  const fullUrlMatch = url.match(/http:\/\/([^.]+)\.localhost/);
  if (fullUrlMatch && fullUrlMatch[1]) return fullUrlMatch[1];
  if (hostname.includes('.localhost')) return hostname.split('.')[0];
  return null;
}
```

Y la guía del template sugiere además fijarlo en `/etc/hosts`:

```text
127.0.0.1 tenant1.localhost
127.0.0.1 tenant2.localhost
```

→ visitás `http://tenant1.localhost:3000`. Que Chrome/Firefox resuelvan `*.localhost` **sin** tocar `/etc/hosts` es comportamiento habitual pero **no lo verifiqué en fuente primaria** (ver UNVERIFIED); el `/etc/hosts` lo hace determinista en cualquier browser y en cualquier máquina del equipo, así que **usar `/etc/hosts` y no discutir**.

**`nip.io` / `sslip.io`:** DNS que devuelve la IP embebida en el hostname (`tenant1.127.0.0.1.nip.io`, o con guiones `64-176-22-9.nip.io`). Útil **para probar desde el celular en la LAN** (que es exactamente el caso de iStock: vidriera mobile-first, hay que verla en un teléfono real). Pero, textual del sitio: **"nip.io & sslip.io do not support wildcard certificates"**. Certs individuales por hostname sí, vía Let's Encrypt HTTP-01. `lvh.me` y `localtest.me` resuelven `*` a `127.0.0.1` pero son sólo loopback: **no sirven para el celular**.

**Qué rompe respecto de producción (lista para no perder tiempo debuggeando fantasmas):**

1. **No hay CDN de Vercel en `next dev`.** No hay ISR, no hay `x-vercel-cache`, no hay request collapsing, no hay purga global de 300 ms. El cache de `'use cache'` en dev es in-memory **y su key incluye un HMR refresh hash** (*"HMR refresh hash (development only) - Invalidates cache on hot module replacement"*) → el comportamiento de cache que ves en dev **no predice el de prod**. Toda validación de cache va contra un deploy.
2. **No hay HTTPS** → cookies `Secure` / `__Host-` / `SameSite=None` no funcionan. Si la sesión del panel usa `__Host-`, el flujo local necesita una excepción por env.
3. **El `host` trae el puerto** (`tenant1.localhost:3000`). El parser del slug **tiene que hacer `host.split(':')[0]`** o el slug local sale mal y el de prod bien — bug clásico que aparece sólo en dev.
4. **Faltan los headers de Vercel**: `x-vercel-ip-country`, `x-forwarded-for` real, geolocalización. Cualquier lógica que dependa de ellos necesita fallback.
5. **El scoping por dominio de la revalidación (§4) es intesteable en local.** Es la razón principal por la que el test de invalidación cruzada tiene que correr contra un deploy.
6. **⚠️ Blocker de staging:** *"Multi-tenant preview URLs are available exclusively for **Enterprise** customers"* (URLs tipo `tenant1---project-git-branch.yourdomain.dev`). En **Pro no las tenés**. → para testear wildcard antes de producción hay que **dedicar un segundo dominio wildcard** (ej. `*.staging.maat.work` o `*.maat.dev`) apuntado a un proyecto/environment de Vercel. Eso **no es gratis en esfuerzo** y hay que decidirlo en `ARCHITECTURE.md`, no descubrirlo el día del release.

### 6. Trampas conocidas

**a) Cache compartido entre hosts — la trampa #1.**
El cache key del **CDN** sí incluye el host:

> Each request to Vercel's CDN has a cache key derived from the following: the request method · the request URL · **the host domain** · the unique deployment URL · the scheme.

Pero el key de **`'use cache'`** es otro animal: *"Build ID · Function ID (a secure hash of the function's location and signature) · Serializable arguments · HMR refresh hash (dev only)"*. **El host no aparece.** Y el ISR durable se indexa por path.
→ Si `acme.maat.work/` y `beta.maat.work/` renderizan **el mismo path `/`** y llaman a la misma función cacheada **con los mismos argumentos**, comparten entrada. El CDN te salva en el borde, pero el ISR durable y el `use cache` te pueden servir el contenido de otro tenant en el primer miss. **Es un tenant leak, no una ineficiencia.**
**Regla no negociable para `storefront-agent`: el proxy reescribe SIEMPRE a un path que contiene el slug (`/s/{slug}/...`), y toda función `'use cache'` de vidriera recibe el `slug` como argumento explícito.** Nunca leer el host adentro de un scope cacheado (además tiraría `next-request-in-use-cache`).

**b) ¿El proxy corre sobre respuestas cacheadas? SÍ.**
Vercel, *Routing Middleware*: *"Because it **runs globally before the cache**, Routing Middleware is an effective way of providing personalization to statically generated content."*
Implicancias:
- **Se factura en el 100% de los requests de vidriera**, incluso cuando el HTML sale del CDN sin invocar la función de página. Modelo: **fluid compute** (Active CPU + Provisioned Memory + Invocations).
- → El proxy **no puede** tener I/O. Un `await db.query()` ahí convierte "95% de los hits no tocan Postgres" en "100% de los hits tocan Postgres".
- Límites de request en Routing Middleware: URL máx **14 KB**, body máx **4 MB**, **64 headers** máx, headers máx **16 KB**.

**c) Sin `matcher`, el proxy corre sobre TODO.**
> Without a `matcher`, Proxy runs on **every request**, including static files (`_next/static`), image optimizations (`_next/image`), and assets in the `public/` folder.

Y una que sorprende: *"Even when `_next/data` is excluded in a negative matcher pattern, proxy will still be invoked for `_next/data` routes. This is intentional behavior to prevent accidental security issues."*

**d) `set-cookie` mata el cache del CDN.** Criterios de cacheabilidad:
- método `GET` o `HEAD`; sin header `Range`; **sin header `Authorization`**;
- status 200/404/410/301/302/307/308;
- **≤10 MB** (20 MB en streaming);
- **sin header `set-cookie`**;
- sin `private`/`no-cache`/`no-store`; sin `Vary: *`.

→ Si PostHog, un A/B test o un banner de cookies setea una cookie **desde el server** en la respuesta de la vidriera, **la vidriera deja de cachearse entera** y el objetivo de costo se cae. Todo lo de analytics tiene que ser **client-side**. Esto es un check para `cost-auditor`.

**e) `Vary`.** No pongas `Vary: Host` — el host **ya** está en el key, y *"each additional header exponentially increases the number of cache entries"*. Vercel ya incluye `Accept` y `Accept-Encoding` por defecto.

**f) Límites de dominios por proyecto.** Hobby **50**; Pro ilimitado con **soft limit de 100.000/proyecto**; Enterprise 1.000.000. Ampliables por soporte. Para el wildcard esto **no aplica** (`*.maat.work` cuenta como 1 dominio); aplica al upsell de dominio propio por tenant. Con rate limit de **100 altas de dominio/hora/team**, un onboarding masivo de dominios custom necesita cola.

**g) Deploy nuevo = cache ISR nuevo.** *"each new deployment uses its own ISR cache and does not reuse the cache from a previous deployment"* (aunque el cache viejo **no se purga**, lo que permite rollback instantáneo). Y de `use cache`: *"Neither caching directive carries over to a new deploy, because the cache key includes the build (or `deploymentId`) ID."*
→ **Cada deploy es un cold start de cache para todos los tenants**: pico de invocaciones + ISR Writes. Con deploys frecuentes esto se paga. Si el pico molesta, se puede fijar `deploymentId` para conservar el cache entre builds — pero eso **también conserva bugs cacheados**, así que no lo recomiendo sin más evidencia.

**h) Purgar tiene costo indirecto.** *"Vercel does not bill the purge event itself, but purging can temporarily increase related usage, such as Active CPU, Provisioned Memory, Function Invocations, Fast Origin Transfer ... and ISR Writes."* Purgar con `*` (todo el proyecto) desde el dashboard = re-render de todas las vidrieras. **No es un botón inocente.**

**i) `Invalidate` vs `Delete`.** Usar **siempre `invalidate`** (marca stale, revalida en background). `dangerouslyDeleteByTag` revalida en **foreground** y la propia doc advierte del **cache stampede**.

**j) Runtime Cache ≠ ISR.** *"Next.js's `revalidatePath` and `revalidateTag` API does not invalidate the Runtime Cache."* Si algún día `packages/ai` cachea respuestas del chatbot en Runtime Cache, **ese cache no se limpia con las mutaciones de stock** → el bot puede citar precios viejos. Hay que invalidarlo aparte con `expireTag`.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| Next.js versión de los docs consultados | 16.3.3 | versión | nextjs.org/docs (header `version:`) |
| Wildcard domain: planes soportados | Hobby, Pro, Enterprise | — | Vercel Multi-tenant Limits |
| Custom domains por proyecto (Hobby) | 50 | dominios | Vercel Multi-tenant Limits / Add a Domain |
| Custom domains por proyecto (Pro, soft limit) | 100.000 | dominios | Vercel Multi-tenant Limits |
| Custom domains por proyecto (Enterprise, soft limit) | 1.000.000 | dominios | Vercel Multi-tenant Limits |
| Nameservers de Vercel (obligatorios para wildcard) | ns1.vercel-dns.com / ns2.vercel-dns.com | — | Vercel Multi-tenant Quickstart |
| Propagación DNS tras cambiar NS | 24–48 | horas | Vercel Multi-tenant Limits |
| Longitud máx de label DNS (subdominio) | 63 | caracteres | Vercel Multi-tenant Limits (RFC 1035) |
| Rate limit alta de dominios | 100 | req/hora/team | Vercel Multi-tenant Limits |
| Rate limit verificación de dominios | 50 | req/hora/team | Vercel Multi-tenant Limits |
| Multi-tenant preview URLs | Enterprise only | plan | Vercel Multi-tenant Limits |
| Custom SSL certificates (subir el tuyo) | Enterprise only | plan | Vercel Multi-tenant Limits |
| Global Config: tamaño máx de store | 1 | MB (todos los planes) | Vercel Global Config Limits |
| Global Config: stores conectados a un proyecto (Pro) | 3 | stores | Vercel Global Config Limits |
| Global Config: stores totales (Hobby / Pro) | 1 / ilimitados | stores | Vercel Global Config Limits |
| Global Config: propagación de escritura | hasta 10 | segundos | Vercel Global Config Limits |
| Global Config: largo máx de key | 256 | caracteres | Vercel Global Config Limits |
| Global Config Reads / Writes (Pro) | $3.00 / $5.00 | USD (unidad no publicada) | Vercel Pricing |
| Cache tags: caracteres por tag | 256 | chars (256 bytes UTF-8) | Vercel Purge Limits / @vercel/functions |
| Cache tags: tags por respuesta cacheada | 128 | tags | Vercel Purge Limits |
| Cache tags: tags por llamada bulk REST | 16 | tags | Vercel Purge Limits |
| `cacheTag()`: tags por llamada | 128 (el resto se descarta con warning) | tags | Next.js cacheTag |
| Scope de un cache tag | proyecto + environment | — | Vercel Purge Cache |
| Propagación global de una purga por tag | 300 | ms | Vercel ISR |
| Retención del ISR cache durable | 31 | días sin accesos | Vercel ISR |
| Unidad de facturación ISR | 8 | KB por read/write unit | Vercel ISR Limits and Pricing |
| ISR Reads (iad1) | $0.40 | por 1.000.000 read units | Vercel Regional Pricing iad1 |
| ISR Writes (iad1) | $4.00 | por 1.000.000 write units | Vercel Regional Pricing iad1 |
| ISR Reads (gru1) | $0.64 | por 1.000.000 read units | Vercel Regional Pricing gru1 |
| ISR Writes (gru1) | $6.40 | por 1.000.000 write units | Vercel Regional Pricing gru1 |
| Fast Origin Transfer (iad1 / gru1) | $0.06 / $0.41 | USD por GB | Vercel Regional Pricing |
| Fast Data Transfer (iad1) | 1 TB incluido, luego $0.15 | USD por GB | Vercel Regional Pricing iad1 |
| Edge Requests (iad1) | 10.000.000 incluidos, luego $2.00 | USD por 1M requests | Vercel Regional Pricing iad1 |
| Edge Requests (gru1) | 10.000.000 incluidos, luego $3.20 | USD por 1M requests | Vercel Regional Pricing gru1 |
| Runtime Cache: tamaño máx de ítem | 2 | MB | @vercel/functions |
| Máx respuesta cacheable en CDN | 10 (20 en streaming) | MB | Vercel CDN Cache |
| Máx cache time (`s-maxage`) | 1 | año | Vercel CDN Cache |
| TTL de reintento si falla la revalidación | 30 | segundos | Vercel ISR |
| Routing Middleware: URL máx | 14 | KB | Vercel Routing Middleware |
| Routing Middleware: headers máx | 64 headers / 16 KB | — | Vercel Routing Middleware |
| Seat adicional Pro | $20 | USD/mes | Vercel Pricing |
| `cacheLife('max')` | stale 5m / revalidate 30d / expire 1y | — | Next.js Revalidating |
| `cacheLife('default')` | stale 5m / revalidate 15m / expire never | — | Next.js Revalidating |

## Fuentes

- [Next.js 16 (blog de release, 2025-10-21)](https://nextjs.org/blog/next-16) — consultado 2026-08-27
- [Next.js — Getting Started: Revalidating (v16.3.3, lastUpdated 2026-06-25)](https://nextjs.org/docs/app/getting-started/revalidating) — consultado 2026-08-27
- [Next.js — `use cache` directive (v16.3.3, lastUpdated 2026-08-25)](https://nextjs.org/docs/app/api-reference/directives/use-cache) — consultado 2026-08-27
- [Next.js — `cacheTag` (v16.3.3, lastUpdated 2026-08-25)](https://nextjs.org/docs/app/api-reference/functions/cacheTag) — consultado 2026-08-27
- [Next.js — `proxy.js` file convention (v16.3.3, lastUpdated 2026-08-25)](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — consultado 2026-08-27
- [Next.js — `next/root-params` (v16.3.3, lastUpdated 2026-06-24)](https://nextjs.org/docs/app/api-reference/functions/next-root-params) — consultado 2026-08-27
- [Vercel — Multi-Tenant Platform Quickstart (last_updated 2026-08-25)](https://vercel.com/docs/platforms/multi-tenant-platforms/quickstart) — consultado 2026-08-27
- [Vercel — Multi-tenant Limits (last_updated 2026-08-11)](https://vercel.com/docs/platforms/multi-tenant-platforms/limits) — consultado 2026-08-27
- [Vercel — Multi-Tenant Platform Concepts (last_updated 2026-08-20)](https://vercel.com/docs/platforms/multi-tenant-platforms/concepts) — consultado 2026-08-27
- [Vercel — Proxy and Routing para multi-tenant (last_updated 2026-08-10)](https://vercel.com/docs/platforms/multi-tenant-platforms/middleware-and-routing) — consultado 2026-08-27
- [Vercel — Multi-Tenant Template (last_updated 2026-07-28)](https://vercel.com/docs/platforms/examples/multi-tenant-template) — consultado 2026-08-27
- [Vercel — Adding & Configuring a Custom Domain (last_updated 2026-08-11)](https://vercel.com/docs/domains/working-with-domains/add-a-domain) — consultado 2026-08-27
- [Vercel — Incremental Static Regeneration (last_updated 2026-08-11)](https://vercel.com/docs/incremental-static-regeneration) — consultado 2026-08-27
- [Vercel — ISR Usage and Pricing (last_updated 2026-08-11)](https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing) — consultado 2026-08-27
- [Vercel — Vercel CDN Cache (last_updated 2026-08-11)](https://vercel.com/docs/caching/cdn-cache) — consultado 2026-08-27
- [Vercel — Purging Vercel CDN Cache (last_updated 2026-08-11)](https://vercel.com/docs/caching/cdn-cache/purge) — consultado 2026-08-27
- [Vercel — Routing Middleware (last_updated 2026-08-14)](https://vercel.com/docs/routing-middleware) — consultado 2026-08-27
- [Vercel — @vercel/functions API Reference (last_updated 2026-08-19)](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) — consultado 2026-08-27
- [Vercel — Global Config Limits and pricing (last_updated 2026-07-29)](https://vercel.com/docs/global-config/global-config-limits) — consultado 2026-08-27
- [Vercel — Pricing on Vercel (last_updated 2026-08-11)](https://vercel.com/docs/pricing) — consultado 2026-08-27
- [Vercel — Regional pricing iad1 (last_updated 2026-02-13)](https://vercel.com/docs/pricing/regional-pricing/iad1) — consultado 2026-08-27
- [Vercel — Regional pricing gru1 (last_updated 2026-02-13)](https://vercel.com/docs/pricing/regional-pricing/gru1) — consultado 2026-08-27
- [nip.io / sslip.io](https://nip.io/) — consultado 2026-08-27

## Impacto en iStock

### ARCHITECTURE

1. **Renombrar el artefacto de host routing: `middleware.ts` → `proxy.ts`.** `CLAUDE.md` §4 y `AGENTS.md` listan `middleware.ts` como propiedad de `storefront-agent`. En Next 16 ese nombre está **deprecado** y el vigente es `proxy.ts` (export `proxy`, runtime Node.js, `runtime` config prohibido). Es un cambio de **una línea en dos archivos de gobernanza** hoy, o una migración con el árbol de rutas ya escrito después. **Sólo el LEAD puede tocar esos archivos.**
2. **Árbol de la vidriera: `apps/web/app/(storefront)/s/[slug]/...`.** El proxy reescribe `{slug}.maat.work/<path>` → `/s/{slug}/<path>`. **No** se pasa el tenant por header a la vidriera: `headers()` dentro de `'use cache'` tira `next-request-in-use-cache` y además convierte la ruta en dinámica, matando el ISR. Los headers `x-tenant-*` siguen siendo válidos **para el panel** (`/app/*`), que es dinámico por definición.
3. **El proxy no habla con la DB, ni con Global Config, ni con nada.** Parseo del host + regex de slug + rewrite. La validación del tenant ocurre dentro de la página cacheada (que hace 1 query en el miss y devuelve 404 cacheable si el slug no existe). Esto es lo que hace alcanzable el "95% de los hits no tocan Postgres" del §3 de `CLAUDE.md`; con un lookup en el proxy el número real sería **0%**.
4. **`cacheComponents: true` en `next.config.ts`** y `'use cache'` + `cacheTag('storefront:{slug}')` + `cacheLife('max')` en la vidriera. Reemplaza la mención genérica a "ISR / cache de CDN" del stack por la forma vigente y explícita.
5. **Environment de staging con wildcard propio.** Las multi-tenant preview URLs son **Enterprise only** → en Pro no hay forma de probar `{slug}.<preview>` gratis. Hay que reservar `*.staging.maat.work` (o equivalente) apuntado a un proyecto de Vercel separado. **Decisión de arquitectura, no detalle de CI.**
6. **Aislamiento de cookies entre tenants.** El dueño publica contenido en su subdominio → cookies de sesión del panel **nunca** con `Domain=.maat.work`. Usar `__Host-` (sin `Domain`), que queda pineada a `maat.work`. Alternativa más cara: someter `maat.work` a la Public Suffix List.

### DECISIONS (ADRs a abrir por `architect`)

- **ADR: Cache Components ON.** `cacheComponents: true`, `'use cache'` + `cacheTag` + `cacheLife`. Motivo: `updateTag` (read-your-writes para el panel) sólo existe en este modelo, `experimental.ppr` fue eliminado en 16.0, y `revalidateTag` de 1 argumento está deprecado. Costo: migración de APIs async, `generateStaticParams` obligatorio, prohibido leer `headers()`/`cookies()` en scopes cacheados.
- **ADR: resolución de tenant por rewrite de path, no por header.** Consecuencia directa del punto anterior; sin esto no hay vidriera cacheada.
- **ADR: cero I/O en el proxy.**
- **ADR: taxonomía de tags** — `storefront:{slug}` / `listing:{unit_id}` / `tenant-config:{slug}`. **Prohibido un tag sin slug** en cualquier cosa que toque vidriera: purgaría a todos los tenants. Regla de review para `adversary-reviewer`.
- **ADR: región de función.** `iad1` es **1.6x más barato** que `gru1` en ISR y **~7x más barato en Fast Origin Transfer** ($0.06 vs $0.41/GB), pero está más lejos de Supabase si Supabase queda en `sa-east-1`. La doc de Vercel dice *"set your default Function region close to where your data sources are"*. **Esto se decide junto con la región de Supabase, no por separado.** Como el 95% de los hits no debería tocar la función, el argumento de costo pesa más que el de latencia — pero necesita el número de latencia real para cerrarse.

### COST (input para `cost-auditor`, `docs/COST.md`)

- **El wildcard en sí: $0.** No cambia de plan, no agrega línea de facturación.
- **Nueva línea de costo que hoy no está modelada: el proxy corre antes del cache, en el 100% de los pageviews.** Facturado como fluid compute (Active CPU + Provisioned Memory + Invocations) además del Edge Request. Con proxy O(1) sin red es ruido; con un lookup a DB o a Global Config es una línea real. **El presupuesto del proxy debería ser <2 ms de CPU y 0 llamadas de red, y ser un assert del cost-auditor.**
- **Edge Requests:** 10M/mes incluidos (iad1). A ~500 pageviews/día/tenant y ~8 requests por pageview (HTML + RSC + assets no cacheados en browser), son ~120k req/mes/tenant → el margen incluido cubre **~80 tenants** antes de pagar $2/1M. Estimación mía sobre el número oficial de requests incluidos, **no un dato de Vercel**.
- **ISR Writes ($4.00/1M unidades de 8 KB, iad1):** una vidriera de ~120 KB comprimida ≈ 15 write units. 200 mutaciones/mes/tenant × 15 = 3.000 units/mes/tenant → **$0.012/tenant/mes**. Despreciable **siempre que** se use `cacheLife('max')` + invalidación por evento. Con `revalidate` de 60 s serían 43.200 regeneraciones/mes/tenant = ~648k units = **$2.59/tenant/mes** — o sea, **el 7,4% del plan Base de USD 35**. El perfil de `cacheLife` es una decisión de costo, no de UX.
- **ISR Reads ($0.40/1M):** sólo en CDN miss. Prácticamente ruido.
- **Fast Data Transfer:** 1 TB incluido. Como las fotos van por R2/Cloudflare (egress $0), acá sólo viaja HTML/RSC (~120 KB/pageview) → 1 TB ≈ **8.3M pageviews**. No es el cuello.
- **Riesgo de costo escondido #1: cualquier `set-cookie` server-side en la vidriera desactiva el cache del CDN entero** → todos los pageviews pasan a invocar la función y a leer Postgres. Debe ser un check explícito de `cost-auditor`.
- **Riesgo de costo escondido #2: cada deploy invalida el ISR cache** (el key incluye el build ID) → pico de invocaciones + ISR Writes proporcional a `tenants × páginas`. Con 100 tenants y deploys diarios esto deja de ser gratis.
- **Global Config: NO adoptarlo todavía.** $3.00 reads + $5.00 writes con **unidad no publicada** en la doc, y la arquitectura propuesta no lo necesita. Si en algún momento hace falta (ej. mapear dominios custom → tenant en el proxy), el techo es **1 MB por store en todos los planes**.

## Confianza

**alta** para los puntos 1, 3, 5 y 6, y para todas las cifras de la tabla: todo sale de docs oficiales de Vercel y Next.js con `last_updated`/`version` visible y reciente (feb–ago 2026), leídas hoy.

**media** para el punto 4 (granularidad de invalidación por tenant), por la contradicción documentada entre *"On-demand revalidation applies to the domain ... doesn't affect subdomains"* (ISR docs) y *"Cache tags are scoped to your project and environment"* (Purge docs). Ambas son fuente primaria del mismo proveedor con la misma fecha. Argumenté por qué pesa más la de purga, pero **es un argumento, no una medición**.

**Qué la subiría a alta:** un test en un deploy real de Vercel con dos subdominios wildcard — mutar el tenant A desde el panel (`maat.work/app`), y verificar con `curl -I` el header `x-vercel-cache` y el contenido de `A.maat.work` y `B.maat.work`. Es un experimento de 20 minutos una vez que exista el primer deploy con wildcard, y **es la primera cosa que debería probar `qa-agent`** apenas haya vidriera.

**Qué la bajaría:** que Vercel confirme que el índice de tags está particionado por dominio. En ese caso toda invalidación cross-host desde el panel es un no-op silencioso, y el diseño tiene que cambiar a "la mutación siempre golpea un Route Handler en el host del tenant" — mitigación que ya dejé escrita en §4 justamente por eso.

## UNVERIFIED

- **Unidad de precio de Global Config Reads/Writes.** Las dos páginas oficiales (`/docs/pricing` y `/docs/global-config/global-config-limits`) muestran `$3.00` y `$5.00` **sin unidad**. Probablemente "por 1M reads" y "por 1M writes" por analogía con el resto de la tabla, pero **no está escrito**. No usar en un cálculo de costo sin confirmar.
- **Si `revalidateTag` está o no scopeado por dominio.** Ver §4. Contradicción entre dos docs oficiales de Vercel; resuelta por argumento, no por evidencia.
- **Certificado wildcard: ¿uno solo o uno por subdominio?** La página *Concepts* de Vercel se contradice a sí misma ("SSL certificates for each subdomain on the fly" vs "Single wildcard certificate covers all subdomains"). Sin impacto operativo conocido (en ambos casos es automático y sin pasos manuales), pero sin resolver. Se dirime en 1 minuto con `openssl s_client -connect a.maat.work:443` vs `b.maat.work` una vez que exista el deploy.
- **Que Chrome/Firefox resuelvan `*.localhost` a 127.0.0.1 sin `/etc/hosts`.** Comportamiento habitual y el template de Vercel lo asume, pero no lo verifiqué en una fuente primaria de los browsers. Por eso la recomendación es fijar `/etc/hosts` igual.
- **Que Safari NO resuelva `*.localhost`.** Creencia común; no verificada.
- **Estimación de "10M Edge Requests incluidos ≈ 80 tenants".** El número incluido es oficial; los ~8 requests/pageview y ~500 pageviews/día/tenant son supuestos míos. Los debe revisar `cost-auditor` con datos reales.
- **Estimación de 120 KB de HTML/RSC comprimido por pageview de vidriera.** Supuesto mío para dimensionar ISR Writes y Fast Data Transfer. Se mide después de la primera vidriera real, no antes.
- **Latencia real `iad1` ↔ Alto Valle vs `gru1` ↔ Alto Valle.** No medida. Bloquea el cierre del ADR de región.
