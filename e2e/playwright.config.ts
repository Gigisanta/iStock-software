import { defineConfig, devices } from '@playwright/test';
import { APEX_URL, E2E_PORT } from './_lib/env';

/**
 * Playwright de iStock. Owner: `qa-agent`.
 *
 * ## Contra qué corre (y por qué no contra `next dev`)
 * Contra `next build` + `next start`. **No es negociable para esta slice**: la mitad de lo que
 * S1 tiene que probar —el 404 cacheado, `x-nextjs-cache: HIT`, la invalidación por tag al dar de
 * alta un tenant— **no existe en `next dev`**, que no cachea nada. Un e2e de la vidriera contra
 * el server de desarrollo es un e2e que da verde el día que producción se rompe.
 *
 * ## `NODE_ENV=test` en el `start`, a propósito
 * El driver de auth local (sin B2) **se niega a arrancar con `NODE_ENV=production`**
 * (`assertLocalDriverAllowed`, y está bien que lo haga: firma cookies con un secreto de
 * desarrollo y no verifica el mail). El build se hace en modo producción —que es lo que decide el
 * bundle y el modo de servido de cada ruta— y el server se levanta con `NODE_ENV=test`, que es lo
 * único que el assert deja pasar. Cuando llegue B2 esto se cambia por credenciales de Supabase de
 * test y el `NODE_ENV` vuelve a `production`.
 *
 * ## Un solo worker
 * Los tests comparten una base Postgres real y el **cache de ISR del server**, que es estado
 * global por definición. Paralelizarlos es inventar flakes.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env['CI'] !== undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],

  use: {
    baseURL: APEX_URL,
    trace: 'retain-on-failure',
    // Mobile-first no es un adorno del producto (`CLAUDE.md` §0.11): el visitante de la vidriera
    // está parado en la calle con una mano. Se prueba en un viewport de celular.
    ...devices['Pixel 7'],
  },

  projects: [{ name: 'mobile-chromium' }],

  webServer: {
    command:
      'pnpm --filter @istock/web exec next build && ' +
      `NODE_ENV=test pnpm --filter @istock/web exec next start -p ${String(E2E_PORT)}`,
    cwd: '..',
    url: `http://127.0.0.1:${String(E2E_PORT)}/api/health`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev',
      AUTH_DRIVER: 'local',
      AUTH_LOCAL_SECRET: process.env['AUTH_LOCAL_SECRET'] ?? 'e2e-local-secret-32-chars-minimum',
      MEDIA_DRIVER: 'local',
      BILLING_DRIVER: 'mock',
      NEXT_PUBLIC_ROOT_DOMAIN: APEX_URL.replace('http://', ''),
      NEXT_PUBLIC_APP_URL: APEX_URL,
    },
  },
});
