import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requestRootDomain } from '../../_lib/env';
import { selectedPlanFromSearchParams, SUBSCRIPTION_REDIRECTS } from '../../_lib/auth/selected-plan';
import { getPanelSession } from '../../_lib/session';
import { CreateTenantForm } from './create-tenant-form';

/**
 * Alta del negocio. Vive **fuera** del grupo `(panel)` a propósito: la chrome del panel muestra el
 * nombre del negocio y llama a `requireTenant()`, que redirige justo a esta página. Con el layout
 * compartido, entrar acá sería un loop de redirecciones.
 *
 * Tres campos y un check. Ni uno más. Es la única pantalla entre "me registré" y "tengo mi link",
 * y cada campo extra acá es gente que abandona antes de ver el producto. Los medios de pago y los
 * puntos de retiro se cargan después, desde Ajustes, cuando ya hay algo que mostrar; el tipo de
 * cambio se actualiza automáticamente una vez por día.
 */

export const metadata: Metadata = {
  title: 'Crear tu negocio',
  robots: { index: false, follow: false },
};

type CreateTenantPageProps = {
  readonly searchParams: Promise<{ readonly plan?: string | string[] }>;
};

export default function CreateTenantPage({ searchParams }: CreateTenantPageProps) {
  return (
    <div className="account-shell">
      <div className="account-panel">
        <Link href="/" className="marketing-brand marketing-logo" aria-label="iStock">
          <img src="/brand/logo-horizontal.svg" alt="" width="140" height="28" />
        </Link>
        <h1 className="mt-8">Creá tu negocio</h1>
        <p className="mt-2">
          Con esto queda armada tu vidriera. Son tres datos y después entrás al panel.
        </p>

      <Suspense fallback={<FormSkeleton />}>
        <CreateTenantGate searchParams={searchParams} />
      </Suspense>
      </div>
    </div>
  );
}

async function CreateTenantGate({ searchParams }: CreateTenantPageProps) {
  const params = await searchParams;
  const rawPlan = Array.isArray(params.plan) ? null : params.plan;
  const selectedPlan = selectedPlanFromSearchParams({ plan: rawPlan });

  // Autorización adentro de la página (ADR-007). La Server Action que crea el tenant repite el
  // chequeo por su cuenta: son dos superficies distintas y cada una se defiende sola.
  const session = await getPanelSession();
  if (session === null) {
    redirect(selectedPlan === null ? '/ingresar' : `/ingresar?plan=${selectedPlan}`);
  }
  if (session.tenant !== null) {
    redirect(selectedPlan === null ? '/app' : SUBSCRIPTION_REDIRECTS[selectedPlan]);
  }

  return <CreateTenantForm rootDomain={await requestRootDomain()} selectedPlan={selectedPlan} />;
}

function FormSkeleton() {
  return (
    <div className="mt-8 space-y-5" aria-hidden="true">
      <div className="h-[72px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-[72px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-[72px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
