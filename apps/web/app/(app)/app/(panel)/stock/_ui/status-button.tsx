'use client';

import { useActionState } from 'react';
import { setListingStatusAction } from '../actions';
import { initialStatusActionState } from '../status-action-state';

/**
 * Botón de publicar / sacar de la vidriera.
 *
 * `"use client"` justificado y mínimo: `useActionState` da dos cosas que en un teléfono no son
 * lujo — el estado "Publicando…" (la acción invalida el cache del CDN y no es instantánea, y sin
 * feedback la gente aprieta dos veces) y el mensaje de error cuando la transición se rechaza por
 * una carrera (dos dispositivos, el mismo equipo).
 *
 * Sigue siendo un `<form>` de verdad: sin JavaScript postea igual y la acción hace lo mismo.
 * El `listingId` va en un hidden y la acción lo valida con Zod: no se confía en él.
 *
 * ── `disabled` es cortesía, NO control ───────────────────────────────────────────────────────
 * `/app/stock/{id}/fotos` lo usa para dejar el botón de publicar apagado hasta que haya 3 fotos.
 * Eso ahorra un viaje que iba a fallar; no autoriza nada. Quien decide es `checkTransition()` de
 * `@istock/domain`, adentro de la Server Action, con la unidad releída de Postgres. Un `disabled`
 * lo saca cualquiera con el inspector, y ahí el `POST` se encuentra con `missing_photos`.
 *
 * ── `after` no es una URL ────────────────────────────────────────────────────────────────────
 * Viaja como `'stay' | 'stock'` y la Server Action lo mapea a un path escrito allá adentro. Si
 * fuera texto libre, este hidden sería un open redirect servido por nosotros.
 */

export interface StatusButtonProps {
  readonly listingId: string;
  readonly to: 'available' | 'draft';
  readonly label: string;
  readonly pendingLabel: string;
  readonly tone: 'primary' | 'quiet';
  readonly testId?: string;
  /** Cortesía de UI. La autorización la hace la acción. Ver el encabezado. */
  readonly disabled?: boolean;
  /** A dónde va el dueño si la transición sale bien. Default: se queda. */
  readonly after?: 'stay' | 'stock';
}

export function StatusButton({
  listingId,
  to,
  label,
  pendingLabel,
  tone,
  testId,
  disabled = false,
  after = 'stay',
}: StatusButtonProps) {
  const [state, formAction, isPending] = useActionState(
    setListingStatusAction,
    initialStatusActionState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="after" value={after} />
      <button
        type="submit"
        data-testid={testId}
        disabled={isPending || disabled}
        className={
          tone === 'primary'
            ? 'min-h-[44px] rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900'
            : 'min-h-[44px] rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-neutral-700'
        }
      >
        {isPending ? pendingLabel : label}
      </button>
      {state.error === null ? null : (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
