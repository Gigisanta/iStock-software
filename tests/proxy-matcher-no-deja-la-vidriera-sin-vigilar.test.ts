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
 * ## Tercera mitad, agregada en P2: los file conventions de metadata son rutas de la app
 * `ROUTE_FILES` enumeraba `page.*` y `route.*`, y con eso este guard **no veía** la clase de bug
 * que `ARCHITECTURE.md` §"Qué NO se reescribe" dejó anotada como hueco abierto: un `icon.png` por
 * tenant se sirve en `/icon.png`, el sufijo `.png` cae en la exclusión de 16 extensiones, el proxy
 * no corre, no hay rewrite y **el visitante de `acme.maat.work` recibe el ícono del apex**. Es la
 * misma discrepancia de siempre —el matcher excluye por SUFIJO, el router de Next matchea por
 * SEGMENTO— con otro sufijo.
 *
 * Lo que se afirma abajo es **que el proxy la vea**, no que la reescriba. La diferencia importa y
 * es el precedente de `/_media`: qué se hace con esa URL (passthrough global al deploy, rewrite
 * por tenant, o 404) se decide **en el cuerpo** del proxy, con una guarda con nombre y un
 * comentario, como `isGlobalMediaPath()`. Un `matcher` que la excluye por extensión toma esa misma
 * decisión **sin decirlo, sin poder distinguir el apex de un host de tenant y sin correr
 * `stripInboundTenantHeaders()`**. La decisión de diseño es P1/P2 del board; que la tome alguien
 * y no un regex de sufijos es esto.
 *
 * ### Tres cosas medidas contra el Next instalado, que corrigen lo que se venía contando
 * Todo esto sale de ejecutar las funciones del propio Next (`next@16.3.3`, ver `nextMetadataApi`),
 * no de la prosa de la doc — que en dos lugares es más floja que el código:
 *
 * 1. **`opengraph-image` NO estaba cubierto.** `ARCHITECTURE.md` y la entrada P2 dicen *"su URL no
 *    lleva extensión"*. Eso vale para la variante **generada por código**
 *    (`normalizeMetadataRoute('/opengraph-image')` → `/opengraph-image`), pero el archivo
 *    **estático** produce `fillStaticMetadataSegment('/', 'opengraph-image.png')` →
 *    **`/opengraph-image.png`**, que cae en la exclusión igual que el ícono. Lo mismo
 *    `twitter-image`.
 * 2. **"Generado por código ⇒ sin extensión" es falso para tres convenciones.**
 *    `robots.ts` → `/robots.txt`, `manifest.ts` → `/manifest.webmanifest`, `sitemap.ts` →
 *    `/sitemap.xml`. La regla verdadera no es estático vs generado: es qué URL emite cada
 *    convención, y por eso la tabla de abajo la declara fila por fila.
 * 3. **`/manifest.webmanifest` está cubierto por accidente**, no por decisión: `webmanifest` no
 *    está entre los 16 sufijos. `/manifest.json` —la otra mitad de la misma convención— no lo
 *    está. Dos URLs de la misma convención con destinos distintos es exactamente el síntoma de
 *    que el criterio no es un criterio.
 *
 * Y un cuarto dato, que es de la doc y hay que leer con la cabeza puesta en multi-tenant: el
 * índice de `file-conventions/metadata` dice *"If using along with `proxy.ts`, configure the
 * matcher to exclude the metadata files"*. Ese consejo asume **una app, un dominio**. Acá el mismo
 * path significa cosas distintas según el host, así que excluirlo del matcher es justamente cómo
 * se sirve el ícono del apex en el subdominio de otro.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
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
 *
 * ── Por qué esto es un scanner y no un regex (S8) ─────────────────────────────────────────────
 * La versión anterior era `/matcher\s*:\s*\[([\s\S]*?)\]/u`: no-golosa, o sea que **cortaba en el
 * primer `]` que encontrara**. Un `]` adentro de un comentario del array —o una clase de
 * caracteres `[…]` adentro de una entrada regex, que es lo próximo que va a pasar— truncaba la
 * lista en la segunda entrada, y el rojo que salía de ahí eran **70 tests fallando** que hablaban
 * de rutas sin cubrir y no del parser. Lo encontró `storefront-agent` en S8 y lo **reportó** en vez
 * de editar este archivo, que es lo correcto (`CLAUDE.md` §4).
 *
 * El arreglo real que había hasta hoy era una **convención**: "los comentarios de este array van
 * sin corchetes", escrita en `apps/web/proxy.ts`. Una convención que nadie chequea no es un
 * invariante, es una trampa con instrucciones. Ahora el corchete se cuenta con profundidad y se
 * saltean comentarios y literales, así que el fuente puede escribirse como se escriba.
 *
 * Lo que el scanner NO soporta, a propósito y por escrito: una entrada que **no** sea un literal de
 * string (un `RegExp` crudo o una constante importada). Next compila los matchers con
 * `path-to-regexp` sobre strings, y una entrada que no esté en el fuente sería una entrada que este
 * guard no puede evaluar — el modo de falla correcto ahí es "no la leí", no "la aprobé". Por eso
 * las entradas se cuentan sólo a profundidad 1 y se exige que el array cierre.
 */
function readStringLiteral(source: string, start: number): { readonly text: string; readonly end: number } {
  const quote = source.charAt(start);
  let text = '';
  let at = start + 1;
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === '\\') {
      // Mismo criterio que la versión vieja: `\\` colapsa a `\` (así viaja `\\.` en el fuente y
      // llega `\.` al RegExp). Cualquier otra escapada se deja tal cual, con su barra.
      const escaped = source.charAt(at + 1);
      text += escaped === '\\' || escaped === quote ? escaped : `\\${escaped}`;
      at += 2;
      continue;
    }
    if (char === quote) return { text, end: at + 1 };
    text += char;
    at += 1;
  }
  throw new Error('el `matcher` tiene un literal de string sin cerrar');
}

function parseMatcherArray(source: string): string[] {
  const config = /export\s+const\s+config\s*=\s*\{/u.exec(source);
  if (config === null) throw new Error('no se encontró `export const config = {`');
  const key = /matcher\s*:\s*\[/u.exec(source.slice(config.index));
  if (key === null) throw new Error('no se encontró `matcher: [` dentro de `export const config`');

  const entries: string[] = [];
  let depth = 1;
  let at = config.index + key.index + key[0].length;

  while (at < source.length) {
    const char = source.charAt(at);
    const next = source.charAt(at + 1);

    if (char === '/' && next === '/') {
      const eol = source.indexOf('\n', at);
      if (eol === -1) break;
      at = eol + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      if (end === -1) break;
      at = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const literal = readStringLiteral(source, at);
      if (depth === 1) entries.push(literal.text);
      at = literal.end;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        if (entries.length === 0) throw new Error('el `matcher` está vacío');
        return entries;
      }
    }
    at += 1;
  }

  throw new Error('el array del `matcher` no cierra');
}

function readMatchers(): string[] {
  try {
    return parseMatcherArray(readFileSync(PROXY, 'utf8'));
  } catch (error) {
    throw new Error(`apps/web/proxy.ts: ${error instanceof Error ? error.message : String(error)}`);
  }
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

/**
 * Por qué una URL quedó afuera. **Diagnóstico, no aserción**: acá sí se lee el `matcher`, porque
 * el que reciba el rojo necesita saber cuál de los dos mecanismos lo excluyó — son dos arreglos
 * distintos. `favicon.ico`, `robots.txt` y `sitemap.xml` están excluidos **dos veces**: por nombre
 * en el lookahead y por sufijo. Acotar la exclusión de extensiones no los cubre; hay que sacarlos
 * también del lookahead.
 */
function excludedBecause(url: string, matchers: readonly string[]): string {
  const reasons: string[] = [];
  const extension = /\.([A-Za-z0-9]+)$/u.exec(url)?.[1]?.toLowerCase();
  if (extension !== undefined && (SUFFIXES as readonly string[]).includes(extension)) {
    reasons.push(`por SUFIJO \`.${extension}\` (la exclusión de ${String(SUFFIXES.length)} extensiones)`);
  }
  const literal = url.slice(1).replace(/\./gu, '\\.');
  if (namedInLookahead(literal, matchers)) {
    reasons.push(`por NOMBRE (\`${literal}\` está escrito en el lookahead)`);
  }
  return reasons.length === 0 ? 'sin matchear ninguna entrada del matcher' : reasons.join(' y ');
}

/**
 * ¿Está esta alternativa **entera** en el lookahead negativo?
 *
 * Se miran los bordes y no se hace `includes()` pelado porque `favicon\.ico` **contiene**
 * `icon\.ico`: sin esto, `/icon.ico` —que está excluido sólo por sufijo— aparecía en el rojo como
 * "excluido también por nombre", y el que lee el mensaje iría a borrar una entrada del lookahead
 * que no existe.
 */
function namedInLookahead(literal: string, matchers: readonly string[]): boolean {
  return matchers.some((matcher) => {
    for (let at = matcher.indexOf(literal); at !== -1; at = matcher.indexOf(literal, at + 1)) {
      const before = matcher[at - 1];
      const after = matcher[at + literal.length];
      if ((before === '|' || before === '!') && (after === '|' || after === ')')) return true;
    }
    return false;
  });
}

// ── file conventions de metadata: qué URL produce cada uno ────────────────────────────────────

/** `DEFAULT_METADATA_ROUTE_EXTENSIONS` de `next/dist/lib/metadata/is-metadata-route`. */
const PAGE_EXTENSIONS: readonly string[] = ['js', 'jsx', 'ts', 'tsx'];

interface MetadataConvention {
  /** El nombre del archivo, sin número y sin extensión. */
  readonly file: string;
  /** Extensiones que Next acepta como archivo **estático**. */
  readonly staticExtensions: readonly string[];
  /** `icon1.png`, `icon2.png`: la doc lo permite sólo en las cuatro convenciones de imagen. */
  readonly numbered: boolean;
  /**
   * URL de la variante **generada por código** (`icon.tsx`, `robots.ts`), pedida en la raíz.
   * `null` = no existe variante generada — doc de `app-icons`: *"You cannot generate a favicon
   * icon"*.
   */
  readonly generatedUrl: string | null;
  /** La convención sólo existe en la raíz de `app/` (regex anclado `^[\\/]…$` en Next). */
  readonly rootOnly: boolean;
  /** URLs que la convención produce y que ninguna regla de arriba deriva. */
  readonly extraUrls: readonly string[];
}

/**
 * La tabla. **Literal a propósito**, igual que `SUFFIXES` y por el mismo motivo: si se derivara de
 * Next en tiempo de test, el día que Next cambie una convención el guard cambiaría de opinión solo
 * y en silencio. Acá el cambio de Next se ve como **un** rojo con nombre propio —el test de deriva
 * de más abajo, que ejecuta las funciones de Next y compara contra esta tabla— y no como una
 * cobertura que se agranda o se achica sin que nadie lo decida.
 *
 * Cada fila está medida, no recordada: `fillStaticMetadataSegment` para la variante estática y
 * `normalizeMetadataRoute` + `normalizeMetadataPageToRoute` + `normalizeAppPath` para la generada.
 */
const METADATA_CONVENTIONS: readonly MetadataConvention[] = [
  {
    file: 'favicon',
    staticExtensions: ['ico'],
    numbered: false,
    generatedUrl: null,
    rootOnly: true,
    extraUrls: [],
  },
  {
    file: 'icon',
    staticExtensions: ['ico', 'jpg', 'jpeg', 'png', 'svg'],
    numbered: true,
    generatedUrl: '/icon',
    rootOnly: false,
    extraUrls: [],
  },
  {
    file: 'apple-icon',
    staticExtensions: ['jpg', 'jpeg', 'png'],
    numbered: true,
    generatedUrl: '/apple-icon',
    rootOnly: false,
    extraUrls: [],
  },
  {
    file: 'opengraph-image',
    staticExtensions: ['jpg', 'jpeg', 'png', 'gif'],
    numbered: true,
    generatedUrl: '/opengraph-image',
    rootOnly: false,
    extraUrls: [],
  },
  {
    file: 'twitter-image',
    staticExtensions: ['jpg', 'jpeg', 'png', 'gif'],
    numbered: true,
    generatedUrl: '/twitter-image',
    rootOnly: false,
    extraUrls: [],
  },
  {
    file: 'manifest',
    staticExtensions: ['json', 'webmanifest'],
    numbered: false,
    generatedUrl: '/manifest.webmanifest',
    rootOnly: true,
    extraUrls: [],
  },
  {
    file: 'robots',
    staticExtensions: ['txt'],
    numbered: false,
    generatedUrl: '/robots.txt',
    rootOnly: true,
    extraUrls: [],
  },
  {
    file: 'sitemap',
    staticExtensions: ['xml'],
    numbered: false,
    generatedUrl: '/sitemap.xml',
    rootOnly: false,
    // `generateSitemaps` parte el sitemap en varios: *"Your generated sitemaps will be available
    // at `/…/sitemap/[id].xml`. For example, `/product/sitemap/1.xml`"* (doc de `sitemap`).
    extraUrls: ['/sitemap/1.xml'],
  },
];

interface NextMetadataApi {
  readonly normalizeMetadataRoute: (page: string) => string;
  readonly normalizeMetadataPageToRoute: (page: string, isDynamic: boolean) => string;
  readonly fillStaticMetadataSegment: (segment: string, lastSegment: string) => string;
  readonly normalizeAppPath: (route: string) => string;
}

let cachedNextApi: NextMetadataApi | null = null;

/**
 * Las funciones con las que **el propio Next** decide en qué URL se sirve cada file convention.
 *
 * Se resuelven desde `apps/web`, no desde `@istock/tests`, y eso no es un detalle de paths: el
 * guard tiene que medir **el Next que usa la app**. Si mañana `apps/web` sube de versión y una
 * convención cambia de URL, este archivo lo va a saber en el mismo `pnpm test`.
 *
 * Si no se pueden cargar, **se rompe fuerte**. Un guard que no encuentra su fuente de verdad y
 * sigue en verde es peor que no tenerlo: es el modo de falla del censo de specs, otra vez.
 */
function nextMetadataApi(): NextMetadataApi {
  if (cachedNextApi !== null) return cachedNextApi;
  const requireFromWeb = createRequire(join(REPO, 'apps/web/package.json'));
  try {
    const routes = requireFromWeb('next/dist/lib/metadata/get-metadata-route') as Pick<
      NextMetadataApi,
      'normalizeMetadataRoute' | 'normalizeMetadataPageToRoute' | 'fillStaticMetadataSegment'
    >;
    const paths = requireFromWeb('next/dist/shared/lib/router/utils/app-paths') as Pick<
      NextMetadataApi,
      'normalizeAppPath'
    >;
    cachedNextApi = {
      normalizeMetadataRoute: routes.normalizeMetadataRoute,
      normalizeMetadataPageToRoute: routes.normalizeMetadataPageToRoute,
      fillStaticMetadataSegment: routes.fillStaticMetadataSegment,
      normalizeAppPath: paths.normalizeAppPath,
    };
    return cachedNextApi;
  } catch (cause) {
    throw new Error(
      'no se pudieron cargar los helpers de metadata de Next desde `apps/web`. Este guard deriva ' +
        'las URLs de las file conventions con las funciones del propio Next: sin ellas no puede ' +
        'afirmar nada, y prefiere romper antes que dar verde sobre nada.',
      { cause },
    );
  }
}

/** URL pública de la variante generada por código de una convención, en un segmento dado. */
function generatedMetadataUrl(segment: string, base: string): string {
  const next = nextMetadataApi();
  // El `.xml` del sitemap no lo pone `normalizeMetadataRoute` sino el paso siguiente, así que la
  // cadena va entera. Medido: `/sitemap` → `/sitemap/route` → `/sitemap.xml/route` → `/sitemap.xml`.
  return next.normalizeAppPath(
    next.normalizeMetadataPageToRoute(next.normalizeMetadataRoute(join(segment, base)), false),
  );
}

/**
 * URL pública de un archivo de convención que **existe en disco**, o `null` si ese archivo no es
 * una file convention.
 *
 * Hoy no hay ninguno en `apps/web/app` — por eso la cobertura de la clase se afirma abajo sobre la
 * **convención** y no sobre el disco: el agujero es que el matcher no la cubre, no que el archivo
 * esté. Esta función es la otra mitad: el día que `storefront-agent` agregue el primer `icon.tsx`,
 * su URL entra sola al `describe` de cobertura, sin que nadie se acuerde de agregarla a una lista.
 *
 * Los segmentos llegan **con** los grupos de ruta adentro, a propósito: Next le cuelga un hash de
 * 6 caracteres al nombre cuando hay un grupo en el camino (`/(marketing)/icon.png` →
 * `/icon-pwu6ef.png`), y ese hash lo calcula él, no este archivo.
 */
function metadataRouteFor(segments: readonly string[], filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const base = filename.slice(0, dot);
  const extension = filename.slice(dot + 1).toLowerCase();
  const stem = base.replace(/\d$/u, '');
  const convention = METADATA_CONVENTIONS.find(
    (candidate) => candidate.file === base || (candidate.numbered && candidate.file === stem),
  );
  if (convention === undefined) return null;
  if (convention.rootOnly && segments.length > 0) return null;

  const segment = `/${segments.join('/')}`;
  if (PAGE_EXTENSIONS.includes(extension)) {
    return convention.generatedUrl === null ? null : generatedMetadataUrl(segment, base);
  }
  if (!convention.staticExtensions.includes(extension)) return null;
  return nextMetadataApi().fillStaticMetadataSegment(segment, filename);
}

/** Las URLs que una convención puede producir **en la raíz del host**, que es donde se piden. */
function conventionUrlsAtRoot(convention: MetadataConvention): string[] {
  const urls = convention.staticExtensions.map((extension) => `/${convention.file}.${extension}`);
  const first = convention.staticExtensions[0];
  if (convention.numbered && first !== undefined) urls.push(`/${convention.file}1.${first}`);
  if (convention.generatedUrl !== null) urls.push(convention.generatedUrl);
  urls.push(...convention.extraUrls);
  return [...new Set(urls)];
}

// ── enumeración de rutas de la app ────────────────────────────────────────────────────────────

const ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts', 'route.tsx']);
const IGNORED = new Set(['node_modules', '.next', '_lib', '_components']);

/**
 * URL pública de cada `page.tsx` / `route.ts` **y de cada file convention de metadata** de
 * `apps/web/app`.
 *
 * Los grupos de ruta (`(app)`, `(marketing)`, `(storefront)`, `(panel)`) **no** aparecen en la URL:
 * se descartan. Los segmentos dinámicos quedan como `[slug]` para que el generador de sondas de
 * abajo sepa dónde meter la basura.
 *
 * Las conventions se derivan del disco con las funciones del propio Next (`metadataRouteFor`), no
 * con una lista de URLs escrita a mano: es la parte del guard que no hay que acordarse de
 * actualizar. Hoy no hay ninguna en el árbol, así que esta rama no aporta casos — la cobertura de
 * la clase la sostiene el `describe` de conventions, que no depende de que el archivo exista.
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
      const raw = relative(APP_DIR, dirname(full))
        .split('/')
        .filter((segment) => segment.length > 0);
      if (ROUTE_FILES.has(entry)) {
        const segments = raw.filter((segment) => !segment.startsWith('('));
        routes.push(`/${segments.join('/')}`.replace(/\/+$/u, '') || '/');
        continue;
      }
      const metadata = metadataRouteFor(raw, entry);
      if (metadata !== null) routes.push(metadata);
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

// ── el que lee al que lee ─────────────────────────────────────────────────────────────────────

/**
 * Fuente de mentira, con las tres formas de `]` que el regex viejo no sobrevivía. Es el fixture que
 * hace ENCENDER el defecto que reportó `storefront-agent`: con el parser anterior
 * (`/matcher\s*:\s*\[([\s\S]*?)\]/u`) esta lista se cortaba en **una** entrada, porque el primer
 * `]` del fuente está adentro de un comentario. Y el síntoma no hablaba del parser: hablaba de 70
 * rutas de la app "sin cubrir por el proxy".
 */
const PROXY_CON_CORCHETES_EN_COMENTARIOS = `
import { NextResponse } from 'next/server';

/** Docblock con un matcher: [ '/mentira' ] escrito en prosa, ANTES del config real. */
export function proxy(): void {}

export const config = {
  matcher: [
    '/s',
    // El panel entero: cubre /app/canjes/[id] y todo lo que cuelgue de ahí.
    '/app/:path*',
    /* Bloque con corchetes ] y una entrada falsa: '/no-soy-una-entrada' */
    '/_media/:path*',
    '/((?!_next/static|(?:.*/)?icon[0-9]*\\\\.png).*\\\\.(?:png|json)$).*',
  ],
};
`;

describe('leer el matcher del fuente no puede depender de cómo se escriben los comentarios', () => {
  it('un corchete adentro de un comentario del array no trunca la lista de entradas', () => {
    expect(
      parseMatcherArray(PROXY_CON_CORCHETES_EN_COMENTARIOS),
      'el parser cortó la lista en el primer `]` del fuente. Ése es el defecto que reportó ' +
        '`storefront-agent` en S8: la mitad de las entradas desaparece, este archivo declara sin ' +
        'cubrir rutas que SÍ están cubiertas, y el rojo (70 tests) no habla del parser. Hasta hoy ' +
        'el invariante lo sostenía una convención escrita en `apps/web/proxy.ts` —"los comentarios ' +
        'de este array van sin corchetes"— que no chequeaba nadie.',
    ).toEqual([
      '/s',
      '/app/:path*',
      '/_media/:path*',
      '/((?!_next/static|(?:.*/)?icon[0-9]*\\.png).*\\.(?:png|json)$).*',
    ]);
  });

  it('una entrada citada adentro de un comentario no se cuenta como entrada del matcher', () => {
    expect(
      parseMatcherArray(PROXY_CON_CORCHETES_EN_COMENTARIOS),
      "`'/no-soy-una-entrada'` está adentro de un comentario de bloque: si aparece en la lista, el " +
        'guard estaría evaluando cobertura contra un matcher que el proxy no tiene.',
    ).not.toContain('/no-soy-una-entrada');
  });

  it('el docblock que menciona un matcher en prosa no le gana al config exportado', () => {
    // Se ancla en `export const config = {`, no en el primer `matcher:` del archivo. `proxy.ts` es
    // un archivo con 350 líneas de docblock que nombran el matcher a cada rato.
    expect(parseMatcherArray(PROXY_CON_CORCHETES_EN_COMENTARIOS)).not.toContain('/mentira');
  });

  it('un array de matcher que no cierra se reporta como tal y no como cobertura faltante', () => {
    // El modo de falla correcto de un lector es "no pude leer", nunca "leí menos". Si esto
    // devolviera una lista corta en vez de tirar, el rojo volvería a mentir sobre qué se rompió.
    expect(() => parseMatcherArray("export const config = {\n  matcher: [\n    '/s',\n")).toThrow(
      /no cierra/u,
    );
  });

  it('las entradas del matcher real de apps/web/proxy.ts se leen enteras y sin comentarios', () => {
    const matchers = readMatchers();
    expect(
      matchers.length,
      'el matcher real tiene que traer TODAS sus entradas. Si acá hay menos, el resto de este ' +
        'archivo está midiendo cobertura contra media lista.',
    ).toBeGreaterThanOrEqual(5);
    expect(
      matchers.every((entry) => entry.startsWith('/')),
      `una entrada leída no empieza con "/": ${JSON.stringify(matchers)}. Eso es texto de un ` +
        'comentario colándose como entrada.',
    ).toBe(true);
  });
});

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

describe('los file conventions de metadata también son rutas de la app y el proxy tiene que verlos', () => {
  const matchers = readMatchers();

  it('la tabla de conventions sigue diciendo lo mismo que el Next instalado en apps/web', () => {
    // El único lugar del archivo donde Next manda sobre la tabla. Si `apps/web` sube de versión y
    // una convención cambia de URL, el rojo es éste —con nombre y con el valor viejo y el nuevo—
    // y no una cobertura que se mueve sola. Es la contracara de tener la tabla literal.
    const next = nextMetadataApi();
    const drift: string[] = [];

    for (const convention of METADATA_CONVENTIONS) {
      for (const extension of convention.staticExtensions) {
        const filename = `${convention.file}.${extension}`;
        const served = next.fillStaticMetadataSegment('/', filename);
        if (served !== `/${filename}`) {
          drift.push(`estático ${filename}: la tabla dice \`/${filename}\` y Next sirve \`${served}\``);
        }
      }
      if (convention.generatedUrl !== null) {
        const served = generatedMetadataUrl('/', convention.file);
        if (served !== convention.generatedUrl) {
          drift.push(
            `generado ${convention.file}.tsx: la tabla dice \`${convention.generatedUrl}\` y Next ` +
              `sirve \`${served}\``,
          );
        }
      }
    }

    expect(
      drift,
      'la tabla de file conventions de este guard y el Next de `apps/web` ya no dicen lo mismo. ' +
        'No se "actualiza el test": primero se mira si la URL nueva sigue cayendo adentro del ' +
        '`matcher`, porque si no, el agujero se acaba de reabrir con otra forma.',
    ).toEqual([]);

    expect(
      METADATA_CONVENTIONS.length,
      'la tabla de file conventions quedó vacía: el `for` de abajo no afirmaría nada',
    ).toBeGreaterThan(0);
  });

  for (const convention of METADATA_CONVENTIONS) {
    it(`el ${convention.file} de un tenant se pide en la raíz de su host y el proxy tiene que verlo`, () => {
      const uncovered = conventionUrlsAtRoot(convention)
        .filter((url) => !proxyRuns(url, matchers))
        .map((url) => `${url}  ← excluido ${excludedBecause(url, matchers)}`);

      expect(
        uncovered,
        `la convención \`${convention.file}\` produce URLs que el \`matcher\` de ` +
          '`apps/web/proxy.ts` deja afuera:\n' +
          `${uncovered.map((line) => `      ${line}`).join('\n')}\n` +
          '    Bajo `acme.maat.work` esa URL la pide el browser en la RAÍZ del host, la atiende la ' +
          'app, y el proxy no corre: (a) no hay rewrite, así que el visitante del tenant recibe el ' +
          'archivo del apex —el ícono de otro negocio en la pestaña del suyo—; (b) ' +
          '`stripInboundTenantHeaders()` tampoco corre y un `x-tenant-*` del cliente sobrevive ' +
          'hasta la app (CLAUDE.md §2). Es la MISMA discrepancia de siempre: el matcher excluye por ' +
          'SUFIJO y el router de Next matchea por SEGMENTO.\n' +
          '    Lo que se pide es que el proxy la VEA, no que la reescriba: qué se hace con ella ' +
          '—passthrough global al deploy, rewrite por tenant, o 404— se decide en el CUERPO del ' +
          'proxy con una guarda con nombre, como `isGlobalMediaPath()` (ADR de P1/P2). Un regex de ' +
          'sufijos no puede distinguir el apex de un host de tenant, así que no puede tomar esa ' +
          'decisión.',
      ).toEqual([]);
    });
  }

  it('la variante generada por código ya está cubierta hoy: el guard discrimina, no rechaza todo', () => {
    // Sin esto, un `matcher` roto de cualquier otra forma haría fallar los ocho tests de arriba y
    // el rojo no diría nada. Estas cuatro URLs no llevan extensión (`icon.tsx` → `/icon`), así que
    // ya caen adentro del catch-all: son el control de que lo que falla arriba es la exclusión por
    // sufijo y no el matcher entero.
    const extensionless = METADATA_CONVENTIONS.map((convention) => convention.generatedUrl).filter(
      (url): url is string => url !== null && !url.includes('.'),
    );

    expect(
      extensionless.length,
      'no quedó ninguna convención generada sin extensión: el control positivo se vació',
    ).toBeGreaterThan(0);

    expect(
      extensionless.filter((url) => !proxyRuns(url, matchers)),
      'una URL de metadata SIN extensión quedó afuera del matcher. Eso ya no es el agujero de P2 ' +
        '(la exclusión por sufijo): es el catch-all del matcher, y lo rompió otra cosa.',
    ).toEqual([]);
  });
});

describe('el proxy NO corre sobre los assets estáticos, que es de donde sale el ahorro', () => {
  const matchers = readMatchers();

  // La otra mitad. Sin esto, todo lo de arriba se arregla con `matcher: ['/:path*']`, que cierra el
  // agujero y de paso manda cada chunk de JS y cada fuente por una función facturada — en el 100%
  // de las requests, porque el proxy corre antes del cache (ADR-007, ley 1).
  /**
   * `/favicon.ico`, `/robots.txt` y `/sitemap.xml` estaban en esta lista y **se fueron en P2**. No
   * es que hayan dejado de importar: es que estaban en la lista equivocada.
   *
   * Los tres son **nombres de file conventions de Next**, no archivos de `public/` — de hecho
   * `apps/web/public/` no existe en este repo. O sea que no son assets que el proxy pueda ahorrarse:
   * son URLs que **la app sirve o va a servir**, y bajo un host de tenant significan algo distinto
   * que bajo el apex. Afirmar acá que el proxy no las ve era afirmar, sin decirlo, que `robots.txt`
   * y `sitemap.xml` son del apex para siempre — que es justo la decisión de diseño que P1 tiene
   * abierta. Ahora se afirman en el `describe` de conventions, del lado de "el proxy tiene que
   * verlas", y qué hace con ellas lo decide el cuerpo del proxy.
   *
   * Lo que queda acá es lo que de verdad es un asset: el runtime del build y `public/`, que cuelga
   * de la RAÍZ y nunca de `/s/**`. Por eso la exclusión por extensión se **acota**, no se borra.
   */
  const STATIC = [
    '/_next/static/chunks/main-abc123.js',
    '/_next/static/css/1ccwlwn4fqhmf.css',
    '/_next/static/media/inter-latin.woff2',
    '/_next/image',
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
