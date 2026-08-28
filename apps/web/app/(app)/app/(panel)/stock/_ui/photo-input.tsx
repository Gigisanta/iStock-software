'use client';

import { useId, useRef, useState } from 'react';
import { downscalePhoto } from './downscale-photo';
import { photoGateState } from './photo-gate';

/**
 * El `<input type="file">` de una foto. **Una**, sin `multiple`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `"use client"` justificado: hay tres interacciones reales
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. El downscale de rescate, que ocurre entre el `change` y el `submit`.
 * 2. El aviso de "estoy achicando la foto" — en un teléfono de gama media son 1–3 segundos y sin
 *    feedback la gente aprieta enviar dos veces.
 * 3. Bloquear el submit mientras eso pasa, que es lo que evita que se suba el archivo original de
 *    12 MB por adelantarse.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Dos señales hacia arriba, y no una: `busy` y `blocked`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * - `onBusyChange` = *"esperá, estoy achicando"*. Es transitorio y se apaga solo.
 * - `onBlockedChange` = *"esta foto no entra y no la vamos a poder mandar"*. Es un veredicto.
 *
 * Meterlas en la misma variable fue el bug: con `busy` apagándose siempre al final, la foto que no
 * se pudo achicar mostraba el aviso correcto y **se podía mandar igual**, el body pasaba
 * `bodySizeLimit` y Next contestaba **413 en inglés** (`CLAUDE.md` §0.10). Y reusar `busy` para
 * bloquear tampoco servía: `aria-busy` sobre un archivo rechazado le miente a un lector de
 * pantalla, que anunciaría "ocupado" para algo que ya terminó. El veredicto lo calcula
 * `photo-gate.ts`, que es puro y está testeado; acá sólo se cablea.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cómo se sube el archivo achicado sin romper el form
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Se reemplaza el contenido del propio `<input>` con un `DataTransfer`. Esto es a propósito: el
 * `<form action={serverAction}>` sigue siendo un form común, sin `onSubmit`, sin
 * `preventDefault`, sin `FormData` armado a mano. **Sin JavaScript el form postea igual** y el
 * server valida lo mismo; lo que se pierde es el rescate, no el alta.
 *
 * Si `DataTransfer` no existe (navegador viejo), no se toca nada: el archivo grande sigue adentro
 * del input, así que la compuerta baja igual que si el downscale hubiera fallado. Es el mismo
 * hecho —lo que va a viajar no entra— y por eso no es un caso aparte en el código.
 *
 * ── Lo que este componente NO hace ───────────────────────────────────────────────────────────
 * No sube a R2, no ve una credencial, no arma una URL de imagen. El byte va en el `FormData` de
 * la Server Action y de ahí al pipeline. `CLAUDE.md` §3.
 */

export interface PhotoInputProps {
  /** `photo`, en singular. El plural murió con el diseño de 8 fotos en un submit. */
  readonly name: string;
  readonly testId: string;
  readonly label: string;
  readonly accept: string;
  readonly maxBytes: number;
  readonly maxMb: number;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly hint?: string;
  /** El form de arriba deshabilita su submit mientras se achica. Transitorio. */
  readonly onBusyChange?: (busy: boolean) => void;
  /**
   * El form de arriba deshabilita su submit **mientras la foto cargada no entre**. Se levanta sola
   * en cuanto el dueño elige otra que sí entra: un form trabado para siempre es peor que el 413.
   */
  readonly onBlockedChange?: (blocked: boolean) => void;
}

export function PhotoInput({
  name,
  testId,
  label,
  accept,
  maxBytes,
  maxMb,
  required = false,
  invalid = false,
  hint,
  onBusyChange,
  onBlockedChange,
}: PhotoInputProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Cada selección invalida a la anterior. Sin esto, elegir un HEIC de 9 MB y arrepentirse eligiendo
   * una foto chica termina con el veredicto del HEIC —que resuelve después— pisando al de la foto
   * buena: form bloqueado, mensaje que no corresponde y nada que el dueño pueda hacer.
   */
  const runIdRef = useRef(0);

  function settle(originalBytes: number | null, submittedBytes: number | null): void {
    const state = photoGateState({ originalBytes, submittedBytes, maxBytes, maxMb });
    setNote(state.note);
    setBlocked(state.blocked);
    onBlockedChange?.(state.blocked);
  }

  function setBusyTo(value: boolean): void {
    setBusy(value);
    onBusyChange?.(value);
  }

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    // Se captura la referencia ANTES del `await`: React limpia `event.currentTarget` cuando el
    // handler retorna, y este handler retorna una promesa.
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    const runId = ++runIdRef.current;

    // Sin archivo, o bajo el cap: se resuelve en el acto y se levanta cualquier compuerta previa.
    // Bajo el cap NO se re-encodea. Ver `downscale-photo.ts`: el gate mide el pipeline.
    if (file === null || file.size <= maxBytes) {
      setBusyTo(false);
      settle(file?.size ?? null, file?.size ?? null);
      return;
    }

    setBusyTo(true);
    setNote('Achicando la foto…');

    const result = await downscalePhoto(file, maxBytes);

    // Llegó tarde: ya hay otra foto elegida y ese veredicto manda. Ni se toca el input.
    if (runId !== runIdRef.current) return;

    let submittedBytes = file.size;
    if (result.kind === 'resized' && typeof DataTransfer === 'function') {
      const transfer = new DataTransfer();
      transfer.items.add(result.file);
      (inputRef.current ?? input).files = transfer.files;
      submittedBytes = result.file.size;
    }

    setBusyTo(false);
    settle(file.size, submittedBytes);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        data-testid={testId}
        type="file"
        required={required}
        accept={accept}
        onChange={(event) => {
          void handleChange(event);
        }}
        aria-invalid={invalid || blocked}
        aria-busy={busy}
        className="mt-1.5 w-full rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-3 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:file:bg-white dark:file:text-neutral-900"
      />
      {note === null ? (
        hint === undefined ? null : (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>
        )
      ) : (
        <p
          data-testid={`${testId}-nota`}
          className={`mt-2 text-xs ${blocked ? 'font-medium text-red-700 dark:text-red-300' : 'text-neutral-600 dark:text-neutral-300'}`}
          aria-live="polite"
        >
          {note}
        </p>
      )}
    </div>
  );
}
