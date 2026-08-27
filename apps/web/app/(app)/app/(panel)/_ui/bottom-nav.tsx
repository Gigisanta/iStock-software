'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navegación principal del panel: **abajo, fija, con cuatro destinos y nada más.**
 *
 * No es una elección estética. `CLAUDE.md` §0.11 dice mobile-first y el contrato de `app-agent`
 * es más específico: *"El panel se usa parado en un local con una mano"*. Con el teléfono en una
 * mano, la parte de arriba de la pantalla queda fuera del alcance del pulgar. Un menú hamburguesa
 * arriba a la izquierda es el peor lugar posible de la pantalla para el gesto más frecuente.
 *
 * Cuatro items es el techo: con cinco, cada blanco baja de ~44px de ancho en un teléfono chico y
 * empiezan los toques equivocados.
 *
 * `"use client"` justificado: `usePathname()` para marcar el activo. Es lo único que hace.
 * `pb-[env(safe-area-inset-bottom)]` para que la barra no quede debajo del gesto de home del
 * iPhone — el ICP vende iPhones, los va a usar.
 */

const ITEMS = [
  { href: '/app', label: 'Inicio', icon: '⌂' },
  { href: '/app/stock', label: 'Stock', icon: '▦' },
  { href: '/app/canjes', label: 'Canjes', icon: '⇄' },
  { href: '/app/ajustes', label: 'Ajustes', icon: '⚙' },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones del panel"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950"
    >
      <ul className="mx-auto flex w-full max-w-2xl">
        {ITEMS.map((item) => {
          const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
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
