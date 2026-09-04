'use client';

import { useActionState } from 'react';
import { signInAction } from '../_lib/auth/actions';
import { initialAuthFormStateForPlan } from '../_lib/auth/form-state';
import type { SelectedPlan } from '../_lib/auth/selected-plan';

/**
 * `"use client"` justificado: hay interacción real (submit con estado pendiente y error por
 * campo). Es uno de los tres o cuatro componentes de cliente que va a tener el panel entero.
 *
 * El `<form action={...}>` funciona **sin JavaScript**: si el bundle no cargó todavía —que es lo
 * normal en un celular con señal de mierda en un local— el navegador postea igual y la Server
 * Action corre. Por eso el `disabled` del botón depende de `isPending` y no de un `useState`
 * propio: no hay estado que sincronizar.
 */
export function SignInForm({
  developmentDriver,
  selectedPlan,
}: {
  developmentDriver: boolean;
  selectedPlan: SelectedPlan | null;
}) {
  const [state, formAction, isPending] = useActionState(
    signInAction,
    initialAuthFormStateForPlan(selectedPlan),
  );

  return (
    <form action={formAction} className="account-form mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Tu mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
          aria-invalid={state.error !== null}
          aria-describedby={state.error !== null ? 'email-error' : undefined}
          placeholder="vos@tunegocio.com.ar"
          className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white"
        />
        {state.error !== null ? (
          <p id="email-error" role="alert" className="mt-2 text-sm font-medium text-red-600">
            {state.error}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={128}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white"
        />
      </div>

      <input type="hidden" name="plan" value={state.selectedPlan ?? ''} />
      {state.selectedPlan === null ? null : (
        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          Elegiste el plan {state.selectedPlan === 'base' ? 'Base' : 'Pro'}. Después de entrar vas
          a poder suscribirte.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="submit"
          name="mode"
          value="sign_in"
          disabled={isPending}
          className="w-full rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {isPending ? 'Procesando…' : 'Entrar'}
        </button>
        <button
          type="submit"
          name="mode"
          value="sign_up"
          disabled={isPending}
          className="w-full rounded-xl border border-neutral-300 px-6 py-3.5 text-base font-semibold disabled:opacity-60 dark:border-neutral-700"
        >
          Crear cuenta
        </button>
      </div>

      {state.status === 'link_sent' ? (
        <p
          role="status"
          className="rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          Cuenta lista. Ya podés entrar al panel
          {state.selectedPlan === null ? '.' : ' y seguir con el plan que elegiste.'}
        </p>
      ) : null}

      {developmentDriver ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
          <strong className="font-semibold">Modo desarrollo.</strong> Entrás directo con el mail,
          sin proveedor externo. En producción Neon Auth verifica tu contraseña.
        </p>
      ) : null}
    </form>
  );
}
