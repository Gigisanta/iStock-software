'use client';

import { useActionState, useId } from 'react';
import { updateListingPriceAction } from '../actions';
import { initialPriceActionState } from '../price-action-state';

export interface PriceFormProps {
  readonly listingId: string;
  readonly defaultPrice: string;
}

/** Edición corta y reversible del precio que ve el comprador. */
export function PriceForm({ listingId, defaultPrice }: PriceFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateListingPriceAction,
    initialPriceActionState,
  );
  const priceId = useId();

  return (
    <details className="panel-price-editor w-full" data-testid="editar-precio">
      <summary className="flex min-h-[44px] w-fit cursor-pointer list-none items-center rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
        Cambiar precio
      </summary>

      <form action={formAction} className="panel-price-editor-form mt-2 space-y-2">
        <input type="hidden" name="listingId" value={listingId} />
        <div>
          <label htmlFor={priceId} className="block text-xs font-medium">
            Precio publicado (USD)
          </label>
          <input
            id={priceId}
            name="priceUsd"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            defaultValue={defaultPrice}
            aria-invalid={state.error !== null}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white px-3 text-base tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
          />
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            La vidriera se actualiza al guardar.
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="min-h-[44px] w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {isPending ? 'Guardando…' : 'Guardar precio'}
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
