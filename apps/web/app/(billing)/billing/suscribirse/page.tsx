import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { formatArs } from '@istock/domain';
import { selectedPlanFromSearchParams } from '../../../(app)/_lib/auth/selected-plan';
import { loadFxSettings } from '../../../(app)/_lib/tenants/queries';
import { getPanelSession } from '../../../(app)/_lib/session';
import { panelTenantName } from '../../../(app)/_lib/tenants/panel-identity';
import { billingReady } from '../../_lib/env';
import { monthlySubscriptionAmountArsCents, parseSubscriptionRequest } from '../../_lib/subscribe';
import { formatMonthlyUsd, PLAN_CATALOG } from '../../_lib/plans';
import { SubscriptionSubmitButton } from '../../_ui/subscription-submit-button';

export const metadata: Metadata = {
  title: 'Confirmar suscripción',
  robots: { index: false, follow: false },
};

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
  const params = await searchParams;
  const rawPlan = Array.isArray(params.plan) ? null : params.plan;
  const selectedPlan = selectedPlanFromSearchParams({ plan: rawPlan });
  const requested = parseSubscriptionRequest({ plan: selectedPlan ?? '' });

  if (requested === null) {
    return (
      <main className="billing-shell">
        <h1 className="text-2xl font-semibold">Elegí un plan válido</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Volvé a la pantalla de suscripción y elegí Base o Pro.
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

  const session = await getPanelSession();
  if (session === null) redirect(`/ingresar?plan=${requested.plan}`);
  if (session.tenant === null) redirect(`/app/crear-negocio?plan=${requested.plan}`);
  if (session.role !== 'owner') {
    return (
      <main className="billing-shell">
        <h1 className="text-2xl font-semibold">No tenés permiso para suscribirte</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Sólo la persona dueña del negocio puede administrar el plan.
        </p>
      </main>
    );
  }
  if (session.tenant.plan !== 'trial') {
    return (
      <main className="billing-shell">
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Suscripción</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tu plan ya está activo</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          No hace falta iniciar otra suscripción desde este enlace.
        </p>
      </main>
    );
  }
  const { tenant } = session;

  const spec = PLAN_CATALOG[requested.plan];
  const billingConfigured = billingReady();
  let fx: Awaited<ReturnType<typeof loadFxSettings>> = null;
  try {
    fx = await loadFxSettings({
      userId: session.identity.userId,
      tenantId: tenant.id,
      role: 'owner',
    });
  } catch {
    // El POST vuelve a leer y valida el TC; la pantalla no muestra un precio inventado.
  }
  const amountArsCents = fx === null ? null : monthlySubscriptionAmountArsCents(requested.plan, fx);
  const paymentsEnabled = billingConfigured && amountArsCents !== null;

  return (
    <main className="billing-shell">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{panelTenantName(tenant)}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Confirmá tu plan</h1>
      <section className="billing-plan mt-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xl font-semibold">{spec.label}</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {formatMonthlyUsd(requested.plan)} por mes de referencia
        </p>
        <p className="mt-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {amountArsCents === null
            ? 'El importe en pesos se confirma al continuar'
            : `${formatArs(amountArsCents)} por mes al adherirte`}
        </p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          {paymentsEnabled
            ? 'Vas a completar el alta en Mercado Pago. Elegís el medio disponible allí; después MP gestiona el débito mensual en pesos. Nosotros no recibimos datos de tarjeta.'
            : fx === null || amountArsCents === null
              ? 'No pudimos actualizar el importe en pesos. Volvé a intentar en unos minutos.'
              : 'Los pagos están pausados por ahora porque esta instalación está usando únicamente servicios gratuitos.'}
        </p>
        {fx === null ? (
          <a
            href={`/billing/suscribirse?plan=${requested.plan}`}
            className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-neutral-300 px-6 text-base font-semibold dark:border-neutral-700"
          >
            Reintentar
          </a>
        ) : (
          <form method="post" action="/billing/subscribe" className="mt-5">
            <input type="hidden" name="plan" value={requested.plan} />
            <SubscriptionSubmitButton
              disabled={!paymentsEnabled}
              label="Continuar a Mercado Pago"
              className="w-full"
            />
          </form>
        )}
      </section>
    </main>
  );
}

function SubscribeSkeleton() {
  return (
    <main className="billing-shell billing-skeleton space-y-3" aria-hidden="true">
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-10 w-56 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-48 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </main>
  );
}
