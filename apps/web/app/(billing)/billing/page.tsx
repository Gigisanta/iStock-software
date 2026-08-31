import { Suspense } from 'react';
import type { Metadata } from 'next';
import { formatMonthlyUsd, PAID_PLAN_TIERS, PLAN_CATALOG } from '../_lib/plans';
import { requireOwner } from '../../(app)/_lib/session';

export const metadata: Metadata = { title: 'Suscripción' };

/** Página server-side: el navegador sólo recibe formularios HTML, sin secretos ni tokens de MP. */
export default function BillingPage() {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingContent />
    </Suspense>
  );
}

async function BillingContent() {
  const { tenant } = await requireOwner();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{tenant.name}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Elegí tu plan</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        Te llevamos a Mercado Pago para completar la suscripción. Podés usar dinero disponible o
        tarjeta de débito; nosotros no recibimos datos de tarjeta.
      </p>

      <div className="mt-6 grid gap-4">
        {PAID_PLAN_TIERS.map((plan) => {
          const spec = PLAN_CATALOG[plan];
          return (
            <form
              key={plan}
              method="post"
              action="/billing/subscribe"
              className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{spec.label}</h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    {formatMonthlyUsd(plan)} por mes
                  </p>
                </div>
                <input type="hidden" name="plan" value={plan} />
                <button
                  type="submit"
                  className="min-h-[48px] shrink-0 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900"
                >
                  Elegir {spec.label}
                </button>
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
        Tu prueba de 14 días no se cobra automáticamente desde esta pantalla. El estado se confirma
        cuando Mercado Pago notifica la suscripción.
      </p>
    </main>
  );
}

function BillingSkeleton() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-8" aria-hidden="true">
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-10 w-56 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </main>
  );
}
