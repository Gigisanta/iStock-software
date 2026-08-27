/**
 * Los dos caminos del panel que un e2e necesita recorrer de verdad: entrar y crear el negocio.
 * Owner: `qa-agent`.
 *
 * Se navega el formulario **como lo navega una persona** (labels, inputs, botón) y no se llama a
 * la Server Action a mano: el alta tiene que disparar todo lo que dispara en producción —
 * incluida la invalidación de los cache tags del slug— o el test no prueba el alta, prueba un
 * `insert`.
 */

import { expect, type Page } from '@playwright/test';
import { APEX_URL } from './env';

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${APEX_URL}/ingresar`);
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole('button', { name: /entrar/iu }).click();
  // El driver local (sin B2) crea el usuario y redirige al panel. Si la sesión no quedó, la
  // siguiente navegación a `/app/*` vuelve a `/ingresar` y el test muere sin decir por qué.
  await page.waitForURL(/\/app(\/|$)/u, { timeout: 20_000 });
}

export interface NewBusiness {
  readonly name: string;
  readonly slug: string;
  readonly waPhone?: string;
  readonly acceptsTradeIn?: boolean;
}

export async function createBusiness(page: Page, business: NewBusiness): Promise<void> {
  await page.goto(`${APEX_URL}/app/crear-negocio`);

  await page.locator('input[name="name"]').fill(business.name);
  // El campo del link es controlado y se autocompleta desde el nombre: escribirlo marca
  // `slugTouched` y gana lo que tipeó la persona, que es exactamente lo que hace un dueño que
  // no quiere el link sugerido.
  await page.locator('input[name="slug"]').fill(business.slug);
  await page.locator('input[name="waPhone"]').fill(business.waPhone ?? '299 555 1234');
  if (business.acceptsTradeIn === true) {
    await page.locator('input[name="acceptsTradeIn"]').check();
  }

  // La disponibilidad se consulta con debounce; el botón queda deshabilitado si el slug está
  // tomado. Esperar a que se habilite es esperar a que el panel esté de acuerdo con el test.
  const submit = page.getByRole('button', { name: /crear mi negocio/iu });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();

  // `createTenantAction` redirige a `/app` sólo si el alta salió bien.
  await page.waitForURL(/\/app(\/)?$/u, { timeout: 30_000 });
}
