/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  EL `matcher` DEL PROXY NO PUEDE EXCLUIR UNA RUTA DE LA APP. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## De dónde sale este archivo
 * HIGH de S1, reportado por `adversary-reviewer` y medido por el LEAD contra el server real:
 *
 * ```
 * curl -m 12 http://127.0.0.1.nip.io:3100/s/noexiste-991.json
 *   → HTTP/1.1 200 · 8661 bytes · el stream NUNCA cierra · el body trae id="__next_error__"
 * curl    http://127.0.0.1.nip.io:3100/s/noexiste-control-991
 *   → HTTP/1.1 404 en 0.006 s
 * ```
 *
 * La causa no está en `/s/[slug]`: está en **una discrepancia entre dos matchers**. El `matcher` de
 * `apps/web/proxy.ts` excluye por **sufijo de path** (`.*\.(?:…|json|…)$`), mientras que el router
 * de Next matchea por **segmento**. `/s/algo.json` es un match perfecto de `/s/[slug]` con
 * `slug = "algo.json"` y, al mismo tiempo, está fuera del matcher: `proxy()` no corre, ninguna de
 * sus guardas se evalúa, el slug basura llega a `cacheTag()`, eso tira, y bajo `cacheComponents` +
 * PPR el throw sale como stream de 200 que no cierra. 1 request anónima : hasta 300 s de Active CPU.
 *
 * ## Por qué el guard vive acá y no sólo en el e2e
 * El e2e (`e2e/s1-ruta-de-vidriera-con-extension-cuelga-la-respuesta.spec.ts`) prueba el
 * **síntoma** contra un server real, que es lo único que demuestra que el agujero está cerrado.
 * Este archivo prueba la **clase**: que ninguna ruta de la app quede fuera del matcher, hoy y con
 * las rutas que todavía no existen. Corre en `pnpm test`, sin build y en milisegundos, así que la
 * próxima vez que aparezca una ruta con segmento dinámico —`/p/[id]` de S3 es la siguiente— el
 * fallo llega en el commit y no cuatro semanas después con una factura de Vercel.
 *
 * Y hay una segunda consecuencia del mismo agujero que **no** es observable desde afuera y que sólo
 * un guard estático puede sostener: `stripInboundTenantHeaders()` tampoco corre en los paths
 * excluidos. La doc de multi-tenant que el propio `proxy.ts` cita dice *"delete or overwrite
 * inbound `x-tenant-*` headers on **every path** through the proxy, including on paths that skip
 * tenant resolution"* (y es `CLAUDE.md` §2: `x-tenant-*` del cliente = escalación de tenant). Hoy
 * ninguna ruta lee esos headers, así que un e2e no puede afirmarlo sin inventar un endpoint que los
 * refleje — un test que sólo prueba su propio andamio. La forma honesta de sostener esa regla es la
 * de acá: **si una ruta de la app puede quedar fuera del matcher, el saneo de headers es opcional**,
 * y eso es cierto lo lea alguien o no.
 *
 * ## Las dos mitades, y por qué ninguna sirve sola
 * 1. **Cobertura**: toda ruta de la app tiene que caer adentro del matcher. Sola, se satisface con
 *    `matcher: ['/:path*']` — que es el arreglo perezoso.
 * 2. **Economía**: `_next/static` y los assets de `public/` tienen que seguir **afuera**. El proxy
 *    corre ANTES del cache, o sea en el 100% de las requests: mandarle cada chunk y cada fuente es
 *    una invocación facturada por asset, contra el presupuesto de ADR-007 (`< 2 ms`, 0 red). Sola,
 *    se satisface borrando el matcher entero.
 *
 * Las dos juntas describen la única forma correcta: acotar la exclusión, no ampliarla ni borrarla.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROXY = join(REPO, 'apps/web/proxy.ts');
const APP_DIR = join(REPO, 'apps/web/app');

/**
 * Las 16 extensiones con las que empezó todo. **Se escriben acá a mano, a propósito.**
 *
 * Derivarlas del `matcher` haría el test *vacuo* justo el día en que alguien borre la exclusión: la
 * lista quedaría vacía, el `for` no ejecutaría ninguna aserción y el archivo saldría verde sin
 * haber probado nada. Una lista literal no puede degradar en silencio.
 *
 * (El reporte del adversary hablaba de 14; sobre el literal del matcher son 16. Se cubren las 16.)
 */
const SUFFIXES = [
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'css',
  'js',
  'txt',
  'xml',
  'json',
  'woff',
  'woff2',
  'ttf',
] as const;

// ── lectura del matcher ───────────────────────────────────────────────────────────────────────

/**
 * Saca el array de `export const config = { matcher: [...] }` del fuente.
 *
 * Se lee el **texto** y no se importa el módulo: `proxy.ts` importa `next/server`, que no está en
 * las dependencias de `@istock/tests` y que arrastraría medio runtime de Next adentro de Vitest.
 * Es el mismo camino que ya usa `reserved-slugs.test.ts` para leer las listas de otro owner.
 */
function readMatchers(): string[] {
  const source = readFileSync(PROXY, 'utf8');
  const block = /matcher\s*:\s*\[([\s\S]*?)\]/u.exec(source);
  if (block === null) throw new Error('apps/web/proxy.ts: no se encontró `matcher: [...]`');
  const entries = [...(block[1] ?? '').matchAll(/'((?:[^'\\]|\\.)*)'/gu)].map((m) =>
    (m[1] ?? '').replace(/\\\\/gu, '\\'),
  );
  if (entries.length === 0) throw new Error('apps/web/proxy.ts: el `matcher` está vacío');
  return entries;
}

/**
 * Convierte una entrada de `matcher` en un `RegExp`.
 *
 * Next compila los matchers con `path-to-regexp`, que además acepta regex crudo entre paréntesis —
 * que es lo que usa la entrada larga de este proxy. Se soportan las dos formas que el archivo usa
 * hoy: la entrada regex (se reconoce por el lookahead negativo) y los segmentos `:nombre` /
 * `:nombre*`. Es una aproximación declarada: no reemplaza al e2e, que ejercita el matcher **real**
 * compilado por Next contra un server real. Acá alcanza para afirmar cobertura.
 */
function toRegExp(matcher: string): RegExp {
  if (matcher.includes('(?!')) return new RegExp(`^${matcher}$`, 'u');
  const source = matcher
    .replace(/\/:[A-Za-z0-9_]+\*/gu, '(?:/.*)?')
    .replace(/\/:[A-Za-z0-9_]+\+/gu, '/.+')
    .replace(/:[A-Za-z0-9_]+/gu, '[^/]+');
  return new RegExp(`^${source}$`, 'u');
}

/** Los matchers de un array se combinan con OR (doc de `proxy.md`: *"For multiple paths: Use an array"*). */
function proxyRuns(pathname: string, matchers: readonly string[]): boolean {
  return matchers.some((matcher) => toRegExp(matcher).test(pathname));
}

// ── enumeración de rutas de la app ────────────────────────────────────────────────────────────

const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts', 'route.tsx']);
const IGNORED = new Set(['node_modules', '.next', '_lib', '_components']);

/**
 * URL pública de cada `page.tsx` / `route.ts` de `apps/web/app`.
 *
 * Los grupos de ruta (`(app)`, `(marketing)`, `(storefront)`, `(panel)`) **no** aparecen en la URL:
 * se descartan. Los segmentos dinámicos quedan como `[slug]` para que el generador de sondas de
 * abajo sepa dónde meter la basura.
 */
function appRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (IGNORED.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!ROUTE_FILES.has(entry)) continue;
      const segments = relative(APP_DIR, dirname(full))
        .split('/')
        .filter((segment) => segment.length > 0 && !segment.startsWith('('));
      routes.push(`/${segments.join('/')}`.replace(/\/+$/u, '') || '/');
    }
  };
  walk(APP_DIR);
  return [...new Set(routes)].sort();
}

const DYNAMIC_SEGMENT = /\[[^\]]+\]/u;

/**
 * Paths concretos que esa ruta **puede recibir de un desconocido**.
 *
 * Para una ruta con segmento dinámico, el valor del segmento lo elige quien pide la URL: ahí es
 * donde entra `algo.json`. Por eso las sondas rellenan el segmento con basura terminada en cada
 * uno de los 16 sufijos, que es exactamente la request que hoy cuelga el server.
 */
function probesFor(route: string): string[] {
  if (!DYNAMIC_SEGMENT.test(route)) return [route];
  return SUFFIXES.map((suffix) => route.replace(DYNAMIC_SEGMENT, `basura-991.${suffix}`));
}

// ── las dos mitades ───────────────────────────────────────────────────────────────────────────

describe('el proxy corre sobre toda ruta que la app puede atender', () => {
  const matchers = readMatchers();
  const routes = appRoutes();

  it('hay rutas para chequear y el matcher se pudo leer: el guard no está midiendo el vacío', () => {
    // Sin esto, un `appRoutes()` que devuelve `[]` (porque alguien movió `apps/web/app`) haría que
    // todos los `it` de abajo pasen sin ejercitar nada. Es el mismo modo de falla que el censo de
    // specs: verde sobre código que no se evaluó.
    expect(matchers.length, 'no se leyó ninguna entrada del `matcher` de `apps/web/proxy.ts`').toBeGreaterThan(0);
    expect(routes.length, 'no se encontró ninguna ruta en `apps/web/app`').toBeGreaterThan(0);
    expect(
      routes.some((route) => DYNAMIC_SEGMENT.test(route)),
      'no se encontró ninguna ruta con segmento dinámico. `/s/[slug]` es la que originó el HIGH: ' +
        'si desapareció del árbol, este guard dejó de vigilar lo que existe para vigilarlo.',
    ).toBe(true);
  });

  for (const route of appRoutes()) {
    for (const probe of probesFor(route)) {
      it(`la ruta ${route} queda cubierta por el proxy cuando la piden como ${probe}`, () => {
        expect(
          proxyRuns(probe, matchers),
          `\`${probe}\` matchea la ruta \`${route}\` de la app pero NO matchea el \`matcher\` del ` +
            'proxy. O sea: la app la atiende y el proxy no la vio. Consecuencias, las dos medidas ' +
            'sobre el server real: (a) las guardas de host y de path no se evalúan — así es como ' +
            '`/s/algo.json` llegaba a `cacheTag()` y dejaba el stream abierto en 200; (b) ' +
            '`stripInboundTenantHeaders()` tampoco corre, y un `x-tenant-*` del cliente sobrevive ' +
            'hasta la app (CLAUDE.md §2, escalación de tenant). El matcher excluye por SUFIJO de ' +
            'path y el router de Next matchea por SEGMENTO: esa discrepancia es el bug.',
        ).toBe(true);
      });
    }
  }
});

describe('el proxy NO corre sobre los assets estáticos, que es de donde sale el ahorro', () => {
  const matchers = readMatchers();

  // La otra mitad. Sin esto, todo lo de arriba se arregla con `matcher: ['/:path*']`, que cierra el
  // agujero y de paso manda cada chunk de JS y cada fuente por una función facturada — en el 100%
  // de las requests, porque el proxy corre antes del cache (ADR-007, ley 1).
  const STATIC = [
    '/_next/static/chunks/main-abc123.js',
    '/_next/static/css/1ccwlwn4fqhmf.css',
    '/_next/static/media/inter-latin.woff2',
    '/_next/image',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    // `public/` cuelga de la RAÍZ, nunca de `/s/**`: por eso la exclusión por extensión se acota,
    // no se borra.
    '/logo.png',
    '/fonts/inter.woff2',
    '/og/default.jpg',
  ];

  for (const asset of STATIC) {
    it(`${asset} se sirve sin invocar el proxy: una invocación por asset es plata, no estilo`, () => {
      expect(
        proxyRuns(asset, matchers),
        `\`${asset}\` entró al matcher. El proxy corre ANTES del cache: esto es una invocación y ` +
          'Active CPU facturados por cada asset de cada pageview, incluidos los cache HIT. Si el ' +
          'agujero de `/s/**` se cerró borrando la exclusión por extensión, se cerró mal: sobre un ' +
          'host de tenant `/logo.png` además se reescribiría a `/s/{slug}/logo.png` y el asset ' +
          'dejaría de existir.',
      ).toBe(false);
    });
  }
});
