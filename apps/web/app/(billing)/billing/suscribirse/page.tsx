import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireOwner } from '../../../(app)/_lib/session';
import { billingDriver } from '../../_lib/env';
import { parseSubscriptionRequest } from '../../_lib/subscribe';
import { formatMonthlyUsd, PLAN_CATALOG } from '../../_lib/plans';

export const metadata: Metadata = { title: 'Confirmar suscripción' };

type SubscribePageProps = {
  readonly searchParams: Promise<{ readonly plan?: string | string[] }>;
};

/**
 * Confirmación server-side para el CTA del panel. El query string sólo preselecciona el plan;
 * crear la suscripción sigue siendo un POST explícito al handler protegido.
 */
export default function SubscribePage({ searchParams }: SubscribePageProps) {
  return (
    <Suspense fallback={<SubscribeSkeleton />}>
      <SubscribeContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SubscribeContent({ searchParams }: SubscribePageProps) {
  const { tenant } = await requireOwner();
  const params = await searchParams;
  const rawPlan = Array.isArray(params.plan) ? null : params.plan;
  const requested = parseSubscriptionRequest({ plan: rawPlan ?? '' });

  if (requested === null) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Elegí un plan válido</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Volvé a la pantalla de suscripción y elegí Base o Negocio.
        </p>
        <a
          href="/billing"
          className="mt-5 inline-flex min-h-[48px] items-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900"
        >
          Ver planes
        </a>
      </main>
    );
  }

  const spec = PLAN_CATALOG[requested.plan];
  const paymentsEnabled = billingDriver() === 'mercadopago';

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{tenant.name}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Confirmá tu plan</h1>
      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xl font-semibold">{spec.label}</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {formatMonthlyUsd(requested.plan)} por mes
        </p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          {paymentsEnabled
            ? 'Vas a completar el alta en Mercado Pago. Podés usar dinero disponible o tarjeta de débito; nosotros no recibimos datos de tarjeta.'
            : 'Los pagos están pausados por ahora porque esta instalación está usando únicamente servicios gratuitos.'}
        </p>
        <form method="post" action="/billing/subscribe" className="mt-5">
          <input type="hidden" name="plan" value={requested.plan} />
          <button
            type="submit"
            disabled={!paymentsEnabled}
            className="min-h-[52px] w-full rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
          >
            {paymentsEnabled ? 'Continuar a Mercado Pago' : 'Pagos próximamente'}
          </button>
        </form>
      </section>
    </main>
  );
}

function SubscribeSkeleton() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-8" aria-hidden="true">
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-10 w-56 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-48 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </main>
  );
}
