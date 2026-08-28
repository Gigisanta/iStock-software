import { StorefrontMiss } from '../../_components/storefront-miss';

/**
 * Boundary de `notFound()` del segmento `/s/[slug]/**`.
 *
 * **Hoy no lo dispara nadie, y eso es correcto.** El slug inexistente ya no lanza `notFound()`:
 * `page.tsx` renderiza `<StorefrontMiss />` como contenido normal (ADR-011, variante B — el porqué
 * está medido en el docblock de `page.tsx`). Este archivo no es el camino del miss.
 *
 * **Y desde el 2026-08-28 tampoco lo va a disparar la ficha.** Este docblock decía que S3/S4 sí
 * iban a lanzarlo —"un id de listing que no existe sí es un `notFound()` legítimo: ahí el shell del
 * tenant ya resolvió"—. Se implementó así y el LEAD lo midió: la ficha inexistente salía `200` con
 * **0 chars de texto visible** en la primera request y 404 recién en la segunda. El mismo
 * patológico de ADR-011, un nivel más abajo. La ficha ahora devuelve `<ListingMiss />` como render
 * normal (`_components/listing-miss.tsx`, con la tabla medida) y `s/[slug]/p/[listing]/not-found.tsx`
 * se borró: era una segunda copia del párrafo que nadie podía llegar a ver.
 *
 * O sea que hoy **ningún archivo de `(storefront)` llama `notFound()`**, y eso no es un olvido:
 * bajo `cacheComponents` + PPR está medido que `notFound()` no pinta nada en el primer hit, que es
 * el único que tiene la persona que abrió un link viejo de un estado de WhatsApp.
 *
 * Entonces queda **un** motivo para este archivo, y sobrevive a la medición porque no depende de
 * ella: **la red de contención tiene que estar en español y dentro del layout de la vidriera.** Si
 * algo del framework, o un `notFound()` que alguien agregue mañana, cae sin boundary propio,
 * termina en el 404 default de Next, que se renderiza **fuera** de `(storefront)/layout.tsx` y bajo
 * el `title.template` del layout raíz: `'… · iStock'`. `iStock` es nombre código interno
 * (`CLAUDE.md`, encabezado) y no puede aparecerle en la pestaña al cliente de un reseller. Es un
 * piso, no un camino: lo que se ve cuando algo salió mal, no la respuesta a una pregunta de
 * negocio. Las dos preguntas de negocio —¿existe la vidriera?, ¿existe el equipo?— se contestan
 * con contenido de página.
 *
 * Cero texto propio: el párrafo vive una sola vez, en `_components/storefront-miss.tsx`. Si este
 * archivo tuviera su propia copia, en tres meses diría otra cosa que la del camino del miss y nadie
 * se enteraría hasta que un dueño lo viera.
 */
export default function StorefrontNotFound() {
  return <StorefrontMiss />;
}
