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
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El censo por test decía una mentira medible (2026-08-27, gate de S2)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La versión anterior daba por ejecutado a todo test con `results.length > 0`:
 *
 * ```ts
 * return test.results.length > 0 || test.expectedStatus === 'skipped';
 * ```
 *
 * Un test que Playwright saltea por `mode: 'serial'` después de un fallo previo **tiene** un
 * resultado (uno con `status: 'skipped'` y cero aserciones evaluadas), así que entraba como
 * ejecutado. Medido en la misma corrida: Playwright imprimió `8 did not run` y esta línea imprimió
 * `63/63 tests ejecutados`, y el gate del LEAD leyó `PASS: ningun test quedo en 'did not run'`.
 *
 * No abría un agujero de verde-con-tests-faltantes —el salteo serial sólo ocurre con la corrida ya
 * roja— pero **una línea de guard que afirma algo falso es peor que no tenerla**: entrena a leerla
 * mal, y el día que sí importe nadie la va a mirar dos veces.
 *
 * ## Las tres cosas que ahora se cuentan por separado
 * | bucket | qué es | ¿rompe la corrida? |
 * |---|---|---|
 * | **ejecutados** | corrieron sus aserciones (pasaron, fallaron o resultaron flaky) | no por sí solo |
 * | **salteados por un fallo previo** | `did not run`: el `beforeAll` reventó, el modo serial los tapó, el worker se cayó, o la corrida se interrumpió | **sí** |
 * | **skip declarado** | alguien decidió no correrlos (declarado o en runtime) | no |
 *
 * La clasificación **no se inventa acá**: es la misma que usa Playwright para imprimir su propio
 * `N did not run` (`node_modules/playwright/lib/runner/index.js`, `generateSummary()`). Se copia a
 * propósito, para que el censo y el resumen no puedan contradecirse: si dos números que miran lo
 * mismo salen distintos en la misma salida, el que lee elige el que le conviene.
 *
 * El denominador de "ejecutados" **excluye los skip declarados**: la igualdad `N/N` tiene que
 * significar "todo lo que tenía que correr, corrió", y un skip a propósito no es una regla que se
 * dejó de evaluar por accidente — es una que alguien decidió no evaluar, y se lo cuenta aparte
 * para que la decisión se vea.
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
 * En qué bucket cae un test. Ver la tabla del encabezado.
 *
 * `did-not-run` es el único que rompe la corrida, y es el que la versión anterior confundía con
 * `ran`: **tener un resultado no es haber corrido**. Playwright le fabrica un `TestResult` con
 * `status: 'skipped'` al test que saltea por un fallo previo, así que `results.length > 0` da
 * `true` para un test que no evaluó una sola aserción.
 */
type Bucket = 'ran' | 'did-not-run' | 'declared-skip';

/**
 * Misma lógica que `generateSummary()` de `playwright/lib/runner/index.js`, que es la que decide
 * el `N did not run` del resumen. Se replica en vez de aproximarse: el censo tiene que contar lo
 * mismo que el reporter oficial o los dos números de la misma salida se contradicen.
 *
 * `interrupted` (Ctrl-C, `--max-failures`) cae en `did-not-run`: sus aserciones tampoco se
 * evaluaron. Se distingue en el detalle, no en el conteo, porque el arreglo es el mismo — volver a
 * correr entero.
 */
function bucketOf(test: TestCase): Bucket {
  if (test.outcome() !== 'skipped') return 'ran';
  if (test.results.some((result) => result.status === 'interrupted')) return 'did-not-run';
  if (test.results.length === 0 || test.expectedStatus !== 'skipped') return 'did-not-run';
  return 'declared-skip';
}

/** Por qué este test no corrió, dicho en el idioma del que va a tener que arreglarlo. */
function whyNotRun(test: TestCase): string {
  if (test.results.some((result) => result.status === 'interrupted')) {
    return 'la corrida se interrumpió (Ctrl-C o --max-failures)';
  }
  if (test.results.length === 0) {
    return 'nunca se le asignó un worker (el archivo se cortó antes, o la suite murió)';
  }
  return 'salteado por un fallo previo (`mode: serial` o `beforeAll` en rojo): cero aserciones evaluadas';
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

    const ran = tests.filter((test) => bucketOf(test) === 'ran');
    const neverRan = tests.filter((test) => bucketOf(test) === 'did-not-run');
    const declaredSkip = tests.filter((test) => bucketOf(test) === 'declared-skip');
    /** Todo lo que tenía que correr: los que corrieron más los que se quedaron sin correr. */
    const owed = ran.length + neverRan.length;

    const discovered = new Set(tests.map((test) => test.location.file));
    // Un archivo rinde cuentas si algo suyo corrió o si alguien decidió no correrlo. Un archivo
    // cuyos tests están TODOS en `did not run` no rinde cuentas: es el archivo que se cortó.
    const executed = new Set(
      [...ran, ...declaredSkip].map((test) => test.location.file),
    );

    const missing = onDisk.filter((file) => !executed.has(file));
    const rel = (file: string): string => relative(this.root, file);

    process.stdout.write(
      `\ncenso de specs: ${String(executed.size)}/${String(onDisk.length)} archivos ejecutados ` +
        `(${String(discovered.size)} descubiertos) · ` +
        `${String(ran.length)}/${String(owed)} tests ejecutados · ` +
        `${String(neverRan.length)} salteados por un fallo previo · ` +
        `${String(declaredSkip.length)} skip declarado\n`,
    );

    if (missing.length === 0 && neverRan.length === 0) return undefined;

    if (process.env['E2E_ALLOW_PARTIAL'] === '1') {
      process.stdout.write(
        `  E2E_ALLOW_PARTIAL=1 · censo desactivado. Archivos sin ejecutar: ` +
          `${missing.length === 0 ? '(ninguno)' : missing.map(rel).join(', ')} · ` +
          `tests salteados por un fallo previo: ${String(neverRan.length)}\n`,
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
        '    Tests que NO corrieron ("did not run" en el resumen de Playwright). Tienen un\n' +
          '    resultado con status "skipped", pero no evaluaron una sola aserción: la regla de\n' +
          '    negocio que cada uno afirma quedó sin probar en esta corrida.\n',
      );
      for (const test of neverRan) {
        process.stdout.write(
          `      - ${rel(test.location.file)}:${String(test.location.line)} › ${test.title}\n` +
            `        ${whyNotRun(test)}\n`,
        );
      }
    }

    if (declaredSkip.length > 0) {
      process.stdout.write(
        `    (${String(declaredSkip.length)} con skip declarado, que no rompen el censo: se los\n` +
          '    lista para que la decisión de no correrlos se vea.)\n',
      );
      for (const test of declaredSkip) {
        process.stdout.write(
          `      - ${rel(test.location.file)}:${String(test.location.line)} › ${test.title}\n`,
        );
      }
    }

    process.stdout.write(
      '    Si es a propósito (estás corriendo un solo spec a mano), E2E_ALLOW_PARTIAL=1.\n\n',
    );

    return { status: result.status === 'passed' ? 'failed' : result.status };
  }
}
