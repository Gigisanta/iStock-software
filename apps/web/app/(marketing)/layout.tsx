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
  title: 'iStock - vidriera y stock para revendedores de celulares',
  description:
    'Cargás tu stock una vez y tenés tu propia vidriera online. El cliente entra informado y te ' +
    'escribe por WhatsApp con el equipo y el precio ya escritos.',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-shell flex min-h-dvh flex-col">
      <header className="marketing-header">
        <nav className="marketing-nav mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="marketing-brand marketing-logo" aria-label="iStock">
            <img src="/brand/logo-horizontal.svg" alt="" width="140" height="28" />
          </Link>
          <div className="marketing-nav-actions">
            <div className="marketing-nav-links marketing-nav-links-desktop">
              <Link href="/precios">Precios</Link>
            </div>
            <Link href="/ingresar" className="marketing-sign-in px-4 py-2">
              Ingresar
            </Link>
            <details className="marketing-menu">
              <summary aria-label="Abrir menú">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className="sr-only">Abrir menú</span>
              </summary>
              <div className="marketing-menu-panel">
                <Link href="/precios">Precios</Link>
                <Link href="/ingresar">Ingresar</Link>
              </div>
            </details>
          </div>
        </nav>
      </header>

      <main className="marketing-main flex-1">{children}</main>

      <footer className="marketing-footer px-4 py-8 text-sm">
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
