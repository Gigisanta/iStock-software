import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MIN_PHOTOS_TO_PUBLISH } from '@istock/domain';
import { listCatalogModels } from '../../../../_lib/catalog/queries';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_MB,
  PHOTO_ACCEPT_ATTR,
} from '../../../../_lib/listings/schema';
import { requireTenant } from '../../../../_lib/session';
import { PageTitle } from '../../_ui/section';
import { NuevaUnidadForm } from './nueva-unidad-form';

/**
 * `/app/stock/nuevo` — cargar un equipo.
 *
 * Server Component: verifica la sesión (ADR-007: adentro de cada página, no en el layout ni en el
 * proxy), lee el catálogo global y decide **si el campo de costo existe**. Esa decisión no se
 * delega al cliente: `canWriteCost` sale del rol de la sesión, del lado del server, y la Server
 * Action lo vuelve a verificar por su cuenta. Un `disabled` en el input no es una defensa.
 *
 * Los techos (`MAX_PHOTO_BYTES`, `PHOTO_ACCEPT_ATTR`, `MIN_PHOTOS_TO_PUBLISH`) bajan como props en
 * vez de importarse desde el componente cliente: el schema arrastra Zod, y Zod no tiene nada que
 * hacer en el bundle del navegador cuando la validación que decide corre en el server.
 *
 * El catálogo también baja como prop, ya proyectado a `{ id, displayName, family }`: la fila
 * entera de `catalog_models` no tiene por qué viajar al cliente.
 */

export const metadata: Metadata = { title: 'Cargar equipo' };

export default function NuevaUnidadPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NuevaUnidadContent />
    </Suspense>
  );
}

async function NuevaUnidadContent() {
  const { role, ctx } = await requireTenant();
  const catalogModels = await listCatalogModels(ctx);

  return (
    <>
      <PageTitle hint="Cargalo con una foto. Después sumás las otras dos y lo publicás.">
        Cargar equipo
      </PageTitle>

      <NuevaUnidadForm
        canWriteCost={role === 'owner'}
        photoAccept={PHOTO_ACCEPT_ATTR}
        maxPhotoBytes={MAX_PHOTO_BYTES}
        maxPhotoMb={MAX_PHOTO_MB}
        minPhotosToPublish={MIN_PHOTOS_TO_PUBLISH}
        catalogModels={catalogModels}
      />

      <p className="mt-6 text-center text-sm">
        <Link href="/app/stock" className="underline underline-offset-2">
          Volver al stock
        </Link>
      </p>
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-32 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
