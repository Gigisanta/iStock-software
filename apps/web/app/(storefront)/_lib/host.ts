/**
 * `host → tenant`, en TypeScript puro. **Cero I/O, cero `next/*`, cero globals.**
 *
 * Este módulo es el cerebro entero de `apps/web/proxy.ts`. Vive acá y no dentro del proxy por dos
 * razones concretas:
 *
 * 1. **Se puede testear con Vitest sin levantar Next.** El proxy corre fuera del runtime de la app
 *    y no hay forma barata de ejercitarlo en unit test; esta función sí.
 * 2. **Deja el proxy trivialmente auditable.** Lo que el LEAD tiene que verificar (`0 llamadas de
 *    red`, `< 2 ms de CPU`) se lee de un vistazo si el archivo son 60 líneas de string ops.
 *
 * ## Lo que este archivo NO hace, a propósito (ADR-007 §3)
 * - **No consulta Postgres.** No sabe qué tenants existen. Sólo sabe qué *forma* tiene un slug.
 * - **No cachea nada.** No hay `Map` a nivel de módulo. La doc de `proxy.ts` dice literal que no
 *   dependas de módulos ni globals compartidos: el proxy puede desplegarse al CDN y cada
 *   invocación puede ser otra instancia. Un `Map` acá no sería un cache, sería una mentira.
 * - **No decide si el tenant existe.** Eso lo decide la página cacheada, con **una** query en el
 *   miss y **cero** en el hit.
 *
 * ## Por qué el slug termina en el PATH y no en un header (ADR-007 §4)
 * Dos razones independientes, cada una suficiente:
 * - `headers()` dentro de `'use cache'` tira `next-request-in-use-cache` y vuelve la ruta dinámica
 *   → adiós ISR, adiós "95% de los hits sin Postgres".
 * - El cache key del CDN **sí** incluye el host, pero el de `'use cache'` y el del ISR durable
 *   **no**: son build ID + function ID + argumentos. Dos subdominios que rendericen el mismo path
 *   con los mismos argumentos **comparten entrada**. Eso es servir la vidriera del tenant A bajo el
 *   dominio del tenant B: una fuga entre tenants, no una ineficiencia.
 */

import {
  PRERENDER_SEED_SLUG,
  RESERVED_SUBDOMAINS,
  STOREFRONT_DOMAIN,
  isReservedSubdomain,
} from '@istock/domain';

/**
 * Los tres se **re-exportan** en vez de re-declararse.
 *
 * `packages/domain` es el único paquete que los cuatro owners del slug pueden importar (TS puro,
 * cero I/O), así que es el único lugar donde "una sola lista" es una propiedad del grafo de
 * imports y no una promesa de code review. Mientras la lista estuvo escrita dos veces — acá y en
 * `(app)/_lib/slug-format.ts` — **ya había divergido**: el proxy mandaba `not-a-tenant.maat.work`
 * a marketing y el panel dejaba registrar ese mismo nombre. Quien lo registrara pagaba un plan y
 * su vidriera no existía nunca. No rompe el build ni un test unitario: aparece con el cliente.
 *
 * El re-export existe porque el resto de `(storefront)` (y los tests de `qa-agent`) leen estos
 * símbolos desde acá: el proxy y su cerebro son un solo módulo desde afuera.
 *
 * - {@link RESERVED_SUBDOMAINS} — subdominios que **nunca** son una vidriera. Ojo con `demo`: NO
 *   está en este Set a propósito (`demo.maat.work` sirve el tenant demo, S13), pero **sí** está en
 *   `RESERVED_SLUGS`, así que nadie lo puede registrar. Esa asimetría es la razón por la que en
 *   `@istock/domain` hay dos Sets y no uno.
 * - {@link PRERENDER_SEED_SLUG} — el artefacto del que depende que la vidriera sea cacheable.
 *
 * ## {@link PRERENDER_SEED_SLUG} — el `slug` que `/s/[slug]` prerenderiza en el build
 *
 * ### Por qué existe (esto NO es decorativo: es lo que hace cacheable la vidriera)
 * Con `cacheComponents: true`, una ruta con segmento dinámico y **sin** `generateStaticParams` se
 * sirve siempre en modo *postponed*: `Cache-Control: private, no-cache, no-store` y una invocación
 * de función en el 100% de los pageviews. Medido en `next start` 16.3.3, con la página entera bajo
 * `'use cache'`. Con `generateStaticParams` presente — **aunque devuelva un solo slug que no le
 * importa a nadie** — la ruta pasa a ISR clásico: `s-maxage=2592000, stale-while-revalidate=28944000`,
 * `MISS` la primera vez y `HIT` después, **también para slugs que no existían en el build**.
 *
 * O sea: el contenido de esta entrada es irrelevante; lo que importa es que la lista no esté vacía
 * (Next exige ≥ 1 resultado con Cache Components).
 *
 * ### Por qué NO es la lista real de tenants
 * Prerenderizar todos los tenants ataría el build a Postgres, haría una query por tenant en **cada
 * deploy** y generaría un pico de ISR Writes proporcional a `tenants × páginas` — y los tenants
 * dados de alta después del deploy quedarían igual en el camino on-demand. Con el slug semilla el
 * build hace **cero** queries (verificado: `next build` sin `DATABASE_URL` compila) y cada vidriera
 * se materializa sola en su primer visitante.
 *
 * ### Por qué este slug y no `demo`
 * `/s/not-a-tenant` es **inalcanzable en producción**: el proxy manda `not-a-tenant.maat.work` a
 * marketing (está reservado) y `/s/*` sobre el apex da 404. La entrada del build es un artefacto,
 * no una página que alguien pueda ver. Con `demo` el build tendría que consultar la DB y, si el
 * tenant demo faltara ese día, dejaría un 404 estático servido bajo el nombre del demo.
 */
export { PRERENDER_SEED_SLUG, RESERVED_SUBDOMAINS, isReservedSubdomain };

/**
 * Mismo regex que el `CHECK tenants_slug_format` de `packages/db` y que `assertSlug()` de
 * `@istock/domain`: minúsculas, dígitos y guiones, 3–32 caracteres, sin guión en los bordes.
 *
 * Que sea el mismo en los tres lados no es prolijidad: un slug que la DB acepta y el proxy rechaza
 * es un tenant que paga y no tiene vidriera. Un slug que el proxy acepta y la DB no, es un 404
 * cacheado para siempre.
 *
 * Además acota el largo **por debajo** del límite de label DNS (63 chars, RFC 1035) y muy por
 * debajo del límite de cache tag (256 bytes).
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** El primer segmento de la vidriera. `acme.maat.work/x` → `/s/acme/x`. */
export const STOREFRONT_PATH_PREFIX = '/s';

/** Sufijos que son infraestructura, no tenants: nunca se reescriben. */
const PASSTHROUGH_SUFFIXES = ['.vercel.app', '.vercel.sh'] as const;

/** Hosts de desarrollo que representan el apex (marketing), no un tenant. */
const LOCAL_APEX = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export type HostResolution =
  /** Apex, `www` o un subdominio reservado → no se toca la request. */
  | { readonly kind: 'marketing' }
  /** Subdominio con forma de slug. **No** quiere decir que el tenant exista. */
  | { readonly kind: 'storefront'; readonly slug: string }
  /**
   * Host con forma de vidriera pero label inválido (`Foo_Bar.maat.work`, `a.b.maat.work`).
   * No puede ser un tenant **jamás**, porque la DB no acepta ese slug → 404 sin invocar la app.
   */
  | { readonly kind: 'not-found'; readonly reason: string };

/**
 * `Acme.MAAT.work:3000` → `acme.maat.work`. Minúsculas, sin puerto, sin punto final.
 *
 * El puerto **importa**: en dev el header `host` llega como `acme.localhost:3000` y sin el
 * `split(':')` el slug sale mal en local y bien en prod. Es el bug clásico de esta función.
 */
export function normalizeHostname(rawHost: string | null | undefined): string {
  if (rawHost === null || rawHost === undefined) return '';
  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) return '';

  // IPv6 literal: `[::1]:3000`. El `:` del puerto está fuera de los corchetes.
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close === -1 ? host : host.slice(1, close);
  }

  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  // FQDN con punto raíz: `acme.maat.work.`
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** `127-0-0-1` / `192-168-0-10`: parte de `nip.io`, no un slug. */
const DASHED_IPV4_RE = /^\d{1,3}(?:-\d{1,3}){3}$/;
const NUMERIC_LABEL_RE = /^\d+$/;

function labelToResolution(label: string): HostResolution {
  if (RESERVED_SUBDOMAINS.has(label)) return { kind: 'marketing' };
  if (!SLUG_RE.test(label)) {
    return { kind: 'not-found', reason: `subdominio "${label}" no tiene forma de slug de tenant` };
  }
  return { kind: 'storefront', slug: label };
}

/**
 * Dev en la LAN: `acme.127.0.0.1.nip.io` o `acme.127-0-0-1.nip.io`.
 * Es el único modo de abrir la vidriera **desde un celular real**, que es exactamente el caso de
 * uso del producto (mobile-first, 4G malo, una mano). `lvh.me` sólo resuelve a loopback.
 *
 * Devuelve `null` si el host no es de esa familia.
 */
function resolveWildcardIpHost(hostname: string): HostResolution | null {
  const suffix = ['.nip.io', '.sslip.io'].find((s) => hostname.endsWith(s));
  if (suffix === undefined) return null;

  const rest = hostname.slice(0, -suffix.length).split('.');
  const first = rest[0];
  // `127.0.0.1.nip.io` / `127-0-0-1.nip.io`: es el apex de dev, no hay slug adelante.
  if (rest.length < 2 || first === undefined) return { kind: 'marketing' };
  if (NUMERIC_LABEL_RE.test(first) || DASHED_IPV4_RE.test(first)) return { kind: 'marketing' };
  return labelToResolution(first);
}

export interface ResolveHostOptions {
  /** Default `maat.work` (`STOREFRONT_DOMAIN` de `@istock/domain`). */
  readonly rootDomain?: string;
}

/**
 * El único punto de decisión del proxy. **O(1), sin red, sin allocations raras.**
 *
 * | host | resultado |
 * |---|---|
 * | `maat.work`, `www.maat.work` | `marketing` |
 * | `acme.maat.work` | `storefront('acme')` |
 * | `app.maat.work` | `marketing` (reservado) |
 * | `Foo_Bar.maat.work`, `a.b.maat.work` | `not-found` |
 * | `localhost`, `127.0.0.1` | `marketing` |
 * | `acme.localhost` | `storefront('acme')` |
 * | `acme.127.0.0.1.nip.io` | `storefront('acme')` |
 * | `cualquier-cosa.vercel.app` | `marketing` (preview de Vercel) |
 * | host vacío / desconocido | `marketing` (nunca 404 por un header raro) |
 */
export function resolveHost(rawHost: string | null | undefined, options: ResolveHostOptions = {}): HostResolution {
  const hostname = normalizeHostname(rawHost);
  if (hostname.length === 0) return { kind: 'marketing' };

  // Preview de Vercel y compañía: el primer label es un hash de deploy, no un tenant.
  for (const suffix of PASSTHROUGH_SUFFIXES) {
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) return { kind: 'marketing' };
  }

  const ipHost = resolveWildcardIpHost(hostname);
  if (ipHost !== null) return ipHost;

  // Dev: `acme.localhost` / `acme.127.0.0.1`
  for (const apex of LOCAL_APEX) {
    if (hostname === apex) return { kind: 'marketing' };
    if (hostname.endsWith(`.${apex}`)) {
      const labels = hostname.slice(0, -(apex.length + 1)).split('.');
      const first = labels[0];
      if (labels.length !== 1 || first === undefined) {
        return { kind: 'not-found', reason: `host de dev con más de un subdominio: "${hostname}"` };
      }
      return labelToResolution(first);
    }
  }

  const rootDomain = (options.rootDomain ?? STOREFRONT_DOMAIN).toLowerCase();
  if (hostname === rootDomain) return { kind: 'marketing' };
  if (!hostname.endsWith(`.${rootDomain}`)) {
    // Dominio custom del tenant (upsell futuro) o host desconocido. Hoy no se resuelve acá:
    // pasar a marketing es lo único honesto. Un 404 rompería healthchecks y dominios apuntados
    // por error.
    return { kind: 'marketing' };
  }

  const labels = hostname.slice(0, -(rootDomain.length + 1)).split('.');
  const first = labels[0];
  if (labels.length !== 1 || first === undefined) {
    // `a.b.maat.work`. No es un tenant: el wildcard de Vercel es de **un** nivel.
    return { kind: 'not-found', reason: `subdominio anidado no soportado: "${hostname}"` };
  }
  return labelToResolution(first);
}

/**
 * `('acme', '/')` → `/s/acme` · `('acme', '/p/iphone-14')` → `/s/acme/p/iphone-14`.
 *
 * El slug ya viene validado por `resolveHost`; se re-valida igual porque esta función es exportada
 * y el día que alguien la llame desde otro lado, el path traversal entra por acá.
 */
export function storefrontPathFor(slug: string, pathname: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`storefrontPathFor: slug inválido "${slug}"`);
  const rest = pathname === '/' ? '' : pathname;
  return `${STOREFRONT_PATH_PREFIX}/${slug}${rest}`;
}

/**
 * Paths que el proxy nunca reescribe aunque el host sea de un tenant.
 *
 * `/_next/*` es el runtime de la app y su URL es global al deploy: reescribirlo rompe el RSC
 * payload y el chunk loading. La doc avisa además que **`_next/data` se invoca igual aunque el
 * matcher lo excluya**, así que la guardia tiene que estar también acá adentro, no sólo en el
 * `matcher`.
 */
export function isInfrastructurePath(pathname: string): boolean {
  return pathname === '/_next' || pathname.startsWith('/_next/') || pathname.startsWith('/__nextjs');
}
