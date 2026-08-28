/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `@istock/media/incidents` NO arrastra `sharp`. Medido, no declarado.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué se afirma y por qué importa
 * `apps/web` enchufa el canal de incidentes en `instrumentation.ts`, o sea en el bootstrap del
 * server, **antes de la primera request y en toda instancia** — también en las que nunca van a
 * servir una foto. Mientras el único entrypoint fue el barrel, llegar a `setMediaIncidentReporter`
 * costaba `./upload → ./pipeline → sharp`: el binario nativo de libvips y las ~180 unidades de
 * `zod`. Este archivo afirma que el subpath no paga nada de eso.
 *
 * ## Por qué son DOS mediciones y no una
 * Ninguna de las dos alcanza sola, y fallan por motivos distintos:
 *
 * - **El grafo estático** (`walk`) lee el fuente y sigue sólo los imports que **sobreviven a la
 *   compilación**: `import type` / `export type` se borran, así que no cuentan. Es exhaustivo —ve
 *   ramas que una corrida puntual no ejecuta— pero es una lectura del código, no del proceso.
 * - **La sonda de runtime** (`scripts/subpath-probe/child.mjs`) levanta un proceso nuevo, importa
 *   el especificador **público** `@istock/media/incidents` y mide el **efecto**: qué bibliotecas
 *   nativas quedaron mapeadas y qué especificadores resolvió el loader. Ejerce el campo `exports`
 *   del `package.json` de verdad, cosa que el grafo estático no puede hacer.
 *
 * ## Los controles no son decoración (ADR-020)
 * Un medidor de arrastre que se rompe deja de encontrar `sharp` y **pasa**. Es el modo de falla de
 * toda esta clase de gate: verde por ceguera. Por eso cada medición viene con su control positivo
 * sobre el **barrel**, que sí arrastra `sharp`: si el control no lo ve, el gate se declara ciego y
 * falla, aunque el subpath esté impecable.
 *
 * ## Un hallazgo que corrige la premisa
 * `@aws-sdk/client-s3` **ya estaba diferido antes de esta slice**: `storage/r2.ts` lo carga con
 * `await import()` dentro de cada método, así que el barrel nunca lo trajo al bootstrap. Lo que el
 * barrel sí trae, y este subpath elimina, es `sharp` (nativo) y `zod`. El test lo deja escrito
 * como aserción para que la afirmación quede atada a la medición y no al recuerdo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SRC, '..');

const ENTRY_FILE = 'incidents-entry.ts';
const BARREL_FILE = 'index.ts';
const SUBPATH = '@istock/media/incidents';
const BARREL = '@istock/media';

// ── grafo estático ────────────────────────────────────────────────────────────────────────────

/** Saca comentarios para no leer como `import` lo que un docblock sólo menciona. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

interface Graph {
  /** Archivos de `src/` alcanzables en runtime, relativos a `src/`. */
  readonly files: ReadonlySet<string>;
  /** Paquetes que entran con un `import` estático (se pagan al importar el entrypoint). */
  readonly staticBare: ReadonlySet<string>;
  /** Paquetes que entran con `await import()` (se pagan recién al usar la función). */
  readonly dynamicBare: ReadonlySet<string>;
}

/**
 * `import ... from 'x'` y `export ... from 'x'`. El clausulado nunca contiene `;`, así que
 * `[^;]*?` no puede saltar de una sentencia a la siguiente. `import type` / `export type` se
 * descartan: `verbatimModuleSyntax` los borra del JS emitido y no cuestan nada en runtime.
 */
const FROM_RE = /(?:^|[;}\n])\s*(import|export)\s+([^;]*?)\sfrom\s*(['"])([^'"]+)\3/gu;
/** `import 'x'` sin binding: es un side-effect import y sí carga el módulo. */
const SIDE_EFFECT_RE = /(?:^|[;}\n])\s*import\s*(['"])([^'"]+)\1/gu;
const DYNAMIC_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu;
const REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu;

function resolveRelative(fromFile: string, spec: string): string {
  const base = join(dirname(join(SRC, fromFile)), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return relative(SRC, candidate);
  }
  throw new Error(`no se pudo resolver "${spec}" desde "${fromFile}"`);
}

/** Recorre el grafo de imports **de runtime** desde un archivo de `src/`. */
function walk(entry: string): Graph {
  const files = new Set<string>();
  const staticBare = new Set<string>();
  const dynamicBare = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || files.has(current)) continue;
    files.add(current);

    const code = stripComments(readFileSync(join(SRC, current), 'utf8'));

    const visit = (spec: string, kind: 'static' | 'dynamic'): void => {
      if (spec.startsWith('.')) {
        pending.push(resolveRelative(current, spec));
        return;
      }
      if (spec.startsWith('node:')) return;
      (kind === 'static' ? staticBare : dynamicBare).add(spec);
    };

    for (const m of code.matchAll(FROM_RE)) {
      if ((m[2] ?? '').trimStart().startsWith('type')) continue;
      visit(m[4] ?? '', 'static');
    }
    for (const m of code.matchAll(SIDE_EFFECT_RE)) visit(m[2] ?? '', 'static');
    for (const m of code.matchAll(DYNAMIC_RE)) visit(m[2] ?? '', 'dynamic');
    for (const m of code.matchAll(REQUIRE_RE)) visit(m[2] ?? '', 'dynamic');
  }

  return { files, staticBare, dynamicBare };
}

// ── sonda de runtime ──────────────────────────────────────────────────────────────────────────

interface ProbeResult {
  readonly target: string;
  readonly elapsedMs: number;
  readonly resolvedCount: number;
  readonly bare: readonly string[];
  readonly nativeImaging: readonly string[];
  readonly nativeObjectCount: number;
}

/**
 * Corre la sonda en un proceso **nuevo**: en el proceso de vitest `sharp` ya podría estar cargado
 * por otro test y toda medición daría cero. `cwd` en la raíz del paquete para que el
 * `import(SUBPATH)` de adentro se resuelva por self-reference contra nuestro `exports`.
 */
function probe(target: string): ProbeResult {
  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', join(PKG_ROOT, 'scripts', 'subpath-probe', 'child.mjs')],
    {
      cwd: PKG_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PROBE_TARGET: target },
      timeout: 60_000,
    },
  );
  const line = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as ProbeResult;
}

// ── el contrato del subpath ───────────────────────────────────────────────────────────────────

describe('el subpath está declarado y apunta al archivo que se mide', () => {
  it('`exports["./incidents"]` existe y resuelve al entrypoint liviano', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports['./incidents']).toBe(`./src/${ENTRY_FILE}`);
    expect(pkg.exports['.']).toBe(`./src/${BARREL_FILE}`);
  });
});

describe('grafo estático: qué sobrevive a la compilación', () => {
  it('el entrypoint del subpath alcanza tres archivos de `src/` y CERO paquetes', () => {
    const graph = walk(ENTRY_FILE);

    expect([...graph.files].sort()).toEqual(['incidents-entry.ts', 'incidents.ts', 'types.ts']);
    expect([...graph.staticBare]).toEqual([]);
    // También cero dinámicos: un `await import('sharp')` escondido acá seguiría siendo `sharp`
    // adentro del proceso, sólo que más tarde y más difícil de ver.
    expect([...graph.dynamicBare]).toEqual([]);
  });

  it('CONTROL — el mismo recorrido sobre el barrel SÍ ve `sharp` (si no, el medidor está ciego)', () => {
    const graph = walk(BARREL_FILE);

    expect(graph.staticBare, 'el recorrido no encontró `sharp` desde el barrel').toContain('sharp');
    expect(graph.staticBare).toContain('zod');
    // El SDK de S3 ya estaba diferido antes de esta slice: entra por `await import()` en
    // `storage/r2.ts`, nunca por un import estático. Se afirma para que se note si eso cambia.
    expect(graph.dynamicBare).toContain('@aws-sdk/client-s3');
    expect(graph.staticBare).not.toContain('@aws-sdk/client-s3');
    expect(graph.files.size).toBeGreaterThan(8);
  });

  it('CONTROL — el recorrido distingue `import type` de un import de valor', () => {
    // `incidents.ts` importa `Variant` con `import type`: si el walker contara los tipos, este
    // archivo suelto arrastraría `./types` igual, y el test de arriba pasaría por el motivo
    // equivocado. Acá se comprueba sobre `unlink.ts`, que importa `./storage` SÓLO como tipo.
    const graph = walk('unlink.ts');
    expect([...graph.files].sort()).toEqual(['errors.ts', 'keys.ts', 'unlink.ts']);
    expect([...graph.staticBare]).toEqual(['zod']);
  });
});

describe('sonda de runtime: qué carga de verdad el proceso', () => {
  it(`importar ${SUBPATH} no mapea el binario de sharp`, () => {
    const light = probe(SUBPATH);

    expect(light.nativeImaging, 'el subpath cargó libvips').toEqual([]);
    expect(light.bare.filter((s) => /^(?:sharp|zod|@img\/|@aws-sdk\/)/u.test(s))).toEqual([]);
    expect(light.resolvedCount).toBeLessThan(10);

    console.info(
      `MEDIDO media subpath · target=${light.target} · modulos=${String(light.resolvedCount)} ` +
        `· nativos=${String(light.nativeObjectCount)} · ms=${String(light.elapsedMs)}`,
    );
  });

  it(`CONTROL — importar ${BARREL} SÍ mapea el binario de sharp, y por eso el subpath existe`, () => {
    const heavy = probe(BARREL);

    expect(
      heavy.nativeImaging.length,
      'el barrel no cargó libvips: la sonda no está midiendo nada',
    ).toBeGreaterThan(0);
    expect(heavy.bare).toContain('sharp');
    expect(heavy.resolvedCount).toBeGreaterThan(100);

    console.info(
      `MEDIDO media barrel · target=${heavy.target} · modulos=${String(heavy.resolvedCount)} ` +
        `· nativos=${String(heavy.nativeObjectCount)} · ms=${String(heavy.elapsedMs)}`,
    );
  });
});
