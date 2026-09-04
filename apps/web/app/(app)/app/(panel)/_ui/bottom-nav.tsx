'use client';

import { usePathname } from 'next/navigation';
import { BottomNavView } from './bottom-nav-view';

/**
 * Navegación principal del panel: **fija, abajo en móvil y lateral en escritorio.**
 *
 * No es una elección estética. `CLAUDE.md` §0.11 dice mobile-first y el contrato de `app-agent`
 * es más específico: *"El panel se usa parado en un local con una mano"*. Con el teléfono en una
 * mano, la parte de arriba de la pantalla queda fuera del alcance del pulgar. Un menú hamburguesa
 * arriba a la izquierda es el peor lugar posible de la pantalla para el gesto más frecuente.
 *
 * Cuántos items entran **está medido en `bottom-nav-view.tsx`**, que es donde vive el markup y
 * donde se puede verificar. Esta línea decía "cuatro es el techo, con cinco cada blanco baja de
 * ~44px": era una estimación escrita como si fuera una medición, y S9 la desmintió al agregar el
 * quinto — con `flex-1` sobre 320 CSS px cada blanco mide 64px, no menos de 44.
 *
 * `"use client"` justificado: `usePathname()` para marcar el activo. Es lo único que hace, y ahora
 * es literalmente lo único que hace este archivo — de eso se trata el corte.
 *
 * **Este componente sólo se monta adentro de un `<Suspense>`** (ver `(panel)/layout.tsx`). Bajo
 * `cacheComponents`, `usePathname()` suspende cuando el pathname no se conoce en build, que es el
 * caso de `/app/stock/{id}/fotos`. Sin el boundary el `next build` no falla en runtime: falla al
 * prerenderizar, y se lleva puesto el build entero.
 */

export function BottomNav() {
  return <BottomNavView pathname={usePathname()} />;
}
