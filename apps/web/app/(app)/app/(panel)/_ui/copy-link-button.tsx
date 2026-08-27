'use client';

import { useState } from 'react';

/**
 * `"use client"` justificado: usa el portapapeles, que es una API del navegador.
 *
 * Es un botón chiquito con una función grande. El recorrido que factura (`PRODUCT.md` §2) es
 * *"pega `{slug}.maat.work` en un estado de Instagram"*, y eso pasa desde el teléfono, parado,
 * con una mano. Obligar a seleccionar un texto con el dedo para copiarlo es exactamente el
 * momento donde la persona abandona y vuelve a mandar fotos sueltas por WhatsApp.
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {copied ? '¡Copiado!' : 'Copiar link de mi vidriera'}
    </button>
  );
}
