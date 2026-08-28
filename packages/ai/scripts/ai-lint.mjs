#!/usr/bin/env node
/**
 * gate-owner: LEAD
 *
 * Este archivo es un **gate**, no codigo del paquete: `CLAUDE.md` §4 y **ADR-022** — el gate no
 * puede ser del mismo writer que el codigo que audita. Vive en este directorio por resolucion de
 * paths y porque `pnpm -r lint` lo encuentra ahi, no por pertenencia. Un lint que crece de la mano
 * del codigo que mira es un lint que nunca lo va a contradecir.
 *
 * El owner del paquete **pide, no edita** — igual que con los techos del WAF. La marca de arriba
 * la censa `scripts/guard-gates.sh` (G3), que enumera los `package.json` en vez de confiar en el
 * nombre del archivo: la version anterior de la regla decia `*-lint.mjs` y por ese sufijo se le
 * escapaba `purity-check.mjs`, que es exactamente este mismo agujero un nivel mas arriba.
 *
 * `ai-lint` — las reglas de este paquete que ningún linter genérico puede tener.
 *
 * No reemplaza a `tsc` ni a los tests: chequea las cosas que **no fallan en runtime** y que por eso
 * se cuelan. Un ID de modelo hardcodeado compila perfecto, pasa los tests y se descubre en la
 * factura o el día que el proveedor deprecia el modelo. Eso es exactamente lo que busca acá.
 *
 * Cada regla dice qué prohíbe y POR QUÉ, porque una regla sin motivo se termina desactivando.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Blanquea comentarios conservando posiciones (cada carácter borrado se reemplaza por un espacio,
 * los saltos de línea quedan). Así una regla puede mirar SÓLO el código sin perder el número de
 * línea del hallazgo.
 *
 * Hace falta de verdad, no es prolijidad: el docblock de `provider.ts` explica que el puerto **no**
 * expone `reasoning_effort`, y una regla que mira el texto crudo trata esa explicación como la
 * infracción que la explicación previene. Un gate que castiga documentar la regla enseña a no
 * documentarla.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/gu, (line, prefix) => prefix + ' '.repeat(line.length - prefix.length));
}

const files = walk(SRC).map((path) => {
  const text = readFileSync(path, 'utf8');
  return { path, rel: relative(ROOT, path), text, code: stripComments(text) };
});

const isTest = (rel) => rel.endsWith('.test.ts') || rel.endsWith('.eval.ts');
const findings = [];

function report(rule, rel, line, message) {
  findings.push({ rule, rel, line, message });
}

/** Número de línea de un índice de caracteres. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * `where` decide si la regla mira el código sin comentarios (`'code'`, el default) o el archivo
 * entero (`'text'`). Mirar el texto entero es la excepción y se usa sólo donde nombrar la cosa ya
 * es el problema: un modelo frontier o un `NEXT_PUBLIC_`.
 */
function scan(rule, predicate, pattern, message, where = 'code') {
  for (const file of files) {
    if (!predicate(file)) continue;
    const haystack = where === 'text' ? file.text : file.code;
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = re.exec(haystack)) !== null) {
      report(rule, file.rel, lineOf(haystack, match.index), `${message} → ${JSON.stringify(match[0].slice(0, 60))}`);
    }
  }
}

// ── A001 · IDs de modelo ────────────────────────────────────────────────────────────────────────
// Van por env (`CLAUDE.md` §3: hubo dos deprecaciones en tres meses). `env.ts` los valida y
// `pricing.ts` los tarifa; en cualquier otro lado un literal es una decisión de modelo tomada en
// código, que es la que no se puede tomar.
const MODEL_ID = /(?<![\w./-])(?:gemini|gpt-oss|llama|mixtral|qwen|deepseek|grok)[-/][\w.]+/iu;
scan(
  'A001',
  (file) => !isTest(file.rel) && !/src\/(env|pricing)\.ts$/u.test(file.rel),
  MODEL_ID,
  'ID de modelo escrito en el código: va por LLM_PRIMARY_MODEL / LLM_FALLBACK_MODEL',
);

// ── A002 · familias prohibidas en el hot path ───────────────────────────────────────────────────
// Un frontier por mensaje de vidriera es fallo de la tarea, y `llama-3.1-8b-instant` está retirado
// desde el 16/08/2026. Acá se busca el literal en CUALQUIER archivo, tests incluidos: un test que
// lo nombra es un test que lo va a usar.
scan(
  'A002',
  (file) => !/src\/env\.ts$/u.test(file.rel),
  /claude-[a-z0-9.]+|gpt-[45][\w.-]*|(?<![\w-])o[1-4]-(?:mini|preview|pro)|llama-3\.1-8b-instant/iu,
  'familia de modelo prohibida en el hot path (CLAUDE.md §3)',
  'text',
);

// ── A003 · datos que no cruzan al contexto ni a la salida ───────────────────────────────────────
// `redaction.ts` es el único que puede nombrarlos: es el archivo que los detecta. En los tests y
// en el corpus de evals también, porque ahí se escriben los ataques. En cualquier otro archivo,
// nombrar el campo es el primer paso para leerlo.
scan(
  'A003',
  (file) => !isTest(file.rel) && !/src\/redaction\.ts$/u.test(file.rel),
  /\b(?:imei|cost_usd|costUsd|internal_notes|internalNotes|supplier)\b/u,
  'campo prohibido en `packages/ai`: no entra al contexto ni sale en la respuesta',
);

// ── A004 · nada de `console` ────────────────────────────────────────────────────────────────────
// `CLAUDE.md` §2: loguear un listing entero es rechazo. El runner de evals escribe por
// `process.stdout` a propósito, que es una decisión visible y no un log olvidado.
scan('A004', (file) => !isTest(file.rel), /\bconsole\.(log|debug|info|warn|error)\b/u, 'console en código de producción');

// ── A005 · nada cruza al browser ────────────────────────────────────────────────────────────────
// Este paquete es server-only: prompts, tools y keys. Un `NEXT_PUBLIC_` acá es un secreto en el
// bundle esperando a que alguien importe el módulo desde un componente cliente.
scan(
  'A005',
  () => true,
  /NEXT_PUBLIC_/u,
  'este paquete es server-only y nada suyo puede cruzar al browser',
  'text',
);

// ── A006 · sin red en `src` ─────────────────────────────────────────────────────────────────────
// El proveedor es un puerto (`provider.ts`) y el adapter real vive detrás de él. Una llamada de red
// suelta en `src` rompe los evals offline, que son el único gate que tenemos con B4 abierto.
scan(
  'A006',
  (file) => !isTest(file.rel),
  /\bfetch\s*\(|\bXMLHttpRequest\b|from\s+['"]node:(?:http|https|net)['"]|\baxios\b|\bundici\b/u,
  'llamada de red en src: el I/O va detrás del puerto `LlmProvider`',
);

// ── A007 · la dieta es constitucional ───────────────────────────────────────────────────────────
// Los techos se bajan por env, nunca se suben, y viven en un solo lugar. Si alguien los edita, el
// gate lo dice acá y no seis meses después en la factura.
const budget = files.find((file) => file.rel === 'src/budget.ts');
if (budget === undefined) {
  report('A007', 'src/budget.ts', 0, 'falta el archivo de la dieta');
} else {
  const expected = [
    ['MAX_INPUT_TOKENS', '1200'],
    ['MAX_OUTPUT_TOKENS', '180'],
    ['TEMPERATURE', '0.2'],
    ['CACHE_TTL_MS', '60_000'],
    ['MAX_HISTORY_TURNS', '4'],
    ['MAX_CATALOG_CHUNKS', '3'],
    ['MAX_SEARCH_RESULTS', '5'],
  ];
  for (const [name, value] of expected) {
    const re = new RegExp(`export const ${name} = ${value.replace('.', '\\.')};`, 'u');
    if (!re.test(budget.text)) {
      report('A007', 'src/budget.ts', 0, `la dieta cambió: se esperaba \`${name} = ${value}\` (CLAUDE.md §Dieta)`);
    }
  }
}

// ── A008 · sin thinking, sin reasoning ──────────────────────────────────────────────────────────
// La dieta es cero thinking. El sucesor del primario lo trae encendido y no apagable, y el
// reemplazo del fallback factura reasoning tokens como output (R3): si algún día aparece una
// perilla acá, el costo medido de la eval deja de significar lo que dice que significa.
scan(
  'A008',
  (file) => !isTest(file.rel),
  /\breasoning_effort\b|\bthinkingBudget\b|\bthinking_config\b|\bincludeThoughts\b/u,
  'perilla de thinking/reasoning: la dieta es cero thinking y el adapter la fija en su mínimo',
);

// ── A009 · un test por módulo ───────────────────────────────────────────────────────────────────
// Regla de la casa: un test por export público. El gate no puede verificar "por export", pero sí
// que ningún módulo nazca sin su test al lado, que es como empieza siempre.
const EXEMPT = new Set(['src/index.ts']);
for (const file of files) {
  if (isTest(file.rel) || EXEMPT.has(file.rel) || file.rel.startsWith('src/fixtures/')) continue;
  if (file.rel.startsWith('src/evals/')) continue; // los cubre `src/evals/evals.test.ts`
  const sibling = file.rel.replace(/\.ts$/u, '.test.ts');
  if (!files.some((candidate) => candidate.rel === sibling)) {
    report('A009', file.rel, 0, `módulo sin test hermano: falta ${sibling}`);
  }
}

// ── salida ──────────────────────────────────────────────────────────────────────────────────────
if (findings.length > 0) {
  for (const finding of findings) {
    process.stdout.write(`${finding.rule}  ${finding.rel}:${finding.line}  ${finding.message}\n`);
  }
  process.stdout.write(`\nai-lint: ${findings.length} hallazgo(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`ai-lint: ${files.length} archivos, 9 reglas, sin hallazgos.\n`);
}
