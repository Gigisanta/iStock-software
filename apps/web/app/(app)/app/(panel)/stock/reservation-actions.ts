'use server';

import { refresh } from 'next/cache';
import { panelActor } from '../../../_lib/listings/publish-listing';
import { cancelReservation, reserveUnit } from '../../../_lib/reservations/reserve-unit';
import { cancelReservationSchema, reserveUnitSchema } from '../../../_lib/reservations/schema';
import { requireTenant } from '../../../_lib/session';
import type { ReservationActionState } from './reservation-action-state';

/**
 * Reservar y cancelar desde la lista de stock.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `requireTenant()` es la primera línea de las dos acciones (ADR-007)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Las Server Functions **no** son rutas propias en la cadena de matchers de `proxy.ts`: un
 * `matcher` que excluye un path también saltea las Server Functions de ese path. Un guard en el
 * proxy protege la pantalla y deja la mutación abierta a un `POST` crudo con el id de otro. La
 * autorización se verifica acá adentro, siempre, y por eso también la sostiene `W012` de
 * `web-lint`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Nada del actor viaja en el `FormData`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `slug`, `plan` y `trialEndsAt` salen de la sesión, y los arma `panelActor()` en un solo lugar.
 * Si el slug viniera del form, un `POST` armado a mano purgaría el cache de la vidriera de otro
 * negocio; si viniera el plan, el entitlement de reservas se compraría escribiendo `negocio` en un
 * hidden. Del cliente llega **sólo** el `listingId`, la duración y la etiqueta, y los tres pasan
 * por Zod antes de tocar nada.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El mensaje de Zod se muestra tal cual; el resto es genérico
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Los mensajes de `reserveUnitSchema` están escritos para el mostrador ("La reserva dura entre 30
 * y 120 minutos"), así que se muestran. El fallo de `listingId`, en cambio, no es un error que el
 * dueño pueda arreglar tipeando: o la pantalla quedó vieja o alguien está probando el endpoint. Se
 * dice lo único accionable, que es recargar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `refresh()` sólo cuando salió bien
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `/app/stock` lee vivo de Postgres (sin `'use cache'`), así que no hay cache de ruta que purgar:
 * lo que hace falta es que el router del cliente vuelva a pedir el segmento, o la fila se queda
 * con el badge "En vidriera" y el formulario de reservar mientras la unidad ya está `reserved` en
 * la base. Es `refresh()` y no `revalidatePath()` por eso mismo.
 *
 * La invalidación de la **vidriera** no se hace acá: la hace `reserveUnit()` /
 * `cancelReservation()` con `invalidateStorefrontUnit()`, dentro de la misma función que escribió
 * el cambio. Repetirla en la acción sería una segunda purga que se olvidaría el día que alguien
 * llame al dominio desde otra pantalla — el cron, sin ir más lejos, no pasa por acá.
 *
 * En el camino de error **no** se refresca: refrescar tira el `useActionState` con el mensaje
 * puesto y el dueño ve la pantalla parpadear sin enterarse de por qué no se reservó.
 */

const UNREADABLE = 'No pudimos identificar el equipo. Recargá la pantalla.';

export async function reserveUnitAction(
  _prev: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  const session = await requireTenant();

  const parsed = reserveUnitSchema.safeParse({
    listingId: formData.get('listingId'),
    minutes: formData.get('minutes'),
    customerLabel: formData.get('customerLabel'),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues.find((candidate) => candidate.path[0] !== 'listingId');
    return { error: issue?.message ?? UNREADABLE };
  }

  const result = await reserveUnit(panelActor(session), parsed.data);
  if (!result.ok) {
    return { error: result.message };
  }

  refresh();
  return { error: null };
}

export async function cancelReservationAction(
  _prev: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  const session = await requireTenant();

  const parsed = cancelReservationSchema.safeParse({ listingId: formData.get('listingId') });
  if (!parsed.success) {
    return { error: UNREADABLE };
  }

  const result = await cancelReservation(panelActor(session), parsed.data.listingId);
  if (!result.ok) {
    return { error: result.message };
  }

  refresh();
  return { error: null };
}
