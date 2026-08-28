'use client';

import { useState } from 'react';

/**
 * Copiar al portapapeles. **La única razón por la que este archivo es `"use client"`** es que el
 * portapapeles es una API del navegador.
 *
 * Es un botón chiquito con una función grande. El recorrido que factura (`PRODUCT.md` §2) termina
 * en *"pega el texto en un estado"*, y eso pasa desde el teléfono, parado, con una mano. Obligar a
 * seleccionar con el dedo un bloque de nueve renglones que incluye links es exactamente el momento
 * donde la persona abandona y vuelve a mandar fotos sueltas por WhatsApp.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El estado `failed` no es defensivo de más
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `navigator.clipboard` **no existe fuera de un contexto seguro**, y "contexto seguro" mira el
 * *origen*, no a dónde resuelve: `http://demo.127.0.0.1.nip.io:3100` —el host de los e2e y del
 * `next start` del gate— no lo es aunque apunte a 127.0.0.1. La versión anterior hacía
 * `void navigator.clipboard.writeText(...)` a secas: ahí eso es un `TypeError` sobre `undefined`,
 * o sea un botón que no hace **nada** y no dice nada. Un fallo mudo en el único botón que la
 * pantalla tiene es peor que no tener el botón: la persona vuelve a tocarlo y se va.
 *
 * Cuando falla, el botón lo dice y manda a copiar a mano — el texto está en pantalla, arriba.
 */

export interface CopyButtonProps {
  /** Lo que se copia. Un link o un bloque de varios renglones: al portapapeles le da igual. */
  readonly value: string;
  /** Rótulo en reposo. En español rioplatense, como todo lo que se ve en el panel. */
  readonly label: string;
  /** Rótulo del acuse. Vuelve solo a `label` a los 2 s. */
  readonly copiedLabel?: string;
}

const FAILED_LABEL = 'No pudimos copiar. Copialo a mano del texto de arriba.';

export function CopyButton({ value, label, copiedLabel = '¡Copiado!' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = () => {
    void (async () => {
      try {
        // `navigator.clipboard` puede ser `undefined`: ver el encabezado. El `?.` más el `throw`
        // hacen que los dos modos de falla —no existe la API, o el usuario negó el permiso—
        // terminen en el mismo lugar, que es lo único que le importa a quien está mirando.
        const clipboard: Clipboard | undefined = navigator.clipboard;
        if (clipboard === undefined) throw new Error('sin portapapeles');
        await clipboard.writeText(value);
        setState('copied');
        setTimeout(() => {
          setState('idle');
        }, 2000);
      } catch {
        // El error del navegador no se loguea: el `value` de esta pantalla es texto de negocio y
        // un `console.error(err)` con el bloque adentro es un listing entero en la consola.
        setState('failed');
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className="min-h-[52px] w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {state === 'copied' ? copiedLabel : state === 'failed' ? FAILED_LABEL : label}
    </button>
  );
}
