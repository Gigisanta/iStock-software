/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El `test` de esta suite. **Ningún spec importa `test` de `@playwright/test`.** Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué arregla (HIGH-3)
 * El pool de Postgres se abría a nivel de módulo y **cada spec lo cerraba** en su `test.afterAll`.
 * Con `workers: 1` los specs comparten proceso: el primero en orden alfabético cerraba el pool y
 * se llevaba puestos a todos los que venían atrás. Los specs de aislamiento entre tenants —los
 * que prueban que el reseller A no lee el stock de B— nunca llegaban a ejecutarse, y la salida de
 * Playwright no lo decía en ningún lado.
 *
 * El ciclo de vida de un recurso compartido por toda la suite **no puede ser de un spec**. Acá el
 * dueño es el worker:
 *
 * - `scope: 'worker'` → se resuelve una vez por proceso de worker, no una vez por archivo.
 * - `auto: true` → **no hace falta que ningún test lo pida**. Un fixture que hay que acordarse de
 *   pedir es el mismo bug con otra cara: el spec que se olvide deja el socket abierto.
 * - El `await use()` de adentro no da nada útil a propósito (`void`): esto no es un servicio que
 *   los tests consumen, es un ciclo de vida que los tests no tienen que administrar.
 *
 * Con esto, `closeDb()` ocurre **una** vez, después del último test del worker, y el orden de los
 * archivos deja de ser una variable del resultado.
 *
 * ## Por qué no `globalTeardown`
 * `globalSetup`/`globalTeardown` corren en **otro proceso**. El pool que abren los tests vive en
 * el proceso del worker: cerrarlo desde ahí sería cerrar un pool distinto y vacío, y el socket de
 * verdad quedaría abierto igual. La forma correcta en Playwright para un recurso por proceso es
 * un fixture de worker.
 */

import { test as base } from '@playwright/test';
import { closeDb } from './db';

interface WorkerFixtures {
  /** No se consume: existe por su teardown. Ver el docblock. */
  readonly dbLifecycle: void;
}

export const test = base.extend<Record<never, never>, WorkerFixtures>({
  dbLifecycle: [
    // eslint-disable-next-line no-empty-pattern -- la firma de Playwright exige el destructuring.
    async ({}, use) => {
      await use();
      // Único `closeDb()` de toda la suite. Si aparece otro en un spec, volvió el bug.
      await closeDb();
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect } from '@playwright/test';
