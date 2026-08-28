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
import { buildChatContext, type ChatContext, type ContextTrimReport } from './context';
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
export const MAX_TOOL_ROUNDS = 1;

/** Rondas de modelo que puede tener un turno: la inicial más las de tool. */
const TURN_ROUNDS = 1 + MAX_TOOL_ROUNDS;

/**
 * Techo estructural de llamadas **facturadas** por turno. Es un número del producto, no una
 * curiosidad de implementación: `docs/COST.md` §2.8 costea el chat multiplicando por él.
 *
 * **Se DERIVA de la topología, y esa derivación es la mitad del punto.** Son `TURN_ROUNDS` rondas
 * y cada una paga al menos un proveedor; **una sola** puede pagar dos, porque el primario que
 * contesta vacío queda salteado por lo que reste del turno ({@link generateWithFallback}). De ahí
 * el `+ 1`, que es literalmente "el vacío del primario, una vez por turno". Antes del salteo el
 * término era `2 * TURN_ROUNDS` y el techo daba 4.
 *
 * **Estaba escrito como el literal `3` y eso era un bug de diseño, falsificado por el LEAD el
 * 2026-08-28.** El docblock afirmaba que vivir en el mismo archivo que `MAX_TOOL_ROUNDS` alcanzaba
 * para que el techo se enterara si alguien subía las rondas. No alcanza: **co-locar dos constantes
 * no crea una dependencia entre ellas.** Mutando `MAX_TOOL_ROUNDS = 1 → 2` el techo real pasaba a
 * 4, esta constante se quedaba en `3`, y la sección de tests del techo quedaba **entera en verde**;
 * el único rojo era un test de la sección de tools —una aserción sobre cuántas rondas hay, no
 * sobre la factura—, o sea justo el que quien sube las rondas a propósito va a actualizar, porque
 * su fallo se lee como "actualizame". Ahora el `=` lo hace el compilador y no la buena memoria.
 *
 * La derivación sola tampoco alcanza, y por eso hay dos aserciones y no una: si el número se
 * deriva, un cambio de topología lo mueve **en silencio**. `chat.test.ts` §"el techo facturable"
 * clava el literal `3` aparte y arma el peor caso ejerciendo `MAX_TOOL_ROUNDS` rondas de verdad,
 * así que subir las rondas o agregar un tercer proveedor pone en rojo la sección que habla de
 * plata. Si el número sube, sube en un diff que alguien firma.
 *
 * Lo exporta el paquete para que el log de `/api/chat` pueda alarmar contra él en vez de contra un
 * `2` mágico (C10). Un turno por encima de este número es un bug de control de flujo, no tráfico.
 */
export const MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1;

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
  /**
   * Tokens de entrada **medidos por nosotros**: es el número contra el que se asserta la dieta.
   *
   * **Es el MÁXIMO de los prompts del turno, no la suma, y por eso no sirve para la factura.** La
   * dieta es un techo por request (`≤1200`), así que la pregunta que contesta este número es "¿el
   * prompt más grande entró?". La factura hace otra pregunta —"¿cuánta entrada procesó el
   * proveedor?"— y en un turno con tool la respuesta es **dos prompts**. Usar éste para costear
   * subcontaba el turno con tool 2,16× (lo midió `cost-auditor`, C8). El número de la factura es
   * {@link ChatAnswer.billed}.
   */
  readonly promptTokens: number;
  /** Lo que reportó el proveedor, o nuestra estimación si no reporta. */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly guardViolations: readonly string[];
  /**
   * Qué tuvo que tirar la dieta para que este prompt entrara. `null` = **no se armó ningún
   * prompt**: el turno se resolvió antes (entitlement, soft cap, intención) y no hay nada que
   * reportar. No es lo mismo que "no se recortó nada", y por eso no es un objeto de ceros.
   *
   * Está en la firma pública porque la degradación **no aparece en la factura**: el prompt sigue
   * entrando en 1200, no se mueve ningún número, y lo que baja es la calidad de la respuesta. Sin
   * esto, el único modo de falla que el producto no puede ver es el que más le importa al tenant
   * que paga el plan Negocio — el chatbot se olvida de lo que el comprador dijo dos mensajes atrás
   * y nadie se entera. Lo miran la eval y, cuando exista, la telemetría de `apps/web`.
   */
  readonly trimmed: ContextTrimReport | null;
  /**
   * Lo que la **factura** ve de este turno: suma de todas las llamadas que un proveedor atendió.
   *
   * Un turno con tool paga el prompt **dos veces** (la segunda con el resultado adentro) y un
   * primario que contesta vacío paga una tercera. `promptTokens` es el máximo y `billed.tokensIn`
   * es la suma: son dos preguntas distintas y confundirlas es subcontar. `calls: 0` = el turno se
   * resolvió sin llamar a nadie y **cuesta cero**, que es la defensa más barata del sistema.
   *
   * `calls` está acotado por {@link MAX_BILLED_CALLS_PER_TURN} y es el campo que el log
   * estructurado de `/api/chat` tiene que emitir: `calls >= 3` es un turno que pagó una llamada
   * degradada (alguien contestó vacío), y `calls > MAX_BILLED_CALLS_PER_TURN` es imposible por
   * construcción, o sea un bug de control de flujo. Esa ruta todavía no existe y el campo la
   * espera armado.
   */
  readonly billed: BilledUsage;
}

/** Consumo facturable de un turno. Suma, no máximo. */
export interface BilledUsage {
  readonly calls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

/** Un turno que no llamó a ningún proveedor. */
const NOTHING_BILLED: BilledUsage = { calls: 0, tokensIn: 0, tokensOut: 0 };

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
    readonly trimmed: ContextTrimReport | null;
    readonly billed: BilledUsage;
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
    trimmed: extra.trimmed,
    billed: extra.billed,
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

/** Lo que una ronda le deja al turno: la respuesta, y lo que esa ronda le va a costar al tenant. */
interface RoundOutcome {
  readonly result: LlmResult;
  readonly provider: 'primary' | 'fallback';
  /**
   * Cuántas llamadas **atendió** un proveedor en esta ronda, y cuánta salida generaron entre todas.
   * Un primario que contesta vacío y obliga a ir al fallback igual se factura: el prompt entró, el
   * proveedor lo procesó, y la factura no distingue "vacío" de "útil". Una llamada que **tiró** no
   * se cuenta: ahí no hubo request atendido.
   */
  readonly servedCalls: number;
  readonly servedTokensOut: number;
  /**
   * El primario atendió y devolvió vacío. **No** se prende cuando el primario tira: una excepción
   * no se factura, así que saltearla no ahorra nada y sí resigna la respuesta del modelo mejor.
   */
  readonly primaryServedEmpty: boolean;
}

/**
 * Llama al primario y, si falla **por lo que sea**, al fallback.
 *
 * "Por lo que sea" incluye la respuesta vacía, no sólo la excepción: un 200 con `text: ""` es el
 * modo de falla más común de un modelo barato bajo carga, y tratarlo como éxito deja al comprador
 * mirando un globo vacío. R3 le da al primario riesgo de apagado en octubre 2026: **este camino se
 * ejerce en `chat.test.ts`, no se documenta y se espera lo mejor.**
 *
 * ## `skipPrimary`: un primario que ya contestó vacío no se reintenta en el mismo turno
 *
 * Decidido acá y a propósito, contra la lectura de que un vacío es transitorio (C11, 2026-08-28).
 * Dentro de un turno el reintento **no es un experimento independiente**, por tres motivos que se
 * acumulan:
 *
 * 1. **El prompt de la segunda ronda contiene al de la primera.** Es el mismo system, la misma
 *    ficha y el mismo historial, más el resultado de la tool. Si el vacío vino de un filtro de
 *    contenido —`SAFETY` / `RECITATION` / `OTHER` devuelven 200 sin candidatos— el disparador
 *    sigue adentro del prompt más largo. La probabilidad condicional de éxito no es la de base.
 * 2. **El otro modo de falla es descarte por capacidad, y su constante de tiempo es de minutos**,
 *    no del segundo que separa las dos rondas. Reintentar tan rápido es preguntar dos veces
 *    durante el mismo incidente.
 * 3. **La calidad ya se degradó y el reintento no la recupera.** Si el primario contestó vacío en
 *    la ronda 1, el que contestó fue el fallback: el turno YA se está sirviendo con el modelo
 *    chico. Volver al primario en la ronda 2 no repara la ronda 1, mezcla dos voces en la misma
 *    respuesta y encima paga una llamada entera por el intento.
 *
 * El costo del salteo está acotado a propósito: **es por turno, no persistente.** El mensaje
 * siguiente del comprador vuelve a empezar por el primario. No hay circuit breaker acá —
 * un estado que sobrevive al turno necesita dueño, ventana y reset, y este paquete no tiene reloj.
 *
 * Lo que compra: el techo facturable del turno baja de 4 a {@link MAX_BILLED_CALLS_PER_TURN} = 3,
 * −25% del peor caso y −29% del techo de gasto mensual del chat, **sin tocar la dieta, ni el soft
 * cap, ni una sola respuesta que hoy se conteste bien.**
 */
async function generateWithFallback(
  deps: ChatDeps,
  context: ChatContext,
  tools: LlmRequest['tools'],
  options: { readonly skipPrimary: boolean } = { skipPrimary: false },
): Promise<RoundOutcome> {
  const chain: readonly { readonly provider: 'primary' | 'fallback'; readonly llm: LlmProvider; readonly model: string }[] =
    [
      { provider: 'primary', llm: deps.primary, model: deps.env.primaryModel },
      { provider: 'fallback', llm: deps.fallback, model: deps.env.fallbackModel },
    ];
  const attempts = options.skipPrimary ? chain.filter((attempt) => attempt.provider !== 'primary') : chain;
  // El salteo entra al mensaje de error: si los dos caminos mueren, el que lea el log tiene que ver
  // que el primario no se intentó y por qué, no una lista de un solo proveedor sin explicación.
  const failures: string[] = options.skipPrimary
    ? ['primario: salteado, ya había contestado vacío en este turno']
    : [];
  let servedCalls = 0;
  let servedTokensOut = 0;
  let primaryServedEmpty = false;
  for (const attempt of attempts) {
    try {
      const result = await attempt.llm.generate(requestFor(context, attempt.model, deps.env, tools));
      servedCalls += 1;
      servedTokensOut += result.tokensOut;
      if (result.text.trim().length === 0 && result.toolCalls.length === 0) {
        failures.push(`${attempt.provider}: respuesta vacía`);
        if (attempt.provider === 'primary') primaryServedEmpty = true;
        continue;
      }
      return { result, provider: attempt.provider, servedCalls, servedTokensOut, primaryServedEmpty };
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

  // Sin prompt armado no hay recorte que reportar, y `trimmed: null` lo dice: un objeto de ceros
  // diría "no se recortó nada", que es una afirmación sobre un prompt que nunca existió.
  const noTokens = {
    promptTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    guardViolations: [] as readonly string[],
    trimmed: null,
    billed: NOTHING_BILLED,
  };

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

  // `promptTokens` es la cota de la DIETA (máximo) y `billed` es la FACTURA (suma). Dos números
  // porque son dos preguntas: uno responde "¿entró?", el otro "¿cuánto se procesó?".
  let promptTokens = context.budget.tokensIn;
  let billed: BilledUsage = NOTHING_BILLED;
  const addBilled = (servedCalls: number, servedTokensOut: number): void => {
    billed = {
      calls: billed.calls + servedCalls,
      tokensIn: billed.tokensIn + context.budget.tokensIn * servedCalls,
      tokensOut: billed.tokensOut + servedTokensOut,
    };
  };
  let provider: 'primary' | 'fallback' = 'primary';
  let result: LlmResult;
  // Estado del primario DENTRO del turno. Nace en `false` en cada `answerChat`: no sobrevive al
  // turno y por eso no necesita ventana ni reset (ver `generateWithFallback`).
  let primaryDegraded = false;

  try {
    const first = await generateWithFallback(deps, context, runtime.specs);
    result = first.result;
    provider = first.provider;
    primaryDegraded = first.primaryServedEmpty;
    addBilled(first.servedCalls, first.servedTokensOut);
  } catch {
    // El prompt SÍ se armó acá, así que su recorte se reporta aunque no se haya facturado nada: la
    // degradación describe lo que la dieta tuvo que tirar, no lo que salió en la factura.
    return answerFromHandoff(input.listing, 'provider_down', {
      provider: 'none',
      model: null,
      ...noTokens,
      trimmed: context.trimmed,
      billed,
    });
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
        trimmed: context.trimmed,
        billed,
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
        trimmed: context.trimmed,
        billed,
      });
    }

    // El resultado de la tool vuelve al contexto y el contexto se **re-arma y se re-mide**:
    // agregarlo a mano al array de mensajes saltearía la dieta justo en el turno más largo.
    //
    // Va por `toolResult` y **no** metido en `turns`, que es donde estaba. Adentro de `turns` lo
    // agarraba `trimTurns`, que lo re-sanitizaba —borrándole los delimitadores que `tools.ts`
    // acababa de ponerle— y lo cortaba a 45 tokens, el presupuesto de un turno viejo de historial.
    // Medido sobre una ficha `reserved`, el `RESERVADO` se perdía en ese corte.
    const withCurrentTurn: readonly ChatTurn[] = [
      ...input.turns,
      { role: 'user', content: input.userMessage },
    ];
    context = buildChatContext(
      {
        listing: input.listing,
        storeName: input.storeName,
        catalogModelId: input.catalogModelId,
        chunks: input.chunks,
        turns: withCurrentTurn,
        userMessage: input.userMessage,
        toolResult: `[${outcome.name}] ${outcome.content}`,
      },
      { limit: deps.env.maxInputTokens, ...(deps.listingCache === undefined ? {} : { listingCache: deps.listingCache }) },
    );
    assertWithinBudget(context.budget);
    promptTokens = Math.max(promptTokens, context.budget.tokensIn);

    try {
      const next = await generateWithFallback(deps, context, runtime.specs, { skipPrimary: primaryDegraded });
      result = next.result;
      provider = next.provider;
      // El `||` no es defensivo de más: con `MAX_TOOL_ROUNDS > 1` la degradación tiene que
      // arrastrarse a la ronda siguiente, no reevaluarse desde cero en cada vuelta.
      primaryDegraded = primaryDegraded || next.primaryServedEmpty;
      addBilled(next.servedCalls, next.servedTokensOut);
    } catch {
      return answerFromHandoff(input.listing, 'provider_down', {
        provider: 'none',
        model: null,
        promptTokens,
        tokensIn: 0,
        tokensOut: 0,
        guardViolations: [],
        trimmed: context.trimmed,
        billed,
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
      trimmed: context.trimmed,
      billed,
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
    trimmed: context.trimmed,
    billed,
  };
}
