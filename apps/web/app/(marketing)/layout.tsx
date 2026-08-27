import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Layout de la cara pública en `maat.work` (`PRODUCT.md` §Tres caras).
 *
 * **Estático a propósito.** No lee `cookies()` ni `headers()`, así que Next lo prerenderiza
 * entero: cero función por pageview, cero query. El header no cambia según haya sesión o no —
 * mostrar "Hola, Gio" arriba obligaría a marcar toda la home como dinámica para ahorrarle un
 * click a alguien que ya sabe dónde queda `/app`.
 */

export const metadata: Metadata = {
  title: 'iStock — vidriera y stock para revendedores de celulares',
  description:
    'Cargás tu stock una vez y tenés tu propia vidriera online. El cliente entra informado y te ' +
    'escribe por WhatsApp con el equipo y el precio ya escritos.',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            iStock
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <Link
              href="/precios"
              className="rounded-lg px-3 py-2 font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Precios
            </Link>
            <Link
              href="/ingresar"
              className="rounded-lg bg-neutral-900 px-4 py-2 font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Ingresar
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-neutral-200 px-4 py-8 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
          <p>
            iStock es un producto de <strong className="font-semibold">MaatWork</strong>, Patagonia
            argentina.
          </p>
          <p>
            No somos un registro oficial de equipos ni tenemos convenio con ENACOM. Guardamos el
            IMEI y el resultado de tu consulta para que lo tengas ordenado, nada más.
          </p>
        </div>
      </footer>
    </div>
  );
}
