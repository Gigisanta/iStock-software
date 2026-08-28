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
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
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

console.log('');
if (failed) { console.log(`WEB-LINT: FAIL (${failed} regla${failed > 1 ? 's' : ''})`); process.exit(1); }
console.log('WEB-LINT: PASS (14 reglas)');
