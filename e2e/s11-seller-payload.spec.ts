/**
 * S11 · roles owner/seller. La pantalla del vendedor tiene que ser útil sin convertirse en una
 * forma alternativa de entregar costo, IMEI o notas internas.
 *
 * Las pruebas unitarias de `listUnits()` ya fijan la allowlist del objeto. Este spec cruza el
 * límite que faltaba: identidad local creada por el formulario de ingreso, membresía resuelta en
 * el server y respuesta HTML/RSC observada desde Playwright. Un test que sólo mira la pantalla no
 * alcanza: un campo oculto igual viaja en el payload.
 */

import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  purgeE2eFixtures,
  seedMembership,
  seedPublicUnit,
  seedTenant,
  tenantIdBySlug,
  userIdByEmail,
} from './_lib/db';
import { APEX_URL, FIXTURE_PREFIX, uniqueEmail, uniqueSlug } from './_lib/env';
import { signIn, STOCK_PATH } from './_lib/panel';

const tenant = {
  slug: uniqueSlug('seller'),
  name: 'S11 Vendedor QA',
};
const email = uniqueEmail('seller');
const unitTitle = 'iPhone 15 Pro 256 Titanio natural';
const sensitiveImei = '359999999999991';

test.beforeAll(async () => {
  await purgeE2eFixtures(FIXTURE_PREFIX);
  await seedTenant(tenant);
  const tenantId = await tenantIdBySlug(tenant.slug);
  if (tenantId === null) throw new Error(`no se creó el tenant ${tenant.slug}`);

  // El costo y el IMEI existen en la fixture para que la ausencia en la respuesta no sea un
  // chequeo vacuo. La lista del vendedor debe mostrar el equipo, no esos campos.
  await seedPublicUnit({
    tenantId,
    slug: uniqueSlug('equipo'),
    title: unitTitle,
    imei: sensitiveImei,
    costUsd: 410,
  });
});

test.afterAll(async () => {
  await deleteTenantBySlug(tenant.slug);
  await deleteUserByEmail(email);
});

test('seller ve su stock operativo, pero no recibe datos internos en el payload ni rutas de owner', async ({
  page,
}) => {
  await signIn(page, email);

  const tenantId = await tenantIdBySlug(tenant.slug);
  if (tenantId === null) throw new Error(`desapareció el tenant ${tenant.slug}`);
  const userId = await userIdByEmail(email);
  if (userId === null) throw new Error(`el login no creó la identidad ${email}`);
  await seedMembership(tenantId, userId, 'seller');

  const response = await page.goto(`${APEX_URL}${STOCK_PATH}`);
  expect(response?.status(), 'el seller autenticado no pudo abrir su lista de stock').toBe(200);
  if (response === null) throw new Error('la navegación a stock no devolvió una respuesta HTTP');

  const payload = await response.text();
  await expect(page.getByRole('heading', { name: 'Stock', exact: true })).toBeVisible();
  await expect(page.getByText(unitTitle, { exact: true })).toBeVisible();

  for (const forbidden of [
    'costUsdCents',
    'cost_usd',
    'marginUsd',
    'margin_usd',
    'internalNotes',
    'internal_notes',
    sensitiveImei,
  ]) {
    expect(payload, `el payload del seller contiene ${forbidden}`).not.toContain(forbidden);
  }

  const billingResponse = await page.goto(`${APEX_URL}/billing`);
  // Con Cache Components el shell del `Suspense` se transmite como 200 antes de que termine la
  // sesión. La frontera `forbidden()` reemplaza el contenido y es la señal de autorización que ve
  // la persona; las Server Actions sensibles sí conservan 403 porque no tienen shell que emitir.
  expect(billingResponse?.status(), 'la ruta de owner no respondió para el seller').toBe(200);
  await expect(
    page.getByRole('heading', { name: 'No tenés permiso para ver esta pantalla', exact: true }),
  ).toBeVisible();
});
