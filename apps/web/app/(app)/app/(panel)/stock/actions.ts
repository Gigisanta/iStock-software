'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  panelActor,
  transitionUnit,
  type TransitionRequest,
} from '../../../_lib/listings/publish-listing';
import { requireTenant } from '../../../_lib/session';
import { parseStatusForm } from './status-action-schema';
import type { StatusActionState } from './status-action-state';

/**
 * Publicar, despublicar o marcar vendida una unidad.
 *
 * ── Autorización adentro de la acción (ADR-007) ──────────────────────────────────────────────
 * `requireTenant()` es lo primero. Las Server Functions no son rutas propias en la cadena de
 * matchers de `proxy.ts`: un `matcher` que excluye un path también saltea sus Server Functions.
 *
 * ── Zod en el borde, también acá ─────────────────────────────────────────────────────────────
 * El `listingId` viene de un `<input type="hidden">`, o sea del cliente, o sea de cualquiera.
 * Sin `z.uuid()` un string cualquiera llega a un `where id = $1` y Postgres responde con un error
 * de sintaxis de UUID que después alguien loguea entero.
 *
 * ── El borde vive en `status-action-schema.ts` ─────────────────────────────────────────────
 * Qué claves se leen del `FormData`, qué destinos se aceptan, qué pide la venta y —sobre todo— qué
 * NO se lee (el costo, D2) está todo allá, con su motivo. Se mudó para poder testearlo: un módulo
 * `'use server'` sólo exporta funciones `async`, así que un schema declarado acá no se puede
 * importar desde un test. Acá queda lo que esta acción decide: a dónde va el dueño después.
 *
 * ── El tenant NO viaja en el form ────────────────────────────────────────────────────────────
 * `tenant.slug` sale de la sesión. Si viniera del request, un `POST` con el slug de otro negocio
 * purgaría el cache de una vidriera ajena.
 *
 * ── `after`: a dónde va el dueño después de publicar ─────────────────────────────────────────
 * `/app/stock/{id}/fotos` es una pantalla de un solo propósito: dejar la unidad publicable. Una
 * vez publicada, quedarse ahí es un callejón sin salida justo en el momento de más impulso — el
 * "done cobrable" de CLAUDE.md es cargar 15 equipos en una tarde, y el botón de alta vive en
 * `/app/stock`. Desde la lista, en cambio, no hay a dónde ir: se queda.
 *
 * Es un campo del cliente, así que **NO** es una URL: es una allowlist de dos valores que mapea a
 * paths escritos acá adentro. Un `redirectTo` de texto libre en un form es un open redirect, y en
 * una Server Action además es un redirect que el navegador sigue sin preguntar. `catch('stay')`
 * hace que basura en el campo no rompa la publicación: publica y se queda.
 *
 * ── `redirect()` cuando se va, `refresh()` cuando se queda ───────────────────────────────────
 * Las dos son la misma obligación —que la pantalla deje de mentir— y hay que cumplir una. Con
 * `after='stock'` el `redirect()` fuerza la navegación y el segmento se rinde de cero: alcanza.
 * Con `after='stay'`, que es el default y el caso de la lista de `/app/stock`, la acción devolvía
 * `{ error: null }` y la fila se quedaba con el badge viejo, el botón viejo y el motivo de "no se
 * puede publicar" viejo, con la transición ya escrita en Postgres. Mismo bug que el de
 * `stock/{id}/fotos/actions.ts`, distinta pantalla.
 *
 * `/app/stock` **lee vivo de Postgres** (sin `'use cache'`): no hay cache de la ruta que purgar,
 * así que es `refresh()` y no `revalidatePath()`. `invalidateStorefront()`, que `transitionUnit`
 * sí llama, es la otra capa —el CDN de la vidriera— y no refresca ninguna pantalla del panel.
 *
 * Sólo en el camino exitoso, por el mismo motivo que el `redirect()`: un fallo tiene que poder
 * mostrar su mensaje, y refrescar de más es re-consultar Postgres gratis.
 */

const AFTER_PATHS = {
  stay: null,
  stock: '/app/stock',
} as const;

export async function setListingStatusAction(
  _prev: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const session = await requireTenant();

  const parsed = parseStatusForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  /**
   * El actor sale entero de la sesión (`panelActor()`). Del form llega el id, el destino y —cuando
   * el destino es la venta— lo cobrado y el medio de pago. Nada más: si el slug viniera del request
   * se purgaría la vidriera de otro negocio, si viniera el plan el entitlement se compraría
   * escribiendo `negocio` en un hidden, y si viniera el costo se escribiría el margen (D2).
   *
   * La rama se arma a mano en vez de pasar `parsed.data` entero porque `TransitionRequest` es una
   * unión discriminada (D5) y el `after` no es asunto de `transitionUnit()`.
   */
  const request: TransitionRequest =
    parsed.data.to === 'sold'
      ? {
          to: 'sold',
          sale: {
            priceUsdCents: parsed.data.priceUsdCents,
            paymentMethod: parsed.data.paymentMethod,
          },
        }
      : { to: parsed.data.to };

  const result = await transitionUnit(panelActor(session), parsed.data.listingId, request);

  if (!result.ok) {
    return { error: result.message };
  }

  // Sólo cuando salió bien. Un fallo tiene que poder mostrar su mensaje donde el dueño está mirando.
  const destination = AFTER_PATHS[parsed.data.after];
  if (destination !== null) {
    redirect(destination);
  }

  // Se queda en la pantalla: hay que decirle al router del cliente que vuelva a pedir el segmento
  // o la fila sigue mostrando el estado anterior. Ver el encabezado.
  refresh();

  return { error: null };
}
