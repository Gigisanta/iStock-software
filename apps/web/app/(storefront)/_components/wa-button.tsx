import type { PublicListingDTO } from '@istock/domain';
import { statusBadge } from '../_lib/status';
import { WaClickBeacon } from './wa-beacon';

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
 *
 * ── Lo que S4 le agregó, y lo que NO le agregó (el click se registra) ─────────────────────────
 * Dos cosas, las dos deliberadamente inertes para el visitante:
 *
 * - `data-wa-listing`, con el `id` del DTO —público por definición, es el mismo uuid con el que la
 *   ficha registra su `cacheTag`— para que el beacon sepa **qué equipo** generó la conversación.
 *   Es el único dato que el click necesita: el tenant NO viaja desde el browser, lo pone el
 *   servidor a partir del host (ver `s/[slug]/api/track/route.ts`).
 * - `<WaClickBeacon />`, que viaja **soldado** a este componente y no lo monta la página. Así no
 *   existe el estado "hay botón y no hay medición" ni el inverso, y sobre todo: como este
 *   componente se rinde una sola vez por ficha, el listener se instala una sola vez.
 *
 * Lo que NO cambió, y es la mitad que importa: este archivo **sigue siendo un Server Component** y
 * el `<a>` sigue saliendo del servidor con su `href` real. El botón que da la plata no depende de
 * que hidrate nada, y con JavaScript apagado abre WhatsApp igual — lo mide el e2e de `qa-agent`
 * con `javaScriptEnabled: false`, no un grep. El beacon no cancela el click ni lo demora.
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
        data-wa-listing={listing.id}
        className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-center text-base font-semibold text-white shadow-sm active:bg-emerald-700"
      >
        {badge.ctaLabel}
      </a>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        Se abre WhatsApp con el equipo y el precio ya escritos. No hace falta que copies nada.
      </p>
      <WaClickBeacon />
    </div>
  );
}
