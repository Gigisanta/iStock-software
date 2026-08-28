/**
 * `@istock/ai` — el chatbot de vidriera: dieta de contexto, tools, handoff y evals.
 *
 * Reglas del paquete (`CLAUDE.md` §0 y §3, `docs/CHATBOT.md`):
 * - **≤1200 tokens de entrada, ≤180 de salida** por turno. Es una aserción medida, no un objetivo.
 * - `temperature: 0.2`. Sin thinking, sin reasoning tokens.
 * - Los IDs de modelo van por **env** (`LLM_PRIMARY_MODEL` / `LLM_FALLBACK_MODEL`). Nunca frontier
 *   en el hot path.
 * - El chatbot consume el **mismo `publicListingDTO`** que la vidriera. No tiene consulta propia.
 * - Sin memoria persistente, sin tools de escritura, sin embeddings por request.
 * - `tenant_id` no es argumento de ninguna tool: se inyecta server-side.
 * - Toda respuesta termina empujando al `wa.me` que armó `buildWaMessage` en `packages/domain`.
 *
 * Server-only. Nada de este paquete puede cruzar al browser.
 */

export { AiError, AI_ERROR_CODES, isAiError, type AiErrorCode } from './errors';

export {
  CACHE_TTL_MS,
  MAX_CATALOG_CHUNKS,
  MAX_HISTORY_TURNS,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_SEARCH_RESULTS,
  TEMPERATURE,
  assertWithinBudget,
  measurePrompt,
  type BudgetReport,
} from './budget';

export {
  MESSAGE_OVERHEAD_TOKENS,
  countMessageTokens,
  countTokens,
  normalizeForCount,
  truncateToTokens,
  type CountableMessage,
} from './tokens';

export {
  LLM_DRIVERS,
  aiEnv,
  parseAiEnv,
  resetAiEnvCache,
  type AiEnv,
  type LlmDriverName,
} from './env';

export {
  INTENT_PATTERNS,
  OUTPUT_PATTERNS,
  REDACTION_TAGS,
  detectForbiddenOutput,
  detectSensitiveIntent,
  type RedactionTag,
  type TermPattern,
} from './redaction';

export {
  AVAILABILITY_TEXT,
  DESCRIPTION_TOKEN_BUDGET,
  MAX_PAYMENT_METHODS,
  MAX_PICKUP_POINTS,
  listingPromptView,
  renderListingBlock,
  renderListingDigest,
  withPaymentMethodsKept,
  type ListingPromptView,
} from './listing-view';

export { CHUNK_TOKEN_BUDGET, renderChunks, selectChunks, type CatalogChunk } from './chunks';

export {
  CHAT_ROLES,
  TURN_TOKEN_BUDGET,
  USER_MESSAGE_TOKEN_BUDGET,
  normalizeUserMessage,
  trimTurns,
  type ChatRole,
  type ChatTurn,
} from './turns';

export {
  PROMPT_RULE_MARKERS,
  REQUIRED_PROMPT_RULES,
  buildSystemPrompt,
  type PromptRule,
} from './prompt';

export {
  TOOL_RESULT_TOKEN_BUDGET,
  buildChatContext,
  type BuildContextOptions,
  type ChatContext,
  type ChatContextInput,
  type ContextTrimReport,
} from './context';

export { createTtlCache, type TtlCache, type TtlCacheOptions } from './cache';

export {
  HANDOFF_COPY,
  HANDOFF_REASONS,
  MODEL_HANDOFF_REASONS,
  SERVER_HANDOFF_REASONS,
  buildHandoff,
  detectHandoffIntent,
  isModelHandoffReason,
  type HandoffReason,
  type HandoffResult,
  type ModelHandoffReason,
  type ServerHandoffReason,
} from './handoff';

export { GUARD_VIOLATIONS, guardAnswer, type GuardVerdict, type GuardViolation } from './guard';

export {
  createDownProvider,
  createStubProvider,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type LlmToolCall,
  type LlmToolParameters,
  type LlmToolSpec,
  type StubProvider,
  type StubProviderOptions,
  type StubTurn,
} from './provider';

export {
  TOOL_NAMES,
  TOOL_SPECS,
  createToolRuntime,
  toolBudgetTokens,
  toolSchemas,
  type SearchHit,
  type SearchPort,
  type ToolName,
  type ToolOutcome,
  type ToolRuntime,
  type ToolRuntimeDeps,
} from './tools';

export {
  SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY,
  assertChatEntitled,
  chatEntitlementSchema,
  requireMeasuredUsage,
  softCapReached,
  usageMeasured,
  usageUnmeasured,
  type ChatEntitlement,
  type MeasuredUsage,
  type TenantUsageToday,
  type UnmeasuredUsage,
} from './entitlement';

export {
  PRICE_PER_MTOK,
  costPerThousandMessages,
  priceFor,
  type TokenPrice,
} from './pricing';

export {
  MAX_BILLED_CALLS_PER_TURN,
  MAX_TOOL_ROUNDS,
  answerChat,
  chatRequestSchema,
  type BilledUsage,
  type ChatAnswer,
  type ChatDeps,
  type ChatInput,
  type ChatRequest,
} from './chat';
