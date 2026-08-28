/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Sonda de arrastre: qué carga DE VERDAD un entrypoint de `@istock/media`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Se corre en un proceso **nuevo** (`node --import tsx child.mjs`) porque la pregunta es de cold
 * start: en el proceso del test `sharp` ya está cargado y cualquier medición daría cero.
 *
 * Vive **adentro** de `packages/media` a propósito: así `import('@istock/media/incidents')` se
 * resuelve por **self-reference** contra el campo `exports` del `package.json` del paquete. O sea:
 * la sonda ejerce el mismo mecanismo de resolución que va a usar `apps/web`, no un atajo por path
 * relativo que pasaría aunque el `exports` estuviera mal escrito.
 *
 * Mide dos cosas independientes, porque ninguna sola alcanza:
 *
 *  1. **`sharedObjects`** del reporte de diagnóstico de Node: las bibliotecas nativas efectivamente
 *     mapeadas en el proceso. `sharp` aparece acá como `sharp-<plat>.node` + `libvips-cpp.dylib`.
 *     Es un **efecto**, no un nombre: no se puede satisfacer renombrando nada.
 *  2. **Cada especificador resuelto** por el loader (`./hooks.mjs`). Cubre lo que no tiene binario
 *     nativo — `zod`, `@aws-sdk/client-s3` — y da el tamaño del grafo.
 *
 * Emite una sola línea de JSON por stdout. El que interpreta es `src/subpath-isolation.test.ts`.
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = process.env.PROBE_TARGET;
if (typeof target !== 'string' || target.length === 0) {
  process.stderr.write('PROBE_TARGET vacío\n');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'istock-media-probe-'));
const out = join(dir, 'resolved.txt');
appendFileSync(out, '');

register('./hooks.mjs', { parentURL: import.meta.url, data: { out } });

const nativeBefore = new Set(process.report.getReport().sharedObjects);

const t0 = performance.now();
await import(target);
const elapsedMs = performance.now() - t0;

const nativeAfter = process.report.getReport().sharedObjects.filter((s) => !nativeBefore.has(s));

const resolved = readFileSync(out, 'utf8').split('\n').filter(Boolean);
rmSync(dir, { recursive: true, force: true });

// Se descartan los especificadores relativos, los builtins y los `file://` que emite el loader de
// tsx: lo que interesa es qué **paquetes** entraron al proceso. El hook se registra recién después
// de que este archivo terminó de importar lo suyo, así que el andamio de la sonda no cuenta.
const bare = [
  ...new Set(
    resolved.filter(
      (s) => !s.startsWith('.') && !s.startsWith('node:') && !s.startsWith('file:'),
    ),
  ),
].sort();

// El total de objetos nativos NO sirve como aserción: en macOS cargar libvips arrastra medio
// AppKit y la lista depende del sistema. Lo que se afirma es la presencia del binario de `sharp`,
// que es un efecto del proceso y no un nombre que se pueda renombrar para esquivar el gate.
const nativeImaging = nativeAfter.filter((s) => /sharp|vips/iu.test(s));

process.stdout.write(
  `${JSON.stringify({
    target,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    resolvedCount: resolved.length,
    bare,
    nativeImaging,
    nativeObjectCount: nativeAfter.length,
  })}\n`,
);
