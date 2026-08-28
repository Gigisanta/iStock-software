'use client';

import { useActionState, useState } from 'react';
import { PhotoInput } from '../../_ui/photo-input';
import { addPhotoAction } from './actions';
import { initialPhotoActionState } from './photo-action-state';

/**
 * Sumar una foto a la unidad. **Una por request**, sin `multiple`.
 *
 * `"use client"` acotado y con motivo: subir una foto de 3 MB desde el teléfono de un local tarda,
 * y sin el estado "Subiendo…" la gente aprieta dos veces y sube la misma foto dos veces. Sumado a
 * eso, `PhotoInput` necesita bloquear el submit mientras achica una foto grande, y **dejarlo
 * bloqueado** si la foto elegida no entra: mandarla igual sería un 413 de Next en inglés.
 *
 * Sigue siendo un `<form action={...}>` de verdad: sin JavaScript postea igual, la Server Action
 * valida lo mismo y la foto entra. Lo que se pierde sin JS es el rescate de la foto pesada.
 *
 * Esa promesa **depende de que `page.tsx` sea una ruta bloqueante** (`export const instant =
 * false`, sin `<Suspense>` de tope). Con un boundary arriba, este form sale del server adentro de
 * un `<div hidden>` que recoloca un script inline: sin JS queda invisible para siempre y el form
 * mejor armado del mundo no se puede tocar. Si alguien le devuelve el `<Suspense>` a la página,
 * esta línea vuelve a ser mentira.
 *
 * El `listingId` va en un hidden y la acción lo valida con Zod y lo acota por tenant: acá no se
 * confía en él, se lo manda.
 */

export interface AgregarFotoFormProps {
  readonly listingId: string;
  readonly photoAccept: string;
  readonly maxPhotoBytes: number;
  readonly maxPhotoMb: number;
  readonly remaining: number;
}

export function AgregarFotoForm({
  listingId,
  photoAccept,
  maxPhotoBytes,
  maxPhotoMb,
  remaining,
}: AgregarFotoFormProps) {
  const [state, formAction, isPending] = useActionState(addPhotoAction, initialPhotoActionState);
  const [photoBusy, setPhotoBusy] = useState(false);
  /**
   * Compuerta aparte de `photoBusy`: la foto que no se pudo achicar no está "ocupada", está
   * rechazada. Se levanta sola cuando el dueño elige otra que entra (`PhotoInput`).
   */
  const [photoBlocked, setPhotoBlocked] = useState(false);

  return (
    <form data-testid="form-agregar-foto" action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="listingId" value={listingId} />

      <PhotoInput
        name="photo"
        testId="input-agregar-foto"
        label="Sumar una foto"
        accept={photoAccept}
        maxBytes={maxPhotoBytes}
        maxMb={maxPhotoMb}
        required
        invalid={state.error !== null}
        hint={
          remaining > 0
            ? `Va de a una. Te quedan ${String(remaining)} lugares para este equipo.`
            : 'Va de a una.'
        }
        onBusyChange={setPhotoBusy}
        onBlockedChange={setPhotoBlocked}
      />

      {state.error === null ? null : (
        <p
          data-testid="error-foto"
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        data-testid="submit-agregar-foto"
        disabled={isPending || photoBusy || photoBlocked}
        className="w-full rounded-xl border border-neutral-300 px-6 py-3.5 text-base font-semibold disabled:opacity-60 dark:border-neutral-700"
      >
        {photoBusy
          ? 'Achicando la foto…'
          : photoBlocked
            ? 'Elegí otra foto'
            : isPending
              ? 'Subiendo…'
              : 'Agregar esta foto'}
      </button>
    </form>
  );
}
