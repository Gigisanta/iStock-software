import { Suspense } from 'react';
import type { Metadata } from 'next';
import { formatArs } from '@istock/domain';
import { loadFxSettings } from '../../(app)/_lib/tenants/queries';
import { formatMonthlyUsd, PAID_PLAN_TIERS, PLAN_CATALOG } from '../_lib/plans';
import { billingReady } from '../_lib/env';
import { monthlySubscriptionAmountArsCents } from '../_lib/subscribe';
import { requireOwner } from '../../(app)/_lib/session';
import { panelTenantName } from '../../(app)/_lib/tenants/panel-identity';
import { SubscriptionSubmitButton } from '../_ui/subscription-submit-button';

export const metadata: Metadata = {
  title: 'Suscripción',
  robots: { index: false, follow: false },
};

/** Página server-side: el navegador sólo recibe formularios HTML, sin secretos ni tokens de MP. */
type BillingPageProps = {
  readonly searchParams: Promise<{ readonly checkout?: string | string[] }>;
};

export default function BillingPage({ searchParams }: BillingPageProps) {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingContent({ searchParams }: BillingPageProps) {
  const params = await searchParams;
  const checkoutState = Array.isArray(params.checkout) ? null : params.checkout;
  const checkoutNotice =
    checkoutState === 'en-curso'
      ? 'Ya hay una contratación en curso. Si la abriste en otra pestaña, continuá desde ahí.'
      : checkoutState === 'otro-plan'
        ? 'Ya hay una contratación iniciada para otro plan. Terminá esa contratación o esperá su confirmación antes de cambiar de plan.'
        : checkoutState === 'verificar'
          ? 'No pudimos confirmar si el inicio del pago se completó. Esperá unos minutos antes de volver a intentar para evitar duplicar la suscripción.'
        : checkoutState === 'no-disponible'
          ? 'No pudimos preparar el pago. No se creó ningún cobro. Probá de nuevo en unos minutos.'
          : null;
  const { tenant, ctx } = await requireOwner();
  if (tenant.plan !== 'trial') {
    return <ActiveSubscription plan={tenant.plan} />;
  }

  const billingConfigured = billingReady();
  let fx: Awaited<ReturnType<typeof loadFxSettings>> = null;
  try {
    fx = await loadFxSettings(ctx);
  } catch {
    // La contratación vuelve a validar el TC y falla cerrado si la lectura no está disponible.
  }
  const paymentsEnabled = billingConfigured && fx !== null;

  return (
    <main className="billing-shell">
      {checkoutNotice !== null ? (
        <p
          className="billing-notice rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          role="status"
        >
          {checkoutNotice}
        </p>
      ) : null}
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{panelTenantName(tenant)}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Elegí tu plan</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        {paymentsEnabled
          ? 'Te llevamos a Mercado Pago para completar la suscripción. Elegís el medio disponible allí y, una vez autorizada, MP debita el importe en pesos cada mes. Nosotros no recibimos datos de tarjeta.'
          : fx === null
            ? 'No pudimos actualizar el importe en pesos. Volvé a intentar en unos minutos.'
            : 'La prueba gratuita está activa. Los pagos están pausados por ahora y se habilitarán cuando configuremos Mercado Pago.'}
      </p>

      <div className="mt-6 grid gap-4">
        {PAID_PLAN_TIERS.map((plan) => {
          const spec = PLAN_CATALOG[plan];
          const amountArsCents = fx === null ? null : monthlySubscriptionAmountArsCents(plan, fx);
          return (
            <form
              key={plan}
              method="post"
              action="/billing/subscribe"
              className="billing-plan rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{spec.label}</h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    {formatMonthlyUsd(plan)} por mes
                  </p>
                  <p className="mt-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {amountArsCents === null
                      ? 'El importe en pesos se confirma al continuar'
                      : `${formatArs(amountArsCents)} por mes al adherirte`}
                  </p>
                </div>
                <input type="hidden" name="plan" value={plan} />
                {fx === null ? (
                  <a
                    href="/billing"
                    className="inline-flex min-h-[48px] shrink-0 items-center rounded-xl border border-neutral-300 px-4 text-sm font-semibold dark:border-neutral-700"
                  >
                    Reintentar
                  </a>
                ) : (
                  <SubscriptionSubmitButton
                    disabled={!paymentsEnabled}
                    label={`Elegir ${spec.label}`}
                    pendingLabel="Conectando…"
                    className="min-h-[48px] shrink-0 px-4 text-sm"
                  />
                )}
              </div>
              <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
                {plan === 'base'
                  ? 'Stock, vidriera, WhatsApp y FX. Sin chatbot, reservas ni margen.'
                  : 'Chatbot, reservas, margen y hasta 3 puntos de retiro.'}
              </p>
            </form>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">
        {paymentsEnabled
          ? 'Tu prueba de 14 días no se cobra desde esta pantalla. Después de autorizarla, Mercado Pago gestiona los débitos mensuales y nosotros actualizamos tu acceso con sus notificaciones.'
          : fx === null
            ? 'No iniciamos ningún cobro porque todavía no tenemos un tipo de cambio válido.'
            : 'Tu prueba de 14 días no requiere tarjeta ni configura ningún débito automático.'}
      </p>
    </main>
  );
}

function ActiveSubscription({ plan }: { readonly plan: 'base' | 'negocio' }) {
  const spec = PLAN_CATALOG[plan];

  return (
    <main className="billing-shell">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Suscripción</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tu plan está activo</h1>
      <section className="billing-plan mt-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xl font-semibold">{spec.label}</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          No hace falta iniciar otra suscripción. Tu acceso se actualiza con las notificaciones de
          Mercado Pago.
        </p>
      </section>
    </main>
  );
}

function BillingSkeleton() {
  return (
    <main className="billing-shell billing-skeleton space-y-3" aria-hidden="true">
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-10 w-56 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </main>
  );
}
