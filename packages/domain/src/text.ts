/**
 * Criterio **único** de "texto vacío" para todo el dominio.
 *
 * ## Por qué existe este módulo de tres líneas
 * `NOT NULL` no es `no vacío`. `catalog_models.display_name` es `text not null` **sin CHECK**
 * (`packages/db/drizzle/0000_sparkling_vector.sql:95`) y `listings.title` tampoco tiene CHECK:
 * `''` es un valor representable en las dos columnas. Y `''` no es el único: `'   '` y `'\t\n'`
 * también entran, y son igual de vacíos para un ser humano que mira una pantalla.
 *
 * La vidriera ya toma esa decisión aguas arriba (`resolveModelName`: un `display_name` en blanco
 * cuenta como **ausente** y cae al `title`). Este archivo existe para que la decisión sea **la
 * misma** de los dos lados de la cadena. Dos definiciones distintas de "vacío" en la misma cadena
 * de datos no es una defensa en profundidad: es un hueco con forma de acuerdo —cada capa cree que
 * la otra lo tapó, y el caso que una considera lleno y la otra vacío pasa por el medio.
 *
 * Criterio: `trim().length === 0`. `String.prototype.trim` usa la definición de whitespace de
 * ECMAScript, que incluye el NBSP ` ` — que es exactamente lo que aparece cuando alguien
 * copia y pega un nombre desde una página web.
 */

/** `''`, `'   '`, `'\t\n'`, `' '` → `true`. Vacío **o sólo whitespace** cuenta como ausente. */
export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}
