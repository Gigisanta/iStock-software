import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireTenant } from '../../../_lib/session';
import { NotReadyYet, PageTitle } from '../_ui/section';

/**
 * Canjes (trade-in). Es un flujo de primera clase del producto, no una nota al pie
 * (`PRODUCT.md` §Realidad local), y por eso ya tiene su lugar en la barra de abajo aunque la
 * pantalla esté vacía: el orden de la navegación es una promesa sobre qué importa.
 */

export const metadata: Metadata = { title: 'Canjes' };

export default function TradeInPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />}>
      <TradeInContent />
    </Suspense>
  );
}

async function TradeInContent() {
  await requireTenant();

  return (
    <>
      <PageTitle>Canjes</PageTitle>
      <NotReadyYet what="Acá te van a llegar los datos del equipo que el cliente quiere entregar, antes de que se tome el colectivo hasta tu local." />
    </>
  );
}
