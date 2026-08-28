/**
 * Hook de resolución de módulos ESM. Corre en el **hilo de loaders** de Node, así que no comparte
 * memoria con el proceso: la comunicación es un archivo, escrito con `appendFileSync` (síncrono, y
 * por lo tanto ya completo cuando el `await import()` del proceso principal resuelve).
 *
 * Registra **cada especificador que Node resolvió**, que es la única forma de ver el grafo real —
 * el que incluye lo que arrastra una dependencia transitiva, no el que uno cree que escribió.
 */

import { appendFileSync } from 'node:fs';

let outFile = null;

export async function initialize(data) {
  outFile = data?.out ?? null;
}

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (outFile !== null) appendFileSync(outFile, `${specifier}\n`);
  return resolved;
}
