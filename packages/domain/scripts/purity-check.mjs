#!/usr/bin/env node
/**
 * Lint de pureza de `@istock/domain`.
 *
 * No es un linter de estilo: es el gate que hace cumplible la regla "TS puro, cero I/O".
 * Corre sin dependencias (Node stdlib) para que no haya excusa de "no estaba instalado".
 *
 * Falla con exit 1 si aparece:
 *  - import de `next`, `drizzle*`, `@supabase/*`, `@istock/db`, `node:*`, `fs`, `path`, `crypto`
 *  - `process.env`, `fetch(`, `Date.now(`, `new Date()` sin argumento, `Math.random(`, `require(`
 *  - `console.` (CLAUDE.md §2: nada de logs desde el dominio)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const RULES = [
  { name: 'import de framework/IO', re: /\bfrom\s+['"](next(\/.*)?|drizzle[^'"]*|@supabase\/[^'"]*|@istock\/db|node:[^'"]*|fs|path|crypto|http|https)['"]/g },
  { name: 'process.env', re: /\bprocess\s*\.\s*env\b/g },
  { name: 'fetch()', re: /(?<![\w.])fetch\s*\(/g },
  { name: 'Date.now()', re: /\bDate\s*\.\s*now\s*\(/g },
  { name: 'new Date() sin argumento (el tiempo se inyecta)', re: /\bnew\s+Date\s*\(\s*\)/g },
  { name: 'Math.random()', re: /\bMath\s*\.\s*random\s*\(/g },
  { name: 'require()', re: /(?<![\w.])require\s*\(/g },
  { name: 'console.*', re: /\bconsole\s*\.\s*\w+\s*\(/g },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const failures = [];
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    // Los comentarios documentan las prohibiciones: no se auditan a sí mismos.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) {
        failures.push(`${relative(ROOT, file)}:${index + 1}  ${rule.name}\n    ${trimmed}`);
      }
    }
  });
}

// ── Fase 2: "todo export público tiene test" ─────────────────────────────────────────────────
// Se toman los exports de VALOR de `src/index.ts` (los `type` no tienen runtime) y se exige que
// cada nombre aparezca en al menos un `*.test.ts`.
const indexSource = readFileSync(join(SRC, 'index.ts'), 'utf8');
const exportedValues = new Set();
for (const block of indexSource.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
  for (const raw of block[1].split(',')) {
    const name = raw.trim();
    if (name.length === 0 || name.startsWith('type ')) continue;
    exportedValues.add(name.split(/\s+as\s+/)[0].trim());
  }
}

const testSources = walk(SRC)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const untested = [...exportedValues].filter((name) => !new RegExp(`\\b${name}\\b`).test(testSources));
for (const name of untested) {
  failures.push(`src/index.ts  export público sin test: ${name}`);
}

if (failures.length > 0) {
  process.stdout.write(`domain guard FAIL (${failures.length}):\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `domain guard OK — TS puro y ${String(exportedValues.size)} exports de valor con test\n`,
);
