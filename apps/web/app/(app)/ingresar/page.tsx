import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { authDriver } from '../_lib/auth/driver';
import {
  selectedPlanFromSearchParams,
  SUBSCRIPTION_REDIRECTS,
  type SelectedPlan,
} from '../_lib/auth/selected-plan';
import { getPanelSession } from '../_lib/session';
import { SignInForm } from './sign-in-form';

/**
 * Ingreso al panel. No hay pantalla de "registro" aparte: en Capa 1 el mail te crea la cuenta si
 * no existe y te hace entrar si existe. Dos formularios idénticos con dos títulos distintos es
 * una decisión de diseño que sólo sirve para que alguien elija el equivocado.
 *
 * `noindex`: es una pantalla de sesión, no tiene nada que hacer en Google.
 */

export const metadata: Metadata = {
  title: 'Ingresar',
  robots: { index: false, follow: false },
};

type SignInPageProps = {
  searchParams: Promise<{ plan?: string | string[] | undefined }>;
};

export default function SignInPage({ searchParams }: SignInPageProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        iStock
      </Link>

      <h1 className="mt-8 text-2xl font-bold tracking-tight">Entrá a tu panel</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        Si es la primera vez, con esto mismo te creamos la cuenta.
      </p>

      {/*
        `cacheComponents` está prendido en `next.config.ts`: todo lo que lea cookies tiene que ir
        adentro de un `<Suspense>`, o el prerender falla. El envoltorio no es ceremonia — es lo que
        deja el encabezado estático y manda a la función sólo el pedazo que depende de la sesión.
      */}
      <Suspense fallback={<FormSkeleton />}>
        <SignInGate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * Una query por visita a esta pantalla (resolver la sesión). Es aceptable: `/ingresar` la ve una
 * persona por día por tenant, no un visitante anónimo. La vidriera, que sí tiene volumen, no
 * comparte nada de este camino.
 */
async function SignInGate({ searchParams }: SignInPageProps) {
  const selectedPlan: SelectedPlan | null = selectedPlanFromSearchParams(await searchParams);
  const session = await getPanelSession();
  if (session !== null) {
    redirect(selectedPlan === null ? '/app' : SUBSCRIPTION_REDIRECTS[selectedPlan]);
  }

  return <SignInForm developmentDriver={authDriver().isDevelopmentOnly} selectedPlan={selectedPlan} />;
}

function FormSkeleton() {
  return (
    <div className="mt-8 space-y-4" aria-hidden="true">
      <div className="h-[68px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-[52px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
