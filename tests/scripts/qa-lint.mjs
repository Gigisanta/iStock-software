#!/usr/bin/env node
/**
 * Linter de los tests de `qa-agent` (`tests/**`, `e2e/**`).
 *
 * No reemplaza a ESLint: chequea las reglas que hacen que un test **mienta**, que son las que un
 * linter genérico no ve porque el archivo compila y "pasa".
 *
 *   1. Afirmaciones trivialmente ciertas (`expect(true).toBe(true)`): un test que pasa con la
 *      implementación vacía es un test que reporta salud que no existe.
 *   2. `.only` / `.skip`: `.only` esconde el resto de la suite; `.skip` es una regla que dejó de
 *      chequearse sin que nadie lo decida. Si algo no se puede probar, se borra o se reporta.
 *   3. Snapshots: un snapshot gigante convierte cualquier cambio en "actualizá el snapshot" y no
 *      dice qué regla de negocio se rompió.
 *   4. `waitForTimeout` / `sleep`: esperar por reloj es cómo se fabrica un test intermitente. Se
 *      espera por una condición.
 *   5. Nombres de test cortos: el nombre tiene que decir **la regla de negocio**, no el nombre de
 *      la función. Menos de 24 caracteres no alcanza para decir una regla.
 *
 * Uso: `node qa-lint.mjs <dir>`
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const IGNORED = new Set(['node_modules', 'test-results', 'playwright-report', '.git', 'dist']);

/** @type {{file: string, line: number, rule: string, message: string}[]} */
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(test|spec)\.ts$/u.test(entry) || /\.ts$/u.test(entry)) check(full);
  }
}

const RULES = [
  {
    id: 'trivial-assertion',
    re: /expect\(\s*(true|false|1|'[^']*')\s*\)\s*\.\s*(toBe|toEqual)\(\s*\1\s*\)/u,
    message: 'afirmación trivialmente cierta: pasa con la implementación vacía',
  },
  { id: 'only', re: /\b(test|it|describe)\s*\.\s*only\b/u, message: '`.only` deja el resto de la suite sin correr' },
  {
    id: 'skip',
    re: /\b(test|it|describe)\s*\.\s*skip\b/u,
    message: '`.skip` es una regla que dejó de chequearse: se borra o se reporta, no se saltea',
  },
  { id: 'snapshot', re: /toMatch(Inline)?Snapshot\(/u, message: 'snapshot: no dice qué regla de negocio se rompió' },
  {
    id: 'sleep',
    re: /waitForTimeout\(|setTimeout\(\s*resolve/u,
    message: 'espera por reloj: se espera por una condición, no por milisegundos',
  },
];

function check(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/u, '');
    for (const rule of RULES) {
      if (rule.re.test(code)) {
        problems.push({ file, line: index + 1, rule: rule.id, message: rule.message });
      }
    }
    const named = /^\s*(?:test|it)\(\s*(['"`])([^'"`]+)\1/u.exec(code);
    if (named !== null && (named[2] ?? '').trim().length < 24) {
      problems.push({
        file,
        line: index + 1,
        rule: 'nombre-flaco',
        message: `"${named[2]}": el nombre tiene que decir la regla de negocio, no la función`,
      });
    }
  });
}

walk(root);

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`${relative(root, problem.file)}:${problem.line}  [${problem.rule}] ${problem.message}`);
  }
  console.error(`\nqa-lint: ${problems.length} problema(s).`);
  process.exit(1);
}

console.log('qa-lint: ok');
