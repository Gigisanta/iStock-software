'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { RESERVED_SLUGS, SLUG_PATTERN, normalizeSlug, suggestSlug } from '../../_lib/slug-format';
import { createTenantAction } from './actions';
import { initialCreateTenantState } from './form-state';

/**
 * Alta del negocio. `"use client"` justificado: hay tres interacciones reales (sugerir el link a
 * partir del nombre, chequear disponibilidad mientras se escribe, y el estado de envío).
 *
 * Importa de `slug-format` y **no** de `slug.ts`: el primero es puro y el segundo arrastra Zod al
 * bundle del navegador. La validación que decide es la del server; esta es sólo para no hacerle
 * perder un viaje a alguien parado en el mostrador.
 *
 * El formulario anda sin JavaScript: `<form action={...}>` postea igual y la Server Action valida
 * todo de nuevo. Lo que se pierde sin JS son las ayudas, no la funcionalidad.
 */

type Availability =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'free' }
  | { readonly state: 'taken'; readonly reason: string };

const DEBOUNCE_MS = 600;

/** Mismo criterio que el server, sin Zod: no gastamos un request si el formato ya es inválido. */
function looksValid(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

export function CreateTenantForm({ rootDomain }: { rootDomain: string }) {
  const [state, formAction, isPending] = useActionState(createTenantAction, initialCreateTenantState);

  const [name, setName] = useState(state.values.name);
  const [slug, setSlug] = useState(state.values.slug);
  const [slugTouched, setSlugTouched] = useState(state.values.slug !== '');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });

  const nameId = useId();
  const slugId = useId();
  const phoneId = useId();

  const effectiveSlug = slugTouched ? normalizeSlug(slug) : suggestSlug(name);

  useEffect(() => {
    if (!looksValid(effectiveSlug)) {
      setAvailability({ state: 'idle' });
      return;
    }

    setAvailability({ state: 'checking' });
    const controller = new AbortController();

    const timer = setTimeout(() => {
      fetch(`/api/tenants/slug-check?slug=${encodeURIComponent(effectiveSlug)}`, {
        signal: controller.signal,
      })
        .then(async (response) => (await response.json()) as { available?: boolean; reason?: string })
        .then((body) => {
          setAvailability(
            body.available === true
              ? { state: 'free' }
              : { state: 'taken', reason: body.reason ?? 'Ese link no está disponible.' },
          );
        })
        .catch(() => {
          // Si falla la consulta no se bloquea el alta: el `unique index` de Postgres tiene la
          // última palabra igual. Perder la ayuda no puede impedir crear el negocio.
          setAvailability({ state: 'idle' });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [effectiveSlug]);

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium">
          Nombre de tu negocio
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          required
          maxLength={60}
          autoComplete="organization"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Norte Cel"
          aria-invalid={state.errors.name !== undefined}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white"
        />
        {state.errors.name === undefined ? null : (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {state.errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={slugId} className="block text-sm font-medium">
          El link de tu vidriera
        </label>
        <div className="mt-1.5 flex items-center rounded-xl border border-neutral-300 bg-white focus-within:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-white">
          <input
            id={slugId}
            name="slug"
            type="text"
            required
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            placeholder="nortecel"
            aria-invalid={state.errors.slug !== undefined}
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-base outline-none"
          />
          <span className="shrink-0 pr-4 text-sm text-neutral-500 dark:text-neutral-400">
            .{rootDomain}
          </span>
        </div>

        <p aria-live="polite" className="mt-2 text-sm">
          {state.errors.slug !== undefined ? (
            <span className="font-medium text-red-600">{state.errors.slug}</span>
          ) : availability.state === 'checking' ? (
            <span className="text-neutral-500 dark:text-neutral-400">Fijándonos…</span>
          ) : availability.state === 'free' ? (
            <span className="font-medium text-emerald-600">Está libre.</span>
          ) : availability.state === 'taken' ? (
            <span className="font-medium text-red-600">{availability.reason}</span>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-400">
              Minúsculas, números y guiones. Después no se puede cambiar.
            </span>
          )}
        </p>
      </div>

      <div>
        <label htmlFor={phoneId} className="block text-sm font-medium">
          WhatsApp donde te escriben
        </label>
        <input
          id={phoneId}
          name="waPhone"
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel"
          defaultValue={state.values.waPhone}
          placeholder="299 555 1234"
          aria-invalid={state.errors.waPhone !== undefined}
          className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-white"
        />
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {state.errors.waPhone ??
            'Con característica, sin el 0 ni el 15. Ejemplo: 299 555 1234. Le agregamos el +54 9 nosotros.'}
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <input
          type="checkbox"
          name="acceptsTradeIn"
          defaultChecked={state.values.acceptsTradeIn}
          className="mt-0.5 size-5 shrink-0"
        />
        <span className="text-sm">
          <strong className="font-semibold">Tomo equipos en canje.</strong>
          <span className="mt-0.5 block text-neutral-500 dark:text-neutral-400">
            Lo mostramos en tu vidriera para que el cliente lo sepa antes de escribirte.
          </span>
        </span>
      </label>

      {state.errors.form === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.errors.form}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || availability.state === 'taken'}
        className="w-full rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {isPending ? 'Creando…' : 'Crear mi negocio'}
      </button>
    </form>
  );
}
