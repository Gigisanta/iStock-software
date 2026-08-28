/**
 * El orquestador: de un mensaje del comprador a un texto plano que termina empujando al `wa.me`.
 *
 * ## El orden de las defensas es la mitad del diseño
 * ```
 * 1. entitlement      → en Base no se arma ni el prompt
 * 1b. parte del contador → sin medidor no hay chat (AI_USAGE_UNMEASURED), no "cero mensajes"
 * 2. soft cap         → 40/tenant/día, después sólo el botón
 * 3. intención        → reservar/pagar/iCloud/identificador/envío/canje: se deriva SIN llamar al modelo
 * 4. dieta            → se arma, se MIDE y se asserta contra 1200
 * 5. primario         → Gemini Flash-Lite (ID por env)
 * 6. fallback         → Groq (ID por env), en el camino de ejecución, no en un `catch` decorativo
 * 7. guard de salida  → si algo huele mal, se descarta la respuesta y se deriva
 * 8. siempre          → `waUrl` + `waMessage` del DTO en la respuesta
 * ```
 * Los pasos 3 y 7 son los que hacen que los evals de jailbreak sean **deterministas**: no dependen
 * de que el modelo se porte bien. El paso 3 además es el más barato del sistema — un jailbreak que
 * nunca llega al proveedor cuesta cero.
 *
 * ## Un solo round de tools
 * El modelo puede pedir una tool y contestar con el resultado. Después de eso, contesta o deriva.
 * Un loop abierto es un loop de costo: cada vuelta paga el prompt entero de nuevo (el context
 * caching no nos aplica a esta dieta, R3 §1).
 */

import { z } from 'zod';
import type { PublicListingDTO } from '@istock/domain';
import type { TtlCache } from './cache';
import type { CatalogChunk } from './chunks';
import { buildChatContext, type ChatContext } from './context';
import { assertWithinBudget } from './budget';
import {
  assertChatEntitled,
  requireMeasuredUsage,
  softCapReached,
  type ChatEntitlement,
  type TenantUsageToday,
} from './entitlement';
import { AiError } from './errors';
import { buildHandoff, detectHandoffIntent, type HandoffReason } from './handoff';
import { guardAnswer } from './guard';
import type { ListingPromptView } from './listing-view';
import type { AiEnv } from './env';
import { countTokens } from './tokens';
import type { LlmProvider, LlmRequest, LlmResult } from './provider';
import { createToolRuntime, type SearchPort } from './tools';
import { CHAT_ROLES, type ChatTurn } from './turns';

/** Un solo round: el modelo pide una tool, la contesta, y con eso cierra. */
const MAX_TOOL_ROUNDS = 1;

/**
 * Borde no confiable del paquete: lo único que escribe el visitante son `userMessage` y `turns`.
 * Se exporta para que el route handler de `apps/web` valide con **este** schema y no con otro.
 */
export const chatRequestSchema = z.object({
  userMessage: z.string().trim().min(1).max(2000),
  turns: z
    .array(z.object({ role: z.enum(CHAT_ROLES), content: z.string().max(2000) }))
    .max(20)
    .default([]),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatInput {
  /**
   * El veredicto de facturación, **ya tomado** por quien tiene la fila del tenant. Este paquete no
   * mira planes ni vencimientos de trial: no tiene la fila y no tiene reloj de suscripción.
   * Ausencia de veredicto = sin chat (`assertChatEntitled` falla cerrado).
   */
  readonly entitlement: ChatEntitlement;
  readonly listing: PublicListingDTO;
  readonly storeName: string;
  readonly catalogModelId: string | null;
  readonly chunks: readonly CatalogChunk[];
  readonly turns: readonly ChatTurn[];
  readonly userMessage: string;
  /**
   * Parte del contador diario del tenant. **No es un `number` a propósito.**
   *
   * Un `number` admite un `0` escrito para poder compilar, y ese cero apaga el único techo por
   * tenant que tiene el producto sin poner nada en rojo (`entitlement.ts`, §"El contador es el
   * techo de la factura"). Se construye con `usageMeasured(n)` o, mientras el contador no exista,
   * con `usageUnmeasured('motivo')` — que falla ruidoso en vez de contestar gratis.
   */
  readonly usage: TenantUsageToday;
}

export interface ChatDeps {
  readonly env: AiEnv;
  readonly primary: LlmProvider;
  readonly fallback: LlmProvider;
  readonly search?: SearchPort | undefined;
  readonly listingCache?: TtlCache<ListingPromptView> | undefined;
}

export interface ChatAnswer {
  /** Texto plano. Nunca markdown, nunca links. */
  readonly text: string;
  /** `null` = el modelo contestó y el guard lo dejó pasar. */
  readonly handoff: HandoffReason | null;
  readonly waUrl: string;
  readonly waMessage: string;
  readonly provider: 'primary' | 'fallback' | 'none';
  readonly model: string | null;
  /** Tokens de entrada **medidos por nosotros**: es el número contra el que se asserta la dieta. */
  readonly promptTokens: number;
  /** Lo que reportó el proveedor, o nuestra estimación si no reporta. */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly guardViolations: readonly string[];
}

function answerFromHandoff(
  listing: PublicListingDTO,
  reason: HandoffReason,
  extra: {
    readonly provider: ChatAnswer['provider'];
    readonly model: string | null;
    readonly promptTokens: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly guardViolations: readonly string[];
  },
): ChatAnswer {
  const handoff = buildHandoff(listing, reason);
  return {
    text: handoff.text,
    handoff: handoff.reason,
    waUrl: handoff.waUrl,
    waMessage: handoff.waMessage,
    provider: extra.provider,
    model: extra.model,
    promptTokens: extra.promptTokens,
    tokensIn: extra.tokensIn,
    tokensOut: extra.tokensOut,
    guardViolations: extra.guardViolations,
  };
}

function requestFor(context: ChatContext, model: string, env: AiEnv, tools: LlmRequest['tools']): LlmRequest {
  return {
    model,
    system: context.system,
    messages: context.messages,
    temperature: env.temperature,
    maxOutputTokens: env.maxOutputTokens,
    tools,
  };
}

/**
 * Llama al primario y, si falla **por lo que sea**, al fallback.
 *
 * "Por lo que sea" incluye la respuesta vacía, no sólo la excepción: un 200 con `text: ""` es el
 * modo de falla más común de un modelo barato bajo carga, y tratarlo como éxito deja al comprador
 * mirando un globo vacío. R3 le da al primario riesgo de apagado en octubre 2026: **este camino se
 * ejerce en `chat.test.ts`, no se documenta y se espera lo mejor.**
 */
async function generateWithFallback(
  deps: ChatDeps,
  context: ChatContext,
  tools: LlmRequest['tools'],
): Promise<{ readonly result: LlmResult; readonly provider: 'primary' | 'fallback' }> {
  const attempts: readonly { readonly provider: 'primary' | 'fallback'; readonly llm: LlmProvider; readonly model: string }[] =
    [
      { provider: 'primary', llm: deps.primary, model: deps.env.primaryModel },
      { provider: 'fallback', llm: deps.fallback, model: deps.env.fallbackModel },
    ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt.llm.generate(requestFor(context, attempt.model, deps.env, tools));
      if (result.text.trim().length === 0 && result.toolCalls.length === 0) {
        failures.push(`${attempt.provider}: respuesta vacía`);
        continue;
      }
      return { result, provider: attempt.provider };
    } catch (error) {
      failures.push(`${attempt.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new AiError('AI_PROVIDER_FAILED', `primario y fallback fallaron → ${failures.join(' · ')}`);
}

/** Contesta. Nunca tira por culpa del modelo: si no puede contestar, deriva a WhatsApp. */
export async function answerChat(input: ChatInput, deps: ChatDeps): Promise<ChatAnswer> {
  assertChatEntitled(input.entitlement);
  // Antes de armar nada: sin medidor no hay techo de factura, y eso se falla cerrado y ruidoso.
  const messagesToday = requireMeasuredUsage(input.usage);

  const noTokens = { promptTokens: 0, tokensIn: 0, tokensOut: 0, guardViolations: [] as readonly string[] };

  if (softCapReached(messagesToday)) {
    return answerFromHandoff(input.listing, 'soft_cap', { provider: 'none', model: null, ...noTokens });
  }

  // Sobre el texto CRUDO, antes de sanitizar: sanitizar primero borra justo lo que hay que detectar.
  const intent = detectHandoffIntent(input.userMessage);
  if (intent !== null) {
    return answerFromHandoff(input.listing, intent, { provider: 'none', model: null, ...noTokens });
  }

  const runtime = createToolRuntime({ listing: input.listing, search: deps.search });
  let context = buildChatContext(
    {
      listing: input.listing,
      storeName: input.storeName,
      catalogModelId: input.catalogModelId,
      chunks: input.chunks,
      turns: input.turns,
      userMessage: input.userMessage,
    },
    { limit: deps.env.maxInputTokens, ...(deps.listingCache === undefined ? {} : { listingCache: deps.listingCache }) },
  );
  assertWithinBudget(context.budget);

  let promptTokens = context.budget.tokensIn;
  let provider: 'primary' | 'fallback' = 'primary';
  let result: LlmResult;

  try {
    const first = await generateWithFallback(deps, context, runtime.specs);
    result = first.result;
    provider = first.provider;
  } catch {
    return answerFromHandoff(input.listing, 'provider_down', { provider: 'none', model: null, ...noTokens });
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const call = result.toolCalls[0];
    if (call === undefined) break;

    let outcome;
    try {
      outcome = await runtime.run(call);
    } catch {
      // Una tool call mal formada es señal de que el modelo se perdió. No se reintenta: se deriva.
      return answerFromHandoff(input.listing, 'low_confidence', {
        provider,
        model: result.model,
        promptTokens,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        guardViolations: [],
      });
    }

    if (outcome.kind === 'handoff') {
      return answerFromHandoff(input.listing, outcome.reason, {
        provider,
        model: result.model,
        promptTokens,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        guardViolations: [],
      });
    }

    // El resultado de la tool vuelve como un turno más y el contexto se **re-arma y se re-mide**:
    // agregarlo a mano al array de mensajes saltearía la dieta justo en el turno más largo.
    const withToolResult: readonly ChatTurn[] = [
      ...input.turns,
      { role: 'user', content: input.userMessage },
      { role: 'assistant', content: `[${outcome.name}] ${outcome.content}` },
    ];
    context = buildChatContext(
      {
        listing: input.listing,
        storeName: input.storeName,
        catalogModelId: input.catalogModelId,
        chunks: input.chunks,
        turns: withToolResult,
        userMessage: input.userMessage,
      },
      { limit: deps.env.maxInputTokens, ...(deps.listingCache === undefined ? {} : { listingCache: deps.listingCache }) },
    );
    assertWithinBudget(context.budget);
    promptTokens = Math.max(promptTokens, context.budget.tokensIn);

    try {
      const next = await generateWithFallback(deps, context, runtime.specs);
      result = next.result;
      provider = next.provider;
    } catch {
      return answerFromHandoff(input.listing, 'provider_down', {
        provider: 'none',
        model: null,
        promptTokens,
        tokensIn: 0,
        tokensOut: 0,
        guardViolations: [],
      });
    }
  }

  const verdict = guardAnswer(result.text, input.listing, deps.env.maxOutputTokens);
  if (!verdict.ok) {
    return answerFromHandoff(input.listing, 'unsafe_output', {
      provider,
      model: result.model,
      promptTokens,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      guardViolations: verdict.violations,
    });
  }

  return {
    text: verdict.text,
    handoff: null,
    waUrl: input.listing.waUrl,
    waMessage: input.listing.waMessage,
    provider,
    model: result.model,
    promptTokens,
    tokensIn: result.tokensIn > 0 ? result.tokensIn : promptTokens,
    tokensOut: result.tokensOut > 0 ? result.tokensOut : countTokens(verdict.text),
    guardViolations: [],
  };
}
