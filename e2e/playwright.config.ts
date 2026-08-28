import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { APEX_URL, E2E_PORT } from './_lib/env';
import { startPgSpy } from './_lib/pg-spy';

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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El `DATABASE_URL` del server bajo prueba pasa por el contador de queries.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §3 promete que **el 95% de los hits de la vidriera no tocan Postgres**. Esa promesa
 * se verifica contando sentencias, y para contarlas hay que estar en el medio del cable: el
 * `next start` se conecta a un proxy TCP transparente que reenvía todo sin tocarlo y lleva la
 * cuenta al pasar. Ver `_lib/pg-spy.ts` — ahí está el motivo por el que el contador vive acá y no
 * adentro de `apps/web` (`qa-agent` no edita el código que audita) y por qué no se mide con un
 * timing.
 *
 * Se arranca a nivel de módulo, no en `globalSetup`, por orden de ejecución: Playwright levanta el
 * `webServer` **antes** del global setup, así que un espía que naciera ahí llegaría tarde y el
 * server ya estaría hablando con Postgres directo. El módulo se evalúa siempre y antes que todo.
 *
 * Si el espía no puede escuchar, `startPgSpy()` devuelve igual la URL con el proxy y el server no
 * conecta: la suite se cae con un error de conexión ruidoso. Es la falla correcta. La alternativa
 * —caer de vuelta a la URL real en silencio— haría que el contador diga 0 para siempre y que M5
 * pase reportando "no toca Postgres" cuando la verdad es "no vi nada".
 */
const SPIED_DATABASE_URL = startPgSpy();

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
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     *  `false`, SIEMPRE. No es cuestión de higiene: bajo reuso, `MEDIDO s3 db-hits` es vacuo.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     *
     * `SPIED_DATABASE_URL` —la URL del proxy TCP que cuenta sentencias— le llega al server bajo
     * prueba **por este `env` y por ningún otro lado**. Si Playwright engancha un `next start` que
     * ya estaba escuchando, ese server se conectó a Postgres **directo**: el espía queda fuera del
     * cable, la cuenta es la de nadie, y el spec de la ficha puede publicar `primera=0 ·
     * cacheada=0` como si fuera el éxito que promete `CLAUDE.md` §3. Es el mismo agujero que M2 ya
     * tapa con `transferSize=0`: **ausencia de medición no es un número chico, es ausencia** —
     * sólo que acá venía disfrazada de configuración cómoda.
     *
     * Lo mismo pasa con `NEXT_PUBLIC_MEDIA_BASE_URL`, que se inlinea en el `next build` de este
     * `command`: con un server prestado las fotos apuntan al default `localhost:3000` y la suite
     * acusa a `packages/media` por un defecto del arnés. **Un arnés que puede acusar a la columna
     * equivocada es peor que uno lento.**
     *
     * Con `false`, un puerto ocupado hace fallar la corrida de entrada y fuerte, que es el
     * resultado correcto. El costo es un `next build` por corrida local, y está pago.
     *
     * Decidido por el LEAD el 2026-08-28, después de que un server viejo en el 3100 produjera dos
     * rojos fantasma. Si alguien la "optimiza" para ahorrarse el build, vuelve el bug silencioso.
     */
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: SPIED_DATABASE_URL,
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
