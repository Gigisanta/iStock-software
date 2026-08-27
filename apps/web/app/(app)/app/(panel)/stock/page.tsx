import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireTenant } from '../../../_lib/session';
import { NotReadyYet, PageTitle } from '../_ui/section';

/**
 * Stock. Hoy es una pantalla vacía honesta: la carga de equipos con fotos entra en S2, y el
 * pipeline de imágenes (R2 + variantes) está bloqueado en B1.
 *
 * Aun así la página **verifica sesión**. No es ceremonia: cuando esta ruta empiece a devolver
 * listings va a llevar `cost_usd` a un `where` de distancia, y el guard tiene que estar puesto
 * desde antes de que haya algo que filtrar. Agregarlo el día que hay datos es el día que se
 * olvida.
 */

export const metadata: Metadata = { title: 'Stock' };

export default function StockPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />}>
      <StockContent />
    </Suspense>
  );
}

async function StockContent() {
  await requireTenant();

  return (
    <>
      <PageTitle>Stock</PageTitle>
      <NotReadyYet what="Acá vas a cargar cada equipo con sus fotos, condición, batería, GB, color y precio en dólares." />
    </>
  );
}
