import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { APEX_URL, E2E_PORT } from './_lib/env';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Media en los e2e (S2): driver local en disco + base pública apuntando al server bajo prueba.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `NEXT_PUBLIC_MEDIA_BASE_URL` **tiene que estar acá y no en el default del paquete**. El default
 * de `packages/media/src/env.ts` es `http://localhost:3000/_media`, o sea otro puerto y otro host
 * que el que levanta este config: el `<img src>` de la miniatura apuntaría a un server que no
 * existe y el gate de bytes fallaría por un motivo que no tiene nada que ver con el pipeline.
 *
 * Es `NEXT_PUBLIC_*`, así que se **inlinea en el build**: por eso va en el `env` del `webServer`,
 * que es el que corre el `next build`, y no en el entorno del test.
 *
 * `MEDIA_LOCAL_ROOT` absoluto, y no el default `<cwd>/.media-local`, porque el `cwd` del `next
 * start` es un detalle de cómo pnpm invoca el binario. Con la raíz fijada, el objeto que escribe
 * el upload y el que lee `/_media/[...key]` son el mismo por construcción y no por casualidad.
 * `.media-local/` ya está en el `.gitignore` de la raíz.
 */
const MEDIA_LOCAL_ROOT = resolve(HERE, '.media-local');

/**
 * Playwright de iStock. Owner: `qa-agent`.
 *
 * ## Contra qué corre (y por qué no contra `next dev`)
 * Contra `next build` + `next start`. **No es negociable para esta slice**: la mitad de lo que
 * S1 tiene que probar —el miss cacheado (ADR-011: 200 con `noindex`, no 404), `x-nextjs-cache:
 * HIT`, la invalidación por tag al dar de alta un tenant— **no existe en `next dev`**, que no
 * cachea nada. Un e2e de la vidriera contra el server de desarrollo es un e2e que da verde el día
 * que producción se rompe.
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
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `--reporter` en la CLI **reemplaza** a los reporters del config, incluido el censo.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * No los agrega: los pisa. O sea que `playwright test --reporter=line` corre la suite **sin el
 * guard de completitud**, y una suite amputada vuelve a poder salir en verde — que es exactamente
 * HIGH-3. Me pasó a mí misma midiendo esta slice: la corrida salió sin la línea `censo de specs` y
 * no lo noté hasta releer el log.
 *
 * Playwright no permite "reporter obligatorio", así que el config —que sí se evalúa siempre— lo
 * convierte en un error ruidoso. Se escapa con `E2E_ALLOW_PARTIAL=1`, la misma perilla que apaga
 * el censo, para que apagar el guard sea **una** decisión visible y no dos por accidente.
 *
 * `--list` no ejecuta nada a propósito y no lleva censo, así que no se bloquea.
 */
function assertCensusReporterSurvives(): void {
  const argv = process.argv;
  const overrides = argv.some((arg) => arg === '--reporter' || arg.startsWith('--reporter='));
  if (!overrides) return;
  if (argv.includes('--list') || process.env['E2E_ALLOW_PARTIAL'] === '1') return;
  throw new Error(
    '--reporter en la CLI pisa los reporters del config y apaga el censo de specs (HIGH-3): la ' +
      'suite podría cortarse a la mitad y salir en verde. Corré `pnpm --filter @istock/e2e e2e` ' +
      'sin --reporter, o E2E_ALLOW_PARTIAL=1 si de verdad querés correr sin el guard.',
  );
}

assertCensusReporterSurvives();

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env['CI'] !== undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // `list` para leer la corrida + el censo de specs (HIGH-3). El censo compara los archivos y los
  // tests **ejecutados** contra los que existen en disco y hace fallar la corrida si falta alguno:
  // un test que no corre tiene que ser tan ruidoso como un test que falla. Ver el archivo.
  reporter: [['list'], ['./_lib/spec-census-reporter.ts']],

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
      MEDIA_LOCAL_ROOT,
      NEXT_PUBLIC_MEDIA_BASE_URL: `${APEX_URL}/_media`,
      BILLING_DRIVER: 'mock',
      NEXT_PUBLIC_ROOT_DOMAIN: APEX_URL.replace('http://', ''),
      NEXT_PUBLIC_APP_URL: APEX_URL,
    },
  },
});
