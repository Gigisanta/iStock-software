import { CopyButton } from './copy-button';

/**
 * El botón de copiar **el link de la vidriera**, con su rótulo. Es un caso particular de
 * `CopyButton` y no un componente aparte: el rótulo estaba hardcodeado adentro del componente
 * genérico, así que la primera pantalla que necesitó copiar otra cosa —la lista para estados de
 * S9— no tenía forma de reusarlo sin cambiarle el texto a la home.
 *
 * Se conserva la firma exacta (`url`) y el rótulo exacto: el único uso vivo es
 * `(panel)/page.tsx`, y esta refactorización **no cambia una sola letra de lo que ve el dueño**.
 *
 * Ya no lleva `"use client"`: es un Server Component que renderiza uno de cliente. El límite
 * quedó donde tiene que estar —en `copy-button.tsx`, que es el único que toca el navegador— y
 * este archivo no manda nada al bundle.
 */
export function CopyLinkButton({ url }: { url: string }) {
  return <CopyButton value={url} label="Copiar link de mi vidriera" />;
}
