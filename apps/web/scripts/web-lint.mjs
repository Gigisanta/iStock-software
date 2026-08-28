#!/usr/bin/env node
/**
 * web-lint — reglas constitucionales de `apps/web`.
 *
 * Reemplaza a `next lint`, que Next 16 **removió** (`next --help` ya no lo lista). Sigue la
 * convención que el repo ya tiene: `packages/db` corre `rls-lint.mjs`, `packages/domain`
 * `purity-check.mjs`, `packages/media` `media-lint.mjs`. Ninguno es ESLint, y no por ahorrar una
 * dependencia: un linter genérico no sabe que un `prefetch={true}` en la vidriera cuesta una
 * invocación de función por card, y eso es justo lo que hay que atajar.
 *
 * Cada regla cita el artículo que hace cumplir.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `HERE` es siempre `apps/web` real, derivado de la ubicación de este script. `ROOT` es el árbol
 * que se AUDITA, y se puede apuntar a otro lado con `WEB_LINT_ROOT`.
 *
 * El override existe por un solo motivo y no es la comodidad: `scripts/web-lint.test.sh` necesita
 * ver a cada una de las 15 reglas ENCENDERSE contra un caso que la viole. Sin poder mover la raíz,
 * la única forma de ejercer la polaridad era inyectar archivos rotos en `apps/web/app`, que es
 * columna de `app-agent` y de `storefront-agent` — o sea que el arnés del gate tendría que escribir,
 * aunque fuera por un instante, en el código que el gate audita. Es exactamente lo que §4 prohíbe,
 * y además deja basura en el árbol ajeno el día que el arnés se muere a mitad de camino.
 *
 * Los casos de borde de W015 —"presencia no es filtro", "sin ancla no hay exención", "proximidad
 * no es alcance"— están todos documentados abajo como hallazgos, y ninguno era reejecutable: se
 * midieron a mano, fuera del repo. Una afirmación de cobertura que nadie puede reproducir vale lo
 * mismo que ninguna.
 *
 * `WEB_LINT_SCHEMA` es el segundo override y prueba la otra mitad: que W015 falle cuando NO puede
 * leer el schema. Ausencia de medición es FAIL, nunca PASS — sin esto, esa rama se escribió y
 * nunca se ejecutó.
 *
 * Ninguno de los dos se lee en CI: allá se corre sin env y la raíz es la real.
 */
const HERE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOT = process.env.WEB_LINT_ROOT ? resolve(process.env.WEB_LINT_ROOT) : HERE;
const APP = join(ROOT, 'app');
const STOREFRONT = join(APP, '(storefront)');

let failed = 0;
const ok = (m) => console.log(`  \x1b[32mok\x1b[0m    ${m}`);
const bad = (rule, m, hits) => {
  failed++;
  console.log(`  \x1b[31m${rule}\x1b[0m  ${m}`);
  for (const h of hits.slice(0, 8)) console.log(`        ${h}`);
};

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const ALL = [...walk(APP), ...walk(join(ROOT, 'lib')), join(ROOT, 'proxy.ts')].filter((f) => {
  try { return statSync(f).isFile(); } catch { return false; }
});
const read = (f) => ({ f, rel: relative(ROOT, f), src: readFileSync(f, 'utf8') });
const FILES = ALL.map(read);
const TESTS = (f) => /\.test\.tsx?$/.test(f.rel);
const IN = (f, dir) => f.f.startsWith(dir);
const src = FILES.filter((f) => !TESTS(f));
const store = src.filter((f) => IN(f, STOREFRONT));

/** Busca un patrón línea por línea, ignorando comentarios. */
function scan(files, re) {
  const hits = [];
  for (const { rel, src } of files) {
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 100)}`);
    });
  }
  return hits;
}
function must(rule, desc, files, re) {
  const h = scan(files, re);
  h.length ? bad(rule, desc, h) : ok(`${rule} ${desc}`);
}

console.log('web-lint · reglas de apps/web\n');

// ── La vidriera es pública, cacheada y de costo acotado ───────────────────────────────────────
// Los error boundaries son la UNICA excepcion, y es del framework, no nuestra: Next exige que
// `error.tsx` / `global-error.tsx` sean Client Components. Tal como estaba escrita, W001 hacia
// literalmente imposible tener un error boundary en la vidriera — y sin boundary, un throw de
// render bajo cacheComponents+PPR no es un 500: es un stream que nunca cierra con status 200.
// Eso es el HIGH que encontro el adversary en S1.
//
// La excepcion va por NOMBRE DE ARCHIVO, no por un marcador que se pueda escribir en cualquier
// lado. Y se paga con W001b: `storefront-agent` podia haber puesto el lint en verde escribiendo
// `error.js` (web-lint solo camina .ts/.tsx) o re-exportando desde `lib/`, sin cambiar un byte de
// lo que se sirve. No lo hizo y lo reporto, que es como se descubre que una regla estaba mal.
const BOUNDARY = (f) => /(^|\/)(global-)?error\.tsx$/.test(f.rel);

must('W001', 'sin "use client" en (storefront): la vidriera no manda JS de datos', store.filter((f) => !BOUNDARY(f)),
  /['"]use client['"]/);

// Sin esto, la excepcion de W001 es una puerta: alcanza con llamar `error.tsx` a cualquier cosa
// para meter JS de cliente en la vidriera. El boundary tiene que seguir siendo trivial.
must('W001b', 'el error boundary de (storefront) no importa nada ni usa hooks: la excepcion de W001 no es una puerta',
  store.filter(BOUNDARY),
  /^\s*import\s|\brequire\s*\(|\buse(State|Effect|Reducer|Context|Ref|Memo|Callback|LayoutEffect|SyncExternalStore)\s*\(/);

must('W002', 'sin headers()/cookies() en (storefront): vuelve la ruta dinámica y mata el ISR', store,
  /\b(headers|cookies|draftMode)\s*\(\s*\)/);

must('W003', 'sin set-cookie en (storefront): uno solo apaga el CDN entero', store,
  /(set-?[Cc]ookie|cookies\(\)\.set)/);

must('W004', 'sin `export const revalidate` en (storefront): revalidate:60 es 216x el costo', store,
  /export\s+const\s+revalidate\s*=/);

// La doc de Next: "It costs a server invocation per prefetchable link." En una grilla de 20 fichas
// son 20 invocaciones por pageview, en la única página cuya economía depende de no invocar nada.
must('W005', 'sin prefetch={true} en (storefront): una invocación de función por card', store,
  /prefetch\s*=\s*\{\s*true\s*\}/);

must('W006', 'sin next/image: PROHIBIDO Vercel Image Optimization como default (CLAUDE.md §3)', src,
  /from\s+['"]next\/image['"]/);

// Trampa que reportó storefront-agent y que no rompe ningún test: sin generateStaticParams la ruta
// vuelve a modo postponed, el Cache-Control vuelve a `private, no-store` y un slug inexistente pasa
// a devolver 200 con contenido de 404 (soft 404). Falla en silencio, en producción.
{
  const dyn = store.filter((f) => /\[[^\]]+\]/.test(f.rel) && /\/page\.tsx$/.test(f.rel));
  const sin = dyn.filter((f) => !/generateStaticParams/.test(f.src)).map((f) => f.rel);
  dyn.length === 0
    ? ok('W007 (sin rutas dinámicas en (storefront) todavía)')
    : sin.length
      ? bad('W007', 'ruta dinámica de (storefront) sin generateStaticParams → soft 404 silencioso', sin)
      : ok(`W007 las ${dyn.length} rutas dinámicas de (storefront) tienen generateStaticParams`);
}

// ── Aislamiento de tenant ─────────────────────────────────────────────────────────────────────
must('W008', 'tenant_id jamás en user_metadata: el usuario lo escribe (lint 0015, ERROR)', src,
  /user_metadata[^\n]{0,40}tenant/);

must('W009', 'sin imei/cost_usd/margin/internal_notes en (storefront)', store,
  /\b(imei|cost_?[Uu]sd|costUsd|margin_?[Uu]sd|internal_?[Nn]otes|internalNotes)\b/);

// ── Bordes ────────────────────────────────────────────────────────────────────────────────────
// Zod en todos los bordes (CLAUDE.md §5): process.env se parsea en un solo lugar, no salpicado.
{
  const env = src.filter((f) => !/_lib\/env\.ts$|scripts\//.test(f.rel) && f.rel !== 'proxy.ts');
  const h = scan(env, /process\.env\.(?!NODE_ENV\b)/);
  h.length ? bad('W010', 'process.env fuera de _lib/env.ts: el env se valida con Zod en un solo borde', h)
           : ok('W010 process.env sólo en _lib/env.ts');
}

// Un `console.log(listing)` imprime el IMEI y el costo en los logs de Vercel para siempre.
must('W011', 'sin console.log de un listing/unit/row entero (CLAUDE.md §2)', src,
  /console\.(log|info|debug|warn)\((listing|unit|row|record|tenant|data)\b/);

// ADR-007 ley 3: un matcher que excluye un path también saltea sus Server Functions.
{
  const acts = src.filter((f) => /^['"]use server['"]/m.test(f.src));
  // Dos exenciones, las dos declaradas:
  //
  // 1. `_lib/auth/**` es el ciclo de vida de la sesión. No se le puede exigir una sesión a la
  //    acción que la crea: signIn con guard de sesión no deja entrar a nadie nunca. Es estructural
  //    y estrecha a propósito — una lista de paths sueltos se pudre, "el directorio que fabrica
  //    sesiones" no.
  // 2. Un marcador explícito en el archivo, para el caso que no anticipé. Se imprime siempre:
  //    una exención invisible no es una exención, es un agujero.
  const lifecycle = (f) => /app\/\(app\)\/_lib\/auth\//.test(f.rel);
  const marked = (f) => /web-lint-allow\s+W012/.test(f.src);
  for (const f of acts.filter((x) => lifecycle(x) || marked(x))) {
    console.log(`  \x1b[33mW012\x1b[0m  exento: ${f.rel} ${lifecycle(f) ? '(ciclo de vida de sesión)' : '(marcador en el archivo)'}`);
  }
  const check = acts.filter((f) => !lifecycle(f) && !marked(f));
  const sin = check
    // `requireTenant` y `getPanelSession` NO estaban en esta lista, y son EL guard real de este
    // panel (`_lib/session.ts`): `requireTenant()` llama a `getPanelSession()` y redirige si no hay
    // sesión o si no hay tenant. O sea que W012 marcaba en rojo justamente a las Server Actions que
    // usaban el guard correcto, y empujaba a la persona hacia el marcador de exención. Encontrado
    // en S2, 2026-08-27: `app-agent` verificaba sesión adentro y aun así tuvo que poner
    // `web-lint-allow W012` para pasar el lint. Una regla que castiga la conducta correcta se
    // desactiva sola.
    //
    // LÍMITE CONOCIDO Y ACEPTADO, escrito para que nadie lo confunda con una garantía: esto es un
    // grep de NOMBRES, no un análisis de flujo. Un archivo que menciona `getPanelSession()` y no
    // hace nada con el resultado pasa igual. La regla acota el descuido (olvidarse del guard), no
    // el engaño (fingirlo). Endurecerla pide exigir además el redirect/throw, y eso es otra slice.
    .filter(
      (f) =>
        !/(requireSession|requireUser|getSession|getPanelSession|requireTenant|assertSession|currentSession|requireOwner)/.test(
          f.src,
        ),
    )
    .map((f) => f.rel);
  check.length === 0
    ? ok('W012 (sin Server Actions que necesiten guard todavía)')
    : sin.length
      ? bad('W012', 'Server Action que no verifica sesión adentro: el proxy NO es control de acceso', sin)
      : ok(`W012 las ${check.length} Server Actions verifican sesión adentro`);
}

// ── El proxy ──────────────────────────────────────────────────────────────────────────────────
{
  const proxy = FILES.filter((f) => f.rel === 'proxy.ts');
  if (!proxy.length) bad('W013', 'falta apps/web/proxy.ts', []);
  else {
    must('W013', 'el proxy no hace I/O ni guarda estado (corre antes del cache, en el 100% de hits)',
      proxy, /(from ['"]@istock\/db['"]|drizzle|createClient|await fetch\(|new Map\()/);
    must('W014', 'el proxy no declara runtime (en Proxy tira error, Next 16.0)',
      proxy, /^\s*(export const )?runtime\s*=/);
  }
}


// ── W015 · filtro de tenant EN LA QUERY, ademas de RLS ────────────────────────────────────────
// `CLAUDE.md` §2: "Query sin filtro de tenant *ademas* de RLS → rechazo (defensa en profundidad)".
// Lo levanto `qa-agent` el 2026-08-28 auditando cobertura: era una de las prohibiciones que la
// constitucion declara y que NINGUN test ni lint sostenia. Una prohibicion sin gate es una opinion.
//
// Por que importa teniendo RLS: la RLS depende del claim de la sesion. Una query que corre con
// `service_role` (los jobs, el signup, cualquier `withServiceDb`) NO tiene RLS encima — ahi el
// filtro explicito es la unica defensa que queda, y es justo donde se escribe menos porque "total,
// hay RLS". Las dos capas se caen en momentos distintos: por eso van las dos.
//
// La lista de tablas se DERIVA del schema real (las que tienen `tenantId`), no se escribe aca. Una
// tabla de negocio nueva queda cubierta el dia que nace y no el dia que alguien se acuerda de esta
// lista. Si el schema no se puede leer, la regla FALLA: ausencia de medicion es FAIL, nunca PASS —
// una lista vacia haria que todas las queries pasen y el lint diria PASS con 0 tablas miradas.
{
  // Desde `HERE`, no desde `ROOT`: el schema real es el que manda aunque se audite otro árbol.
  // `WEB_LINT_SCHEMA` sólo lo mueve el arnés de polaridad, para ver fallar la rama de ilegible.
  const SCHEMA = process.env.WEB_LINT_SCHEMA
    ? resolve(process.env.WEB_LINT_SCHEMA)
    : join(HERE, '..', '..', 'packages', 'db', 'src', 'schema');
  const negocio = new Set();
  const negocioSql = new Set();
  let leible = true;
  try {
    for (const f of readdirSync(SCHEMA)) {
      if (!f.endsWith('.ts') || f.includes('.test.')) continue;
      const s = readFileSync(join(SCHEMA, f), 'utf8');
      const re = /export\s+const\s+(\w+)\s*=\s*pgTable\(\s*['"](\w+)['"]/g;
      let m;
      while ((m = re.exec(s))) {
        const sig = s.indexOf('\nexport const', m.index + 1);
        if (!/tenantId\s*:/.test(s.slice(m.index, sig === -1 ? s.length : sig))) continue;
        negocio.add(m[1]);      // `waClickEvents`, como se escribe en el builder de Drizzle
        negocioSql.add(m[2]);   // `wa_click_events`, como se escribe en un sql`` crudo
      }
    }
  } catch { leible = false; }

  if (!leible || negocio.size === 0) {
    bad('W015', 'no pude leer las tablas de negocio de packages/db/src/schema: la regla no midio nada', []);
  } else {
    // Ventana de la sentencia: hacia atras hasta el `;` `{` o `}` mas cercano, hacia adelante hasta
    // el proximo `;`. Angosta a proposito. Una ventana ancha produce FALSOS NEGATIVOS — un
    // `tenantId` que aparece diez lineas mas arriba, en otra query, dejaria pasar a esta.
    // ## Presencia NO es filtro (2026-08-28, encontrado midiendo la propia regla)
    // La primera version de W015 preguntaba si `tenantId` APARECIA en la sentencia. `session.ts:71`
    // la pasaba en verde: nombra `m.tenant_id` en el SELECT y en el `join ... on t.id = m.tenant_id`,
    // y no filtra por tenant en ningun lado. Es el MISMO defecto que M3b (afirmar substrings en vez
    // del invariante) que este repo commiteo como bug esta misma manana. Un `select` que PROYECTA
    // tenant_id es justamente el que hay que mirar, no el que hay que eximir.
    // Ahora se exige que aparezca en posicion de FILTRO: dentro de `.where(...)` en el builder, y
    // despues del `where` en el SQL crudo. Un `join ... on` no cuenta: acota la fila que se une, no
    // el tenant que se lee.
    const filtra = (frag) => /tenantId|tenant_id/.test(frag);
    const MARCA = 'web-lint:sin-tenant';
    // Escape con MOTIVO ESCRITO, como el censo de rutas de guard-firewall. La ventana hacia atras
    // es acotada: una marca perdida al principio de un docblock largo NO exime. Falla cerrado
    // (rojo, no verde), asi que el modo de fallo es pedir un motivo de mas, nunca dejar pasar uno
    // de menos. Lo reporto `app-agent` al declarar la primera excepcion.
    // La ventana de la excepcion es la FUNCION QUE CONTIENE la query, mas su docblock pegado
    // arriba. Antes eran "los 400 caracteres anteriores", que es proximidad y no alcance: una
    // marca legitima excusaba a cualquier query vecina que cayera en el radio, aunque fuera de
    // otra funcion y nunca se hubiera declarado. Ese es el falso PASS que importa — la regla
    // existe para separar declarado de invisible, y una excepcion heredada por cercania es
    // invisible con suerte. El docblock cuenta porque asi se usa la unica marca real del repo:
    // `hasMembership` la declara en su docblock, con la firma de la funcion en el medio.
    // Ancla en COLUMNA 0 a proposito. La version anterior permitia sangria y matcheaba lineas
    // INTERNAS: `const rows = (await withServiceDb(async (tx) =>` entraba por la alternativa de
    // arrow porque `[^)\n]*` no excluye `(`, se comia `await withServiceDb(async (tx` y cerraba
    // con el `)` del `tx`. La ventana anclaba adentro de la funcion y dejaba el docblock afuera,
    // o sea que la marca puesta donde la documentacion dice que va NO eximia. Lo midio `app-agent`.
    // Tampoco se pide una forma de RHS: `const x = cache(async (...) => {}` es una declaracion como
    // cualquier otra, y exigir `=>` o `function` la volvia invisible. Una declaracion de modulo es
    // "empieza en la columna 0", y eso es todo lo que hace falta saber.
    const FNDECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+|^(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=\n]*)?=/;
    const COMENT = /^\s*(\/\/|\/\*|\*|$)/;
    const exento = (texto, hasta) => {
      const lineas = texto.slice(0, hasta).split('\n');
      let i = lineas.length - 1;
      while (i >= 0 && !FNDECL.test(lineas[i])) i--;
      let j = i - 1;
      while (j >= 0 && COMENT.test(lineas[j])) j--;
      // SIN ANCLA NO HAY EXENCION. Esto decia `i < 0 ? 0`, o sea que cuando no encontraba la
      // declaracion contenedora abria la ventana al ARCHIVO ENTERO desde la linea 1 — el agujero
      // que esta regla existe para cerrar, en su version mas ancha, y metido justo por la linea
      // del caso de borde. Un default que falla ABIERTO en un gate no es un default, es la regla
      // real el dia que algo no matchea. Mismo criterio que `no pude leer el schema -> FAIL`.
      if (i < 0) return { marcada: false, vale: false };
      const contexto = lineas.slice(j + 1).join('\n');
      const k = contexto.lastIndexOf(MARCA);
      if (k === -1) return { marcada: false, vale: false };
      const motivo = contexto.slice(k + MARCA.length).split('\n')[0].trim();
      return { marcada: true, vale: motivo.length >= 30 };
    };
    const hits = [];
    // El campo se renombra a `texto`: `for (const { src } of src)` es un TDZ — el iterable se evalua
    // en el scope que ya declara la variable del loop, y tira "Cannot access 'src' before init".
    for (const { rel, src: texto } of src) {
      const re = /\.(from|update|delete|insert|into)\(\s*(\w+)/g;
      let m;
      while ((m = re.exec(texto))) {
        if (!negocio.has(m[2])) continue;
        const atras = Math.max(texto.lastIndexOf(';', m.index), texto.lastIndexOf('{', m.index), texto.lastIndexOf('}', m.index));
        const ade = texto.indexOf(';', m.index);
        const vent = texto.slice(atras + 1, ade === -1 ? texto.length : ade);
        // La vara depende de la OPERACION. Un `insert` no tiene `.where()` por construccion: lo que
        // lo ata al tenant es que la fila que escribe lleve `tenantId` en el `.values()`. Medir el
        // insert con la vara del select daba 8 falsos positivos sobre inserts perfectamente atados
        // (`tx.insert(listings).values({ tenantId: ctx.tenantId, ... })`), y una regla que grita
        // sobre codigo correcto se termina apagando: es la forma mas comun de perder un gate.
        const esInsert = m[1] === 'insert' || m[1] === 'into';
        const rel0 = m.index - (atras + 1);
        const ok_ = esInsert ? filtra(vent.slice(rel0)) : (() => {
          const w = vent.indexOf('.where(', rel0);
          return w !== -1 && filtra(vent.slice(w));
        })();
        if (ok_) continue;
        // Hay preguntas legitimamente cross-tenant: `hasMembership(userId)` corre en el signup,
        // ANTES de que exista un tenant, para el "un negocio por persona" de Capa 1. Filtrarla por
        // tenant la volveria sin sentido. Pero la excepcion se DECLARA y se explica, no se asume.
        const e = exento(texto, m.index);
        if (e.vale) continue;
        const ln = texto.slice(0, m.index).split('\n').length;
        hits.push(`${rel}:${ln}: query sobre '${m[2]}' sin tenantId ${m[1] === 'insert' || m[1] === 'into' ? 'en el .values()' : 'en el .where()'}` + (e.marcada ? ' (la marca web-lint:sin-tenant no explica por que: se piden 30+ caracteres de motivo)' : ''));
      }
    }
    // ## Segunda pasada: SQL crudo. Lo encontro `app-agent` declarando la primera excepcion.
    // La pasada de arriba exige el builder de Drizzle (`.from(memberships)`) y por lo tanto NO ve
    // `tx.execute(sql`... from public.memberships m join ...`)`. Habia una segunda lectura
    // cross-tenant privilegiada sobre `memberships` que pasaba por INVISIBLE y no por declarada,
    // que es exactamente la diferencia entre un gate y una casualidad. Y lo que hoy es un `select`
    // invisible manana es un `insert` invisible.
    //
    // El SQL crudo nombra la tabla como la nombra Postgres (`wa_click_events`), no como la nombra
    // el builder (`waClickEvents`): por eso se derivan los DOS nombres del mismo `pgTable(...)`.
    for (const { rel, src: texto } of src) {
      const tpl = /sql`([^`]*)`/g;
      let t;
      while ((t = tpl.exec(texto))) {
        const cuerpo = t[1];
        const tocadas = [...cuerpo.matchAll(/\b(?:from|join|into|update)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)]
          .map((x) => x[1].toLowerCase())
          .filter((n) => negocioSql.has(n));
        if (!tocadas.length) continue;
        // Misma vara por operacion que arriba. El beacon de S4 es `insert into wa_click_events
        // ("tenant_id", ...) select ... where claim.tid is not null`: esta atado al tenant por el
        // claim y por la lista de columnas, y su `where` no nombra tenant_id ni tiene por que.
        const bajo = cuerpo.toLowerCase();
        const esIns = /insert\s+into/.test(bajo);
        let pasa;
        if (esIns) {
          pasa = filtra(cuerpo);
        } else {
          const donde = bajo.lastIndexOf('where');
          pasa = donde !== -1 && filtra(cuerpo.slice(donde).split(/order\s+by|group\s+by|limit/i)[0]);
        }
        if (pasa) continue;
        const e = exento(texto, t.index);
        if (e.vale) continue;
        const ln = texto.slice(0, t.index).split('\n').length;
        hits.push(`${rel}:${ln}: sql crudo (template) sobre '${[...new Set(tocadas)].join(', ')}' sin tenant_id en el where` + (e.marcada ? ' (la marca no explica por que: se piden 30+ caracteres de motivo)' : ''));
      }
    }

    hits.length
      ? bad('W015', `query sobre tabla de negocio sin filtro de tenant explicito (CLAUDE.md §2; ${negocio.size} tablas derivadas del schema)`, hits)
      : ok(`W015 toda query sobre las ${negocio.size} tablas de negocio filtra por tenant ademas de RLS (builder y sql crudo)`);
  }
}

console.log('');
if (failed) { console.log(`WEB-LINT: FAIL (${failed} regla${failed > 1 ? 's' : ''})`); process.exit(1); }
console.log('WEB-LINT: PASS (15 reglas)');
