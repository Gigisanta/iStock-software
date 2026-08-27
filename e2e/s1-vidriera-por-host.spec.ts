/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S1 · host → vidriera. Gate del board: *"`{slug}.local` resuelve al tenant; slug inexistente →
 *  404 real"*. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Corre contra `next build` + `next start` (ver `playwright.config.ts`), porque las dos mitades
 * del gate viven en el modo de servido de la ruta y no en el código: el 404 tiene que ser un 404
 * de verdad (no un 200 con el HTML del 404 adentro, que es lo que Google indexa como página
 * buena) y tiene que quedar cacheado (o cada escaneo de subdominios es una query de Postgres).
 *
 * `qa-agent` no toca el código bajo test. Si algo de acá se pone rojo, se reporta.
 */

import { expect, test } from '@playwright/test';
import { closeDb, deleteTenantBySlug, purgeE2eFixtures, seedTenant } from './_lib/db';
import { APEX_URL, E2E_APEX_HOST, E2E_PORT, FIXTURE_PREFIX, storefrontUrl, uniqueSlug } from './_lib/env';
import { fetchUntilCached, getRaw } from './_lib/http';
import { STOREFRONT_404_H1 } from './_lib/copy';
import { firstH1 } from './_lib/html';

const NORTE = { slug: uniqueSlug('norte'), name: 'Norte Cel Cipolletti' };
const SUR = { slug: uniqueSlug('sur'), name: 'Sur Celulares Neuquen' };
const SUSPENDIDO = { slug: uniqueSlug('susp'), name: 'Tenant Suspendido QA' };

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
  await seedTenant(NORTE);
  await seedTenant(SUR);
  await seedTenant({ ...SUSPENDIDO, status: 'suspended' });
});

test.afterAll(async () => {
  for (const slug of [NORTE.slug, SUR.slug, SUSPENDIDO.slug]) await deleteTenantBySlug(slug);
  await closeDb();
});

test('el subdominio de un negocio activo abre SU vidriera', async ({ page }) => {
  const response = await page.goto(storefrontUrl(NORTE.slug));

  expect(response?.status(), 'la vidriera de un tenant activo responde 200').toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: NORTE.name })).toBeVisible();
  // El host que se muestra es el suyo, no el del deploy ni el de otro.
  await expect(page.getByText(`${NORTE.slug}.`, { exact: false }).first()).toBeVisible();
});

test('la vidriera de un negocio NUNCA se sirve bajo el host de otro', async ({ request }) => {
  // E13 de `TEST_MATRIX.md`. Es la falla que no se ve mirando la pantalla: el cache key de
  // `'use cache'` y el del ISR durable NO incluyen el host — sólo build ID + función +
  // argumentos. Si el slug no viajara como argumento, estos dos hosts compartirían entrada.
  const norte = await getRaw(request, storefrontUrl(NORTE.slug));
  const sur = await getRaw(request, storefrontUrl(SUR.slug));

  const norteHtml = await norte.text();
  const surHtml = await sur.text();

  expect(norteHtml).toContain(NORTE.name);
  expect(norteHtml, 'el HTML de un tenant contiene el nombre de otro: fuga entre tenants').not.toContain(SUR.name);
  expect(surHtml).toContain(SUR.name);
  expect(surHtml, 'el HTML de un tenant contiene el nombre de otro: fuga entre tenants').not.toContain(NORTE.name);
});

test('un slug que no existe da 404 en la PRIMERA visita, que es la que hace Google', async ({ request }) => {
  // El gate de S1 dice "404 real". Un 200 con el HTML del 404 adentro es un **soft 404**: Google
  // lo indexa como página válida y el subdominio inexistente entra al índice. Que la segunda
  // visita sí devuelva 404 no arregla la primera: el crawler pasa una vez.
  const slug = uniqueSlug('ghost');
  const first = await getRaw(request, storefrontUrl(slug));

  expect(
    first.status(),
    `primera visita a un slug inexistente: se esperaba 404 y respondió ${String(first.status())}`,
  ).toBe(404);
});

test('el 404 de un slug inexistente queda cacheado: un escaneo de subdominios no paga Postgres', async ({
  request,
}) => {
  const slug = uniqueSlug('scan');

  const cached = await fetchUntilCached(request, storefrontUrl(slug));

  expect(cached.status()).toBe(404);
  expect(
    cached.headers()['x-nextjs-cache'],
    'el 404 no está cacheado: cada bot que escanea subdominios abre una conexión a Postgres',
  ).toBe('HIT');
  expect(cached.headers()['cache-control']).toContain('s-maxage=');
});

test('el 404 de la vidriera explica qué hacer, y lo explica sin depender de JavaScript', async ({
  request,
}) => {
  // El visitante de la vidriera está en la calle, con datos móviles y una mano. Si el HTML del 404
  // llega vacío y la copy sólo aparece después de ejecutar el bundle, lo que ve es una pantalla en
  // blanco — y ahí no hay nada que le diga "pedile al vendedor que te reenvíe el link completo",
  // que es la única acción que puede recuperar esa visita.
  const cached = await fetchUntilCached(request, storefrontUrl(uniqueSlug('copy')));

  expect(
    firstH1(await cached.text()),
    'el 404 llegó sin contenido renderizado: la copy sólo existe en el payload de Flight',
  ).toBe(STOREFRONT_404_H1);
});

test('el tenant lo decide el host, no un header que puede mandar cualquiera', async ({ request }) => {
  // `CLAUDE.md` §2 y ADR del proxy: *"Tenant headers must come from the proxy, never from the
  // client"*. Cualquiera puede pegarle a la vidriera con `curl -H 'x-tenant-id: ...'`. Si un
  // header ajeno pudiera decidir qué tenant se sirve, el aislamiento entre resellers sería una
  // sugerencia. Dos mitades: no se puede **cambiar** el tenant de un host válido, y no se puede
  // **invocar** una vidriera desde un host que no es de nadie.
  const spoofed = await request.get(storefrontUrl(NORTE.slug), {
    maxRedirects: 0,
    headers: { 'x-tenant-id': SUR.slug, 'x-tenant-slug': SUR.slug },
  });
  const html = await spoofed.text();
  expect(html).toContain(NORTE.name);
  expect(html, 'un header del cliente cambió el tenant que se sirve').not.toContain(SUR.name);

  const summoned = await request.get(storefrontUrl(uniqueSlug('spoof')), {
    maxRedirects: 0,
    headers: { 'x-tenant-slug': NORTE.slug },
  });
  expect(await summoned.text(), 'un header del cliente invocó la vidriera de otro').not.toContain(NORTE.name);
});

test('un slug inexistente NO redirige a la home de marketing', async ({ request }) => {
  // Un redirect le dice a Google que ese subdominio existe, y al visitante que se equivocó de
  // producto — cuando lo que pasó es que se equivocó de dirección.
  const response = await getRaw(request, storefrontUrl(uniqueSlug('nored')));
  const status = response.status();
  expect(status >= 300 && status < 400, `respondió ${String(status)}: es un redirect, no un 404`).toBe(false);
  expect(response.headers()['location'], 'un 404 no lleva Location').toBeUndefined();
});

test('un negocio suspendido no tiene vidriera: no se publica stock que nadie va a atender', async ({
  request,
}) => {
  // Dos afirmaciones distintas a propósito. La primera es la que le importa al dueño suspendido:
  // su nombre y su stock **no** se publican, ni siquiera en la respuesta sin cachear. La segunda
  // usa la respuesta cacheada para no volver a fallar por el soft-404 de la primera visita, que
  // ya tiene su propio test acá arriba: un test por defecto.
  const cold = await getRaw(request, storefrontUrl(SUSPENDIDO.slug));
  expect(
    await cold.text(),
    'la vidriera de un negocio suspendido sigue mostrando su nombre',
  ).not.toContain(SUSPENDIDO.name);

  const cached = await fetchUntilCached(request, storefrontUrl(SUSPENDIDO.slug));
  expect(cached.status(), 'un negocio suspendido tiene que dar 404, no vidriera').toBe(404);
});

test('un subdominio reservado no es la vidriera de nadie: `www` sirve marketing', async ({ request }) => {
  const response = await getRaw(request, `http://www.${E2E_APEX_HOST}:${String(E2E_PORT)}/`);
  expect(response.status()).toBe(200);
  expect(
    firstH1(await response.text()),
    'www resolvió a la vidriera: alguien puede quedarse con la home de marketing',
  ).not.toBe(STOREFRONT_404_H1);
});

test('un host anidado no puede ser un tenant y ni siquiera invoca la app', async ({ request }) => {
  // `a.b.maat.work`: el wildcard de Vercel es de UN nivel. La DB tiene el mismo `CHECK` de slug,
  // así que no existe el futuro en el que ese host sea de alguien. El proxy lo corta sin invocar
  // la app — y por eso la respuesta es texto plano, no el HTML del 404 de la vidriera.
  const response = await getRaw(request, `http://a.b.${E2E_APEX_HOST}:${String(E2E_PORT)}/`);
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
});

test('el apex no publica la vidriera bajo /s/{slug}: una sola URL canónica por negocio', async ({
  request,
}) => {
  // Servir el mismo contenido en `maat.work/s/acme` y en `acme.maat.work` es contenido duplicado
  // para Google y una segunda entrada de cache por tenant, gratis y sin motivo.
  const response = await getRaw(request, `${APEX_URL}/s/${NORTE.slug}`);
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(NORTE.name);
});
