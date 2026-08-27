/**
 * Copy visible que los tests afirman. Owner: `qa-agent`.
 *
 * Está acá y no repetida en cada archivo por una razón concreta: si mañana alguien reescribe el
 * texto del 404 de la vidriera, tiene que fallar **un** lugar y no cinco, y el fallo tiene que
 * decir "cambió la copy", no "el 404 dejó de funcionar".
 */

/**
 * `<h1>` de la **dirección sin vidriera** (`app/(storefront)/_components/storefront-miss.tsx`,
 * ADR-011 variante B). Es el mismo texto que usa `s/[slug]/not-found.tsx`, que renderiza ese
 * componente: el párrafo vive una sola vez del lado de la impl y una sola vez del lado del test.
 */
export const STOREFRONT_404_H1 = 'No hay ninguna vidriera en esta dirección';

/**
 * `<h1>` de `app/(marketing)/page.tsx`.
 *
 * Está acá porque el test de subdominios reservados (`www`) necesita afirmar **en positivo** qué
 * se sirvió, y no sólo que no se sirvió la vidriera: `expect(h1).not.toBe(404_H1)` da verde
 * también el día que `www` devuelve una página vacía, un error de Next o el panel.
 */
export const MARKETING_H1 = 'Tu stock, con vidriera propia y el WhatsApp ya escrito.';
