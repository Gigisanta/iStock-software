import type { NameSource } from '@istock/domain';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  De qué string salió el nombre del equipo. Es una decisión del MAPEO, no del dominio.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `describeListing` de `@istock/domain` necesita saber si el nombre que recibe viene limpio del
 * `catalog_model` (`iPhone 14 Pro`) o es el título de texto libre del dueño (`iPhone 14 Pro 256
 * Grafito`), porque en el segundo caso appendearle storage y color duplica lo que ya está escrito.
 * El dominio no puede saberlo: el discriminante lo produce el `leftJoin`, y por eso vive acá.
 *
 * El 2026-08-28, W5 de `accept-s4.sh` imprimió de un browser real
 * `Hola, vi el iPhone 14 Pro 256 Grafito 256 Grafito (usado A) …`. La causa era este mapeo
 * escrito en una línea (`row.modelDisplayName ?? row.title`) que colapsaba los dos significados en
 * un mismo campo. **La regla que sostiene este archivo es una sola:** el `nameSource` y el nombre
 * salen de la misma decisión y en el mismo objeto, así que no se puede elegir uno y olvidar el
 * otro. Un `nameSource: 'catalog'` escrito a mano al lado de un `?? row.title` compila y vuelve a
 * mentir; un `...resolveModelName(row)` no tiene esa forma.
 *
 * Vive en su propio módulo —y no como una función privada de `listings.ts`— porque `listings.ts`
 * importa `server-only`, `next/cache` y `@istock/db`: desde Vitest no se puede instanciar. Un
 * módulo puro es lo que hace que el fallback tenga un test de comportamiento donde vive el mapeo
 * (`model-name.test.ts`) y no solamente una afirmación sobre el texto del archivo.
 */
export interface ResolvedModelName {
  /** Qué de los dos strings terminó siendo el nombre. Consumido por `describeListing`. */
  readonly nameSource: NameSource;
  /** El nombre elegido, sin normalizar: `describeListing` ya recorta y colapsa espacios. */
  readonly modelDisplayName: string;
}

/** Lo poco que hace falta de la fila: la columna del `leftJoin` y el título del dueño. */
export interface ModelNameRow {
  /** `catalog_models.display_name`. `null` cuando la fila no tiene modelo de catálogo. */
  readonly modelDisplayName: string | null;
  /** `listings.title`, texto libre del dueño. Es el fallback y **nunca** es nombre de catálogo. */
  readonly title: string;
}

/**
 * Fila → nombre + procedencia.
 *
 * Tres caminos, uno solo de ellos `catalog`:
 * 1. Hay `catalog_model` con nombre → `catalog`, nombre del catálogo. Byte a byte lo de siempre.
 * 2. `catalog_model_id` es `null` → `free_text`, título del dueño. No es un caso raro: la columna
 *    es nullable (accesorios, lotes, carga rápida sin elegir modelo) **y** es `on delete set null`,
 *    así que borrar un modelo del catálogo tira a todos sus listings a este camino de golpe.
 * 3. Hay `catalog_model` pero su `display_name` está vacío o en blanco → también `free_text`.
 *    `display_name` es `text not null` **sin CHECK de longitud**, así que `''` es representable, y
 *    `??` no lo atrapa: el equipo terminaría llamándose la cadena vacía y el mensaje arrancaría con
 *    un espacio de más. Un nombre en blanco es un nombre ausente.
 */
export function resolveModelName(row: ModelNameRow): ResolvedModelName {
  const fromCatalog = row.modelDisplayName;
  if (fromCatalog === null || fromCatalog.trim().length === 0) {
    return { nameSource: 'free_text', modelDisplayName: row.title };
  }
  return { nameSource: 'catalog', modelDisplayName: fromCatalog };
}
