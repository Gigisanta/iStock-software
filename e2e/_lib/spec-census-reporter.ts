/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  CENSO DE SPECS — un test que no corre tiene que ser tan ruidoso como un test que falla.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué existe
 * HIGH-3 no fue "un test falló": fue **una suite que reportó verde sobre tests que nunca se
 * ejecutaron**. El pool de Postgres se cerraba en el `afterAll` del primer spec alfabético y los
 * demás morían antes de la primera aserción. Playwright termina en 0 y la salida no dice, en
 * ningún lado, "faltan tres archivos".
 *
 * Eso es exactamente el modo de falla contra el que existe el *phantom-file guard* de
 * `CLAUDE.md` §0, aplicado a tests: **un artefacto que no está es una tarea que no pasó.**
 *
 ## Qué afirma
 * Dos censos, porque el bug tiene dos formas y sólo una se ve de lejos:
 *
 * 1. **Por archivo.** `*.spec.ts` ejecutados == `*.spec.ts` en disco. Se distinguen dos causas,
 *    porque llevan a arreglos distintos:
 *      - *descubierto pero no ejecutado* → el worker se cayó o la suite se cortó a la mitad;
 *      - *ni siquiera descubierto* → no matchea `testMatch`, está fuera de `testDir`, o se corrió
 *        con un filtro de archivos.
 * 2. **Por test.** Ningún test puede quedar sin resultado. Ésta es la forma exacta que tomó
 *    HIGH-3, medida: cuando el `beforeAll` de un archivo revienta porque otro archivo le cerró el
 *    pool, Playwright falla **el primer** test del archivo y marca los demás como `did not run`
 *    — una línea con un guioncito en medio de la salida. Las aserciones de aislamiento entre
 *    tenants no se evaluaron nunca y el resumen dice "1 failed", no "el aislamiento no se probó".
 *
 * En los dos casos la corrida termina en `failed`, aunque cada test que llegó a correr haya
 * pasado.
 *
 * ## Relación con `scripts/accept-s1.sh` A6
 * A6 hace el mismo conteo **desde afuera**, contando los specs nombrados en la salida de
 * Playwright contra `ls e2e/*.spec.ts`. No se duplica por gusto: A6 sólo lo ve quien corra el
 * gate de aceptación, y el fallo tiene que verlo también el que corre `pnpm e2e` en su máquina un
 * martes a las tres de la tarde. Adentro (esto) y afuera (A6) miden lo mismo por dos caminos
 * distintos; que uno de los dos sea redundante es el punto.
 *
 * ## La única salida
 * `E2E_ALLOW_PARTIAL=1` apaga el gate. Es para correr **un** spec a mano mientras se lo escribe
 * (`playwright test x.spec.ts`), y no está puesto en ningún script: una corrida de CI o de
 * aceptación que lo necesite es una corrida que está escondiendo algo.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const SPEC_RE = /\.spec\.ts$/u;
const IGNORED_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', '.git']);

function specFilesOnDisk(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SPEC_RE.test(entry)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * `playwright test --list` **enumera** los tests y no corre ninguno, a propósito. Censar una
 * corrida que por definición no ejecuta nada da un rojo que no significa nada, y un guard que
 * grita cuando no pasa nada es un guard que se apaga. Se detecta por `argv` porque `FullConfig` no
 * expone el modo listado.
 */
function isListOnly(): boolean {
  return process.argv.includes('--list');
}

/**
 * Un test "rindió cuentas" si dejó al menos un resultado (pasó, falló o se salteó en runtime) o si
 * está declarado como skip. Lo que **no** cuenta es `results.length === 0` sin skip declarado:
 * ése es el test que nadie corrió y del que nadie se enteró.
 */
function accountedFor(test: TestCase): boolean {
  return test.results.length > 0 || test.expectedStatus === 'skipped';
}

export default class SpecCensusReporter implements Reporter {
  private root = process.cwd();
  private suite: Suite | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.root = config.rootDir;
    this.suite = suite;
  }

  // `async` por la firma de `Reporter`: devolver el objeto sin promesa no typechequea.
  // eslint-disable-next-line @typescript-eslint/require-await
  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    if (isListOnly()) return undefined;

    const onDisk = specFilesOnDisk(this.root);
    const tests = this.suite?.allTests() ?? [];

    const discovered = new Set(tests.map((test) => test.location.file));
    const executed = new Set(tests.filter(accountedFor).map((test) => test.location.file));

    const missing = onDisk.filter((file) => !executed.has(file));
    const neverRan = tests.filter((test) => !accountedFor(test));
    const rel = (file: string): string => relative(this.root, file);

    process.stdout.write(
      `\ncenso de specs: ${String(executed.size)}/${String(onDisk.length)} archivos ejecutados ` +
        `(${String(discovered.size)} descubiertos) · ` +
        `${String(tests.length - neverRan.length)}/${String(tests.length)} tests ejecutados\n`,
    );

    if (missing.length === 0 && neverRan.length === 0) return undefined;

    if (process.env['E2E_ALLOW_PARTIAL'] === '1') {
      process.stdout.write(
        `  E2E_ALLOW_PARTIAL=1 · censo desactivado. Archivos sin ejecutar: ` +
          `${missing.length === 0 ? '(ninguno)' : missing.map(rel).join(', ')} · ` +
          `tests sin ejecutar: ${String(neverRan.length)}\n`,
      );
      return undefined;
    }

    process.stdout.write('\n  ✖ CENSO DE SPECS: quedó código de test sin ejecutar.\n');

    if (missing.length > 0) {
      process.stdout.write('    Archivos:\n');
      for (const file of missing) {
        const why = discovered.has(file)
          ? 'descubierto pero NO ejecutado (worker caído o suite cortada a la mitad)'
          : 'ni siquiera descubierto (testMatch/testDir, o se corrió con un filtro de archivos)';
        process.stdout.write(`      - ${rel(file)}: ${why}\n`);
      }
    }

    if (neverRan.length > 0) {
      process.stdout.write(
        '    Tests sin resultado (típicamente: el `beforeAll` del archivo reventó y el resto\n' +
          '    quedó en "did not run" — la regla de negocio no se evaluó nunca):\n',
      );
      for (const test of neverRan) {
        process.stdout.write(`      - ${rel(test.location.file)}:${String(test.location.line)} › ${test.title}\n`);
      }
    }

    process.stdout.write(
      '    Si es a propósito (estás corriendo un solo spec a mano), E2E_ALLOW_PARTIAL=1.\n\n',
    );

    return { status: result.status === 'passed' ? 'failed' : result.status };
  }
}
