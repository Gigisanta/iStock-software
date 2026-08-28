/**
 * `proxy.ts` — resolución de host → vidriera. **Next 16 renombró `middleware.ts` a `proxy.ts`.**
 *
 * Version history del API reference (v16.0.0):
 * > *"Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime."*
 * > *"The `runtime` config option is not available in Proxy files. Setting the `runtime` config
 * > option in Proxy will throw an error."*
 *
 * Por eso abajo **no hay** `export const config = { runtime: ... }`. No es un olvido: ponerlo
 * rompe el build.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## Las tres leyes de este archivo (ADR-007, `docs/ARCHITECTURE.md` §"Resolución host → tenant")
 *
 * **1. Cero I/O y cero estado.** No hay `await db.query()`, no hay `fetch`, no hay Global Config,
 *    y **no hay un `Map` de `slug → tenantId`**. La doc de `proxy.ts` dice literal que el proxy
 *    puede desplegarse al CDN y que *"you should not attempt relying on shared modules or
 *    globals"*: un `Map` a nivel de módulo acá no es un cache, es una mentira que funciona en dev.
 *    Y el motivo económico: **el proxy corre ANTES del cache** (*"runs globally before the
 *    cache"*), así que se factura en el **100% de los pageviews, incluso en cache HIT**. Un
 *    `await` a Postgres acá convierte "95% de los hits no tocan Postgres" en "100% los tocan".
 *    Presupuesto: **< 2 ms de CPU, 0 llamadas de red.** Es un assert de `cost-auditor`.
 *
 * **2. El slug viaja en el PATH, jamás en un header.** `headers()` dentro de `'use cache'` tira
 *    `next-request-in-use-cache` y vuelve la ruta dinámica → adiós ISR. Y peor: el cache key del
 *    CDN incluye el host, pero el de `'use cache'` y el del ISR durable **no** (son build ID +
 *    function ID + argumentos). Dos subdominios que rendericen el mismo path con los mismos
 *    argumentos **comparten entrada de cache**. Eso es servir la vidriera del tenant A bajo el
 *    dominio del tenant B: **fuga entre tenants, no ineficiencia.**
 *
 * **3. Esto NO es un control de acceso.** *"Server Functions are not separate routes in this
 *    chain ... a Proxy matcher that excludes a path will also skip Proxy coverage. Always verify
 *    authentication and authorization inside each Server Function."* Toda autorización se
 *    verifica **dentro** de cada Server Function del panel. El proxy sólo enruta.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  isGlobalMediaPath,
  isInfrastructurePath,
  isStorefrontInternalPath,
  resolveHost,
  storefrontPathFor,
} from './app/(storefront)/_lib/host';

/**
 * Headers de tenant que llegan **de afuera** y hay que borrar en TODOS los caminos.
 *
 * Doc de Vercel (Multi-Tenant), y es gate de `adversary-reviewer`:
 * > *"Tenant headers must come from the proxy, never from the client. Any caller can attach an
 * > `x-tenant-id` header ... Delete or overwrite inbound `x-tenant-*` headers on every path
 * > through the proxy, including on paths that skip tenant resolution."*
 *
 * En la vidriera no usamos headers de tenant (ley 2), pero el panel sí puede llegar a usarlos, y
 * un header envenenado que sobrevive al proxy es escalación de tenant directa.
 */
const TENANT_HEADER_PREFIX = 'x-tenant';

/**
 * Devuelve headers saneados, o `null` si no había nada que sacar.
 *
 * El `null` no es microoptimización estética: clonar `Headers` en el 100% de los pageviews (el
 * proxy corre antes del cache) es CPU que se factura. El caso normal — ningún header `x-tenant-*`
 * — no aloca nada.
 */
function stripInboundTenantHeaders(request: NextRequest): Headers | null {
  let dirty = false;
  for (const key of request.headers.keys()) {
    if (key.startsWith(TENANT_HEADER_PREFIX)) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return null;

  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (key.startsWith(TENANT_HEADER_PREFIX)) headers.delete(key);
  }
  return headers;
}

function passthrough(headers: Headers | null): NextResponse {
  return headers === null ? NextResponse.next() : NextResponse.next({ request: { headers } });
}

/**
 * 404 servido por el proxy, **sin invocar la app**.
 *
 * Se usa para las dos entradas que no pueden ser una vidriera **jamás**, y que se reconocen sin
 * consultar nada:
 * - **el host** que no puede ser un tenant (`Foo_Bar.maat.work`, `a.b.maat.work`): la DB tiene un
 *   `CHECK` con el mismo regex, así que no existe el futuro en el que ese slug se dé de alta;
 * - **el path** `/s/**`, que es el destino interno del rewrite y no una URL pública, con slug
 *   válido o basura (`/s/algo.json`). El argumento largo está en `isStorefrontInternalPath`.
 *
 * Los dos son 404 real, servido desde acá, sin invocar la app.
 *
 * **El otro caso es distinto a propósito, no es una inconsistencia.** Un slug **bien formado pero
 * inexistente** NO pasa por acá: sigue al rewrite y lo resuelve la página cacheada, que devuelve
 * la página de miss de ADR-011 —`200` con `noindex`, no 404— con el perfil de cache corto
 * (`_lib/cache-life.ts`). La diferencia es cuánta certeza tiene cada capa: el proxy sabe que ese
 * host no puede ser un tenant nunca, así que puede cerrar la puerta sin preguntarle a nadie; con
 * un slug bien formado el proxy no sabe nada —no consulta la DB, ley 1— y el que sabe es el
 * lookup cacheado. Ver `s/[slug]/page.tsx` para por qué esa respuesta no puede ser un 404.
 *
 * `Cache-Control` acá es sólo para el browser: la respuesta del proxy no entra al CDN de Vercel.
 */
function malformedHost(reason: string): NextResponse {
  return new NextResponse(`404 — no existe una vidriera en este dominio.\n${reason}\n`, {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-robots-tag': 'noindex',
    },
  });
}

export function proxy(request: NextRequest): NextResponse {
  const sanitized = stripInboundTenantHeaders(request);

  const { pathname } = request.nextUrl;
  // `/_next/*` es el runtime de la app y su URL es global al deploy: reescribirla rompe el RSC
  // payload. La doc avisa que **`_next/data` se invoca igual aunque el matcher lo excluya**
  // ("intentional behavior to prevent accidental security issues"), así que la guardia va acá
  // adentro y no sólo en el `matcher`.
  if (isInfrastructurePath(pathname)) return passthrough(sanitized);

  // `/_media/**` es el otro espacio de URLs **global al deploy**: la key es content-addressed, o
  // sea un hash del byte, sin `tenant_id` ni `listing_id` adentro (ADR-006). Dos tenants que suban
  // la misma foto comparten el objeto, así que esa URL no es de la vidriera de ningún slug:
  // reescribirla a `/s/{slug}/_media/…` la mandaría a una ruta que no existe y dejaría **todas** las
  // fotos de **todas** las vidrieras rotas. Pasa derecho — pero pasa por acá, que es el punto: hasta
  // S2 este camino quedaba afuera del `matcher` (las fotos son `.webp`, uno de los 16 sufijos
  // excluidos) y `stripInboundTenantHeaders()` no corría sobre él. El argumento largo, incluido por
  // qué se contempla la forma `%5F`, está en `isGlobalMediaPath`.
  if (isGlobalMediaPath(pathname)) return passthrough(sanitized);

  // `/s/**` es NUESTRO espacio interno: el destino del rewrite, no una URL pública. Se corta acá
  // arriba, antes de resolver el host y sin importar cuál sea, por dos motivos:
  //
  // 1. **Una sola URL canónica por tenant.** `maat.work/s/acme` renderizaría lo mismo que
  //    `acme.maat.work`: contenido duplicado para Google y una segunda entrada de cache por tenant,
  //    gratis y sin motivo.
  // 2. **Es el fix del HIGH del adversary de S1.** `/s/algo.json` es match de la ruta `/s/[slug]`,
  //    y ese `slug` basura terminaba en `cacheTag()`, que tira. El porqué del 404 (y por qué
  //    ADR-011 no gobierna este caso) está entero en `isStorefrontInternalPath`.
  //
  // Los rewrites internos NO vuelven a pasar por el proxy, así que esto no toca el camino de la
  // vidriera: si volvieran, `acme.maat.work/` haría bucle infinito hoy mismo.
  if (isStorefrontInternalPath(pathname)) {
    return malformedHost('la vidriera se sirve en {slug}.maat.work, no en esta ruta.');
  }

  // ── P1: los file conventions de metadata NO tienen guarda propia, y eso es la decisión ──────
  //
  // `/favicon.ico`, `/icon.png`, `/apple-icon.png`, `/opengraph-image.png`, `/twitter-image.png`,
  // `/manifest.json`, `/robots.txt`, `/sitemap.xml`, `/sitemap/1.xml` y sus 16 hermanas caen acá
  // abajo, en la regla general, a propósito: **siguen el host como cualquier otra ruta de la
  // vidriera.** Bajo el apex pasan derecho (`resolveHost` → `marketing`); bajo `acme.maat.work` se
  // reescriben a `/s/acme/robots.txt`, `/s/acme/icon.png`, etc.
  //
  // Y esas rutas **todavía no existen** — las trae S3 —, así que hoy dan **404 bajo un host de
  // tenant. Eso es correcto, no es un pendiente**, y lo escribo acá porque el próximo que vea el
  // 404 va a querer "arreglarlo" con un passthrough:
  //
  // - Un `robots.txt` ausente significa "crawleá todo", que es exactamente lo que queremos para
  //   una vidriera pública. El 404 no bloquea a nadie.
  // - Un favicon 404 en la pestaña de `acme.maat.work` es **la ausencia de una marca**. Servirle
  //   ahí el ícono del apex —que es lo que pasaba hasta esta slice— es poner la marca de MaatWork
  //   en la vidriera de un cliente. Entre las dos, el 404 es la correcta.
  // - Lo mismo con `sitemap.xml`: servirle a `acme.maat.work` el sitemap de marketing es peor que
  //   no darle ninguno, porque le declara a Google que las URLs de ese host son las del apex.
  //
  // O sea: el bug no era el 404, era el 200 con el archivo de otro. Por eso **no hay `if` acá**.
  // `/_media/**` sí tiene guarda porque su URL es global al deploy (content-addressed, sin tenant
  // adentro); estas no lo son: `/icon.png` significa una cosa distinta en cada host.
  //
  // NO se implementan `/s/[slug]/robots.txt` ni `/s/[slug]/sitemap.xml` en esta slice: son S3 y
  // van con su propio perfil de cache (un sitemap que pegue a Postgres por hit de crawler rompe el
  // 95% de `CLAUDE.md` §3). Esta slice es sólo el enrutamiento.

  const resolved = resolveHost(request.headers.get('host'));

  switch (resolved.kind) {
    case 'marketing':
      return passthrough(sanitized);

    case 'not-found':
      return malformedHost(resolved.reason);

    case 'storefront': {
      const url = request.nextUrl.clone();
      // `clone()` preserva el querystring. El slug queda como SEGMENTO DE PATH → llega a la
      // página como `params.slug`, entra al cache key de `'use cache'` y al `cacheTag`.
      url.pathname = storefrontPathFor(resolved.slug, pathname);
      return sanitized === null
        ? NextResponse.rewrite(url)
        : NextResponse.rewrite(url, { request: { headers: sanitized } });
    }

    default: {
      const never: never = resolved;
      throw new Error(`resolveHost devolvió un caso desconocido: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Sin `matcher`, el proxy corre sobre **todo**, incluidos `_next/static`, `_next/image` y los
 * archivos de `public/`. Cada invocación se factura (Active CPU + invocación) y ninguna de esas
 * necesita resolución de host.
 *
 * ## El criterio, después de cuatro agujeros de la misma familia (P2, S8)
 *
 * La exclusión de este matcher mira el **sufijo del path**. El router de Next matchea por
 * **segmento** y decide los file conventions de metadata **por nombre de archivo**. Esa
 * discrepancia produjo cuatro agujeros, todos el mismo bug con otra ropa:
 *
 * | # | URL | por qué el sufijo no alcanzaba |
 * |---|---|---|
 * | S1 | `/s/algo.json` | `/s/[slug]` matchea con `slug = "algo.json"` |
 * | S2 | `/_media/…​.webp` | `[...key]`: la extensión la elige quien pide la URL |
 * | P2 | `/icon.png`, `/robots.txt`, `/sitemap/1.xml` (25 URLs) | son **nombres**, no sufijos |
 * | S8 | `/app/canjes/basura-991.json` (×16 sufijos) | `/app/canjes/[id]`: el dinámico es el **último** segmento |
 *
 * Los dos primeros se taparon agregando una entrada de inclusión por incidente. El tercero **no**
 * se tapa así: son 25 URLs de 8 convenciones, y la lista crece cada vez que Next agrega una.
 * El cuarto tampoco se tapa por URL, y el porqué está abajo, en la entrada `/app/:path*`.
 *
 * **La causa raíz, medida:** `apps/web/public/` **no existe** — ni ahí ni en la raíz del repo, y no
 * hay un solo `favicon.ico`, `icon.*`, `robots.txt` ni `sitemap.xml` en el árbol. La exclusión de
 * 16 sufijos no protege **ningún archivo**: protege una carpeta que nunca se creó. Su costo real
 * hoy es **cero requests ahorradas** y tres agujeros producidos.
 *
 * **Lo que se hizo, entonces:** se sacaron del lookahead los tres nombres propios
 * (`favicon\.ico`, `robots\.txt`, `sitemap\.xml` — que excluían por partida doble, así que acotar
 * sólo los sufijos los dejaba afuera igual) y la exclusión por sufijo pasó a **no aplicarse a los
 * file conventions de metadata**, que es el lookahead anidado del final. El criterio ya no es
 * "sufijo de archivo" sino **el mismo que usa Next: el nombre**. `/icon.png` es una ruta de la app
 * y entra; `/logo.png` es un asset y no entra. Por sufijo esas dos URLs son indistinguibles, y ése
 * era exactamente el problema.
 *
 * La cobertura la verifica `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`, que
 * deriva las 25 URLs ejecutando las funciones del propio Next (`fillStaticMetadataSegment`,
 * `normalizeMetadataRoute`), no de una lista escrita a mano. Si Next cambia una convención, ese
 * guard se pone rojo con nombre y valor viejo/nuevo.
 *
 * **Qué pasa a invocar el proxy que hoy no lo invoca: hoy, nada.** No existe en el repo ningún
 * archivo que se sirva en esas 25 URLs, así que las 25 devuelven 404 con o sin proxy y el delta de
 * invocaciones facturadas es **0**. A futuro, cuando S3 traiga los file conventions por tenant, las
 * que pasen a existir se piden **una vez por sesión de browser y quedan cacheadas por el CDN**
 * (`favicon` y `manifest` con `immutable`), contra los ~40 chunks de `_next/static` por pageview
 * que siguen afuera. El orden de magnitud del ahorro no se mueve.
 *
 * ## Por qué `_next/static` y `_next/image` se quedan afuera
 * Ahí está el volumen real —decenas de subrequests por pageview— y ninguno de los dos puede ser
 * jamás una ruta de la app: son espacios de URL del runtime del build, globales al deploy. Es el
 * único par que se puede excluir **por prefijo** sin razonar por sufijo, o sea sin reabrir el bug.
 * (`isInfrastructurePath()` en el cuerpo los cubre igual, porque la doc avisa que `_next/data` se
 * invoca aunque el matcher lo excluya.)
 *
 * ## Las cinco entradas de inclusión, revisadas en P2 y ampliadas en S8
 * Con la exclusión acotada, cuatro son **load-bearing** y una es redundante:
 *
 * - **`/s/:path*` (necesaria).** `/s/algo.json` sigue cayendo en la exclusión por sufijo —`algo.json`
 *   no es un nombre de convención—, así que sin esta entrada el HIGH de S1 vuelve tal cual.
 * - **`/app/:path*` (necesaria, S8: el panel ENTERO, no una ruta).** Cierra el cuarto agujero de la
 *   tabla de arriba. `/app/canjes/[id]` es la primera ruta de `/app` cuyo segmento dinámico es el
 *   **último**: el valor lo elige quien pide la URL, así que `/app/canjes/basura-991.json` es match
 *   perfecto de la ruta —el router de Next acepta un punto adentro de un segmento— y, a la vez, cae
 *   en la exclusión por sufijo. Resultado medido: **16 URLs (una por sufijo) que la app atiende y el
 *   proxy no ve**, con las dos consecuencias de siempre — las guardas de host y de path no se
 *   evalúan, y sobre todo **`stripInboundTenantHeaders()` no corre**, o sea un `x-tenant-*` puesto
 *   por el cliente sobrevive hasta el panel (`CLAUDE.md` §2: escalación de tenant). Por eso entra
 *   `/app`: no porque el panel necesite rewrite —bajo un host de tenant lo va a resolver el cuerpo,
 *   como cualquier otra ruta—, sino porque **el saneo de headers no puede ser opcional en el
 *   subárbol autenticado**.
 *
 *   **Por qué NO se arregló estrecho, que es la parte que importa.** La corrección obvia era darle
 *   una excepción a la regex por esta ruta (`(?!app/canjes/)…`). Eso deja el mismo agujero esperando
 *   a la próxima ruta de `/app` con dinámico final —`/app/clientes/[id]`, `/app/reservas/[id]`, la
 *   que sea—, que es exactamente cómo este repo pagó S1 y S2: una excepción por incidente. La
 *   inclusión por subárbol no depende de qué rutas se creen adentro: `/app/**` es del panel entero y
 *   **no hay nada más ahí**. La entrada gana sobre la exclusión por sufijo porque el `matcher` es una
 *   lista **OR**, y eso está verificado contra el Next instalado, no supuesto: la doc dice *"For
 *   multiple paths: Use an array … which applies the Proxy to both"*, y
 *   `next/dist/shared/lib/router/utils/middleware-route-matcher` itera las entradas y devuelve
 *   `true` en el primer match (`if (!routeMatch) continue`). Es el mismo mecanismo con el que `/s` y
 *   `/_media` ya ganan hoy.
 *
 *   **No mete estáticos al proxy: `apps/web/public/` no existe** (re-medido en S8; tampoco hay
 *   `public/` en la raíz del repo, ni un solo archivo no-TS bajo `apps/web/app`). Y si existiera,
 *   los assets de `public/` se sirven desde la **raíz** (`/logo.png`, `/fonts/inter.woff2`), no
 *   bajo `/app/`. Medido con `getMiddlewareMatchers` + `getMiddlewareRouteMatcher` del propio Next:
 *   las siete URLs de asset del guard siguen dando `false` con esta entrada puesta.
 *
 *   **No hace falta `/app` pelado, y se midió antes de no escribirlo.** El regex que Next compila
 *   para `/app/:path*` es `^…\/app(?:\/(…))?(\.json|\.rsc|…)?[\/#\?]?$`: el grupo del `*` es
 *   opcional, así que la entrada **ya cubre `/app`** (y `/app/`). Tampoco desborda a hermanos por
 *   prefijo de string: `/appendix`, `/apps` y `/app-otro` dan `false` — `path-to-regexp` ancla por
 *   segmento. Es la diferencia con `/s`, que sí tiene entrada pelada: allá se dejó por no tocar lo
 *   que ningún test respalda; acá agregarla sería una segunda entrada redundante contra la primera,
 *   y el `/app` pelado del panel (`app/(app)/app/(panel)/page.tsx`) ya está fijado por el guard.
 *
 *   **Ninguna entrada vieja queda muerta.** `/s`, `/s/:path*`, `/_media/:path*` y `/%5Fmedia/:path*`
 *   viven en subárboles disjuntos de `/app`, y la exclusión por sufijo sigue siendo la única que
 *   deja afuera los assets de raíz. Lo único que se solapa es el catch-all, que ya cubría los paths
 *   de `/app` **sin** extensión: ese solape es el punto, no un descuido.
 * - **`/_media/:path*` y `/%5Fmedia/:path*` (necesarias).** Ídem con `.webp`/`.avif`: es el fix de
 *   S2, y la forma `%5F` va porque el directorio en disco es `%5Fmedia` (`_media` sería *private
 *   folder*). El argumento largo de las dos está en `isGlobalMediaPath`.
 * - **`/s` (redundante hoy, se queda).** `/s` pelado no tiene extensión, así que el catch-all ya lo
 *   cubre. Se queda por dos motivos, ninguno estético: (a) no hay hoy ningún test que fije el
 *   comportamiento de `/s` pelado, así que borrarla sería un cambio **no medido** —y la regla de
 *   esta slice es no tocar lo que ningún test respalde—; (b) hace que llegar a la guarda de
 *   `isStorefrontInternalPath` no dependa del lookahead del catch-all, que es el mecanismo que ya
 *   falló tres veces. Cuesta cero: nadie pide `/s`.
 *
 * Ninguna de las tres necesarias amplía el gasto sobre assets: `/s/**` y `/_media/**` son rutas de
 * la app, siempre se sirvieron con una invocación. Lo único que cambia es que ahora esa invocación
 * está precedida por un `if` de dos comparaciones de string, sin red y sin allocations.
 *
 * ## Qué medir contra un server real (no lo puedo correr yo, requiere build)
 * 1. `curl -sI http://127.0.0.1:3100/_next/static/chunks/<uno real>.js` → `200` + `cache-control:
 *    public, max-age=31536000, immutable`. Si el proxy se metiera en el medio, ese header cambia.
 * 2. Lo mismo con `Host: demo.127.0.0.1.nip.io`: mismo `200` y mismo `cache-control`. Es el caso
 *    que rompe si alguien alguna vez saca `isInfrastructurePath` del cuerpo del proxy.
 * 3. `curl -s http://demo.127.0.0.1.nip.io:3100/ | grep -c '/_next/static'` > 0 y cada uno de esos
 *    chunks devuelve `200` — o sea, la página **carga** sus propios assets, no sólo los nombra.
 * 4. Control negativo de S1: `/s/x.json`, `/s/x.txt`, `/s/x.css`, `/s/x.xml`, `/s/x.woff2` → los
 *    cinco `404`, en milisegundos, con `content-type: text/plain` (es la respuesta del proxy) y sin
 *    `__next_error__` en el body. Es lo que ya chequea `scripts/accept-s1.sh` A8.
 * 5. Control de S2, el que importa porque la regresión sería silenciosa: la MISMA key de variante
 *    pedida con `Host: 127.0.0.1.nip.io` (apex) y con `Host: demo.127.0.0.1.nip.io` (tenant) tiene
 *    que devolver `200` y los mismos bytes en los dos casos. Si alguien saca la guarda de
 *    `isGlobalMediaPath` del cuerpo, el segundo pasa a `404` y las fotos desaparecen sólo en los
 *    subdominios de tenant — o sea, en el único lugar donde alguien las mira.
 * 6. Control de P2, nuevo: `curl -sI http://127.0.0.1.nip.io:3100/robots.txt` (apex) y
 *    `curl -sI http://demo.127.0.0.1.nip.io:3100/robots.txt` (tenant) **no** pueden devolver el
 *    mismo body. Hoy los dos dan `404` (no existe el archivo en ningún lado) y eso es pasar; lo que
 *    reprueba es que el segundo devuelva `200` con el `robots.txt` del apex.
 * 7. Control de S8, y es el único de la lista que **no** es observable sin instrumentar: pedir
 *    `/app/canjes/basura-991.json` con un header `x-tenant-id: otro` y verificar que la request que
 *    llega al panel **no** lo trae. Sin un endpoint que refleje headers no se puede medir desde
 *    afuera — por eso la afirmación la sostiene el guard estático
 *    (`tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`) y no el e2e. Lo que sí se mide
 *    con `curl`: esa URL bajo un host de tenant tiene que dar `404` de la vidriera (el rewrite a
 *    `/s/{slug}/app/…` no existe), no la página del panel.
 *
 * **No se declara `runtime`**: en Proxy esa opción tira error (v16.0.0). El runtime es Node.js.
 */
export const config = {
  matcher: [
    '/s',
    '/s/:path*',
    // El panel entero. Gana sobre la exclusión por sufijo (el matcher es una lista OR) y por eso
    // `/app/canjes/basura-991.json` —match de la ruta `/app/canjes/:id`, con el segmento dinámico
    // en el ÚLTIMO lugar— ya no se saltea `stripInboundTenantHeaders()`. Subárbol, no ruta: una
    // excepción por ruta reabriría el mismo agujero con la próxima. Cubre `/app` sin entrada aparte.
    // (Los comentarios de este array van SIN corchetes a propósito: el guard lo lee del FUENTE con
    // un regex no-goloso que corta en el primer corchete de cierre, así que un corchete adentro de
    // un comentario le esconde la mitad de las entradas y el rojo que da no habla de eso.)
    '/app/:path*',
    '/_media/:path*',
    '/%5Fmedia/:path*',
    // El lookahead anidado se lee así: excluí un path por su sufijo **salvo** que sea un file
    // convention de metadata de Next. La lista de adentro es la de Next, nombre POR extensión y no
    // "nombre con cualquier extensión": `robots.txt` es convention y `robots.png` no lo es, así que
    // este matcher tampoco lo trata como tal. `icon\d*` cubre `icon1.png` (la doc permite numerar
    // sólo las cuatro de imagen) y `sitemap/\d+\.xml` cubre `generateSitemaps`.
    // `/logo.png` → excluido, es un asset. `/icon.png` → adentro, es una ruta.
    // El `(?:.*/)?` es deliberado: las conventions de imagen y el sitemap NO son sólo de la raíz,
    // así que `/precios/icon.png` es tan ruta de la app como `/icon.png`. Anclarlo a la raíz
    // dejaría el mismo agujero un nivel más abajo, esperando a la primera convention anidada.
    '/((?!_next/static|_next/image|(?!(?:.*/)?(?:favicon\\.ico|icon\\d*\\.(?:ico|jpe?g|png|svg)|apple-icon\\d*\\.(?:jpe?g|png)|(?:opengraph|twitter)-image\\d*\\.(?:jpe?g|png|gif)|manifest\\.(?:json|webmanifest)|robots\\.txt|sitemap\\.xml|sitemap/\\d+\\.xml)$).*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|txt|xml|json|woff|woff2|ttf)$).*)',
  ],
};
