'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { RESERVATION_MINUTE_OPTIONS } from '@istock/domain';
import type { TenantSettingsFormValues } from '../../../_lib/tenants/settings-schema';
import { panelTenantName } from '../../../_lib/tenants/panel-identity';
import { updateTenantSettingsAction } from './actions';
import { initialSettingsFormState } from './form-state';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white';

function FieldError({ message }: { message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

function valuesFor(settings: {
  readonly name: string;
  readonly isDemo: boolean;
  readonly waPhone: string;
  readonly paymentMethods: readonly string[];
  readonly acceptsTradeIn: boolean;
  readonly reservationMinutes: number;
  readonly pickup: { readonly name: string; readonly address: string; readonly hours: string } | null;
}): TenantSettingsFormValues {
  return {
    name: panelTenantName(settings),
    waPhone: `+${settings.waPhone}`,
    paymentMethods: settings.paymentMethods.join('\n'),
    acceptsTradeIn: settings.acceptsTradeIn,
    reservationMinutes: String(settings.reservationMinutes),
    pickupName: settings.pickup?.name ?? '',
    pickupAddress: settings.pickup?.address ?? '',
    pickupHours: settings.pickup?.hours ?? '',
  };
}

export function SettingsForm({
  settings,
}: {
  readonly settings: Parameters<typeof valuesFor>[0];
}) {
  const initial = valuesFor(settings);
  const [state, formAction, isPending] = useActionState(
    updateTenantSettingsAction,
    initialSettingsFormState(initial),
  );
  const [values, setValues] = useState(initial);
  const nameId = useId();
  const phoneId = useId();
  const methodsId = useId();
  const reservationMinutesId = useId();
  const pickupNameId = useId();
  const pickupAddressId = useId();
  const pickupHoursId = useId();

  useEffect(() => {
    setValues(state.values);
  }, [state.values]);

  return (
    <form action={formAction} className="panel-settings-form mt-6 space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold">Lo que ven tus clientes</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          Estos datos aparecen en tu vidriera y en el botón de WhatsApp.
        </p>
      </div>

      {state.errors.form === undefined && state.status !== 'saved' ? null : (
        <p
          role={state.status === 'saved' ? 'status' : 'alert'}
          className={
            state.status === 'saved'
              ? 'rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
              : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
          }
        >
          {state.status === 'saved' ? 'Guardado. Tu vidriera ya tiene los datos nuevos.' : state.errors.form}
        </p>
      )}

      <div>
        <label htmlFor={nameId} className="block text-sm font-medium">Nombre del negocio</label>
        <input
          id={nameId}
          name="name"
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          className={INPUT_CLASS}
          autoComplete="organization"
          required
          aria-invalid={state.errors.name !== undefined}
        />
        <FieldError message={state.errors.name} />
      </div>

      <div>
        <label htmlFor={phoneId} className="block text-sm font-medium">WhatsApp</label>
        <input
          id={phoneId}
          name="waPhone"
          value={values.waPhone}
          onChange={(event) => setValues((current) => ({ ...current, waPhone: event.target.value }))}
          className={INPUT_CLASS}
          inputMode="tel"
          autoComplete="tel"
          required
          aria-invalid={state.errors.waPhone !== undefined}
        />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Ejemplo: +54 9 299 555 1234.</p>
        <FieldError message={state.errors.waPhone} />
      </div>

      <div>
        <label htmlFor={methodsId} className="block text-sm font-medium">Medios de pago</label>
        <textarea
          id={methodsId}
          name="paymentMethods"
          value={values.paymentMethods}
          onChange={(event) => setValues((current) => ({ ...current, paymentMethods: event.target.value }))}
          className={INPUT_CLASS}
          rows={3}
          placeholder="Efectivo USD\nTransferencia ARS"
          aria-invalid={state.errors.paymentMethods !== undefined}
        />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Uno por línea. También podés separarlos con comas.</p>
        <FieldError message={state.errors.paymentMethods} />
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        <input
          type="checkbox"
          name="acceptsTradeIn"
          checked={values.acceptsTradeIn}
          onChange={(event) => setValues((current) => ({ ...current, acceptsTradeIn: event.target.checked }))}
          className="mt-1 h-5 w-5 accent-neutral-900"
        />
        <span>
          <span className="block text-sm font-semibold">Tomo equipos en canje</span>
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">Muestra el formulario de canje en la vidriera.</span>
        </span>
      </label>

      <fieldset className="space-y-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <legend className="text-lg font-semibold">Cómo trabajás</legend>
        <div>
          <label htmlFor={reservationMinutesId} className="block text-sm font-medium">
            Duración inicial de una reserva
          </label>
          <select
            id={reservationMinutesId}
            name="reservationMinutes"
            value={values.reservationMinutes}
            onChange={(event) => setValues((current) => ({ ...current, reservationMinutes: event.target.value }))}
            className={INPUT_CLASS}
            aria-invalid={state.errors.reservationMinutes !== undefined}
          >
            {RESERVATION_MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes === 30 ? '30 minutos' : minutes === 60 ? '1 hora' : minutes === 90 ? '1 hora y media' : '2 horas'}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Es la opción que aparece al tocar Reservar. Si hace falta, la podés cambiar por equipo.
          </p>
          <FieldError message={state.errors.reservationMinutes} />
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <legend className="text-lg font-semibold">Punto de retiro</legend>
        <p className="-mt-2 text-sm text-neutral-600 dark:text-neutral-300">Podés cambiarlo cuando mudás el local o el horario.</p>

        <div>
          <label htmlFor={pickupNameId} className="block text-sm font-medium">Nombre del punto</label>
          <input id={pickupNameId} name="pickupName" value={values.pickupName} onChange={(event) => setValues((current) => ({ ...current, pickupName: event.target.value }))} className={INPUT_CLASS} required aria-invalid={state.errors.pickupName !== undefined} />
          <FieldError message={state.errors.pickupName} />
        </div>
        <div>
          <label htmlFor={pickupAddressId} className="block text-sm font-medium">Dirección o indicación</label>
          <input id={pickupAddressId} name="pickupAddress" value={values.pickupAddress} onChange={(event) => setValues((current) => ({ ...current, pickupAddress: event.target.value }))} className={INPUT_CLASS} required aria-invalid={state.errors.pickupAddress !== undefined} />
          <FieldError message={state.errors.pickupAddress} />
        </div>
        <div>
          <label htmlFor={pickupHoursId} className="block text-sm font-medium">Horario</label>
          <input id={pickupHoursId} name="pickupHours" value={values.pickupHours} onChange={(event) => setValues((current) => ({ ...current, pickupHours: event.target.value }))} className={INPUT_CLASS} required aria-invalid={state.errors.pickupHours !== undefined} />
          <FieldError message={state.errors.pickupHours} />
        </div>
      </fieldset>

      <button type="submit" disabled={isPending} className="w-full rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
        {isPending ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </form>
  );
}
