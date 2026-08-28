import type { PublicListingDTO } from '@istock/domain';
import { statusBadge } from '../_lib/status';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  UN botón, y el texto NO se escribe acá
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §1: *"**UN** botón `wa.me`"* con el texto canónico. Las dos mitades de esa regla se
 * cumplen en lugares distintos y por motivos distintos:
 *
 * - **El texto** sale de `dto.waUrl`, que arma `buildWaUrl` en `@istock/domain`. Este componente
 *   no concatena un solo carácter del mensaje, y no puede: no recibe el teléfono, no recibe el
 *   precio en centavos y no conoce la plantilla. La prohibición de meter IMEI o costo en el
 *   mensaje es **de tipos** allá (`WaListing` no tiene esos campos), no de disciplina acá.
 * - **Que sea uno solo** es de la página. Este componente se renderiza una vez por ficha y la
 *   grilla **no lo usa**: las cards linkean a la ficha, no a WhatsApp. Un `wa.me` por card sería
 *   veinte conversaciones que arrancan sin que la persona haya visto batería, garantía ni punto de
 *   retiro — o sea, exactamente el mensaje sin contexto que el producto existe para eliminar.
 *
 * ── Detalles que parecen de estilo y no lo son ────────────────────────────────────────────────
 * - `rel="noopener"`: `target="_blank"` sin eso le da a la pestaña de WhatsApp una referencia a
 *   `window.opener`.
 * - **Sin `target="_blank"` en el link de datos, sí acá**: en Android el link `wa.me` abre la app;
 *   en desktop abre WhatsApp Web y queremos que la ficha siga viva atrás para volver a mirarla.
 * - `min-h-[3.25rem]` y ancho completo: se toca con el pulgar, parado, con una mano. El objetivo
 *   táctil chico es el bug más caro de una vidriera mobile y no se ve en un monitor.
 * - Abajo del botón se dice **qué va a pasar**, pero NO se transcribe `waMessage`. El mensaje usa
 *   el registro de reseller (*"usado A"*) y la ficha usa el de comprador (*"usado excelente"*):
 *   son dos mapas distintos a propósito (ratificado por el LEAD en FASE 2, punto 1). Imprimir el
 *   mensaje en la ficha pondría las dos etiquetas del mismo equipo a diez píxeles de distancia y
 *   convertiría una decisión deliberada en lo que parece una contradicción.
 */
export function WaButton({ listing }: { readonly listing: PublicListingDTO }) {
  const badge = statusBadge(listing.status);

  return (
    <div className="mt-6">
      <a
        href={listing.waUrl}
        target="_blank"
        rel="noopener"
        data-wa="listing"
        className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-center text-base font-semibold text-white shadow-sm active:bg-emerald-700"
      >
        {badge.ctaLabel}
      </a>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        Se abre WhatsApp con el equipo y el precio ya escritos. No hace falta que copies nada.
      </p>
    </div>
  );
}
