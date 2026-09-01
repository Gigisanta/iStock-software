import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { rootDomain } from '../../_lib/env';
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

export default function CreateTenantPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Creá tu negocio</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        Con esto queda armada tu vidriera. Son tres datos y después entrás al panel.
      </p>

      <Suspense fallback={<FormSkeleton />}>
        <CreateTenantGate />
      </Suspense>
    </div>
  );
}

async function CreateTenantGate() {
  // Autorización adentro de la página (ADR-007). La Server Action que crea el tenant repite el
  // chequeo por su cuenta: son dos superficies distintas y cada una se defiende sola.
  const session = await getPanelSession();
  if (session === null) redirect('/ingresar');
  if (session.tenant !== null) redirect('/app');

  return <CreateTenantForm rootDomain={rootDomain()} />;
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
