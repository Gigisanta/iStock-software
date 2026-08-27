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
import { isInfrastructurePath, resolveHost, storefrontPathFor } from './app/(storefront)/_lib/host';

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
 * Se usa sólo para hosts que no pueden ser un tenant **jamás** (`Foo_Bar.maat.work`,
 * `a.b.maat.work`): la DB tiene un `CHECK` con el mismo regex, así que no existe el futuro en el
 * que ese slug se dé de alta. Un slug **bien formado pero inexistente** NO pasa por acá: va a la
 * página cacheada y sale como 404 real y cacheable (ver `s/[slug]/page.tsx`).
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

  const resolved = resolveHost(request.headers.get('host'));

  switch (resolved.kind) {
    case 'marketing': {
      // Una sola URL canónica por tenant. `maat.work/s/acme` renderiza lo mismo que
      // `acme.maat.work` pero bajo otro host: contenido duplicado para Google y una segunda
      // entrada de cache por tenant, gratis y sin motivo. Los rewrites internos NO vuelven a
      // pasar por el proxy, así que esto no afecta al camino de la vidriera.
      if (pathname === '/s' || pathname.startsWith('/s/')) {
        return malformedHost('la vidriera se sirve en {slug}.maat.work, no en este host.');
      }
      return passthrough(sanitized);
    }

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
 * **No se declara `runtime`**: en Proxy esa opción tira error (v16.0.0). El runtime es Node.js.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|txt|xml|json|woff|woff2|ttf)$).*)',
  ],
};
