/**
 * Los 3 chunks del **mismo** `catalog_model`.
 *
 * `docs/CHATBOT.md` §Contexto: *"Nada más. Ni el catálogo completo, ni los otros listings, ni el
 * historial entero."* El filtro por modelo no es una optimización de tokens: es lo que impide que
 * el bot conteste sobre un equipo que no es el que el comprador está mirando.
 *
 * Los embeddings que producen estos chunks se calculan **sólo en el seed/update de
 * `catalog_models`** (`CLAUDE.md` §3). Acá llegan ya seleccionados: este archivo no consulta nada.
 */

import { sanitizeDescription } from '@istock/domain';
import { MAX_CATALOG_CHUNKS } from './budget';
import { truncateToTokens } from './tokens';

/** Presupuesto por chunk, en tokens de nuestro contador. */
export const CHUNK_TOKEN_BUDGET = 60;

export interface CatalogChunk {
  /** El `catalog_models.id` al que pertenece. Sin esto no se puede filtrar y no entra. */
  readonly catalogModelId: string;
  readonly text: string;
}

/**
 * Filtra por modelo y corta en 3. Un chunk de otro modelo se **descarta**, no se degrada: mezclar
 * specs de dos equipos produce respuestas que suenan bien y son falsas.
 *
 * `catalogModelId` de la ficha en `null` (el dueño cargó a mano, o el `on delete set null` del
 * catálogo le pegó) → **cero chunks**. Sin ancla no hay contexto de catálogo, y eso es correcto:
 * la ficha sola alcanza.
 */
export function selectChunks(
  catalogModelId: string | null,
  chunks: readonly CatalogChunk[],
  max: number = MAX_CATALOG_CHUNKS,
): readonly CatalogChunk[] {
  if (catalogModelId === null || catalogModelId.length === 0) return [];
  const kept: CatalogChunk[] = [];
  for (const chunk of chunks) {
    if (kept.length >= max) break;
    if (chunk.catalogModelId !== catalogModelId) continue;
    const text = truncateToTokens(sanitizeDescription(chunk.text, { maxLength: 400 }), CHUNK_TOKEN_BUDGET);
    if (text.length === 0) continue;
    kept.push({ catalogModelId: chunk.catalogModelId, text });
  }
  return kept;
}

/** Bloque de texto para el prompt. Vacío si no quedó ningún chunk. */
export function renderChunks(chunks: readonly CatalogChunk[]): string {
  if (chunks.length === 0) return '';
  const body = chunks.map((chunk) => `- ${chunk.text}`).join('\n');
  return `DATOS DEL MODELO (referencia general, la ficha manda si se contradicen):\n${body}`;
}
