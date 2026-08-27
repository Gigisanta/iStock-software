/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S1 · HIGH del `adversary-reviewer`: `/s/{cualquier-cosa}.json` deja el stream abierto con 200.
 *  Owner: `qa-agent`. **No toco `apps/web/**`. Si esto se pone rojo, el defecto es del código.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## El defecto, medido (no es una hipótesis)
 *
 * ```
 * curl -m 12 http://127.0.0.1.nip.io:3100/s/noexiste-991.json
 *   → HTTP/1.1 200 · Cache-Control: private, no-cache, no-store
 *   → 8661 bytes y el stream NUNCA cierra (curl sale por timeout, exit 28)
 *   → el cuerpo contiene id="__next_error__"
 *
 * curl http://127.0.0.1.nip.io:3100/s/noexiste-control-991     (control, slug bien formado)
 *   → HTTP/1.1 404 en 0.006 s
 * ```
 *
 * ### La cadena
 * 1. El `matcher` de `apps/web/proxy.ts` excluye **todo path** que termine en una de 16 extensiones
 *    (`svg png jpg jpeg gif webp avif ico css js txt xml json woff woff2 ttf`).
 * 2. `/s/loquesea.json` **sí** matchea la ruta `/s/[slug]` con `slug = "loquesea.json"`, pero **no**
 *    matchea el `matcher` → `proxy()` no corre → ninguna de sus tres guardas se evalúa.
 * 3. El slug basura llega a `cacheTag(storefrontTag(slug))`, que valida la forma y **tira**.
 * 4. No hay `error.tsx` en todo `apps/web/app`. Bajo `cacheComponents` + PPR los headers ya salieron
 *    (200), así que el status no se puede corregir y sin boundary el cuerpo queda **abierto**.
 *
 * ### Por qué es HIGH y no cosmético
 * Anónimo, sin auth, en **cualquier** hostname de producción, incluido el de cada tenant. La
 * respuesta sale `private, no-cache, no-store`: el CDN no la absorbe nunca. La cardinalidad es
 * infinita (`/s/$RANDOM.json`), así que tampoco hay una entrada de cache que sature. Amplificación:
 * **1 request : hasta 300 s de Active CPU facturado**. Es el ataque más barato que tiene esta app.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## DECISIÓN — qué tiene que devolver `/s/algo.json`. **404.**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Punto de coordinación con `storefront-agent`: si su implementación devuelve otra cosa, la slice
 * se cae y va a re-plan. Coincido con la lectura del LEAD, y agrego el argumento que me parece
 * decisivo (el 4).
 *
 * **1 · `algo.json` no es un slug, es un string malformado.** `SLUG_PATTERN` (`@istock/domain`, y el
 *    mismo literal en el `CHECK tenants_slug_format` de `packages/db`) no admite el punto. No existe
 *    el futuro en el que alguien registre ese tenant. Es exactamente el mismo género que
 *    `Foo_Bar.maat.work` o `a.b.maat.work` como host — que hoy dan **404 real desde el proxy, sin
 *    invocar la app** (ver `s1-vidriera-por-host.spec.ts`, "un host anidado no puede ser un tenant").
 *
 * **2 · ADR-011 gobierna el slug BIEN FORMADO que no existe, y sólo ése.** Su razón de ser está
 *    medida y escrita en `s/[slug]/page.tsx`: bajo `cacheComponents` el status se decide **antes de
 *    que resuelva el lookup del tenant**, así que el 404 es inalcanzable sin romper el cache. Ese
 *    argumento requiere que haya un lookup. Acá no hay ninguno que hacer: la **forma** decide, en
 *    string ops, en el proxy, con cero I/O. Donde no hay incertidumbre, no hay ADR-011.
 *
 * **3 · Servir el miss de ADR-011 sería pagar el ataque con otra moneda.** El miss se cachea (perfil
 *    corto de ADR-012) justo porque el conjunto de slugs bien formados que un bot escanea es
 *    acotado. El conjunto de slugs malformados **no lo es**: `/s/$RANDOM.json` genera una entrada de
 *    ISR nueva por request. Cambiaríamos "300 s de CPU por request" por "una escritura de ISR por
 *    request", que es el mismo agujero con otra factura.
 *
 * **4 · El argumento que cierra la discusión: hoy `/s/{slug}` sobre el apex YA es 404.** Lo corta
 *    `malformedHost()` en el branch `marketing` del proxy ("una sola URL canónica por negocio").
 *    Verificado: `www.127.0.0.1.nip.io:3100/s/zzz-991` → **404 en 0.004 s**;
 *    `www.127.0.0.1.nip.io:3100/s/zzz-991.json` → **200 colgado**. O sea que la pregunta no es
 *    siquiera "404 o miss": es que agregarle `.json` a una URL **no puede volverla más permisiva que
 *    la misma URL sin la extensión**. Cualquier respuesta que no sea 404 hace que la extensión sea
 *    un bypass de una regla que ya existe y ya está testeada.
 *
 * **Lo que NO afirmo, a propósito:** *cómo* se llega al 404. Sobre el apex sale del proxy (texto
 * plano, sin invocar la app) porque el branch `marketing` ya existe; bajo el host de un tenant el
 * proxy reescribe a `/s/{slug}/s/algo.json`, que no es una ruta, y el 404 lo da Next. Los dos son
 * 404 y los dos son baratos. El único test que mira la procedencia es el que dice "sin invocar la
 * app", y sólo sobre el apex, que es donde ya está decidido.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## El assert central es "la respuesta TERMINA", no el status
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Un `expect(status).toBe(404)` no atrapa nada de esto: si el server no cierra el stream, el
 * `await` no vuelve, el `expect` no se evalúa nunca y Playwright reporta *"Test timeout of 90000ms
 * exceeded"*. Eso es un rojo por la razón equivocada, indistinguible de un flake, y el martes que
 * viene alguien le pone `retries: 1` y el agujero desaparece del radar.
 *
 * Por eso cada test afirma **primero** `timedOut === false` con `fetchWithDeadline` (`_lib/http.ts`)
 * y **después**, por separado, el status.
 *
 * ### El presupuesto: 5 000 ms. Por qué ese número
 * - **Piso medido** en este mismo server (`next start`, build de producción, máquina de desarrollo):
 *   404 del proxy `0.004–0.009 s` · 404 de Next `0.020 s` · home de marketing completa `0.036 s`.
 *   5 s es entre **140×** y **1250×** el camino legítimo: no hay carga de CI que lo alcance.
 * - **Techo**: el `timeout` de test de `playwright.config.ts` es 90 s. A 5 s el corte lo hace la
 *   aserción y el mensaje dice *"el server no cerró el stream"*, que es el diagnóstico. A 90 s lo
 *   haría Playwright y el mensaje diría "timeout", que no es ninguno.
 * - **Distingue "lento" de "nunca"**: el defecto no es lentitud, es una respuesta sin fin (300 s de
 *   `maxDuration` en Vercel). Cualquier presupuesto entre ~1 s y ~60 s separa las dos poblaciones;
 *   5 s deja margen para un render frío real sin acercarse al techo.
 * - **Costo del rojo**: 16 extensiones × 5 s ≈ 80 s de corrida mientras el defecto esté vivo.
 *   Con el fix, los mismos 16 tests tardan menos de un segundo en total.
 */

import { expect, test } from './_lib/fixtures';
import { deleteTenantBySlug, purgeE2eFixtures, seedTenant } from './_lib/db';
import { APEX_URL, E2E_APEX_HOST, E2E_PORT, FIXTURE_PREFIX, storefrontUrl, uniqueSlug } from './_lib/env';
import { fetchWithDeadline, getRaw } from './_lib/http';
import type { DeadlineResult } from './_lib/http';
import { MARKETING_H1 } from './_lib/copy';
import { firstH1 } from './_lib/html';
import { MISS_MARKER } from './_lib/miss';

/** Ver el docblock, sección "El presupuesto". */
const RESPONSE_BUDGET_MS = 5_000;

/**
 * Las 16 extensiones que el `matcher` de `apps/web/proxy.ts` excluye hoy, literal:
 *
 * ```
 * .*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|txt|xml|json|woff|woff2|ttf)$
 * ```
 *
 * **Son 16, no 14.** (El reporte del adversary decía 14; conté sobre el literal.) Están todas y no
 * una muestra: cada una es una llave distinta a la misma puerta, y "probamos `.json` y `.css`" es
 * cómo se deja viva la undécima. Que esta lista siga siendo un superconjunto de lo que el matcher
 * excluye lo chequea `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`, que corre en
 * `pnpm test` sin necesitar build.
 *
 * `.js` y `.css` están acá **a pesar** de que `_next/static` tiene su propia exclusión: el bypass no
 * depende del directorio, depende de con qué termina el path.
 */
const BYPASSING_EXTENSIONS = [
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

const TENANT = { slug: uniqueSlug('ext'), name: 'Vidriera Control Extension' };

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
  await seedTenant(TENANT);
});

// `closeDb()` NO va acá: el pool es de la suite y lo cierra el fixture de worker (HIGH-3).
test.afterAll(async () => {
  await deleteTenantBySlug(TENANT.slug);
});

/**
 * Afirma el contrato completo de una URL que **no puede ser de ningún negocio jamás**.
 *
 * Orden deliberado: primero que la respuesta exista, después qué dice. Al revés, el mensaje de
 * fallo del primer día sería sobre un `status` que nunca llegó.
 */
function expectDeadUrl(
  result: DeadlineResult,
  where: string,
): void {
  // 1 · EL ASSERT CENTRAL. Todo lo demás es opinable; esto no.
  expect(
    result.timedOut,
    `${where}: el server NO cerró la respuesta en ${String(RESPONSE_BUDGET_MS)} ms. Es el HIGH: ` +
      'el throw de `cacheTag` cae sin `error.tsx`, los headers ya salieron con 200 y el stream ' +
      'queda abierto. 1 request anónima : hasta 300 s de Active CPU facturado, sin cache que lo ' +
      'absorba y con cardinalidad infinita.',
  ).toBe(false);

  expect(
    result.elapsedMs,
    `${where}: la respuesta terminó, pero tardó ${String(result.elapsedMs)} ms. El rechazo de una ` +
      'URL malformada es string ops en el proxy: el camino legítimo mide 4–20 ms en esta máquina.',
  ).toBeLessThan(RESPONSE_BUDGET_MS);

  // 2 · El status. Ver la sección DECISIÓN del docblock: 404, no el miss de ADR-011.
  expect(
    result.status,
    `${where}: se esperaba 404. Esta URL no es un slug (el punto no pasa \`SLUG_PATTERN\`, ni el ` +
      '`CHECK` de la DB), así que no le aplica ADR-011 —que gobierna el slug BIEN FORMADO que no ' +
      'existe— y sí le aplica la misma regla que a `a.b.maat.work`. Y sobre el apex `/s/{slug}` ' +
      'YA es 404: agregarle una extensión a una URL no puede volverla más permisiva.',
  ).toBe(404);

  // 3 · No es una página de error de Next servida como si fuera contenido.
  expect(
    result.body,
    `${where}: el cuerpo trae \`__next_error__\` — se está sirviendo el overlay de error de Next ` +
      'como respuesta pública. Un throw en el render no puede ser la respuesta de una URL basura.',
  ).not.toContain('__next_error__');

  // 4 · Tampoco es el miss de ADR-011. Si aparece esto, la impl tomó la decisión contraria a la de
  //     este archivo y hay que arbitrar ANTES de mergear: es el punto de coordinación declarado.
  expect(
    result.body,
    `${where}: se sirvió la página de miss de ADR-011 (${MISS_MARKER}). Eso es 200 + una entrada ` +
      'de ISR por cada `/s/$RANDOM.json`: cambia 300 s de CPU por una escritura de cache por ' +
      'request. Mismo agujero, otra factura. Ver la sección DECISIÓN de este archivo.',
  ).not.toContain(MISS_MARKER);
}

// ── El defecto, una extensión por test ────────────────────────────────────────────────────────
//
// Un test por extensión y no un `for` adentro de un solo test: mientras el defecto esté vivo cada
// request cuesta los 5 s del presupuesto, y 16 × 5 s adentro de un mismo test lo mata el timeout de
// 90 s de Playwright — el rojo volvería a ser "timeout" en vez de "no cerró el stream". Además así
// el reporte nombra la extensión que falla en vez de esconderla en la primera.
for (const ext of BYPASSING_EXTENSIONS) {
  test(`una URL de vidriera terminada en .${ext} tiene que morir en un 404, no dejar la respuesta abierta`, async ({
    request,
  }) => {
    const url = `${APEX_URL}/s/${uniqueSlug('dead')}.${ext}`;
    expectDeadUrl(await fetchWithDeadline(request, url, RESPONSE_BUDGET_MS), `apex · /s/….${ext}`);
  });
}

test('el agujero también está bajo el host de un tenant real, que es donde vive el tráfico', async ({
  request,
}) => {
  // Verificado con curl: `demo.127.0.0.1.nip.io:3100/s/zzz-991.json` → 200 colgado, igual que el
  // apex. No es un caso de laboratorio del dominio raíz: cada subdominio de cliente en producción
  // expone la misma puerta, y ahí el atacante ni siquiera tiene que adivinar un host.
  const url = storefrontUrl(TENANT.slug, `/s/${uniqueSlug('dead')}.json`);
  expectDeadUrl(await fetchWithDeadline(request, url, RESPONSE_BUDGET_MS), 'host de tenant · /s/….json');
});

test('un subdominio reservado tampoco puede servir la vidriera por agregarle una extensión', async ({
  request,
}) => {
  // Esta es la comparación que hace indefendible cualquier respuesta que no sea 404, y está medida:
  //   www.…/s/zzz-991        → 404 en 0.004 s   (`malformedHost`, "una sola URL canónica")
  //   www.…/s/zzz-991.json   → 200 colgado      (el mismo path, con cinco caracteres más)
  const url = `http://www.${E2E_APEX_HOST}:${String(E2E_PORT)}/s/${uniqueSlug('dead')}.json`;
  expectDeadUrl(await fetchWithDeadline(request, url, RESPONSE_BUDGET_MS), 'www · /s/….json');
});

test('un host que no puede ser de nadie no invoca la app ni cuando el path trae una extensión', async ({
  request,
}) => {
  // `a.b.…` ya está resuelto como `not-found` por el proxy: el wildcard de Vercel es de UN nivel y
  // la DB tiene el mismo `CHECK`. Hoy `a.b.…/` sale por `malformedHost` en 0.004 s, pero
  // `a.b.…/s/zzz.json` se cuelga en 200 y `a.b.…/algo.json` lo contesta la app con un 404 de HTML
  // **sin** `x-robots-tag`. Las dos cosas son la misma: el proxy no corrió.
  const url = `http://a.b.${E2E_APEX_HOST}:${String(E2E_PORT)}/s/${uniqueSlug('dead')}.json`;
  const result = await fetchWithDeadline(request, url, RESPONSE_BUDGET_MS);
  expectDeadUrl(result, 'host anidado · /s/….json');

  // Sobre un host imposible el 404 tiene que salir del proxy, que es lo barato. Es el mismo assert
  // que ya hace `s1-vidriera-por-host.spec.ts` para `a.b.…/`: una extensión no lo puede apagar.
  expect(
    result.headers['content-type'] ?? '(sin content-type)',
    'host anidado: el 404 lo contestó la app, no el proxy. Se invocó una función para decir que ' +
      'un host que no puede existir no existe, y eso se factura en cada request del escaneo.',
  ).toContain('text/plain');
  expect(
    result.headers['x-robots-tag'] ?? '(sin x-robots-tag)',
    'host anidado: el 404 sale indexable — es el 404 de Next, no el del proxy.',
  ).toContain('noindex');
});

// ── Controles positivos ───────────────────────────────────────────────────────────────────────
//
// Sin estos tres, todo lo de arriba da verde el día que el fix rompe la vidriera entera: "nada
// responde 200" satisface cada uno de los asserts anteriores. Un test de rechazo sin control
// positivo mide que el server está apagado.

test('el fix no puede convertir en 404 al slug bien formado que no existe: ADR-011 sigue en pie', async ({
  request,
}) => {
  // El final infeliz más probable de este arreglo es "ahora todo lo que no resuelve es 404", que
  // deroga ADR-011 de contrabando y le muestra una pantalla en blanco al que se equivocó de
  // dirección. `zzz-no-existe` SÍ es un slug: le corresponde el miss, 200 y cacheable.
  const slug = uniqueSlug('vivo');
  const result = await fetchWithDeadline(request, storefrontUrl(slug), RESPONSE_BUDGET_MS);

  expect(result.timedOut, 'control: el miss de ADR-011 tampoco cierra la respuesta').toBe(false);
  expect(
    result.status,
    'control: un slug BIEN FORMADO que no existe dejó de ser 200. El fix del path malformado se ' +
      'llevó puesto ADR-011: el visitante equivocado ahora ve un 404 en blanco en vez de la ' +
      'página que le explica qué hacer.',
  ).toBe(200);
  expect(
    result.body,
    `control: falta ${MISS_MARKER}: no se sirvió la página de "dirección sin vidriera".`,
  ).toContain(MISS_MARKER);
});

test('el fix no puede romper la vidriera de un negocio real: el tenant sigue publicando su stock', async ({
  request,
}) => {
  const result = await fetchWithDeadline(request, storefrontUrl(TENANT.slug), RESPONSE_BUDGET_MS);

  expect(result.timedOut, 'control: la vidriera del tenant no cerró la respuesta').toBe(false);
  expect(result.status, 'control: la vidriera de un tenant activo dejó de responder 200').toBe(200);
  expect(
    firstH1(result.body),
    'control: el h1 de la vidriera no es el nombre del negocio. Si esto falla, todos los tests de ' +
      'rechazo de este archivo están midiendo un server roto, no una regla.',
  ).toBe(TENANT.name);
});

test('el fix no puede empujar los assets estáticos por el proxy ni dejar de servirlos', async ({
  request,
}) => {
  // La reparación natural es tocar el `matcher`, y el `matcher` es lo único que mantiene a
  // `_next/static` fuera del proxy — que es plata: el proxy corre ANTES del cache, o sea en el 100%
  // de las requests, incluidos los cientos de chunks de un pageview. El control mira las dos mitades
  // que un matcher mal editado rompe: que el chunk **se sirva** y que sirva `cache-control` inmutable
  // (que es lo que prueba que no pasó por ningún camino dinámico).
  const home = await getRaw(request, `${APEX_URL}/`);
  const html = await home.text();
  const chunk = /"(\/_next\/static\/[^"]+\.js)"/u.exec(html)?.[1] ?? /(\/_next\/static\/[^"']+\.css)/u.exec(html)?.[1];

  expect(chunk, 'no se encontró ningún asset de `_next/static` en la home: el control no mediría nada').toBeDefined();

  const asset = await fetchWithDeadline(request, `${APEX_URL}${chunk ?? ''}`, RESPONSE_BUDGET_MS);
  expect(asset.timedOut, 'control: un asset estático dejó de cerrar la respuesta').toBe(false);
  expect(asset.status, 'control: `_next/static` dejó de servirse — el matcher se rompió').toBe(200);
  expect(
    asset.headers['cache-control'] ?? '(sin cache-control)',
    'control: el asset estático perdió su cache inmutable. Está pasando por un camino dinámico, y ' +
      'eso es una invocación de proxy por chunk en el 100% de los pageviews.',
  ).toContain('immutable');

  // Y marketing sigue en pie: es el otro lado que un matcher demasiado ancho tira abajo.
  expect(firstH1(html), 'control: la home de marketing dejó de renderizar').toBe(MARKETING_H1);
});
