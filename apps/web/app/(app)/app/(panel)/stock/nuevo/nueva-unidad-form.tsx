'use client';

import { useActionState, useId, useState } from 'react';
import { CONDITIONS, checkImei, conditionLabel } from '@istock/domain';
import type { CatalogModelOption } from '../../../../_lib/catalog/queries';
import { PhotoInput } from '../_ui/photo-input';
import { createUnitAction } from './actions';
import { initialNewUnitState, type NewUnitFormState } from './form-state';

/**
 * Alta de una unidad. `"use client"` justificado y acotado: hay interacciones reales —
 * el estado de envío (subir una foto tarda y sin feedback la gente aprieta dos veces),
 * el aviso de dígito verificador del IMEI mientras se tipea, y el downscale de la foto
 * (`PhotoInput`), que bloquea el submit mientras corre y lo deja bloqueado si la foto elegida no
 * entra: mandarla igual sería un 413 de Next en inglés.
 *
 * **El formulario anda sin JavaScript.** Es un `<form action={...}>` común: postea, la Server
 * Action valida todo de nuevo y responde. Lo que se pierde sin JS son las ayudas y el rescate de
 * la foto pesada, no el alta.  Por eso no hay `onSubmit` con `preventDefault` en ningún lado.
 *
 * ── UNA foto, y el `name` es `photo` en singular ─────────────────────────────────────────────
 * Sin `multiple`. No es una simplificación de UI: el POST del alta pasa por el Routing Middleware
 * de Vercel, cuyo body está capado en 4 MB y no varía por plan. Dos fotos de celular no entran.
 * Al guardar se va a `/app/stock/{id}/fotos`, donde se cargan las otras dos de a una.
 *
 * ── El modelo de catálogo es obligatorio ─────────────────────────────────────────────────────
 * `checkPublishable()` deniega `missing_catalog_model` para toda unidad. Sin este `<select>`, el
 * alta fabrica borradores que no se pueden publicar nunca — que es exactamente lo que pasaba.
 *
 * ── Mobile-first, en serio ───────────────────────────────────────────────────────────────────
 * Se usa parado en un local con una mano. De ahí:
 * - Campos apilados, `text-base` (menos de 16px hace que iOS haga zoom al enfocar) y `py-3`.
 * - `inputMode` por campo: teclado numérico para GB, precio, batería e IMEI. Escribir un IMEI de
 *   15 dígitos con el teclado alfabético es donde se abandona el alta.
 * - `capture` NO se fuerza: el dueño casi siempre ya tiene las fotos sacadas en el carrete.
 * - El botón de guardar es ancho y va al final, arriba del `pb-28` del layout.
 *
 * ── El aviso del IMEI no bloquea ─────────────────────────────────────────────────────────────
 * `checkImei()` de `@istock/domain` devuelve un warning, nunca tira. `packages/db` lo deja escrito:
 * *"un gate de alta que rechaza stock es peor que un warning que el dueño ignora"*. Los 15 dígitos
 * sí son bloqueantes (lo exige el `CHECK` y el propio formulario de ENACOM); el dígito verificador
 * es un aviso.
 *
 * ── Lo que este componente NO hace ───────────────────────────────────────────────────────────
 * No toca R2, no ve una credencial, no arma una URL de imagen. Manda bytes a la Server Action y
 * listo. Cualquier otra cosa sería el bug que `CLAUDE.md` §3 prohíbe.
 */

export interface NuevaUnidadFormProps {
  /** `true` sólo para `owner`. El seller no ve el campo, y la acción tampoco lo lee. */
  readonly canWriteCost: boolean;
  readonly photoAccept: string;
  readonly maxPhotoBytes: number;
  readonly maxPhotoMb: number;
  readonly minPhotosToPublish: number;
  readonly catalogModels: readonly CatalogModelOption[];
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white';

function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="mt-2 text-sm font-medium text-red-600">
      {message}
    </p>
  );
}

/** El orden en que se muestran los errores arriba: el primero que aparezca es el que se cita. */
const ERROR_ORDER = [
  'form',
  'title',
  'catalogModelId',
  'condition',
  'priceUsd',
  'storageGb',
  'color',
  'batteryPct',
  'imei',
  'costUsd',
  'description',
  'photo',
] as const;

function firstError(state: NewUnitFormState): string | null {
  for (const field of ERROR_ORDER) {
    const message = state.errors[field];
    if (message !== undefined) return message;
  }
  return null;
}

/** Agrupa el catálogo por familia. Cuarenta modelos planos en un `<select>` de teléfono no se leen. */
function byFamily(models: readonly CatalogModelOption[]): readonly (readonly [string, readonly CatalogModelOption[]])[] {
  const groups = new Map<string, CatalogModelOption[]>();
  for (const model of models) {
    const list = groups.get(model.family) ?? [];
    list.push(model);
    groups.set(model.family, list);
  }
  return [...groups.entries()];
}

export function NuevaUnidadForm({
  canWriteCost,
  photoAccept,
  maxPhotoBytes,
  maxPhotoMb,
  minPhotosToPublish,
  catalogModels,
}: NuevaUnidadFormProps) {
  const [state, formAction, isPending] = useActionState(createUnitAction, initialNewUnitState);

  const [imei, setImei] = useState(state.values.imei);
  const [photoBusy, setPhotoBusy] = useState(false);
  /**
   * Compuerta aparte de `photoBusy`: la foto que no se pudo achicar no está "ocupada", está
   * rechazada. Se levanta sola cuando el dueño elige otra que entra (`PhotoInput`).
   */
  const [photoBlocked, setPhotoBlocked] = useState(false);

  const titleId = useId();
  const modelId = useId();
  const conditionId = useId();
  const storageId = useId();
  const colorId = useId();
  const priceId = useId();
  const batteryId = useId();
  const imeiId = useId();
  const costId = useId();
  const descriptionId = useId();

  const imeiWarning = imei.trim() === '' ? null : checkImei(imei).warning;
  const topError = firstError(state);

  return (
    <form
      data-testid="form-nueva-unidad"
      action={formAction}
      className="mt-2 space-y-5"
      noValidate
    >
      {topError === null ? null : (
        <p
          data-testid="error-alta"
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {topError}
        </p>
      )}

      <div>
        <label htmlFor={titleId} className="block text-sm font-medium">
          Qué equipo es
        </label>
        <input
          id={titleId}
          name="title"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={state.values.title}
          placeholder="iPhone 14 Pro 256 Grafito"
          aria-invalid={state.errors.title !== undefined}
          className={INPUT_CLASS}
        />
        <FieldError message={state.errors.title} />
      </div>

      <div>
        <label htmlFor={modelId} className="block text-sm font-medium">
          Modelo
        </label>
        <select
          id={modelId}
          name="catalogModelId"
          data-testid="select-catalog-model"
          required
          defaultValue={state.values.catalogModelId}
          aria-invalid={state.errors.catalogModelId !== undefined}
          className={INPUT_CLASS}
        >
          <option value="">Elegí el modelo</option>
          {byFamily(catalogModels).map(([family, models]) => (
            <optgroup key={family} label={family}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError message={state.errors.catalogModelId} />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Sin modelo no lo vas a poder publicar: es lo que deja filtrar tu vidriera.
        </p>
      </div>

      <div>
        <label htmlFor={conditionId} className="block text-sm font-medium">
          En qué estado está
        </label>
        <select
          id={conditionId}
          name="condition"
          required
          defaultValue={state.values.condition}
          aria-invalid={state.errors.condition !== undefined}
          className={INPUT_CLASS}
        >
          <option value="">Elegí una…</option>
          {CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {conditionLabel(condition)}
            </option>
          ))}
        </select>
        <FieldError message={state.errors.condition} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={storageId} className="block text-sm font-medium">
            GB
          </label>
          <input
            id={storageId}
            name="storageGb"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={state.values.storageGb}
            placeholder="256"
            aria-invalid={state.errors.storageGb !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.storageGb} />
        </div>
        <div>
          <label htmlFor={colorId} className="block text-sm font-medium">
            Color
          </label>
          <input
            id={colorId}
            name="color"
            type="text"
            maxLength={40}
            autoComplete="off"
            defaultValue={state.values.color}
            placeholder="Grafito"
            aria-invalid={state.errors.color !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.color} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={priceId} className="block text-sm font-medium">
            Precio USD
          </label>
          <input
            id={priceId}
            name="priceUsd"
            type="text"
            required
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.priceUsd}
            placeholder="620"
            aria-invalid={state.errors.priceUsd !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.priceUsd} />
        </div>
        <div>
          <label htmlFor={batteryId} className="block text-sm font-medium">
            Batería %
          </label>
          <input
            id={batteryId}
            name="batteryPct"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={state.values.batteryPct}
            placeholder="89"
            aria-invalid={state.errors.batteryPct !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.batteryPct} />
        </div>
      </div>

      <div>
        <label htmlFor={imeiId} className="block text-sm font-medium">
          IMEI
        </label>
        <input
          id={imeiId}
          name="imei"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          value={imei}
          onChange={(event) => setImei(event.target.value)}
          placeholder="352000000000000"
          aria-invalid={state.errors.imei !== undefined}
          className={INPUT_CLASS}
        />
        <FieldError message={state.errors.imei} />
        {state.errors.imei === undefined && imeiWarning !== null ? (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{imeiWarning}</p>
        ) : null}
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Queda sólo para vos: no se muestra en tu vidriera ni se le pasa a nadie.
        </p>
      </div>

      {canWriteCost ? (
        <div>
          <label htmlFor={costId} className="block text-sm font-medium">
            Cuánto te costó (USD)
          </label>
          <input
            id={costId}
            name="costUsd"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.costUsd}
            placeholder="540"
            aria-invalid={state.errors.costUsd !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.costUsd} />
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Lo ves sólo vos, el dueño. No sale en la vidriera ni lo ven tus vendedores.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor={descriptionId} className="block text-sm font-medium">
          Algo más que quieras contar
        </label>
        <textarea
          id={descriptionId}
          name="description"
          rows={3}
          defaultValue={state.values.description}
          placeholder="Pantalla original, caja y cargador, sin detalles."
          aria-invalid={state.errors.description !== undefined}
          className={INPUT_CLASS}
        />
        <FieldError message={state.errors.description} />
      </div>

      <div>
        <PhotoInput
          name="photo"
          testId="input-foto"
          label="Primera foto"
          accept={photoAccept}
          maxBytes={maxPhotoBytes}
          maxMb={maxPhotoMb}
          required
          invalid={state.errors.photo !== undefined}
          hint={`Va una por vez. Cuando guardes te llevamos a cargar las otras: para publicarlo necesitás ${String(minPhotosToPublish)}.`}
          onBusyChange={setPhotoBusy}
          onBlockedChange={setPhotoBlocked}
        />
        <FieldError message={state.errors.photo} />
        {state.photoLost ? (
          <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            Volvé a elegir la foto: el navegador no la guarda cuando algo falla.
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="submit-nueva-unidad"
        disabled={isPending || photoBusy || photoBlocked}
        className="w-full rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {photoBusy
          ? 'Achicando la foto…'
          : photoBlocked
            ? 'Elegí otra foto'
            : isPending
              ? 'Guardando…'
              : 'Guardar equipo'}
      </button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Se guarda como borrador. No entra a tu vidriera hasta que lo publiques.
      </p>
    </form>
  );
}
