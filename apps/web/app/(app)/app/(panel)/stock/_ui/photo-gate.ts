/**
 * El estado del selector de foto, como **función pura del tamaño de los bytes**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto es un módulo aparte y no tres `useState` adentro del componente
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Porque la parte que puede fallar caro es una decisión, no un render, y una decisión se testea.
 * El bug que arregla este archivo: cuando `downscalePhoto()` devuelve `'failed'` —HEIC en
 * cualquier navegador que no sea Safari, o sea el teléfono del ICP, que vende iPhones— el
 * componente mostraba el aviso correcto y **dejaba mandar el archivo igual**. El body se pasaba de
 * `bodySizeLimit` y Next contestaba **413 en inglés**, que viola `CLAUDE.md` §0.10.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La regla, en una línea: se bloquea por lo que va a viajar, no por lo que pasó
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `blocked = submittedBytes > maxBytes`. No es "falló el downscale": es "el archivo que quedó
 * cargado en el `<input>` no entra". Eso cubre de una sola vez los tres caminos que terminan con
 * un archivo grande adentro del input —`failed`, la escalera de calidad que no alcanzó, y el
 * navegador sin `DataTransfer` donde el swap no se puede hacer— sin enumerarlos, que es como se
 * escapa el cuarto.
 *
 * Y por la misma razón **se desbloquea solo**: elegir otra foto vuelve a llamar a esta función con
 * los bytes nuevos. Un formulario trabado para siempre es peor que el 413 que estamos evitando.
 *
 * La compuerta **no** es `busy`, a propósito: un archivo rechazado no está "ocupado" y `aria-busy`
 * estaría mintiéndole a un lector de pantalla. Son dos señales distintas y viajan separadas.
 */

const MB = 1024 * 1024;

/** `3145728` → `"3,0"`. Coma decimal: se lee en un teléfono, en Cipolletti. */
export const asMb = (bytes: number): string => (bytes / MB).toFixed(1).replace('.', ',');

export interface PhotoGateInput {
  /** Bytes del archivo que eligió el dueño. `null` = no hay archivo (canceló o limpió el input). */
  readonly originalBytes: number | null;
  /**
   * Bytes del archivo que **efectivamente quedó** en el `<input>`, o sea el que se va a postear.
   * Igual a `originalBytes` salvo que el downscale haya podido reemplazarlo.
   */
  readonly submittedBytes: number | null;
  readonly maxBytes: number;
  readonly maxMb: number;
}

export interface PhotoGateState {
  /** Texto bajo el input. `null` = mostrar el `hint` de siempre. */
  readonly note: string | null;
  /** `true` → el form de arriba deshabilita su submit. */
  readonly blocked: boolean;
}

export function photoGateState({
  originalBytes,
  submittedBytes,
  maxBytes,
  maxMb,
}: PhotoGateInput): PhotoGateState {
  if (originalBytes === null || submittedBytes === null) {
    return { note: null, blocked: false };
  }

  if (submittedBytes > maxBytes) {
    return {
      note: `Esa foto pesa ${asMb(originalBytes)} MB y no la pudimos achicar acá. Probá con una de menos de ${String(maxMb)} MB.`,
      blocked: true,
    };
  }

  if (submittedBytes === originalBytes) {
    return { note: `Lista para subir (${asMb(submittedBytes)} MB).`, blocked: false };
  }

  return {
    note: `La achicamos de ${asMb(originalBytes)} MB a ${asMb(submittedBytes)} MB.`,
    blocked: false,
  };
}
