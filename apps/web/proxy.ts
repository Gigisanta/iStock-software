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
 * Lo que queda excluido acá se sirve desde el apex: `robots.txt` y `sitemap.xml` por tenant son de
 * S3, no de esta slice.
 *
 * ## Las dos primeras entradas son el fix del HIGH del adversary de S1. No son decorativas.
 * La exclusión por extensión de la tercera entrada es un match de SUFIJO, no de directorio: no
 * distingue `/logo.png` (un archivo real de `public/`) de `/s/algo.json` (**una ruta de la app**,
 * porque `/s/[slug]` matchea con `slug = "algo.json"`). El resultado era que sobre `/s/**` el proxy
 * no corría, la guarda de `isStorefrontInternalPath` no se evaluaba, y el slug basura llegaba a
 * `cacheTag()` → throw de render → bajo `cacheComponents` + PPR, **stream colgado con `200`**.
 *
 * El arreglo es declarar el prefijo `/s` como cubierto SIEMPRE. Los matchers de un array se
 * combinan con OR (doc de `proxy.md`: *"For multiple paths: Use an array"*), así que estas dos
 * entradas ganan sobre cualquier exclusión de la tercera. Van las dos porque `:path*` es *cero o
 * más* segmentos y no quiero que el caso `/s` pelado dependa de esa lectura.
 *
 * **Por qué NO se toca la exclusión por extensión** (que era la otra salida posible): existe para
 * que `public/` se sirva sin invocar el proxy, y `public/` cuelga de la RAÍZ (`/logo.png`,
 * `/fonts/x.woff2`), nunca de `/s/**`. Sacarla mandaría cada asset al proxy —invocación + Active
 * CPU en el 100% de los assets, contra el presupuesto de ADR-007— y, peor, sobre un host de tenant
 * `/logo.png` se reescribiría a `/s/{slug}/logo.png` y el asset dejaría de existir. Acotar la
 * exclusión es correcto; borrarla rompe el servido estático.
 *
 * **Qué medir para saber que `/_next/static` no se rompió** (no lo puedo correr yo, requiere build):
 * 1. `curl -sI http://127.0.0.1:3100/_next/static/chunks/<uno real>.js` → `200` + `cache-control:
 *    public, max-age=31536000, immutable`. Si el proxy se metiera en el medio, ese header cambia.
 * 2. Lo mismo con `Host: demo.127.0.0.1.nip.io`: mismo `200` y mismo `cache-control`. Es el caso
 *    que rompe si alguien alguna vez saca `isInfrastructurePath` del cuerpo del proxy.
 * 3. `curl -s http://demo.127.0.0.1.nip.io:3100/ | grep -c '/_next/static'` > 0 y cada uno de esos
 *    chunks devuelve `200` — o sea, la página **carga** sus propios assets, no sólo los nombra.
 * 4. Control negativo del fix: `/s/x.json`, `/s/x.txt`, `/s/x.css`, `/s/x.xml`, `/s/x.woff2` → los
 *    cinco `404`, en milisegundos, con `content-type: text/plain` (es la respuesta del proxy) y sin
 *    `__next_error__` en el body. Es lo que ya chequea `scripts/accept-s1.sh` A8.
 *
 * **No se declara `runtime`**: en Proxy esa opción tira error (v16.0.0). El runtime es Node.js.
 */
export const config = {
  matcher: [
    '/s',
    '/s/:path*',
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|txt|xml|json|woff|woff2|ttf)$).*)',
  ],
};
