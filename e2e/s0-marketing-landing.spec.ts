import { expect, test } from './_lib/fixtures';
import { APEX_URL } from './_lib/env';
import { MARKETING_H1 } from './_lib/copy';

test('la landing explica el recorrido y mantiene sus tabs usables', async ({ page }) => {
  const response = await page.goto(`${APEX_URL}/`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: MARKETING_H1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Probar gratis' })).toHaveAttribute('href', '/ingresar');
  await expect(page.getByRole('link', { name: 'Ver precios' })).toHaveAttribute('href', '/precios');
  await expect(page.getByRole('img', { name: 'Tres equipos publicados en una vidriera online' })).toHaveAttribute(
    'fetchpriority',
    'high',
  );

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'showcase-panel-stock');
  await expect(page.getByTestId('showcase-model-select')).toHaveValue('iphone-14-pro');
  await page.getByTestId('showcase-model-select').selectOption('iphone-15');
  await expect(page.getByRole('combobox').nth(1)).toHaveValue('128 GB');
  await expect(page.getByRole('combobox').nth(2)).toHaveValue('Negro');
  await expect(page.locator('output.showcase-configurator-result')).toContainText(
    'iPhone 15 128 GB Negro',
  );

  await tabs.nth(0).press('ArrowRight');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'showcase-panel-storefront');
  await expect(page.getByRole('tab', { name: /Vidriera/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('img', { name: 'Vista real de una grilla de equipos publicados' })).toBeVisible();

  await page.getByRole('tab', { name: /Vidriera/ }).press('ArrowRight');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'showcase-panel-whatsapp');

  await page.getByRole('tab', { name: /WhatsApp/ }).press('ArrowLeft');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'showcase-panel-storefront');
});

test('el titular principal conserva dos líneas en desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto(`${APEX_URL}/`);

  expect(response?.status()).toBe(200);
  const h1 = page.getByRole('heading', { level: 1, name: MARKETING_H1 });
  await expect(h1).toBeVisible();

  const metrics = await h1.evaluate((element) => {
    const lineHeight = Number.parseFloat(
      element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? '0',
    );
    return {
      height: element.getBoundingClientRect().height,
      lineHeight,
    };
  });

  expect(metrics.lineHeight).toBeGreaterThan(0);
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2.05);
});

test('los planes llevan a iniciar sesión con el plan elegido', async ({ page }) => {
  const response = await page.goto(`${APEX_URL}/precios`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Precios' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Elegir Base' })).toHaveAttribute(
    'href',
    '/ingresar?plan=base',
  );
  await expect(page.getByRole('link', { name: 'Elegir Negocio' })).toHaveAttribute(
    'href',
    '/ingresar?plan=negocio',
  );
});

test('el enlace directo de suscripción lleva a ingresar y conserva el plan', async ({ page }) => {
  const response = await page.goto(`${APEX_URL}/billing/suscribirse?plan=base`);

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/ingresar\?plan=base$/u);
  await expect(page.getByRole('heading', { name: 'Entrá a tu panel', exact: true })).toBeVisible();
  await expect(page.getByText(/Elegiste el plan Base/iu)).toBeVisible();
});

test('la landing conserva contraste y tabs usables en esquema oscuro', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const response = await page.goto(`${APEX_URL}/`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: MARKETING_H1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Probar gratis' })).toBeVisible();

  await page.getByRole('tab', { name: /WhatsApp/ }).click();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'showcase-panel-whatsapp');

  const backgroundColor = await page.locator('body').evaluate((element) =>
    element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? '',
  );
  expect(backgroundColor).toBe('rgb(10, 10, 10)');
});
