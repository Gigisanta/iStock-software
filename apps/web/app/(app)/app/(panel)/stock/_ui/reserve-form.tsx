'use client';

import { useActionState } from 'react';
import { reserveUnitAction } from '../reservation-actions';
import { initialReservationActionState } from '../reservation-action-state';

/**
 * Reservar un equipo desde la lista de stock.
 *
 * ── Por qué `"use client"` acá ───────────────────────────────────────────────────────────────
 * `useActionState` da dos cosas que en un teléfono no son adorno: el estado "Reservando…" (la
 * acción escribe en Postgres y purga el CDN de la vidriera, no es instantánea) y el mensaje de
 * rechazo sin perder lo tipeado. Sin eso, el dueño aprieta dos veces y el segundo intento se come
 * el `23505` del índice único.
 *
 * Sigue siendo un `<form>` de verdad: sin JavaScript postea igual y la acción hace lo mismo.
 *
 * ── El `<details>` no es decoración ──────────────────────────────────────────────────────────
 * La lista de stock son cien filas en una pantalla de 375px. Un `<select>` y un input abiertos en
 * cada fila la vuelven ilegible. `<details>` colapsa sin estado de React y **sin JavaScript**: es
 * el elemento, no un `useState`. El resumen es el único control visible hasta que hace falta.
 *
 * ── Las opciones llegan por props ────────────────────────────────────────────────────────────
 * Los presets y sus etiquetas se calculan en el Server Component con `_lib/reservations/
 * presentation.ts`, que importa `@istock/domain`. Importarlo desde acá metería el paquete de
 * dominio entero en el bundle del browser para dibujar cuatro `<option>`.
 *
 * ── Lo que se manda NO es la autorización ────────────────────────────────────────────────────
 * El `listingId` va en un hidden y la duración en un `<select>`: las dos cosas las reescribe
 * cualquiera con el inspector. Quien decide es `reserveUnitSchema` + `checkTransition()` adentro
 * de la Server Action, con la unidad releída de Postgres. Un `<option>` fuera de rango no existe
 * en esta lista, y si alguien lo inventa le rebota con el mensaje del schema.
 */

export interface ReserveFormOption {
  readonly value: number;
  readonly label: string;
}

export interface ReserveFormProps {
  readonly listingId: string;
  readonly options: readonly ReserveFormOption[];
  readonly defaultMinutes: number;
  /** "30 min a 2 h". Texto de ayuda; el rango real lo impone el schema. */
  readonly rangeHint: string;
}

export function ReserveForm({ listingId, options, defaultMinutes, rangeHint }: ReserveFormProps) {
  const [state, formAction, isPending] = useActionState(
    reserveUnitAction,
    initialReservationActionState,
  );

  const minutesId = `minutes-${listingId}`;
  const labelId = `customer-${listingId}`;

  return (
    <details className="w-full" data-testid="reservar-detalle">
      <summary className="flex min-h-[44px] w-fit cursor-pointer list-none items-center rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
        Reservar
      </summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="listingId" value={listingId} />

        <div>
          <label htmlFor={minutesId} className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Cuánto la guardás
          </label>
          <select
            id={minutesId}
            name="minutes"
            defaultValue={String(defaultMinutes)}
            data-testid="reserva-minutos"
            className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-900"
          >
            {options.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{rangeHint}</p>
        </div>

        <div>
          <label htmlFor={labelId} className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Para quién (opcional)
          </label>
          {/*
            `maxLength` acompaña al techo del schema (80). Es cortesía: recorta mientras se tipea
            en vez de rebotar al enviar. El límite que manda es el de `customerLabelSchema`.
          */}
          <input
            id={labelId}
            name="customerLabel"
            type="text"
            maxLength={80}
            autoComplete="off"
            placeholder="Juan de Cipolletti"
            data-testid="reserva-etiqueta"
            className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          data-testid="reservar-confirmar"
          className="min-h-[44px] w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {isPending ? 'Reservando…' : 'Guardar reserva'}
        </button>

        {state.error === null ? null : (
          <p role="alert" className="text-xs font-medium text-red-600">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
