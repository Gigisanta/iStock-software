/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S1 · "la vidriera que nace muerta". Requisito del LEAD, prioridad sobre el resto de la slice.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## El bug que este archivo existe para atrapar
 * La respuesta a un slug que no es de nadie —la página de "dirección sin vidriera", que bajo
 * **ADR-011** es **200 con `noindex`, no 404**— **se cachea**. Con el perfil corto de **ADR-012**
 * (`stale 60 s · revalidate 300 s · expire 900 s`), no con `'max'`: cachearla 30 días dejaba que
 * un bot barriendo subdominios sembrara entradas de ISR que nadie iba a invalidar jamás.
 *
 * Que el perfil sea corto **no hace que este test sobre**: ADR-012 lo dice con todas las letras —
 * el `updateTag(storefront:{slug})` del alta es **el cinturón** y el TTL corto son **los
 * tirantes**. Sin cinturón, la persona que abre el link en los primeros minutos ve la página de
 * "acá no hay nada": el dueño carga 15 equipos, pega el link en un estado de Instagram, y el link
 * no muestra el negocio. No hay error, no hay log, no hay alerta.
 *
 * Por eso las visitas del paso 3 se hacen **una atrás de la otra, en segundos**: el TTL corto no
 * puede rescatar una implementación que no invalida. Si el test tuviera que esperar 5 minutos para
 * ver la vidriera, eso **es** el bug, no una demora aceptable.
 *
 * Comprobado que la trampa es real, no teórica: con el tenant YA insertado en Postgres, la
 * vidriera seguía sirviendo la respuesta negativa con `x-nextjs-cache: HIT`. La base tenía razón y
 * el CDN no se enteró.
 *
 * Por eso el alta de un tenant tiene que invalidar **los dos** tags de su propio slug:
 *   - `storefront:{slug}`     → el HTML de la vidriera.
 *   - `tenant-config:{slug}`  → `generateMetadata` (el `<title>` y el `robots`), que se cachea
 *                               aparte y por lo tanto puede quedar viejo solo.
 *
 * ## Por qué el alta va por el panel y no por un `insert`
 * Un `insert` directo prueba que Postgres funciona. Lo que hay que probar es que **el camino que
 * recorre un cliente real** deja la vidriera viva. Si el `revalidateTag` se cae de la Server
 * Action en un refactor, el `insert` sigue verde y el producto sigue roto.
 *
 * ## Qué se observa, ahora que el status no dice nada (ADR-011)
 * Miss y vidriera responden **las dos 200**: `expect(status).toBe(200)` daría verde con la
 * vidriera muerta y la página de "no hay ninguna vidriera en esta dirección" en pantalla. Se
 * distingue por **DOM**: `data-storefront="miss"` (`MISS_MARKER`) contra el `<h1>` con el nombre
 * del negocio. El nombre viejo de este archivo decía `404` y era una afirmación falsa; lo que
 * prueba no cambió una coma.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { expect, test } from './_lib/fixtures';
import { deleteTenantBySlug, deleteUserByEmail, purgeE2eFixtures, tenantIdBySlug } from './_lib/db';
import { FIXTURE_PREFIX, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { firstH1, robotsMeta, titleOf } from './_lib/html';
import { fetchUntilCached, getRaw } from './_lib/http';
import { expectStorefrontMiss, isMiss } from './_lib/miss';
import { createBusiness, signIn } from './_lib/panel';

const slug = uniqueSlug('alta');
const email = uniqueEmail('alta');
const businessName = 'Juan Cel Vermkt';

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
});

// `closeDb()` NO va acá. El pool es de la suite y lo cierra el fixture de worker de
// `_lib/fixtures.ts`: cerrarlo desde el `afterAll` del primer spec alfabético es exactamente
// HIGH-3 — dejaba sin base a todos los specs que venían atrás, en silencio.
test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('dar de alta el negocio revive la vidriera que el link ya mostraba como inexistente', async ({
  page,
  request,
  browser,
}) => {
  // ── 1 · alguien visita el link ANTES de que el negocio exista ────────────────────────────
  const warm = await fetchUntilCached(request, storefrontUrl(slug));
  expectStorefrontMiss(await warm.text(), 'el slug todavía no es de nadie');
  expect(
    warm.headers()['x-nextjs-cache'],
    'sin una respuesta CACHEADA este test no prueba nada: la trampa es el cache, no el miss',
  ).toBe('HIT');

  // ── 2 · recién ahora el dueño da de alta el negocio, por el panel de verdad ──────────────
  await signIn(page, email);
  await createBusiness(page, { name: businessName, slug, waPhone: '299 555 1234' });

  // El alta ocurrió de verdad. Sin esta línea, un fallo del paso 3 es ambiguo: no se distingue
  // "el formulario no dio de alta nada" de "dio de alta y el cache siguió sirviendo el 404".
  expect(
    await tenantIdBySlug(slug),
    'el formulario no creó el negocio: el fallo es del alta, no del cache',
  ).not.toBeNull();

  // ── 3 · el link que ya estaba pegado en el estado de Instagram tiene que andar ───────────
  // Se mide la secuencia completa de visitas, no sólo la primera. La diferencia importa para
  // decidir qué está roto: `[miss, miss, miss, …]` es "el alta no invalidó nada y la vidriera está
  // muerta"; `[miss, vidriera]` es "invalidó, pero el primero que abre el link se come la página
  // vieja" (stale-while-revalidate). El gate del LEAD es el primero: *visitar, crear, volver a
  // visitar y ver la vidriera*. Por eso la primera visita se afirma con `expect.soft`: falla igual,
  // pero deja correr las afirmaciones de abajo, que son las que dicen **cuál** de los dos tags
  // quedó viejo.
  //
  // ⚠️ Lo que se observa es el DOM, no el status. Bajo ADR-011 (variante B) el miss también
  // responde 200: `expect(status).toBe(200)` daría verde con la vidriera muerta y la página de
  // "no hay ninguna vidriera en esta dirección" en pantalla.
  //
  // El discriminante primario es `data-storefront="miss"`, que no depende de la copy. El `<h1>`
  // se sigue mirando porque distingue el tercer caso, el que un booleano se comería: *no es el
  // miss, pero tampoco es la vidriera de ESTE negocio* (shell vacío, error de Next, o —peor— la
  // vidriera de otro tenant por colisión de clave de cache).
  const seen: string[] = [];
  const label = (html: string): string => {
    if (isMiss(html)) return 'miss';
    const h1 = firstH1(html);
    if (h1 === businessName) return 'vidriera';
    return `otro(${h1 ?? 'sin h1'})`;
  };

  let revived = await getRaw(request, storefrontUrl(slug));
  let revivedHtml = await revived.text();
  seen.push(label(revivedHtml));
  for (let attempt = 1; attempt < 5 && seen[seen.length - 1] !== 'vidriera'; attempt += 1) {
    revived = await getRaw(request, storefrontUrl(slug));
    revivedHtml = await revived.text();
    seen.push(label(revivedHtml));
  }

  expect
    .soft(
      seen[0],
      `la primera visita después del alta mostró "${String(seen[0])}": la respuesta cacheada le ` +
        `sobrevivió al alta. Secuencia de visitas: [${seen.join(', ')}].`,
    )
    .toBe('vidriera');

  expect(
    seen[seen.length - 1],
    'la vidriera nació muerta: el alta no invalidó `storefront:' +
      slug +
      '` y la página de "sin vidriera" sigue cacheada. Secuencia: [' +
      seen.join(', ') +
      ']',
  ).toBe('vidriera');

  expect(revived.status(), 'la vidriera viva responde 200').toBe(200);

  const html = revivedHtml;
  // Se mira el `<h1>` renderizado y no `html.toContain(...)`: la copy de la página de miss viaja
  // serializada en el payload de Flight de TODA página de ese layout, así que buscarla en el texto
  // crudo da falso positivo incluso con la vidriera andando (ver `_lib/html.ts`).
  expect(firstH1(html), 'la vidriera no muestra el nombre del negocio').toBe(businessName);
  expect(isMiss(html), 'la vidriera viva sigue trayendo la marca de DOM del miss').toBe(false);

  // `generateMetadata` se cachea con `tenant-config:{slug}` y NO con `storefront:{slug}`. El
  // `<title>` y el `robots` son la única forma observable de distinguir los dos tags: si sólo se
  // invalidó uno, el cuerpo de la página se ve perfecto y la vidriera igual es invisible para
  // Google, que es la mitad del producto ("pegá el link en un estado").
  expect(
    titleOf(html),
    'el cuerpo se actualizó pero el <title> no: falta invalidar `tenant-config:' + slug + '`',
  ).toBe(businessName);
  expect(
    robotsMeta(html) ?? '',
    'la vidriera se sirve con el `noindex` del miss: `tenant-config:' + slug + '` quedó viejo',
  ).not.toContain('noindex');

  // ── 4 · y lo ve cualquiera, no sólo la sesión que creó el negocio ────────────────────────
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  const response = await visitorPage.goto(storefrontUrl(slug));
  expect(response?.status()).toBe(200);
  await expect(visitorPage.getByRole('heading', { level: 1, name: businessName })).toBeVisible();
  await visitor.close();
});
