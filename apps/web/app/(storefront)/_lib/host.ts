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
  DEMO_TENANT_SLUG,
  PRERENDER_SEED_SLUG,
  RESERVED_SUBDOMAINS,
  SLUG_PATTERN,
  STOREFRONT_DOMAIN,
  isReservedSubdomain,
  isSlugShaped,
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
 * marketing (está reservado) y `/s/**` da 404 desde el proxy en **cualquier** host, con slug válido
 * o no (ver {@link isStorefrontInternalPath}). La entrada del build es un artefacto,
 * no una página que alguien pueda ver. Con `demo` el build tendría que consultar la DB y, si el
 * tenant demo faltara ese día, dejaría la página de miss prerenderizada bajo el nombre del demo.
 */
export {
  DEMO_TENANT_SLUG,
  PRERENDER_SEED_SLUG,
  RESERVED_SUBDOMAINS,
  isReservedSubdomain,
  isSlugShaped,
};

/**
 * **Alias de `SLUG_PATTERN` de `@istock/domain`. Ya no es una segunda declaración.**
 *
 * Hasta S1 este regex estaba escrito de nuevo acá **y** en `_lib/cache-tags.ts`, idéntico carácter
 * por carácter, sin nada que atara las dos copias. El adversary lo reportó y tenía razón sobre por
 * qué importa: mientras coincidieran, un host bien formado nunca podía disparar el throw de
 * `cacheTag()`; el día que alguien aflojara **una sola** (por ejemplo a 63 caracteres, para
 * alinearla con el límite de label DNS de RFC 1035) el proxy iba a aceptar un host que `cacheTag()`
 * rechaza, y ese throw es un stream colgado en el camino caliente, no un 500.
 *
 * Ahora hay una sola fuente en TypeScript: `packages/domain`, que es el único paquete que los
 * cuatro owners del slug pueden importar. Quedan dos declaraciones en el repo, y la segunda es
 * inevitable: el `CHECK tenants_slug_format` de `packages/db` es SQL y no puede importar TS. Esa
 * equivalencia la sigue chequeando `host.test.ts` (TS contra el literal del `CHECK`) y
 * `scripts/guard-leaks.sh` regla 14.
 *
 * Se mantiene el nombre `SLUG_RE` exportado porque el resto de `(storefront)` y los tests lo leen
 * desde acá: el proxy y su cerebro son un solo módulo visto desde afuera. Para chequear la forma
 * preferí `isSlugShaped()`, que es la misma pregunta sin exponer un objeto `RegExp` mutable.
 */
export const SLUG_RE = SLUG_PATTERN;

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
  if (!isSlugShaped(label)) {
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
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S13 · el alias `/{demo}` del apex, y por qué es un REDIRECT y no un rewrite
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `maat.work/demo` es el link que se pega en un WhatsApp a un prospecto. Lo que tiene que abrir es
 * **la vidriera del tenant demo**, que ya tiene una URL canónica y ratificada:
 * `demo.maat.work` — `TENANT_SERVED_RESERVED_SLUGS` de `@istock/domain` existe exactamente para
 * eso (`demo` sirve vidriera y a la vez nadie lo puede registrar).
 *
 * ── Por qué NO se reescribe `/demo` → `/s/demo` ────────────────────────────────────────────────
 * Tres consecuencias, y la primera sola ya alcanza:
 *
 * 1. **Toda URL interna de la vidriera está anclada al HOST, no a un prefijo de path.** Lo declara
 *    `_lib/routes.ts`: `STOREFRONT_HOME_PATH` es `/`, `listingPath()` devuelve `/p/{listing}`,
 *    `TRADEIN_PATH` es `/canje` y `TRADEIN_ENDPOINT_PATH` es `/api/tradein` — y el 303 del canje
 *    contesta con un `Location` **relativo** a propósito, porque leer el host desde `(storefront)`
 *    es lo que prohíbe `web-lint` W002. Servida bajo `maat.work/demo`, esa misma grilla linkea a
 *    `maat.work/p/…`, que bajo el apex no es vidriera de nadie: **el demo sería una grilla donde
 *    ninguna card abre**. Arreglarlo obliga a enhebrar un base path por toda la vidriera y a
 *    mantener dos espacios de URL sincronizados para siempre.
 * 2. **El texto del `wa.me` es byte a byte** (`CLAUDE.md` §1) y termina en `{slug}.maat.work`. Bajo
 *    `maat.work/demo` el HTML le diría al comprador una URL que no es la que tiene en la barra: o
 *    miente, o aparece una segunda variante del único string que la constitución fija exacto.
 * 3. **Un rewrite por PATH es la puerta de la fuga entre tenants.** Un `if (pathname === '/demo')`
 *    puesto antes de resolver el host sirve la vidriera del demo bajo **cualquier** host, incluido
 *    `acme.maat.work`. Es la clase de bug de ADR-007 ley 2, con el agravante de que acá el
 *    contenido servido sí existe. Por eso la decisión vive **dentro de la rama `marketing`** del
 *    proxy y esa ubicación está afirmada por test (`demo.test.ts`).
 *
 * ── Qué se paga y qué se compra ────────────────────────────────────────────────────────────────
 * Se paga **un round trip** (~150–400 ms en 4G malo) la primera vez. Se compra:
 * - **cero** consultas a Postgres en el alias — no el 95% de `CLAUDE.md` §3: el 100%, porque el
 *   redirect es una función pura de `(host, path)` y ni siquiera invoca la app;
 * - **cero** entradas de cache nuevas y **cero** caminos de render nuevos: el demo lo sirve el
 *   mismo `/s/[slug]` que cualquier tenant, con su propio `storefront:demo`. El demo demuestra el
 *   producto porque **es** el producto, no una segunda copia que puede divergir;
 * - una sola URL canónica por tenant, que es la regla que `isStorefrontInternalPath` ya sostiene.
 *
 * ── `308` y no `307`, con el costo declarado ───────────────────────────────────────────────────
 * `308` es permanente: los navegadores lo cachean y Google consolida las señales en
 * `demo.maat.work`. Es cierto lo que afirma —que `demo.maat.work` es el hogar canónico del demo ya
 * está decidido en `packages/domain`, no lo decide esta slice—. **El costo es real y va escrito:**
 * un `308` cacheado por el browser es difícil de revertir, así que el día que alguien quiera una
 * landing de marketing *en* `maat.work/demo` va a tener clientes que nunca la ven. Se acepta porque
 * ese `/demo` ya está gastado como alias, y porque `307` no ahorraría nada del otro lado: la
 * respuesta del proxy no entra al CDN de Vercel en ninguno de los dos casos.
 *
 * ── Por qué tampoco va en `redirects` de `next.config.ts` ──────────────────────────────────────
 * La doc de `proxy.md` sugiere preferir `redirects` para un redirect simple, y este no lo es por
 * dos motivos: (a) el host destino **se deriva del host entrante** —`maat.work` → `demo.maat.work`,
 * pero `127.0.0.1.nip.io:3100` → `demo.127.0.0.1.nip.io:3100`, que es el host con el que corren los
 * e2e y el `next start` del gate—, así que un `destination` fijo rompe todo lo que no sea
 * producción, exactamente como advierte `STOREFRONT_HOME_PATH`; y (b) `next.config.ts` es del LEAD
 * y decide para las tres caras a la vez (`CLAUDE.md` §4).
 */

/** El alias del demo bajo el apex: `maat.work/demo`. */
export const DEMO_ALIAS_PATH = `/${DEMO_TENANT_SLUG}`;

/**
 * ¿Este path es el alias del demo, o algo colgado debajo?
 *
 * El corte es por **segmento** y no por prefijo de string: `/demostracion` no es el alias. Es la
 * misma discrepancia sufijo/segmento que produjo los cuatro agujeros del `matcher` (S1, S2, P2,
 * S8), así que acá se escribe del lado correcto desde el principio.
 *
 * `/demo/**` entra a propósito: un alias parcial que funciona en la home y muere en
 * `/demo/p/iphone-14` es un callejón sin salida para la única persona que usa esta URL. Total o
 * nada; total cuesta un `slice`.
 */
export function isDemoAliasPath(pathname: string): boolean {
  return pathname === DEMO_ALIAS_PATH || pathname.startsWith(`${DEMO_ALIAS_PATH}/`);
}

/**
 * `/demo` → `/` · `/demo/p/iphone-14` → `/p/iphone-14` · `/demo/` → `/`.
 *
 * Lo que queda es el path **tal como lo vería un visitante en `demo.maat.work`**, o sea el mismo
 * espacio de URLs que ya declara `_lib/routes.ts`. No se toca el querystring: lo preserva el
 * `clone()` del proxy, y un `?utm_source=ig` en el link que se le manda a un prospecto es
 * justamente lo que no hay que perder.
 */
export function demoAliasTargetPath(pathname: string): string {
  if (!isDemoAliasPath(pathname)) {
    throw new Error(`demoAliasTargetPath: "${pathname}" no es el alias del demo`);
  }
  const rest = pathname.slice(DEMO_ALIAS_PATH.length);
  return rest === '' || rest === '/' ? '/' : rest;
}

/**
 * El **apex con wildcard** de este host, o `null` si esta familia de hosts no tiene subdominios de
 * tenant. Es la mitad de abajo de {@link tenantHostFor}; ver allá el argumento entero.
 */
function wildcardApexOf(hostname: string, rootDomain: string): string | null {
  if (hostname.length === 0) return null;

  // Preview de Vercel: el wildcard `*.maat.work` no cubre `*.vercel.app`, y el certificado del
  // deploy tampoco. `demo.istock-git-main-x.vercel.app` no resuelve: mandar ahí a alguien es peor
  // que no tener alias. Sin apex.
  for (const suffix of PASSTHROUGH_SUFFIXES) {
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) return null;
  }

  const wildcardSuffix = ['.nip.io', '.sslip.io'].find((s) => hostname.endsWith(s));
  if (wildcardSuffix !== undefined) {
    const rest = hostname.slice(0, -wildcardSuffix.length).split('.');
    const first = rest[0];
    if (first === undefined || first === '') return null;
    // `127.0.0.1.nip.io` / `127-0-0-1.nip.io`: el apex de dev **es** el host entero.
    // El orden importa: la forma con guiones es UN solo label, así que un chequeo de largo puesto
    // antes la descartaría y `demo` no andaría en `127-0-0-1.nip.io`, que es la mitad del uso real.
    if (NUMERIC_LABEL_RE.test(first) || DASHED_IPV4_RE.test(first)) return hostname;
    if (rest.length < 2) return null;
    return hostname.slice(first.length + 1);
  }

  for (const apex of LOCAL_APEX) {
    if (hostname === apex || hostname.endsWith(`.${apex}`)) {
      // `demo.localhost` lo resuelve todo browser moderno a loopback. `demo.127.0.0.1` **no**: no se
      // le antepone un label a un literal IP. Devolver `null` ahí es lo honesto — el alias no existe
      // en ese setup y la alternativa es un `Location` a un host que no resuelve. Se documenta en el
      // proxy: sobre `127.0.0.1:3000`, `/demo` es 404 y se abre `demo.localhost:3000`.
      return apex === 'localhost' ? 'localhost' : null;
    }
  }

  if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) return rootDomain;

  // Dominio custom del tenant (upsell futuro) o host desconocido: no sabemos si tiene wildcard.
  return null;
}

/**
 * La **inversa de {@link resolveHost}**: dado el host que estoy sirviendo y un slug, ¿en qué host
 * vive la vidriera de ese slug? `null` si esta familia de hosts no sirve vidrieras.
 *
 * | host entrante | `tenantHostFor(host, 'demo')` |
 * |---|---|
 * | `maat.work` · `www.maat.work` · `app.maat.work` | `demo.maat.work` |
 * | `127.0.0.1.nip.io` · `127-0-0-1.nip.io` | `demo.127.0.0.1.nip.io` · `demo.127-0-0-1.nip.io` |
 * | `localhost` · `ajustes.localhost` | `demo.localhost` |
 * | `127.0.0.1` · `0.0.0.0` · `::1` | `null` (no se le antepone un label a una IP) |
 * | `istock-git-main-x.vercel.app` | `null` (no hay wildcard ni certificado) |
 * | `midominio.com` (host desconocido) | `null` |
 *
 * **Devuelve un hostname sin puerto**: el puerto lo preserva el `clone()` de la URL en el proxy, que
 * es donde vive. Meterlo acá obligaría a re-parsear `host:puerto` y a duplicar el caso IPv6 que
 * `normalizeHostname` ya resuelve.
 *
 * ── Por qué esto NO reusa el cuerpo de `resolveHost`, y qué lo ata igual ───────────────────────
 * Fundirlas obligaría a que la rama `marketing` —el 100% de los pageviews del apex y del panel—
 * calcule un apex que nadie le pide, contra el presupuesto de `< 2 ms` de ADR-007 ley 1. Y copiar
 * la taxonomía de hosts es exactamente el modo de falla que este repo ya pagó dos veces (la lista
 * de reservados duplicada, el `SLUG_RE` duplicado): dos copias que no rompen nada hasta que
 * divergen.
 *
 * Lo que las ata no es código compartido, es un **invariante ejecutable**: `demo.test.ts` corre el
 * *round trip* `resolveHost(tenantHostFor(h, s)) === storefront(s)` sobre toda la matriz de
 * familias de host, más el negativo (`null` sólo donde `resolveHost` no podría devolver
 * `storefront`). Una divergencia se ve como un test rojo, no como un link muerto en producción.
 */
export function tenantHostFor(
  rawHost: string | null | undefined,
  slug: string,
  options: ResolveHostOptions = {},
): string | null {
  if (!isSlugShaped(slug)) throw new Error(`tenantHostFor: slug inválido "${slug}"`);
  const hostname = normalizeHostname(rawHost);
  const apex = wildcardApexOf(hostname, (options.rootDomain ?? STOREFRONT_DOMAIN).toLowerCase());
  return apex === null ? null : `${slug}.${apex}`;
}

/**
 * `('acme', '/')` → `/s/acme` · `('acme', '/p/iphone-14')` → `/s/acme/p/iphone-14`.
 *
 * El slug ya viene validado por `resolveHost`; se re-valida igual porque esta función es exportada
 * y el día que alguien la llame desde otro lado, el path traversal entra por acá.
 */
export function storefrontPathFor(slug: string, pathname: string): string {
  if (!isSlugShaped(slug)) throw new Error(`storefrontPathFor: slug inválido "${slug}"`);
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

/**
 * `/s` y `/s/**` — el **espacio de nombres interno** de la vidriera, el destino del rewrite.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué devuelve `/s/algo.json`, y por qué. Hallazgo HIGH del adversary de S1.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * **Respuesta: 404 real, servido por el proxy, sin invocar la app. Para todos los hosts.**
 *
 * ── El síntoma ─────────────────────────────────────────────────────────────────────────────────
 * `/s/algo.json` **sí** es match de la ruta `/s/[slug]` (con `slug = "algo.json"`), pero **no** era
 * match del `matcher` del proxy, que excluye 14 extensiones estáticas. O sea: el proxy no corría, y
 * la guarda que rechaza `/s/**` tampoco. El slug basura llegaba a `cacheTag()` y ahí explotaba.
 * Medido contra `next start`: HTTP 200, 8661 bytes, **el stream no cierra nunca** (`curl` corta por
 * timeout), `no-store` — así que el CDN jamás lo absorbe— y cardinalidad de paths infinita.
 * Anónimo, sin auth, en el dominio de cada tenant. Una request : hasta 300 s de CPU facturada.
 *
 * ── Por qué 404 y no la página de miss, aunque el miss sea `200` ───────────────────────────────
 * Tres argumentos independientes; el primero es el que decide.
 *
 * 1. **ADR-011 no gobierna este caso, y no por un tecnicismo.** ADR-011 eligió `200` + `noindex` +
 *    DOM legible para el slug **bien formado que no existe**, y lo eligió porque la app *no puede*
 *    saber si ese tenant existe sin ir a Postgres, y cuando lo sabe el shell de PPR ya salió con
 *    `200`: es status XOR body, y se eligió el body. `algo.json` no plantea esa disyuntiva: que no
 *    es un slug se decide con una función pura, **antes** de que empiece a streamear nada, en el
 *    único lugar que la doc de Next señala para esto (`loading.md`: *"ensure the resource exists
 *    before the response body is streamed. You can run this check in `proxy`"*). Donde hay certeza
 *    sin I/O, el status se puede tener; y donde se puede tener, se tiene.
 * 2. **Es el mismo género de input que el host `Foo_Bar.maat.work`, que ya da 404 desde el proxy.**
 *    La única diferencia es la puerta por la que entra —path en vez de host—, y el `CHECK
 *    tenants_slug_format` de `packages/db` dice que ninguno de los dos puede ser un tenant jamás.
 *    Dos respuestas distintas para el mismo input, según por qué puerta entró, es arbitrario.
 * 3. **El espacio de `/s/**` no es direccionable en producción, con ningún slug.** La URL canónica
 *    de un tenant es `{slug}.maat.work/`; `/s/**` es el destino interno del rewrite y **los rewrites
 *    del proxy no vuelven a entrar al proxy** (si entraran, `acme.maat.work/` haría bucle infinito
 *    hoy mismo, y no lo hace). Nadie llega acá desde un link legítimo: ni una persona que se
 *    equivocó de subdominio —esa se equivoca en el host, no en el path— ni un buscador. Así que
 *    esta rama no le está negando la página legible de ADR-011 a nadie que la necesite.
 *
 * Contra-argumento que consideré y descarté: *"un 404 acá contradice el `200` del miss"*. No, son
 * dos preguntas distintas. La de ADR-011 es "¿existe este tenant?" y se contesta con I/O, tarde. La
 * de acá es "¿esto puede ser un slug?" y se contesta con un regex, temprano. Que las dos respuestas
 * tengan status distinto es la consecuencia de que una se pueda decidir a tiempo y la otra no.
 *
 * ── Por qué es una función y por qué se chequea ANTES de resolver el host ──────────────────────
 * Antes esta guarda vivía dentro de la rama `marketing` de `proxy.ts`, o sea que dependía de dos
 * cosas para correr: que el matcher no salteara el path **y** que el host fuera el apex. Sobre un
 * host de tenant, `/s/x` se reescribía a `/s/{slug}/s/x` y terminaba en el 404 default de Next —
 * misma respuesta, pero pagando una invocación de función. Ahora es una sola decisión, arriba de
 * todo, sin mirar el host: el prefijo `/s` es nuestro y no es de nadie más.
 */
export function isStorefrontInternalPath(pathname: string): boolean {
  return pathname === STOREFRONT_PATH_PREFIX || pathname.startsWith(`${STOREFRONT_PATH_PREFIX}/`);
}

/**
 * El primer segmento de la URL pública de las fotos. **Global al deploy, no de ningún tenant.**
 *
 * Es el prefijo que trae por default `NEXT_PUBLIC_MEDIA_BASE_URL` (ver `packages/media/src/env.ts`)
 * y la URL que sirve la ruta `apps/web/app/(app)/%5Fmedia/[...key]/route.ts` mientras B1 siga
 * abierto; en producción la misma key la sirve el CDN de Cloudflare desde otro host.
 *
 * **Sí, el string está escrito dos veces en el repo, y es a propósito.** La alternativa era
 * importar `@istock/media` desde acá, o sea meter el cliente de R2 y el parseo de env en el bundle
 * del proxy — que corre en el 100% de los pageviews, antes del cache, con presupuesto de `< 2 ms` y
 * cero I/O (ADR-007, ley 1). Un literal de nueve caracteres es más barato que eso. Si el prefijo
 * cambia, lo que lo detecta es {@link isGlobalMediaPath} quedándose sin cubrir la ruta, y eso lo
 * afirma `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`, que enumera el árbol de
 * `apps/web/app` en cada `pnpm test`.
 */
export const MEDIA_PATH_PREFIX = '/_media';

/**
 * `%5F` es la forma percent-encodeada del `_` inicial, y **hay que contemplarla acá adentro.**
 *
 * En el App Router una carpeta que empieza con `_` es privada y no rutea, así que el directorio en
 * disco se llama `%5Fmedia` (`project-structure.md`: *"You can create URL segments that start with
 * an underscore by prefixing the folder name with `%5F`"*). Del lado de la **definición** de la
 * ruta, Next normaliza ese `%5F` a `_` (`server/normalizers/underscore-normalizer.ts`:
 * *"UnderscoreNormalizer replaces all instances of %5F with _"*), así que la ruta se llama
 * `/_media/[...key]` y la URL pública es `/_media/…`.
 *
 * Del lado del **request** ese normalizador no se aplica: verificado por grep sobre
 * `next@16.3.3`, sus únicos consumidores son los normalizadores de *page* y de *bundle path*. O
 * sea que hoy, muy probablemente, `/%5Fmedia/x.webp` no matchea la ruta y termina en un 404. Pero
 * "probablemente" no es el estándar de este archivo, por tres motivos:
 *
 * 1. **404 igual es la app.** Un `not-found` del App Router es una invocación de función que
 *    renderiza. La regla que se está sosteniendo no es "que la foto salga": es *"delete inbound
 *    `x-tenant-*` on **every path** through the proxy"*. Si el path llega a la app, el proxy tiene
 *    que haberlo visto — sirva una foto o sirva un 404.
 * 2. **La equivalencia `%5F` ↔ `_` es una convención viva de Next, no un detalle de implementación
 *    congelado.** El normalizador existe justamente porque Next trata las dos formas como la misma
 *    cosa en el lado que le tocó normalizar. Apostar a que nunca la aplique del otro lado —o a que
 *    la capa de routing de Vercel no decodifique antes— es apostar a la versión que tenemos hoy.
 * 3. **Cubrirla cuesta cero.** Ningún cliente real escribe `%5F`: no hay tráfico que pagar. El
 *    error opuesto —dejarla afuera y equivocarse— es exactamente el agujero que este cambio cierra.
 *
 * Los dígitos hex de un escape son case-insensitive (RFC 3986 §2.1), así que `%5f` y `%5F` son el
 * mismo octeto y acá valen los dos. Se normaliza **sólo el escape** y no el resto del path: la ruta
 * es `_media` en minúscula y el matcheo de rutas de Next es case-sensitive, así que `/%5FMEDIA/x`
 * no es la ruta de media y no tiene por qué pasar por esta puerta.
 */
const ENCODED_LEADING_UNDERSCORE = /^\/%5f/iu;

/**
 * `/_media/**` (y su forma `%5F`): **se pasa derecho, nunca se reescribe por host.**
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué no alcanzaba con que el `matcher` lo cubriera. Defecto encontrado por guard en S2.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Las fotos salen en `.webp`, y `.webp` era uno de los 16 sufijos que el `matcher` excluye para no
 * cobrar una invocación por asset de `public/`. El router de Next matchea por **segmento** y el
 * matcher excluía por **sufijo**: misma discrepancia que dejaba entrar `/s/algo.json` en S1. Sobre
 * todo el camino de media, `proxy()` no corría — y con él tampoco `stripInboundTenantHeaders()`,
 * así que un `x-tenant-*` mandado por el cliente sobrevivía hasta la app (`CLAUDE.md` §2:
 * escalación de tenant).
 *
 * Ahora el prefijo está cubierto por el `matcher`, pero cubrir sin esta guarda **rompería todas las
 * fotos de todas las vidrieras**: sobre `acme.maat.work`, `/_media/…` caería en la rama
 * `storefront` y se reescribiría a `/s/acme/_media/…`, que no es ruta de nada. Y la reescritura
 * sería incorrecta incluso si existiera: la key es **content-addressed** (ADR-006), o sea un hash
 * del byte de salida, sin `tenant_id` y sin `listing_id` adentro. Dos tenants que suban la misma
 * foto comparten el objeto: por definición ese byte no pertenece a la vidriera de ningún slug.
 * Meterle un slug al path sería inventar una pertenencia que el esquema no tiene — y de paso
 * multiplicaría por tenant las entradas de cache de un objeto inmutable y compartido.
 *
 * Que no se reescriba **no** afloja nada: quién puede leer esa key lo decide la ruta (bucket
 * hardcodeado a `media` + `isPublicVariantKey`), no el proxy. Acá sólo se decide el ruteo, y el
 * ruteo correcto para una URL global es no tocarla. Sanear headers sí se sanea, como en todos los
 * caminos.
 */
export function isGlobalMediaPath(pathname: string): boolean {
  const path = pathname.replace(ENCODED_LEADING_UNDERSCORE, '/_');
  return path === MEDIA_PATH_PREFIX || path.startsWith(`${MEDIA_PATH_PREFIX}/`);
}
