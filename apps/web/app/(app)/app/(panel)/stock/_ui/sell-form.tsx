'use client';

import { useActionState } from 'react';
import { setListingStatusAction } from '../actions';
import { initialStatusActionState } from '../status-action-state';

/**
 * Marcar un equipo como vendido, desde la lista de stock.
 *
 * ── Por qué `"use client"` acá ───────────────────────────────────────────────────────────────
 * Lo mismo que `ReserveForm`: `useActionState` da el estado "Registrando…" —la acción escribe dos
 * tablas y purga el CDN de la vidriera, no es instantánea— y el mensaje de rechazo **sin perder lo
 * tipeado**. Acá eso pesa más que en cualquier otra fila: si el precio se borra en un rebote, el
 * dueño tiene que acordarse de cuánto cobró con el comprador enfrente.
 *
 * Sigue siendo un `<form>` de verdad: sin JavaScript postea igual y la acción hace lo mismo.
 *
 * ── El `<details>` cerrado no es decoración ──────────────────────────────────────────────────
 * Cien filas en una pantalla de 375px. Y hay una razón de más para que **esta** empiece cerrada:
 * `sold` es terminal, así que el botón que la abre está a un toque de una operación sin vuelta
 * atrás. Un input de precio y un `<select>` abiertos en cada fila son un accidente esperando el
 * dedo gordo de alguien que quería tocar "Reservar".
 *
 * ── Qué NO tiene este formulario ─────────────────────────────────────────────────────────────
 * **El costo.** `sales.margin_usd` la deriva Postgres de `price_usd - cost_usd`, así que un input
 * de costo acá sería un input de margen. El valor se copia de `listings.cost_usd` adentro de la
 * transacción (D2). Tampoco tiene el ARS ni el tipo de cambio: los congela el server con el
 * `fx_settings` del negocio (D4), que se actualiza automáticamente.
 *
 * ── Las opciones de pago llegan por props ────────────────────────────────────────────────────
 * Se arman en el Server Component con `_lib/sales/presentation.ts`. Es la misma razón que en
 * `ReserveForm`: dibujar siete `<option>` no justifica meter un módulo del server en el bundle.
 *
 * ── Lo que se manda NO es la autorización ────────────────────────────────────────────────────
 * Todo esto lo reescribe cualquiera con el inspector. Quien decide es el Zod de la acción +
 * `checkTransition()`, con la unidad releída de Postgres; y quien decide el costo no es nadie de
 * este lado.
 */

export interface SellFormPaymentOption {
  readonly value: string;
  readonly label: string;
}

export interface SellFormProps {
  readonly listingId: string;
  /**
   * El precio publicado, ya formateado para tipear encima (sin separador de miles: es lo que el
   * borde sabe parsear). Se **prellena** porque la mayoría de las ventas cierran al precio de la
   * ficha, y en las que no, corregir un número es más rápido que escribirlo entero. Lo que se
   * archiva es lo que quede en el input: D3 dice que `price_usd` es lo realmente cobrado.
   */
  readonly defaultPrice: string;
  readonly paymentOptions: readonly SellFormPaymentOption[];
}

export function SellForm({ listingId, defaultPrice, paymentOptions }: SellFormProps) {
  const [state, formAction, isPending] = useActionState(
    setListingStatusAction,
    initialStatusActionState,
  );

  const priceId = `sale-price-${listingId}`;
  const methodId = `sale-method-${listingId}`;

  return (
    <details className="w-full" data-testid="vender-detalle">
      <summary className="flex min-h-[44px] w-fit cursor-pointer list-none items-center rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
        Vender
      </summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="to" value="sold" />
        <input type="hidden" name="after" value="stay" />

        <div>
          <label
            htmlFor={priceId}
            className="block text-xs font-medium text-neutral-600 dark:text-neutral-300"
          >
            A cuánto lo vendiste (USD)
          </label>
          {/*
            `type="text"` con `inputMode="decimal"`, no `type="number"`: en un teléfono el número
            trae la rueda que cambia el valor al scrollear y, peor, valida distinto según la coma o
            el punto de la configuración regional. Acá se escribe "620,50" o "620.50" y el parseo
            es del server (`parseUsdToCents`), que entiende las dos.
          */}
          <input
            id={priceId}
            name="priceUsd"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            defaultValue={defaultPrice}
            data-testid="venta-precio"
            className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Poné lo que cobraste de verdad, aunque hayan regateado.
          </p>
        </div>

        <div>
          <label
            htmlFor={methodId}
            className="block text-xs font-medium text-neutral-600 dark:text-neutral-300"
          >
            Con qué te pagaron
          </label>
          {/*
            Sin opción preseleccionada, y el `<option value="">` va `disabled`: el medio de pago no
            tiene un default honesto — el que estuviera arriba se registraría solo en las ventas
            apuradas y el dato quedaría inservible. `required` es cortesía del browser; el que
            manda es `paymentMethodSchema`.
          */}
          <select
            id={methodId}
            name="paymentMethod"
            required
            defaultValue=""
            data-testid="venta-medio-pago"
            className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="" disabled>
              Elegí una opción
            </option>
            {paymentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          data-testid="vender-confirmar"
          className="min-h-[44px] w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {isPending ? 'Registrando…' : 'Marcar vendido'}
        </button>

        {/*
          `sold` es terminal en la máquina de estados: no hay arista de vuelta y esta pantalla no
          va a poder ofrecer un "deshacer" después. Se avisa antes del toque, no después.
        */}
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Una vez que lo marcás vendido, no se puede volver atrás desde acá.
        </p>

        {state.error === null ? null : (
          <p role="alert" className="text-xs font-medium text-red-600">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
