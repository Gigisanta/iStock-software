/**
 * S8 · el canje público llega al inbox y el dueño lo convierte en una unidad borrador.
 * Owner: `qa-agent`.
 *
 * Esta cobertura faltaba en la matriz: había tests de Zod, RLS y del motor aislado, pero ningún
 * browser recorría `vidriera /canje → POST → /app/canjes → aceptar`. Ese hueco podía dejar roto el
 * proxy del host, el redirect 303, la consulta del inbox o la Server Action sin que ningún test
 * cruzara el límite público/autenticado.
 *
 * Se usan dos contextos de browser. El visitante no hereda la sesión del dueño y JavaScript queda
 * apagado en el formulario público: el POST nativo es el contrato de producción de la vidriera.
 * No se edita la implementación si algo falla; el rojo es evidencia del defecto bajo prueba.
 */

import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  listingsByTenant,
  tenantIdBySlug,
} from './_lib/db';
import { APEX_URL, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { catalogOptions, PHOTOS_URL_RE, signIn, createBusiness } from './_lib/panel';

const slug = uniqueSlug('canje');
const email = uniqueEmail('canje');
const businessName = 'Vidriera QA Canje';
const visitorName = 'Cliente Canje QA';
const visitorPhone = '299 415 3388';
const visitorModel = 'iPhone 12 128';

test('el visitante deja un canje y el dueño lo acepta como unidad borrador del mismo negocio', async ({
  browser,
}) => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);

  const ownerContext = await browser.newContext();
  const publicContext = await browser.newContext({ javaScriptEnabled: false });
  const owner = await ownerContext.newPage();
  const publicPage = await publicContext.newPage();

  try {
    // Alta real del negocio: la bandera es la que habilita el formulario público.
    await signIn(owner, email);
    await createBusiness(owner, {
      name: businessName,
      slug,
      acceptsTradeIn: true,
    });

    const tenantId = await tenantIdBySlug(slug);
    expect(tenantId, `el alta no creó el tenant ${slug}`).not.toBeNull();

    // Visitante anónimo en el host de la vidriera, sin compartir la sesión del panel.
    await publicPage.goto(storefrontUrl(slug, '/canje'), { waitUntil: 'load' });
    const form = publicPage.locator('form[data-storefront="tradein-form"]');
    await expect(form, 'el host público no mostró el formulario de canje').toBeVisible();
    const customerName = publicPage.locator('form[data-storefront="tradein-form"] input[name="customer_name"]');
    await expect(customerName, 'el primer campo del formulario no quedó visible').toBeVisible();
    await customerName.fill(visitorName);
    await publicPage.locator('input[name="customer_wa_phone"]').fill(visitorPhone);
    await publicPage.locator('input[name="model_text"]').fill(visitorModel);
    await publicPage.locator('input[name="storage_gb"]').fill('128');
    await publicPage.locator('input[name="battery_pct"]').fill('87');
    await publicPage.locator('input[name="color"]').fill('Azul');
    await publicPage.locator('select[name="declared_condition"]').selectOption('used_excellent');
    await publicPage.locator('textarea[name="notes"]').fill('Tiene funda y caja');
    await publicPage.getByRole('button', { name: 'Enviar el canje' }).click();

    await publicPage.waitForURL(/\/canje\/listo\/?$/u, { timeout: 30_000 });
    await expect(publicPage.getByRole('heading', { name: 'Listo, tu canje llegó' })).toBeVisible();

    // El owner ve el lead en el inbox y entra a su ficha, no a una fila sembrada por SQL.
    await owner.goto(`${APEX_URL}/app/canjes`, { waitUntil: 'load' });
    const leadLink = owner.getByRole('link', { name: new RegExp(visitorModel, 'u') }).first();
    await expect(leadLink, 'el canje enviado no apareció en el inbox del dueño').toBeVisible();
    await expect(leadLink).toContainText(visitorName);
    await leadLink.click();
    await owner.waitForURL(/\/app\/canjes\/[0-9a-f-]{36}\/?$/u, { timeout: 30_000 });

    const acceptForm = owner.getByTestId('form-aceptar-canje');
    await expect(acceptForm, 'la ficha del canje no mostró el formulario del dueño').toBeVisible();
    await owner.locator('select[name="condition"]').selectOption('used_excellent');
    const models = await catalogOptions(owner);
    const model = models.find((candidate) => candidate.label === 'iPhone 12') ?? models[0];
    if (model === undefined) throw new Error('el catálogo global no tiene un modelo seleccionable');
    await owner.locator('select[name="catalogModelId"]').selectOption(model.value);
    const storage = owner.locator('select[name="storageGb"]');
    const color = owner.locator('select[name="color"]');
    await expect(storage.locator('option').nth(1)).toBeAttached();
    await expect(color.locator('option').nth(1)).toBeAttached();
    await storage.selectOption({ index: 1 });
    await color.selectOption({ index: 1 });
    const generatedTitle = owner.locator('input[name="title"]');
    await expect(generatedTitle).toHaveValue(/iPhone 12/u);
    const canonicalTitle = await generatedTitle.inputValue();
    await owner.locator('input[name="offerUsd"]').fill('300');
    await owner.locator('input[name="priceUsd"]').fill('500');
    await owner.getByRole('button', { name: 'Aceptar y cargar al stock' }).click();

    await owner.waitForURL(PHOTOS_URL_RE, { timeout: 30_000 });
    const listingId = PHOTOS_URL_RE.exec(owner.url())?.[1];
    if (listingId === undefined) throw new Error(`la redirección no trae listing id: ${owner.url()}`);
    await expect(owner.getByTestId('fotos-de-la-unidad')).toBeVisible();

    // Control de vida y vínculo en la base real: no alcanza con que una action redirija a una URL.
    const listing = await listingById(listingId);
    expect(listing, 'aceptar el canje no creó la unidad').not.toBeNull();
    expect(listing?.tenantId, 'la unidad creada no pertenece al tenant del canje').toBe(tenantId);
    expect(listing?.title, 'la unidad no conservó el modelo y la variante confirmados').toBe(
      canonicalTitle,
    );
    expect(listing?.status, 'un canje aceptado debe entrar como borrador sin fotos').toBe('draft');
    expect(
      (await listingsByTenant(tenantId ?? '')).filter((row) => row.id === listingId),
      'la unidad aceptada no quedó en el stock del tenant',
    ).toHaveLength(1);
  } finally {
    await publicContext.close();
    await ownerContext.close();
    await deleteTenantBySlug(slug);
    await deleteUserByEmail(email);
  }
});
