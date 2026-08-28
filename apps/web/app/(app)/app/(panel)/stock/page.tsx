import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireTenant } from '../../../_lib/session';
import { listUnits } from '../../../_lib/listings/queries';
import { PageTitle } from '../_ui/section';
import { UnitRowCard } from './_ui/unit-row';

/**
 * `/app/stock` — los equipos del negocio.
 *
 * ── Server Component, sin excepciones ────────────────────────────────────────────────────────
 * La lista no tiene interacción propia: se lee. Lo único que manda JavaScript al cliente es el
 * botón de publicar, que es su propio componente. `CLAUDE.md` §3: RSC por default.
 *
 * ── Autorización adentro de la página ────────────────────────────────────────────────────────
 * `requireTenant()` acá, no en el layout: un layout no vuelve a correr al navegar entre páginas
 * hermanas (ADR-007). Y `listUnits()` corre con `withTenantDb` (RLS activa) **más** su
 * `where tenant_id = …` explícito. Las dos capas, siempre.
 *
 * ── Costo ────────────────────────────────────────────────────────────────────────────────────
 * Las miniaturas son `thumb` (≤25 KB, 200px) servidas por CDN con `Cache-Control` inmutable. Cien
 * equipos en pantalla son ~2 MB de imágenes en el peor caso y **cero** transformaciones on-the-fly.
 *
 * ── `now` se calcula una vez ─────────────────────────────────────────────────────────────────
 * `@istock/domain` no llama `Date.now()`: el tiempo entra por parámetro. Una sola marca para todas
 * las filas hace el render determinista y evita que dos equipos se evalúen contra relojes distintos.
 */

export const metadata: Metadata = { title: 'Stock' };

export default function StockPage() {
  return (
    <Suspense fallback={<StockSkeleton />}>
      <StockContent />
    </Suspense>
  );
}

async function StockContent() {
  const { ctx } = await requireTenant();
  const units = await listUnits(ctx);
  const now = new Date();

  return (
    <>
      <PageTitle hint="Cargá cada equipo una vez. Después lo publicás y aparece en tu vidriera.">
        Stock
      </PageTitle>

      <Link
        href="/app/stock/nuevo"
        className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
      >
        Cargar equipo
      </Link>

      {units.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-base font-semibold">Todavía no cargaste ningún equipo</p>
          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
            Sacale tres fotos a uno, ponele precio y en un minuto está en tu vidriera.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {units.length === 1 ? '1 equipo' : `${String(units.length)} equipos`}
          </p>
          <ul className="mt-2 space-y-3">
            {units.map((unit) => (
              <UnitRowCard key={unit.id} unit={unit} ctx={ctx} now={now} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function StockSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-[52px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-28 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-28 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
