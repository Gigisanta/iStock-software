/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S1 · host → vidriera. Gate del board: *"`{slug}.local` resuelve al tenant; slug inexistente →
 *  no se sirve como vidriera"*. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Corre contra `next build` + `next start` (ver `playwright.config.ts`), porque la mitad de lo que
 * hay que probar vive en el **modo de servido** de la ruta y no en el código: que el miss quede
 * cacheado (o cada escaneo de subdominios es una query de Postgres) y que dos hosts distintos no
 * compartan entrada de cache.
 *
 * ## El instrumento cambió: ADR-011
 * La versión anterior de este archivo afirmaba `status === 404` sobre el slug inexistente. **Ese
 * gate lo superó el LEAD con ADR-011**, medido: bajo `cacheComponents` ninguna variante da 404 en
 * la primera request, y las que lo daban en la segunda servían un body de 0 bytes. Lo que se
 * afirma ahora está en `_lib/miss.ts` y es la lista de la ADR — más exigente que el status, no
 * menos: un 404 con el body vacío pasaba el test viejo y no pasa el nuevo.
 *
 * ## Aislamiento
 * Los tests de este archivo que dicen "A no ve a B" **tienen los dos lados**: que A vea lo suyo y
 * que no vea lo de B. Un test de aislamiento que sólo afirma la ausencia da verde el día que la
 * vidriera entera está rota, y ése es el día en que más falta hace que falle.
 *
 * `qa-agent` no toca el código bajo test. Si algo de acá se pone rojo, se reporta.
 */

import { expect, test } from './_lib/fixtures';
import { deleteTenantBySlug, purgeE2eFixtures, seedTenant } from './_lib/db';
import { APEX_URL, E2E_APEX_HOST, E2E_PORT, FIXTURE_PREFIX, storefrontUrl, uniqueSlug } from './_lib/env';
import { fetchUntilCached, getRaw } from './_lib/http';
import { MARKETING_H1, STOREFRONT_404_H1 } from './_lib/copy';
import { firstH1 } from './_lib/html';
import { expectMissWithout, expectStorefrontMiss } from './_lib/miss';

const NORTE = { slug: uniqueSlug('norte'), name: 'Norte Cel Cipolletti' };
const SUR = { slug: uniqueSlug('sur'), name: 'Sur Celulares Neuquen' };
const SUSPENDIDO = { slug: uniqueSlug('susp'), name: 'Tenant Suspendido QA' };

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
  await seedTenant(NORTE);
  await seedTenant(SUR);
  await seedTenant({ ...SUSPENDIDO, status: 'suspended' });
});

// `closeDb()` NO va acá. El pool es de la suite, no de este archivo: lo cierra el fixture de
// worker de `_lib/fixtures.ts`, una vez, al final. Cerrarlo acá es HIGH-3 volviendo a entrar por
// la misma puerta — el primer spec alfabético dejaba sin base a todos los que venían atrás.
test.afterAll(async () => {
  for (const slug of [NORTE.slug, SUR.slug, SUSPENDIDO.slug]) await deleteTenantBySlug(slug);
});

test('el subdominio de un negocio activo abre SU vidriera', async ({ page }) => {
  const response = await page.goto(storefrontUrl(NORTE.slug));

  expect(response?.status(), 'la vidriera de un tenant activo responde 200').toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: NORTE.name })).toBeVisible();
  // El host que se muestra es el suyo, no el del deploy ni el de otro.
  await expect(page.getByText(`${NORTE.slug}.`, { exact: false }).first()).toBeVisible();
});

test('la vidriera de un negocio NUNCA se sirve bajo el host de otro, ni siquiera desde el cache', async ({
  request,
}) => {
  // E13 de `TEST_MATRIX.md`. Es la falla que no se ve mirando la pantalla: el cache key de
  // `'use cache'` y el del ISR durable NO incluyen el host — sólo build ID + función +
  // argumentos. Si el slug no viajara como argumento, estos dos hosts compartirían entrada.
  //
  // Por eso no alcanza con pedir cada host una vez: **una colisión de cache key sólo se
  // materializa cuando hay entrada cacheada**. Se calientan los dos hasta `HIT` y recién ahí se
  // comparan, que es el estado en el que va a estar el 95% de los pageviews reales.
  const norte = await fetchUntilCached(request, storefrontUrl(NORTE.slug));
  const sur = await fetchUntilCached(request, storefrontUrl(SUR.slug));

  const norteHtml = await norte.text();
  const surHtml = await sur.text();

  // Los dos lados. Sin estas dos líneas, el test da verde con la vidriera completamente rota.
  expect(norteHtml, 'la vidriera de NORTE no muestra su propio nombre').toContain(NORTE.name);
  expect(surHtml, 'la vidriera de SUR no muestra su propio nombre').toContain(SUR.name);

  expect(norteHtml, 'el HTML de un tenant contiene el nombre de otro: fuga entre tenants').not.toContain(
    SUR.name,
  );
  expect(surHtml, 'el HTML de un tenant contiene el nombre de otro: fuga entre tenants').not.toContain(
    NORTE.name,
  );

  // Y el `<h1>` renderizado, no sólo el texto crudo: si los dos hosts compartieran entrada, el
  // segundo serviría el DOM del primero y el `toContain` de arriba lo agarraría — pero también lo
  // agarraría un `toContain` que matchea dentro del payload de Flight. Esto afirma lo que se ve.
  expect(firstH1(norteHtml), 'el h1 servido bajo el host de NORTE no es el de NORTE').toBe(NORTE.name);
  expect(firstH1(surHtml), 'el h1 servido bajo el host de SUR no es el de SUR').toBe(SUR.name);
});

test('un slug que no existe no se sirve como vidriera desde la PRIMERA visita, que es la que hace Google', async ({
  request,
}) => {
  // ADR-011. El status ya no distingue (y la deuda está declarada en la ADR): lo que distingue es
  // que el visitante lea algo, que Google no lo indexe y que no haya ni un byte de tienda.
  // El slug se genera nuevo en cada corrida: el cache está frío para él aunque el server esté
  // caliente, así que esto mide de verdad la primera visita.
  const slug = uniqueSlug('ghost');
  const first = await getRaw(request, storefrontUrl(slug));

  expectStorefrontMiss(await first.text(), 'primera visita a un slug que no es de nadie');
});

test('la dirección sin vidriera queda cacheada: un escaneo de subdominios no paga Postgres', async ({
  request,
}) => {
  const slug = uniqueSlug('scan');

  const cached = await fetchUntilCached(request, storefrontUrl(slug));

  expect(
    cached.headers()['x-nextjs-cache'],
    'el miss no está cacheado: cada bot que escanea subdominios abre una conexión a Postgres',
  ).toBe('HIT');
  expect(cached.headers()['cache-control']).toContain('s-maxage=');

  // Y lo que se sirve desde el cache sigue siendo la página del miss, no un shell vacío: la
  // entrada cacheada es la que van a ver el 95% de los que se equivoquen de dirección.
  expectStorefrontMiss(await cached.text(), 'respuesta cacheada de un slug que no es de nadie');
});

test('la dirección sin vidriera explica qué hacer, y lo explica sin depender de JavaScript', async ({
  request,
}) => {
  // El visitante de la vidriera está en la calle, con datos móviles y una mano. Si el HTML llega
  // vacío y la copy sólo aparece después de ejecutar el bundle, lo que ve es una pantalla en
  // blanco — y ahí no hay nada que le diga "pedile al vendedor que te reenvíe el link completo",
  // que es la única acción que puede recuperar esa visita.
  const cached = await fetchUntilCached(request, storefrontUrl(uniqueSlug('copy')));

  expect(
    firstH1(await cached.text()),
    'la página llegó sin contenido renderizado: la copy sólo existe en el payload de Flight',
  ).toBe(STOREFRONT_404_H1);
});

test('el tenant lo decide el host, no un header que puede mandar cualquiera', async ({ request }) => {
  // `CLAUDE.md` §2 y el ADR del proxy: los headers de tenant vienen del proxy, nunca del cliente.
  // Cualquiera puede pegarle a la vidriera con `curl -H 'x-tenant-id: ...'`. Dos mitades:
  //
  //  a) no se puede **cambiar** el tenant de un host válido. Esta mitad sigue siendo válida aun
  //     con la respuesta cacheada: el proxy corre ANTES del cache, en el 100% de las requests, y
  //     si leyera el header reescribiría a `/s/{otro}` — que es otra entrada de cache y otro
  //     contenido. La colisión no se puede esconder detrás de un HIT.
  //  b) no se puede **invocar** una vidriera desde un host que no es de nadie. Esta mitad va sobre
  //     un slug nuevo, así que es camino frío de punta a punta.
  const spoofed = await request.get(storefrontUrl(NORTE.slug), {
    maxRedirects: 0,
    headers: { 'x-tenant-id': SUR.slug, 'x-tenant-slug': SUR.slug },
  });
  const html = await spoofed.text();
  expect(html, 'la vidriera del host legítimo dejó de servirse: el test no mediría nada').toContain(
    NORTE.name,
  );
  expect(html, 'un header del cliente cambió el tenant que se sirve').not.toContain(SUR.name);

  const summoned = await request.get(storefrontUrl(uniqueSlug('spoof')), {
    maxRedirects: 0,
    headers: { 'x-tenant-slug': NORTE.slug, 'x-tenant-id': NORTE.slug },
  });
  await expectMissWithout(summoned, NORTE.name, 'host inexistente con header de tenant ajeno');
});

test('un slug inexistente NO redirige a la home de marketing', async ({ request }) => {
  // Un redirect le dice a Google que ese subdominio existe, y al visitante que se equivocó de
  // producto — cuando lo que pasó es que se equivocó de dirección.
  const response = await getRaw(request, storefrontUrl(uniqueSlug('nored')));
  const status = response.status();
  expect(status >= 300 && status < 400, `respondió ${String(status)}: es un redirect, no la página`).toBe(
    false,
  );
  expect(response.headers()['location'], 'la dirección sin vidriera no lleva Location').toBeUndefined();
  // Y no es la home de marketing servida bajo el subdominio, que es el otro final infeliz.
  expect(firstH1(await response.text()), 'el subdominio inexistente sirvió marketing').not.toBe(
    MARKETING_H1,
  );
});

test('un negocio suspendido no tiene vidriera: no se publica stock que nadie va a atender', async ({
  request,
}) => {
  // Tres afirmaciones, y la tercera es la que hace que las otras dos signifiquen algo.
  const cold = await getRaw(request, storefrontUrl(SUSPENDIDO.slug));
  await expectMissWithout(cold, SUSPENDIDO.name, 'primera visita a un negocio suspendido');

  const cached = await fetchUntilCached(request, storefrontUrl(SUSPENDIDO.slug));
  await expectMissWithout(cached, SUSPENDIDO.name, 'respuesta cacheada de un negocio suspendido');

  // CONTROL POSITIVO. Sin esto, "el suspendido no muestra su nombre" da verde también cuando la
  // vidriera está caída para todos, que es el escenario en el que este test tiene que gritar.
  const activo = await getRaw(request, storefrontUrl(NORTE.slug));
  expect(
    await activo.text(),
    'control: el tenant activo tampoco se publica — no es que el suspendido esté filtrado, ' +
      'es que la vidriera entera está rota',
  ).toContain(NORTE.name);
});

test('un subdominio reservado no es la vidriera de nadie: `www` sirve marketing', async ({ request }) => {
  const response = await getRaw(request, `http://www.${E2E_APEX_HOST}:${String(E2E_PORT)}/`);
  expect(response.status()).toBe(200);
  // En positivo: `www` sirve **marketing**. Afirmar sólo "no es la vidriera" daba verde con una
  // página en blanco, con un error de Next o con el panel servido en el subdominio equivocado.
  expect(firstH1(await response.text()), 'www no está sirviendo la home de marketing').toBe(MARKETING_H1);
});

test('un host anidado no puede ser un tenant y ni siquiera invoca la app', async ({ request }) => {
  // `a.b.maat.work`: el wildcard de Vercel es de UN nivel. La DB tiene el mismo `CHECK` de slug,
  // así que no existe el futuro en el que ese host sea de alguien. El proxy lo corta sin invocar
  // la app — y por eso la respuesta es texto plano, no el HTML de la vidriera.
  const response = await getRaw(request, `http://a.b.${E2E_APEX_HOST}:${String(E2E_PORT)}/`);
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
});

test('el apex no publica la vidriera bajo /s/{slug}: una sola URL canónica por negocio', async ({
  request,
}) => {
  // Servir el mismo contenido en `maat.work/s/acme` y en `acme.maat.work` es contenido duplicado
  // para Google y una segunda entrada de cache por tenant, gratis y sin motivo. Acá el 404 SÍ es
  // afirmable: lo corta el proxy antes de invocar la app, así que no le aplica ADR-011.
  const response = await getRaw(request, `${APEX_URL}/s/${NORTE.slug}`);
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(NORTE.name);
});
