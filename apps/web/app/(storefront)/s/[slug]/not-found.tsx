import { StorefrontMiss } from '../../_components/storefront-miss';

/**
 * Boundary de `notFound()` del segmento `/s/[slug]/**`.
 *
 * **Hoy no lo dispara nadie, y eso es correcto.** El slug inexistente ya no lanza `notFound()`:
 * `page.tsx` renderiza `<StorefrontMiss />` como contenido normal (ADR-011, variante B — el porqué
 * está medido en el docblock de `page.tsx`). Este archivo no es el camino del miss.
 *
 * Existe por dos motivos concretos, no "por las dudas":
 *
 * 1. **La red de contención tiene que estar en español y dentro del layout de la vidriera.** Sin
 *    este archivo, cualquier `notFound()` que se lance en el segmento cae en el 404 default de
 *    Next, que se renderiza **fuera** de `(storefront)/layout.tsx` y bajo el `title.template` del
 *    layout raíz: `'… · iStock'`. `iStock` es nombre código interno (`CLAUDE.md`, encabezado) y no
 *    puede aparecerle en la pestaña al cliente de un reseller.
 * 2. **S3/S4 sí van a lanzarlo.** La ficha (`/s/[slug]/p/[id]`) hereda este boundary, y un id de
 *    listing que no existe sí es un `notFound()` legítimo: ahí el shell del tenant ya resolvió, no
 *    hay ambigüedad de host y el status importa menos que en la raíz.
 *
 * Cero texto propio: el párrafo vive una sola vez, en `_components/storefront-miss.tsx`. Si este
 * archivo tuviera su propia copia, en tres meses diría otra cosa que la del camino del miss y nadie
 * se enteraría hasta que un dueño lo viera.
 */
export default function StorefrontNotFound() {
  return <StorefrontMiss />;
}
