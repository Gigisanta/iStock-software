/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S1 · "la vidriera que nace muerta". Requisito del LEAD, prioridad sobre el resto de la slice.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## El bug que este archivo existe para atrapar
 * El 404 de un slug inexistente **se cachea con `cacheLife('max')`** (verificado a mano:
 * `x-nextjs-cache: MISS` y después `HIT`, `Cache-Control: s-maxage=2592000`). Eso es deliberado y
 * está bien: un escaneo de subdominios cuesta una query, no una por request.
 *
 * La contracara **no** es opcional. Si alguien visita `juanceluvermkt.maat.work` un minuto antes
 * de que exista el tenant —el propio dueño probando el link que le pasó el vendedor, un amigo,
 * un bot— ese 404 queda guardado **hasta 30 días**. El dueño después carga 15 equipos, pega el
 * link en un estado de Instagram, y el link no muestra nada. No hay error, no hay log, no hay
 * alerta: la vidriera nace muerta y sigue muerta un mes.
 *
 * Comprobado que la trampa es real, no teórica: con el tenant YA insertado en Postgres, la
 * vidriera seguía respondiendo `404` con `x-nextjs-cache: HIT`. La base tenía razón y el CDN no
 * se enteró.
 *
 * Por eso el alta de un tenant tiene que invalidar **los dos** tags de su propio slug:
 *   - `storefront:{slug}`     → el HTML de la vidriera.
 *   - `tenant-config:{slug}`  → `generateMetadata` (el `<title>`), que se cachea aparte.
 * Los dos con perfil `'max'`, que es el perfil con el que se guardaron.
 *
 * ## Por qué el alta va por el panel y no por un `insert`
 * Un `insert` directo prueba que Postgres funciona. Lo que hay que probar es que **el camino que
 * recorre un cliente real** deja la vidriera viva. Si el `revalidateTag` se cae de la Server
 * Action en un refactor, el `insert` sigue verde y el producto sigue roto.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { expect, test } from '@playwright/test';
import {
  closeDb,
  deleteTenantBySlug,
  deleteUserByEmail,
  purgeE2eFixtures,
  tenantIdBySlug,
} from './_lib/db';
import { FIXTURE_PREFIX, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { firstH1, robotsMeta, titleOf } from './_lib/html';
import { fetchUntilCached, getRaw } from './_lib/http';
import { createBusiness, signIn } from './_lib/panel';

const slug = uniqueSlug('alta');
const email = uniqueEmail('alta');
const businessName = 'Juan Cel Vermkt';

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
});

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
  await closeDb();
});

test('crear el negocio revive la vidriera que ya había respondido 404', async ({
  page,
  request,
  browser,
}) => {
  // ── 1 · alguien visita el link ANTES de que el negocio exista ────────────────────────────
  const warm = await fetchUntilCached(request, storefrontUrl(slug));
  expect(warm.status(), 'el slug todavía no es de nadie: tiene que dar 404').toBe(404);
  expect(
    warm.headers()['x-nextjs-cache'],
    'sin un 404 CACHEADO este test no prueba nada: la trampa es el cache, no el 404',
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
  // decidir qué está roto: `[404, 404, 404, …]` es "el alta no invalidó nada y la vidriera está
  // muerta"; `[404, 200]` es "invalidó, pero el primero que abre el link se come el 404 viejo"
  // (stale-while-revalidate). El gate del LEAD es el primero: *visitar, crear, volver a visitar y
  // ver la vidriera*. Por eso la primera visita se afirma con `expect.soft`: falla igual, pero deja
  // correr las afirmaciones de abajo, que son las que dicen **cuál** de los dos tags quedó viejo.
  const statuses: number[] = [];
  let revived = await getRaw(request, storefrontUrl(slug));
  statuses.push(revived.status());
  for (let attempt = 1; attempt < 5 && revived.status() !== 200; attempt += 1) {
    revived = await getRaw(request, storefrontUrl(slug));
    statuses.push(revived.status());
  }

  expect
    .soft(
      statuses[0],
      `la primera visita después del alta devolvió ${String(statuses[0])}: el 404 cacheado le ` +
        `sobrevivió al alta. Secuencia de visitas: [${statuses.join(', ')}].`,
    )
    .toBe(200);

  expect(
    revived.status(),
    'la vidriera nació muerta: el alta no invalidó `storefront:' + slug + '` y el 404 sigue cacheado',
  ).toBe(200);

  const html = await revived.text();
  // Se mira el `<h1>` renderizado y no `html.toContain(...)`: el `notFound` de cada segmento viaja
  // serializado en el payload de Flight de TODA página de ese layout, así que buscar la copy del
  // 404 en el texto crudo da falso positivo incluso con la vidriera andando (ver `_lib/html.ts`).
  expect(firstH1(html), 'la vidriera no muestra el nombre del negocio').toBe(businessName);

  // `generateMetadata` se cachea con `tenant-config:{slug}` y NO con `storefront:{slug}`. El
  // `<title>` y el `robots` son la única forma observable de distinguir los dos tags: si sólo se
  // invalidó uno, el cuerpo de la página se ve perfecto y la vidriera igual es invisible para
  // Google, que es la mitad del producto ("pegá el link en un estado").
  expect(
    titleOf(html),
    'el cuerpo se actualizó pero el <title> no: falta invalidar `tenant-config:' + slug + '`',
  ).toBe(businessName);
  expect(
    robotsMeta(html),
    'la vidriera se sirve con `noindex` heredado del 404: `tenant-config:' + slug + '` quedó viejo',
  ).not.toContain('noindex');

  // ── 4 · y lo ve cualquiera, no sólo la sesión que creó el negocio ────────────────────────
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  const response = await visitorPage.goto(storefrontUrl(slug));
  expect(response?.status()).toBe(200);
  await expect(visitorPage.getByRole('heading', { level: 1, name: businessName })).toBeVisible();
  await visitor.close();
});
