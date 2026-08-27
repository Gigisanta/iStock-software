import { Suspense } from 'react';
import { signOutAction } from '../../_lib/auth/actions';
import { storefrontHostForSlug, storefrontUrlForSlug } from '../../_lib/env';
import { requireTenant } from '../../_lib/session';
import { BottomNav } from './_ui/bottom-nav';

/**
 * Chrome del panel. **Mobile-first sin excepción**: el ancho base es el de un teléfono y
 * `max-w-2xl` es lo que pasa cuando alguien abre esto en una notebook, no al revés.
 *
 * Tres decisiones de layout que responden a "se usa parado en un local, con una mano":
 *
 * 1. La navegación va **abajo** (`BottomNav`), donde llega el pulgar.
 * 2. `pb-28` en el `main`: el contenido nunca termina debajo de la barra fija. Un botón de
 *    "guardar" tapado por la nav es un bug, no un detalle de espaciado.
 * 3. El header es `sticky` y corto: se ve de qué negocio es el panel sin gastar media pantalla.
 *
 * Sobre el `<Suspense>`: con `cacheComponents: true` todo acceso dinámico (cookies, sesión) tiene
 * que estar adentro de un límite de suspenso. Acá además sirve: el esqueleto se pinta al toque y
 * el nombre del negocio llega cuando resuelve la query.
 */

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<HeaderSkeleton />}>
        <PanelHeader />
      </Suspense>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4">{children}</main>

      <BottomNav />
    </div>
  );
}

/**
 * `requireTenant()` acá **no reemplaza** al guard de cada página. Un layout no vuelve a correr al
 * navegar entre páginas hermanas, y las Server Actions no pasan por el layout en absoluto: cada
 * página y cada acción verifica lo suyo (ADR-007). Esto es chrome, no seguridad.
 *
 * Que igual sea barato lo resuelve `cache()` de React: layout y página comparten la misma query.
 */
async function PanelHeader() {
  const { tenant } = await requireTenant();

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">{tenant.name}</p>
          <a
            href={storefrontUrlForSlug(tenant.slug)}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
          >
            {storefrontHostForSlug(tenant.slug)} ↗
          </a>
        </div>

        {/*
          Cerrar sesión es una mutación: va por POST desde un `<form>` con Server Action, nunca por
          un `<a href="/salir">`. Un GET que cierra sesión lo dispara cualquier prefetch del
          navegador — y el navegador prefetchea.
        */}
        <form action={signOutAction}>
          <button
            type="submit"
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}

function HeaderSkeleton() {
  return (
    <header
      aria-hidden="true"
      className="sticky top-0 z-10 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center px-4 py-2.5">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      </div>
    </header>
  );
}
