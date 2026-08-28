/**
 * La dieta de contexto, armada y **medida**.
 *
 * Composición exacta (`docs/CHATBOT.md`, y nada más que esto):
 * ```
 * system corto (cacheado)
 * + publicListingDTO de la ficha abierta
 * + 3 chunks del MISMO catalog_model
 * + últimos 4 turnos recortados
 * ```
 *
 * ## Degradar en orden, no truncar al final
 * Cortar el prompt por el medio cuando se pasa es la forma fácil y la peor: se lleva puesta la
 * mitad de la ficha y el modelo contesta sobre lo que quedó. Acá se **descarta por prioridad
 * inversa**, y lo que se descartó se informa en `trimmed` para poder medirlo:
 *
 * | prioridad | qué | se descarta |
 * |---|---|---|
 * | 1 | reglas del system | nunca |
 * | 2 | ficha: precio, estado, condición | nunca |
 * | 3 | mensaje actual del comprador | se recorta, nunca se descarta |
 * | 4 | descripción del dueño | 4º |
 * | 5 | chunks del modelo | 3º |
 * | 6 | historial | 1º (del más viejo al más nuevo) |
 *
 * Si con todo eso no entra, **tira**. Un prompt que no entra en la dieta no se manda achicado a
 * ojo: se rompe fuerte y visible.
 */

import type { PublicListingDTO } from '@istock/domain';
import { MAX_INPUT_TOKENS, measurePrompt, type BudgetReport } from './budget';
import type { TtlCache } from './cache';
import { renderChunks, selectChunks, type CatalogChunk } from './chunks';
import { AiError } from './errors';
import { listingPromptView, renderListingBlock, type ListingPromptView } from './listing-view';
import { buildSystemPrompt } from './prompt';
import { normalizeUserMessage, trimTurns, USER_MESSAGE_TOKEN_BUDGET, type ChatTurn } from './turns';
import { truncateToTokens } from './tokens';
import { toolBudgetTokens } from './tools';

export interface ChatContextInput {
  readonly listing: PublicListingDTO;
  /** Nombre comercial de la tienda, para el saludo. Texto del dueño: entra recortado. */
  readonly storeName: string;
  /** `catalog_models.id` de la ficha. `null` = no hay chunks, y está bien. */
  readonly catalogModelId: string | null;
  readonly chunks: readonly CatalogChunk[];
  readonly turns: readonly ChatTurn[];
  readonly userMessage: string;
}

export interface ContextTrimReport {
  readonly turnsDropped: number;
  readonly chunksDropped: number;
  readonly descriptionDropped: boolean;
  readonly userMessageTokenBudget: number;
}

export interface ChatContext {
  readonly system: string;
  readonly messages: readonly ChatTurn[];
  readonly budget: BudgetReport;
  readonly trimmed: ContextTrimReport;
}

export interface BuildContextOptions {
  readonly limit?: number;
  /** Cache de 60 s del bloque de ficha. Opcional: sin él se re-arma, que es correcto pero más caro. */
  readonly listingCache?: TtlCache<ListingPromptView>;
}

/**
 * Lo que cuestan las tres tools por turno. Se calcula una vez: `TOOL_SPECS` es una constante y
 * medirlo en cada request sería pagar CPU por un número que no cambia.
 */
const TOOL_TOKENS = toolBudgetTokens();

/** Degradaciones sucesivas del mensaje del comprador. Nunca llega a cero. */
const USER_MESSAGE_FALLBACK_BUDGETS = [USER_MESSAGE_TOKEN_BUDGET, 60, 30] as const;

function assemble(
  systemPrompt: string,
  view: ListingPromptView,
  chunks: readonly CatalogChunk[],
  withDescription: boolean,
): string {
  const listingView: ListingPromptView = withDescription ? view : { ...view, description: null };
  const parts = [systemPrompt, renderListingBlock(listingView)];
  const chunkBlock = renderChunks(chunks);
  if (chunkBlock.length > 0) parts.push(chunkBlock);
  return parts.join('\n\n');
}

/**
 * Arma el contexto y lo mide. **No llama a ningún proveedor**: es una función pura salvo por el
 * cache opcional, así que el test de la dieta no necesita red ni credenciales — que es todo el
 * punto con B4 abierto.
 */
export function buildChatContext(input: ChatContextInput, options?: BuildContextOptions): ChatContext {
  const limit = options?.limit ?? MAX_INPUT_TOKENS;
  const systemPrompt = buildSystemPrompt(input.storeName);
  const view =
    options?.listingCache === undefined
      ? listingPromptView(input.listing)
      : options.listingCache.get(input.listing.id, () => listingPromptView(input.listing));

  const allChunks = selectChunks(input.catalogModelId, input.chunks);
  const allTurns = trimTurns(input.turns);

  // Las degradaciones, en orden de preferencia y de a una: primero se van los turnos (del más
  // viejo al más nuevo), después los chunks, y sólo al final la descripción del dueño. Es una
  // lista y no un producto cartesiano de bucles anidados a propósito: anidados, el orden efectivo
  // termina siendo el del bucle externo y no el de la tabla de prioridades del docblock.
  const plans: readonly { readonly turnsKept: number; readonly chunksKept: number; readonly withDescription: boolean }[] =
    [
      ...Array.from({ length: allTurns.length + 1 }, (_unused, index) => ({
        turnsKept: allTurns.length - index,
        chunksKept: allChunks.length,
        withDescription: true,
      })),
      ...Array.from({ length: allChunks.length }, (_unused, index) => ({
        turnsKept: 0,
        chunksKept: allChunks.length - 1 - index,
        withDescription: true,
      })),
      { turnsKept: 0, chunksKept: 0, withDescription: false },
    ];

  for (const userBudget of USER_MESSAGE_FALLBACK_BUDGETS) {
    const userContent = truncateToTokens(normalizeUserMessage(input.userMessage), userBudget);
    // El mensaje vacío después de sanitizar sigue siendo un turno: el modelo tiene que ver que el
    // comprador escribió algo. Un placeholder corto es más honesto que un turno ausente.
    const currentTurn: ChatTurn = { role: 'user', content: userContent.length > 0 ? userContent : '(consulta)' };

    for (const plan of plans) {
      const turns = allTurns.slice(allTurns.length - plan.turnsKept);
      const chunks = allChunks.slice(0, plan.chunksKept);
      const system = assemble(systemPrompt, view, chunks, plan.withDescription);
      const messages: readonly ChatTurn[] = [...turns, currentTurn];
      const budget = measurePrompt(system, messages, limit, TOOL_TOKENS);
      if (budget.withinBudget) {
        return {
          system,
          messages,
          budget,
          trimmed: {
            turnsDropped: allTurns.length - plan.turnsKept,
            chunksDropped: allChunks.length - chunks.length,
            descriptionDropped: !plan.withDescription && view.description !== null,
            userMessageTokenBudget: userBudget,
          },
        };
      }
    }
  }

  const floor = measurePrompt(
    assemble(systemPrompt, view, [], false),
    [{ role: 'user', content: '(consulta)' }],
    limit,
    TOOL_TOKENS,
  );
  throw new AiError(
    'AI_BUDGET_EXCEEDED',
    `ni el contexto mínimo entra en la dieta: ${floor.tokensIn} tokens contra un techo de ${limit}. ` +
      'La ficha es demasiado grande para el prompt; el recorte va en `listing-view.ts`, no en el techo.',
  );
}
