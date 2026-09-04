'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { CONDITIONS, conditionLabel } from '@istock/domain';
import type { CatalogModelOption } from '../../../../_lib/catalog/queries';
import { buildUnitTitle } from '../../../../_lib/catalog/unit-title';
import { acceptTradeinAction } from './actions';
import {
  initialAcceptFormState,
  type AcceptFormState,
  type AcceptFormValues,
} from './accept-form-state';

/**
 * Aceptar el canje y meterlo al stock. `"use client"` justificado y acotado: hay una interacción
 * real —el estado de envío, porque aceptar escribe cuatro sentencias en una transacción y sin
 * feedback la gente aprieta dos veces— y `useActionState` para volver a pintar los errores por
 * campo sin perder lo escrito.
 *
 * **Anda sin JavaScript.** Es un `<form action={...}>` común: postea, la Server Action valida todo
 * de nuevo y responde. Lo único que se pierde sin JS es el "Aceptando…" del botón. Y el doble
 * submit tampoco duplica nada: el guard de concurrencia está en el `where` del `update`
 * (`accept-to-stock.ts`), no en este `disabled`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Este formulario NO se le dibuja a un `seller`, y eso no es lo que lo protege
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lo protegen dos chequeos de rol del lado del server: en `acceptTradeinAction()` y adentro de
 * `acceptToStock()`. No dibujarlo es cortesía de UI. `CLAUDE.md` §0.9 se cumple en el server o no
 * se cumple.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los valores vienen PRECARGADOS del lead, y son del visitante
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El visitante pudo escribir cualquier cosa desde el teléfono, sin que nadie mire el equipo. El
 * dueño elige el modelo real del catálogo y, a partir de ahí, recibe sólo sus capacidades y
 * colores válidos. La condición **no** se precarga a ciegas — arranca en la declarada, pero el
 * `<select>` es el mismo del alta, con las cinco. El título se deriva de esas elecciones.
 *
 * ── Mobile-first ─────────────────────────────────────────────────────────────────────────────
 * Se usa parado en el mostrador con el cliente enfrente: campos apilados, `text-base` (menos de
 * 16px hace que iOS haga zoom al enfocar), teclado numérico donde corresponde, botón ancho al
 * final. Plata con `inputMode="decimal"` y `type="text"`: un `type="number"` rechaza la coma en
 * los teclados que la usan como separador decimal.
 */

export interface AcceptFormProps {
  readonly leadId: string;
  readonly catalogModels: readonly CatalogModelOption[];
  /** Lo que declaró el visitante, listo para corregir. */
  readonly prefill: AcceptFormValues;
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

/** El orden en que se cita el error de arriba: el primero que aparezca gana. */
const ERROR_ORDER = [
  'form',
  'leadId',
  'catalogModelId',
  'condition',
  'priceUsd',
  'offerUsd',
  'storageGb',
  'color',
  'batteryPct',
] as const;

function firstError(state: AcceptFormState): string | null {
  for (const field of ERROR_ORDER) {
    const message = state.errors[field];
    if (message !== undefined) return message;
  }
  return null;
}

/** Agrupa el catálogo por familia. Cuarenta modelos planos en un `<select>` de teléfono no se leen. */
function byFamily(
  models: readonly CatalogModelOption[],
): readonly (readonly [string, readonly CatalogModelOption[]])[] {
  const groups = new Map<string, CatalogModelOption[]>();
  for (const model of models) {
    const list = groups.get(model.family) ?? [];
    list.push(model);
    groups.set(model.family, list);
  }
  return [...groups.entries()];
}

export function AcceptForm({ leadId, catalogModels, prefill }: AcceptFormProps) {
  const [state, formAction, isPending] = useActionState(acceptTradeinAction, initialAcceptFormState);

  // El eco del último intento gana sobre la precarga: si falló, la persona ve lo que escribió ella.
  const values = state.values ?? prefill;

  const [selectedModelId, setSelectedModelId] = useState(values.catalogModelId);
  const [storageGb, setStorageGb] = useState(values.storageGb);
  const [color, setColor] = useState(values.color);

  // Server Actions vuelven con los valores del POST cuando algo falla. Rehidratar los tres
  // controles evita que el navegador muestre una variante distinta de la que se va a reintentar.
  useEffect(() => {
    if (state.values === null) return;
    setSelectedModelId(state.values.catalogModelId);
    setStorageGb(state.values.storageGb);
    setColor(state.values.color);
  }, [state.values]);

  const titleId = useId();
  const modelId = useId();
  const conditionId = useId();
  const storageId = useId();
  const colorId = useId();
  const batteryId = useId();
  const priceId = useId();
  const offerId = useId();

  const topError = firstError(state);
  const selectedModel = catalogModels.find((model) => model.id === selectedModelId);
  const storageOptions = selectedModel?.storageOptionsGb ?? [];
  const colorOptions = selectedModel?.colors ?? [];
  const selectedStorageGb =
    selectedModel === undefined || storageGb === '' || !storageOptions.includes(Number(storageGb))
      ? null
      : Number(storageGb);
  const selectedColor = selectedModel?.colors.includes(color) === true ? color : null;
  const generatedTitle =
    selectedModel === undefined
      ? ''
      : buildUnitTitle(selectedModel.displayName, selectedStorageGb, selectedColor);

  return (
    <form data-testid="form-aceptar-canje" action={formAction} className="mt-2 space-y-5" noValidate>
      <input type="hidden" name="leadId" value={leadId} />

      {topError === null ? null : (
        <p
          data-testid="error-canje"
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {topError}
        </p>
      )}

      <div>
        <label htmlFor={modelId} className="block text-sm font-medium">
          Modelo
        </label>
        <select
          id={modelId}
          name="catalogModelId"
          data-testid="select-catalog-model"
          required
          value={selectedModelId}
          onChange={(event) => {
            setSelectedModelId(event.target.value);
            setStorageGb('');
            setColor('');
          }}
          disabled={catalogModels.length === 0}
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
        {catalogModels.length === 0 ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            Todavía no hay modelos cargados. Actualizá la pantalla en unos segundos.
          </p>
        ) : (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Elegí el modelo que tenés en la mano; el nombre se arma solo.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={conditionId} className="block text-sm font-medium">
          En qué estado está de verdad
        </label>
        <select
          id={conditionId}
          name="condition"
          required
          defaultValue={values.condition}
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
          <select
            id={storageId}
            name="storageGb"
            value={storageGb}
            onChange={(event) => setStorageGb(event.target.value)}
            disabled={selectedModel === undefined}
            aria-invalid={state.errors.storageGb !== undefined}
            className={INPUT_CLASS}
          >
            <option value="">
              {selectedModel === undefined ? 'Elegí un modelo primero' : 'No especificado'}
            </option>
            {storageOptions.map((option) => (
              <option key={option} value={String(option)}>
                {String(option)} GB
              </option>
            ))}
          </select>
          <FieldError message={state.errors.storageGb} />
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
            defaultValue={values.batteryPct}
            placeholder="87"
            aria-invalid={state.errors.batteryPct !== undefined}
            className={INPUT_CLASS}
          />
          <FieldError message={state.errors.batteryPct} />
        </div>
      </div>

      <div>
        <label htmlFor={colorId} className="block text-sm font-medium">
          Color
        </label>
          <select
            id={colorId}
            name="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={selectedModel === undefined}
            aria-invalid={state.errors.color !== undefined}
            className={INPUT_CLASS}
        >
          <option value="">
            {selectedModel === undefined ? 'Elegí un modelo primero' : 'No especificado'}
          </option>
          {colorOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <FieldError message={state.errors.color} />
      </div>

      <div>
        <label htmlFor={titleId} className="block text-sm font-medium">
          Así va a figurar
        </label>
        <input
          id={titleId}
          name="title"
          type="text"
          readOnly
          maxLength={120}
          value={generatedTitle}
          placeholder="Elegí el modelo"
          aria-live="polite"
          className={`${INPUT_CLASS} bg-neutral-50 dark:bg-neutral-950`}
        />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Lo armamos con el catálogo. No tenés que escribir el nombre del equipo.
        </p>
      </div>

      <div>
        <label htmlFor={offerId} className="block text-sm font-medium">
          Cuánto le pagás (USD)
        </label>
        <input
          id={offerId}
          name="offerUsd"
          type="text"
          inputMode="decimal"
          required
          autoComplete="off"
          defaultValue={values.offerUsd}
          placeholder="420"
          aria-invalid={state.errors.offerUsd !== undefined}
          className={INPUT_CLASS}
        />
        <FieldError message={state.errors.offerUsd} />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Es el costo del equipo. Queda guardado en la unidad y no lo ve nadie más que vos.
        </p>
      </div>

      <div>
        <label htmlFor={priceId} className="block text-sm font-medium">
          A cuánto lo vas a publicar (USD)
        </label>
        <input
          id={priceId}
          name="priceUsd"
          type="text"
          inputMode="decimal"
          required
          autoComplete="off"
          defaultValue={values.priceUsd}
          placeholder="560"
          aria-invalid={state.errors.priceUsd !== undefined}
          className={INPUT_CLASS}
        />
        <FieldError message={state.errors.priceUsd} />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="min-h-[52px] w-full rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {isPending ? 'Aceptando…' : 'Aceptar y cargar al stock'}
      </button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Entra como borrador. Después le sacás las fotos y lo publicás.
      </p>
    </form>
  );
}
