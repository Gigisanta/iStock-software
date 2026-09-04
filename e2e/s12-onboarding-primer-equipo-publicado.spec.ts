/**
 * S12 · onboarding cobrable: una persona nueva llega a su primera vidriera.
 *
 * El objetivo de esta prueba no es repetir cada detalle de S2: es afirmar que el recorrido que
 * vende la landing no tiene un salto invisible entre sus partes. La persona crea la cuenta con la
 * acción `sign_up`, arma su negocio, carga un equipo desde el catálogo, completa las tres fotos,
 * publica y abre el link público. Si alguna etapa exige una operación de base manual, S12 no pasa.
 */

import type { Browser, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  listingSlugById,
  purgeE2eFixtures,
  tenantIdBySlug,
} from './_lib/db';
import {
  APEX_URL,
  FIXTURE_PREFIX,
  uniqueEmail,
  uniqueSlug,
} from './_lib/env';
import { ownersPhotoUpload } from './_lib/photo';
import { createBusiness, createUnitWithPhotos, publishUnit, signUp } from './_lib/panel';

test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('onboard');
const email = uniqueEmail('onboard');
const businessName = 'S12 Onboarding Cel';
const updatedBusinessName = 'S12 Onboarding Cel actualizado';
const expectedTitle = 'iPhone 14 Pro 256 Morado oscuro';
const imei = `35${String(Date.now()).slice(-13)}`;

let page: Page;
let browserInstance: Browser;
let listingId = '';
let storefrontHref = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await purgeE2eFixtures(FIXTURE_PREFIX);

  browserInstance = browser;
  page = await browser.newPage();
  await signUp(page, email);
  await createBusiness(page, { name: businessName, slug });
});

test.afterAll(async () => {
  await page.close();
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('la cuenta nueva llega al panel sin perder el alta del negocio', async () => {
  await expect(page).toHaveURL(/\/app(\/)?$/u);
  const pageHost = new URL(page.url()).host;
  const storefront = page
    .getByRole('link', { name: new RegExp(`^${slug}\\.(?:localhost|127\\.0\\.0\\.1\\.nip\\.io):\\d+$`, 'u') })
    .last();
  await expect(storefront).toBeVisible();
  const href = await storefront.getAttribute('href');
  expect(href, 'el panel no entregó una URL absoluta para la vidriera').not.toBeNull();
  if (href === null) throw new Error('el panel no entregó una URL absoluta para la vidriera');
  storefrontHref = href;
  const storefrontHost = new URL(href).host;
  expect(storefrontHost, 'la URL de la vidriera no quedó en el host local de la request').toMatch(
    /^(?:[^.]+\.localhost|[^.]+\.127\.0\.0\.1\.nip\.io):\d+$/u,
  );
  expect(new URL(href).protocol).toBe('http:');
  expect(new URL(page.url()).protocol).toBe('http:');
  expect(pageHost).toMatch(/^(?:127\.0\.0\.1\.nip\.io|localhost):\d+$/u);

  const tenantId = await tenantIdBySlug(slug);
  expect(tenantId, `el alta no creó el tenant ${slug}`).not.toBeNull();
});

test('el enlace de Base abre una confirmación clara de suscripción', async () => {
  const response = await page.goto(`${APEX_URL}/billing/suscribirse?plan=base`);
  expect(response?.status(), 'el enlace público de suscripción Base no responde').toBe(200);
  await expect(page.getByRole('heading', { name: 'Confirmá tu plan', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Base', exact: true })).toBeVisible();
  await expect(page.getByText(/pagos están pausados/iu)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continuar a Mercado Pago', exact: true }),
  ).toBeDisabled();
});

test('el primer equipo se publica y aparece en la vidriera que se puede compartir', async () => {
  test.setTimeout(260_000);

  const photo = await ownersPhotoUpload();
  const created = await createUnitWithPhotos(
    page,
    {
      title: '',
      condition: 'used_excellent',
      storageGb: 256,
      color: 'Morado oscuro',
      priceUsd: 620,
      batteryPct: 89,
      imei,
      costUsd: 500,
      catalogModelHint: 'iPhone 14 Pro',
      photo,
    },
    [photo, photo],
  );
  listingId = created.listingId;

  await expect(
    page.getByRole('heading', { name: expectedTitle, exact: true }),
    'el selector no compuso el nombre canónico del primer equipo',
  ).toBeVisible();

  await publishUnit(page);

  const row = await listingById(listingId);
  expect(row?.status, 'el primer equipo no quedó disponible después de publicar').toBe('available');

  const listingSlug = await listingSlugById(listingId);
  expect(listingSlug, 'el primer equipo no tiene el slug público que necesita la vidriera').not.toBeNull();

  const storefrontPage = await browserInstance.newPage();
  try {
    const response = await storefrontPage.goto(storefrontHref);
    expect(response?.status(), 'la vidriera pública no responde después de publicar').toBe(200);
    await expect(
      storefrontPage.getByRole('heading', { name: businessName, exact: true }),
      'el link de la vidriera no resuelve al negocio recién creado',
    ).toBeVisible();
    await expect(
      storefrontPage.locator('[data-storefront="grid"] [data-listing]').filter({ hasText: expectedTitle }),
      'el equipo recién publicado no aparece en la grilla pública',
    ).toBeVisible();
    await expect(
      storefrontPage.locator(`[href="/p/${listingSlug}"]`),
      'la card pública no lleva a la ficha del equipo correcto',
    ).toBeVisible();
  } finally {
    await storefrontPage.close();
  }
});

test('el dueño puede editar la configuración y la vidriera recibe el cambio', async () => {
  await page.goto(`${APEX_URL}/app/ajustes`);
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();

  const form = page.locator('form.panel-settings-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Nombre del negocio', { exact: true }).fill(updatedBusinessName);
  await form.getByLabel('Duración inicial de una reserva', { exact: true }).selectOption('90');
  await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Guardado.');

  const storefrontPage = await browserInstance.newPage();
  try {
    const response = await storefrontPage.goto(storefrontHref);
    expect(response?.status(), 'la vidriera no responde después de editar el negocio').toBe(200);
    await expect(
      storefrontPage.getByRole('heading', { name: updatedBusinessName, exact: true }),
      'el cambio de configuración no invalidó la vidriera pública',
    ).toBeVisible();
  } finally {
    await storefrontPage.close();
  }
});

test('el dueño puede corregir el precio y la vidriera lo recibe sin esperar TTL', async () => {
  await page.goto(`${APEX_URL}/app/stock`);
  const row = page.locator(`li[data-testid="fila-unidad"][data-listing-id="${listingId}"]`);
  await expect(row).toBeVisible();
  await expect(
    row.getByTestId('reserva-minutos'),
    'la duración configurada en Ajustes no llegó al selector de reserva',
  ).toHaveValue('90');

  const editor = row.getByTestId('editar-precio');
  await editor.locator('summary').click();
  await editor.getByLabel('Precio publicado (USD)', { exact: true }).fill('625');
  await editor.getByRole('button', { name: 'Guardar precio', exact: true }).click();
  await expect(row).toContainText('USD 625');

  const storefrontPage = await browserInstance.newPage();
  try {
    const response = await storefrontPage.goto(storefrontHref);
    expect(response?.status(), 'la vidriera no responde después de editar el precio').toBe(200);
    await expect(
      storefrontPage.locator('[data-storefront="grid"] [data-listing]').filter({ hasText: 'USD 625' }),
      'el precio nuevo no llegó a la grilla pública sin esperar el TTL',
    ).toBeVisible();
  } finally {
    await storefrontPage.close();
  }
});
