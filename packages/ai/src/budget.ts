/**
 * La dieta, como constantes y como aserción.
 *
 * Los techos de `docs/CHATBOT.md` son **constitucionales**: la env puede bajarlos, nunca subirlos
 * (ver `env.ts`). Este archivo es el único lugar donde viven los números.
 */

import { AiError } from './errors';
import { countMessageTokens, type CountableMessage } from './tokens';

/** Techo de entrada por turno. `CLAUDE.md` §Dieta y `docs/CHATBOT.md`. */
export const MAX_INPUT_TOKENS = 1200;
/** Techo de salida por turno. */
export const MAX_OUTPUT_TOKENS = 180;
/** Sin thinking, sin reasoning tokens: la respuesta es corta y directa. */
export const TEMPERATURE = 0.2;
/** Cache de system + ficha. */
export const CACHE_TTL_MS = 60_000;
/** Últimos N turnos, recortados. */
export const MAX_HISTORY_TURNS = 4;
/** Chunks del MISMO `catalog_model`. Nunca de otro modelo, nunca del catálogo entero. */
export const MAX_CATALOG_CHUNKS = 3;
/** Resultados de `search_listings`. */
export const MAX_SEARCH_RESULTS = 5;

export interface BudgetReport {
  /** Total facturable de entrada: system + mensajes + el schema de las tools. */
  readonly tokensIn: number;
  /** La parte que aportan las tools, separada para poder discutirla sin recontar. */
  readonly toolTokens: number;
  readonly limit: number;
  readonly withinBudget: boolean;
}

/**
 * Mide un prompt armado contra el techo. No tira: informa.
 *
 * **`toolTokens` no es opcional por comodidad.** El schema de las tres tools viaja en cada request
 * y el proveedor lo cobra como input igual que el system. Medir la dieta sin contarlo da un número
 * más lindo y equivocado, que es la peor clase de medición: la que tranquiliza.
 */
export function measurePrompt(
  system: string,
  messages: readonly CountableMessage[],
  limit = MAX_INPUT_TOKENS,
  toolTokens = 0,
): BudgetReport {
  const tokensIn = countMessageTokens([{ role: 'system', content: system }, ...messages]) + toolTokens;
  return { tokensIn, toolTokens, limit, withinBudget: tokensIn <= limit };
}

/**
 * Tira si el prompt se pasa. Es el punto donde la dieta deja de ser un objetivo y pasa a ser una
 * aserción: ningún camino de `answerChat` llega al proveedor sin pasar por acá.
 */
export function assertWithinBudget(report: BudgetReport): void {
  if (!report.withinBudget) {
    throw new AiError(
      'AI_BUDGET_EXCEEDED',
      `el prompt armado mide ${report.tokensIn} tokens y el techo es ${report.limit}. ` +
        'No se recorta en el proveedor: se recorta acá o no se manda.',
    );
  }
}
