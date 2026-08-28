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
 * | 2 | ficha: precio, estado, condición, **puntos de retiro** | nunca |
 * | 3 | mensaje actual del comprador | se recorta, nunca se descarta |
 * | 4 | descripción del dueño | 5º |
 * | 5 | chunks del modelo | 4º |
 * | 6 | historial | 3º (del más viejo al más nuevo) |
 * | 7 | medios de pago de la ficha | **1º**, de a uno desde el último |
 *
 * Si con todo eso no entra, **tira**. Un prompt que no entra en la dieta no se manda achicado a
 * ojo: se rompe fuerte y visible.
 *
 * ## El escalón 7 se agregó el 2026-08-28, y el motivo es que el filo no era patológico
 * La escalera empezaba en el historial, así que la primera degradación de una ficha grande era
 * **perder la conversación**. Medido: una ficha con los topes de `listing-view.ts` saturados con
 * contenido creíble —3 puntos de retiro y 6 medios de pago, que es exactamente lo que el plan
 * Negocio de USD 35 vende— más la descripción en su tope, en un turno con tool y con historial,
 * llegaba a **1192 de 1200 tirando los 4 turnos de historial y un chunk**. No es una punta de la
 * distribución: es el cliente objetivo.
 *
 * Recortar el 6º medio de pago cuesta ~7 tokens y el bloque entero ~43, o sea **dos turnos de
 * historial**; y una pregunta de medios de pago no llega nunca al modelo, porque
 * `detectHandoffIntent` la deriva antes (medido en `listing-view.ts`, ocho formulaciones, ocho
 * handoffs). Los puntos de retiro **no** entran a la escalera por la razón opuesta: esas preguntas
 * sí llegan al modelo, y una sucursal recortada se convierte en una sucursal negada.
 */

import type { PublicListingDTO } from '@istock/domain';
import { MAX_INPUT_TOKENS, measurePrompt, type BudgetReport } from './budget';
import type { TtlCache } from './cache';
import { renderChunks, selectChunks, type CatalogChunk } from './chunks';
import { AiError } from './errors';
import {
  listingPromptView,
  renderListingBlock,
  withPaymentMethodsKept,
  type ListingPromptView,
} from './listing-view';
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
  /**
   * Resultado de la tool que el modelo acaba de pedir, si hubo uno. **No es historial y por eso no
   * entra por `turns`**, que es donde estaba antes.
   *
   * Dos cosas le pasaban ahí adentro, las dos malas y las dos silenciosas:
   *
   * 1. `trimTurns` lo **re-sanitizaba**, y `sanitizeDescription` borra tags: los delimitadores
   *    `<<<DESCRIPCION_NO_CONFIABLE>>>` que `renderListingDigest` acababa de poner llegaban al
   *    modelo como `<< >>`. Sanitizar la propia salida no es defensa en profundidad; acá era
   *    destruir la marca que el system nombra por su nombre.
   * 2. Lo **recortaba a `TURN_TOKEN_BUDGET` (45 tokens)**, que es el presupuesto de un turno viejo
   *    de historial, no el de un dato que el modelo pidió hace un instante. Medido sobre una ficha
   *    `reserved`: el digest llegaba cortado en `RESERVADO —`, o sea sin el *"NO está disponible"*,
   *    y con el digest delimitado el `RESERVADO` desaparecía entero. E8 se perdía en el camino y
   *    ningún test lo veía, porque todos miran `renderListingDigest` y no lo que llega al modelo.
   *
   * Viene ya sanitizado del lado de `tools.ts` —ahí es donde se sabe qué parte la escribió un
   * tercero y qué parte la escribimos nosotros—, así que acá sólo se le pone un techo propio.
   */
  readonly toolResult?: string | null;
}

export interface ContextTrimReport {
  readonly turnsDropped: number;
  readonly chunksDropped: number;
  readonly descriptionDropped: boolean;
  /** Medios de pago de la ficha que no entraron. Es el primer escalón de la degradación. */
  readonly paymentMethodsDropped: number;
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

/**
 * Techo del resultado de tool. Tiene que entrar el peor de los tres: `search_listings` con 5 hits
 * más el envoltorio del texto de los vendedores. **No se degrada con el historial**: el modelo
 * acaba de pedir ese dato, y contestarle con la mitad es peor que no contestarle — se queda con
 * la parte de arriba, que es justo la que puede venir de un tercero, y sin el estado, que va al
 * final. Está acotado por construcción, así que no puede inflar el prompt.
 */
export const TOOL_RESULT_TOKEN_BUDGET = 150;

function assemble(
  systemPrompt: string,
  view: ListingPromptView,
  chunks: readonly CatalogChunk[],
  withDescription: boolean,
  paymentsKept: number,
): string {
  const trimmedView = withPaymentMethodsKept(view, paymentsKept);
  const listingView: ListingPromptView = withDescription ? trimmedView : { ...trimmedView, description: null };
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
  // Sin `sanitizeDescription`: esto lo escribimos nosotros en `tools.ts`, ya sanitizado y ya
  // delimitado. Volver a pasarlo por el sanitizador le borraría los delimitadores.
  const toolContent =
    input.toolResult === undefined || input.toolResult === null
      ? ''
      : truncateToTokens(input.toolResult, TOOL_RESULT_TOKEN_BUDGET);
  const toolTurn: readonly ChatTurn[] =
    toolContent.length === 0 ? [] : [{ role: 'assistant', content: toolContent }];

  const allPayments = view.paymentMethods.length;

  // Las degradaciones, en orden de preferencia y de a una: primero se recortan los medios de pago
  // (una pregunta de pago se deriva antes de llegar al modelo, así que esos tokens no contestan
  // nada), después se van los turnos del más viejo al más nuevo, después los chunks, y sólo al
  // final la descripción del dueño. Es una lista y no un producto cartesiano de bucles anidados a
  // propósito: anidados, el orden efectivo termina siendo el del bucle externo y no el de la tabla
  // de prioridades del docblock.
  type Plan = {
    readonly paymentsKept: number;
    readonly turnsKept: number;
    readonly chunksKept: number;
    readonly withDescription: boolean;
  };
  const plans: readonly Plan[] = [
    ...Array.from({ length: allPayments + 1 }, (_unused, index) => ({
      paymentsKept: allPayments - index,
      turnsKept: allTurns.length,
      chunksKept: allChunks.length,
      withDescription: true,
    })),
    ...Array.from({ length: allTurns.length }, (_unused, index) => ({
      paymentsKept: 0,
      turnsKept: allTurns.length - 1 - index,
      chunksKept: allChunks.length,
      withDescription: true,
    })),
    ...Array.from({ length: allChunks.length }, (_unused, index) => ({
      paymentsKept: 0,
      turnsKept: 0,
      chunksKept: allChunks.length - 1 - index,
      withDescription: true,
    })),
    { paymentsKept: 0, turnsKept: 0, chunksKept: 0, withDescription: false },
  ];

  /**
   * El último plan que se midió. Es el **piso real** —el más chico que este input admite— y es lo
   * que reporta el error si nada entró. Se guarda en vez de re-armarse abajo porque un piso
   * re-armado a mano no es el que se probó: la versión anterior omitía el turno de tool y cambiaba
   * la consulta por un placeholder, así que informaba un número **por debajo del techo** mientras
   * abortaba por pasarse de él.
   */
  let lastMeasured: BudgetReport | undefined;

  for (const userBudget of USER_MESSAGE_FALLBACK_BUDGETS) {
    const userContent = truncateToTokens(normalizeUserMessage(input.userMessage), userBudget);
    // El mensaje vacío después de sanitizar sigue siendo un turno: el modelo tiene que ver que el
    // comprador escribió algo. Un placeholder corto es más honesto que un turno ausente.
    const currentTurn: ChatTurn = { role: 'user', content: userContent.length > 0 ? userContent : '(consulta)' };

    for (const plan of plans) {
      const turns = allTurns.slice(allTurns.length - plan.turnsKept);
      const chunks = allChunks.slice(0, plan.chunksKept);
      const system = assemble(systemPrompt, view, chunks, plan.withDescription, plan.paymentsKept);
      const messages: readonly ChatTurn[] = [...turns, ...toolTurn, currentTurn];
      const budget = measurePrompt(system, messages, limit, TOOL_TOKENS);
      lastMeasured = budget;
      if (budget.withinBudget) {
        return {
          system,
          messages,
          budget,
          trimmed: {
            turnsDropped: allTurns.length - plan.turnsKept,
            chunksDropped: allChunks.length - chunks.length,
            descriptionDropped: !plan.withDescription && view.description !== null,
            paymentMethodsDropped: allPayments - Math.min(plan.paymentsKept, allPayments),
            userMessageTokenBudget: userBudget,
          },
        };
      }
    }
  }

  // El piso que se reporta es **el último que se midió**, no uno re-armado: el que efectivamente no
  // entró, con el turno de tool adentro y con la consulta real ya recortada al mínimo. Es, por
  // construcción, mayor que el techo — un error que aborta por pasarse no puede imprimir un número
  // que esté dentro del presupuesto y mandar a buscar el bug a otro lado.
  if (lastMeasured === undefined) {
    // Inalcanzable: las dos listas son no vacías por construcción. Si alguna vez se vacía, esto
    // dice qué pasó en vez de inventar un piso que nadie midió.
    throw new AiError('AI_BUDGET_EXCEEDED', 'la escalera de degradación quedó sin ningún plan que medir');
  }
  const conTool = toolTurn.length > 0 ? ', el resultado de la tool' : '';
  throw new AiError(
    'AI_BUDGET_EXCEEDED',
    `ni el contexto mínimo entra en la dieta: ${lastMeasured.tokensIn} tokens contra un techo de ${limit}. ` +
      `Ese piso ya es system + ficha sin descripción, sin chunks, sin historial, sin medios de pago${conTool} ` +
      `y la consulta recortada a ${USER_MESSAGE_FALLBACK_BUDGETS[USER_MESSAGE_FALLBACK_BUDGETS.length - 1]} tokens ` +
      `(de los cuales ${TOOL_TOKENS} son el schema de las tools). ` +
      'La ficha es demasiado grande para el prompt; el recorte va en `listing-view.ts`, no en el techo.',
  );
}
