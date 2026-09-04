import Link from 'next/link';
import { PanelBrand } from './panel-brand';

/**
 * La navegación del panel, **dibujada**. En móvil se ve como barra de abajo y en escritorio como
 * sidebar. Sin hooks, sin `"use client"`, sin leer la URL.
 *
 * Está separada de `bottom-nav.tsx` por una razón de build, no de estética: bajo
 * `cacheComponents: true`, `usePathname()` **suspende** en toda ruta con un param dinámico que no
 * está en `generateStaticParams` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md`,
 * sección "Cache Components"). El pathname de `/app/stock/{id}/fotos` no existe en build, así que
 * el shell no se puede prerenderizar si la nav lee la URL fuera de un `<Suspense>`.
 *
 * La doc de migración dice literalmente qué hacer: *"Wrap the component that reads the hook in
 * `<Suspense>` (push the read down to the smallest leaf so the rest stays prerendered)"*. Este
 * archivo **es** ese "resto": el markup entero, que no depende de la URL, entra al shell estático
 * como fallback; lo único que se difiere es cuál de los items va marcado.
 *
 * Consecuencia buscada: en el shell de una ruta dinámica la navegación **ya está ahí, completa y
 * con los links usables**, sólo que sin resaltado. No hay salto de layout ni un hueco de 60px en
 * la zona del pulgar, que es lo que pasaría con un fallback vacío o con un esqueleto gris.
 */

/**
 * ── Cinco destinos, y por qué el quinto no rompe el blanco del pulgar ────────────────────────
 * `bottom-nav.tsx` decía *"cuatro items es el techo: con cinco, cada blanco baja de ~44px de
 * ancho en un teléfono chico"*. **Medido, es falso**: la barra es `w-full` con items `flex-1`, así
 * que en el teléfono más angosto que soportamos (320 CSS px, iPhone SE de 1ª) cada blanco mide
 * 320/5 = **64px** de ancho por 60px de alto — arriba de los 44×44 que pide Apple y de los 48dp de
 * Material. El techo real de esta barra está en seis o siete, no en cinco.
 *
 * `/app/lista` entra acá porque esta navegación **es** la entrada común del panel: una pantalla que el
 * dueño no encuentra es una pantalla que no existe, y ésta es la que le ahorra escribir la lista a
 * mano todas las noches. El rótulo es "Lista" y no "Stock 2" ni "Difusión" porque es la palabra
 * que usa él —"paso la lista"— y porque es la que dice la URL.
 */
const ITEMS = [
  { href: '/app', label: 'Inicio', icon: '⌂' },
  { href: '/app/stock', label: 'Stock', icon: '▦' },
  { href: '/app/lista', label: 'Lista', icon: '≡' },
  { href: '/app/canjes', label: 'Canjes', icon: '⇄' },
  { href: '/app/ajustes', label: 'Ajustes', icon: '⚙' },
] as const;

export interface BottomNavViewProps {
  /** `null` = todavía no se sabe (shell prerenderizado). Ningún item queda marcado. */
  readonly pathname: string | null;
}

export function BottomNavView({ pathname }: BottomNavViewProps) {
  return (
    <nav
      aria-label="Secciones del panel"
      className="panel-nav fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="panel-nav-brand">
        <PanelBrand variant="full" />
      </div>
      <ul className="mx-auto flex w-full max-w-2xl">
        {ITEMS.map((item) => {
          const active =
            pathname === null
              ? false
              : item.href === '/app'
                ? pathname === '/app'
                : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active
                    ? 'text-neutral-900 dark:text-white'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
