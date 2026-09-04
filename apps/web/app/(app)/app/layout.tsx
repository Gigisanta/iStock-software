import type { Metadata } from 'next';

/**
 * Raíz de `/app/*`.
 *
 * Este layout no lee la sesión **a propósito**. Adentro cuelgan dos mundos con reglas distintas:
 *
 * - `(panel)/…` → ya tenés negocio. Lleva la chrome completa (header + barra de abajo).
 * - `crear-negocio` → todavía no tenés negocio. **No** puede tener la chrome, porque el header
 *   necesita el nombre del negocio y `requireTenant()` redirige justamente ahí: sería un loop de
 *   redirecciones, y de los que sólo se descubren en producción.
 *
 * Lo que sí es global: `noindex`. El panel no va a Google, ni ahora ni nunca.
 */

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s · iStock' },
  robots: { index: false, follow: false },
};

export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="app-root-shell min-h-dvh">{children}</div>;
}
