/**
 * Copy visible que los tests afirman. Owner: `qa-agent`.
 *
 * Está acá y no repetida en cada archivo por una razón concreta: si mañana alguien reescribe el
 * texto del 404 de la vidriera, tiene que fallar **un** lugar y no cinco, y el fallo tiene que
 * decir "cambió la copy", no "el 404 dejó de funcionar".
 */

/** `<h1>` de `app/(storefront)/s/[slug]/not-found.tsx`. */
export const STOREFRONT_404_H1 = 'No hay ninguna vidriera en esta dirección';
