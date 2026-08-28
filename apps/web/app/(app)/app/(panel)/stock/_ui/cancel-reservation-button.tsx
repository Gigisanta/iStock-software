'use client';

import { useActionState } from 'react';
import { cancelReservationAction } from '../reservation-actions';
import { initialReservationActionState } from '../reservation-action-state';

/**
 * Liberar a mano un equipo reservado: vuelve a `available` y a la vidriera.
 *
 * `"use client"` por lo mismo que `StatusButton`: el estado "Liberando…" y el mensaje cuando la
 * cancelación pierde una carrera (el cron la venció un segundo antes, o alguien la canceló desde
 * otro teléfono). El `<form>` postea igual sin JavaScript.
 *
 * ── No pregunta "¿estás seguro?" ─────────────────────────────────────────────────────────────
 * Cancelar es reversible: se vuelve a reservar en dos toques. Un `confirm()` acá sería un diálogo
 * que se aprende a saltear, y encima el mismo botón está a un dedo del pulgar en un local con
 * gente esperando. La acción destructiva de verdad —marcar vendido— es otra pantalla y tiene otra
 * historia.
 *
 * ── El `listingId` alcanza ───────────────────────────────────────────────────────────────────
 * No viaja el id de la reserva: la activa es única por unidad (`reservations_one_active_per_
 * listing`), así que mandarlo sería un dato de más que habría que validar contra la unidad igual.
 */

export function CancelReservationButton({ listingId }: { readonly listingId: string }) {
  const [state, formAction, isPending] = useActionState(
    cancelReservationAction,
    initialReservationActionState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="listingId" value={listingId} />
      <button
        type="submit"
        disabled={isPending}
        data-testid="cancelar-reserva"
        className="min-h-[44px] rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-neutral-700"
      >
        {isPending ? 'Liberando…' : 'Liberar equipo'}
      </button>
      {state.error === null ? null : (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
