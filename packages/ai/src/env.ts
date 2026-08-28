/**
 * Env del chatbot, validada con Zod (regla de la casa: Zod en todos los bordes).
 *
 * ## Los IDs de modelo van por env, y eso no es preferencia de estilo
 * `docs/research/llm-pricing.md` `[R3]` documenta **dos deprecaciones en tres meses** y le da al
 * primario riesgo de apagado en octubre 2026. Un ID hardcodeado es una salida de producción que
 * requiere deploy; un ID por env es un cambio de variable. `scripts/guard-leaks.sh` regla 11 lo
 * chequea mecánicamente y `scripts/ai-lint.mjs` A001 lo chequea otra vez desde adentro.
 *
 * ## La env puede BAJAR la dieta, nunca subirla
 * `LLM_MAX_INPUT_TOKENS` y `LLM_MAX_OUTPUT_TOKENS` se validan contra los techos de `budget.ts`.
 * Poner 4000 en Vercel no afloja la dieta: **rompe el arranque**. Si el techo tiene que subir, sube
 * en `docs/CHATBOT.md` y en `budget.ts`, con el LEAD mirando, no en un dashboard.
 *
 * ## B4 abierto
 * Sin keys el paquete funciona igual con `LLM_DRIVER=stub`: la dieta, la cadena primario→fallback,
 * el guard de salida y los evals no dependen de ninguna credencial. En producción el stub está
 * **prohibido** (mismo patrón que `MEDIA_DRIVER` en `packages/media`).
 */

import { z } from 'zod';
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, TEMPERATURE } from './budget';
import { AiError } from './errors';

export const LLM_DRIVERS = ['stub', 'live'] as const;
export type LlmDriverName = (typeof LLM_DRIVERS)[number];

/**
 * Familias de modelo prohibidas en el hot path, chequeadas **en runtime** sobre el valor de la env.
 *
 * Las tres primeras son `CLAUDE.md` §3: un frontier por mensaje de vidriera es fallo de la tarea,
 * y el fallo tiene que ocurrir en el arranque y no en la factura. La cuarta es el modelo de Groq
 * que quedó fuera del catálogo self-serve el 16/08/2026: sigue estando escrito en docs viejos y en
 * la cabeza de cualquiera que haya leído la versión anterior de `CLAUDE.md` §3.
 *
 * Los patrones se escriben sin el literal completo del nombre a propósito: el nombre literal de un
 * modelo prohibido dentro de `packages/ai` es exactamente lo que la regla 11 de
 * `scripts/guard-leaks.sh` sale a buscar, y un archivo no puede ser a la vez la defensa y el hallazgo.
 */
const FORBIDDEN_MODEL_PATTERNS: readonly { readonly re: RegExp; readonly why: string }[] = [
  { re: /(^|\/)claude(?![a-z])/iu, why: 'frontier de Anthropic: prohibido en el hot path (CLAUDE.md §3)' },
  { re: /(^|\/)gpt-[0-9]/iu, why: 'frontier de OpenAI: prohibido en el hot path (CLAUDE.md §3)' },
  { re: /(^|\/)o[1-4](-|$)/iu, why: 'familia de razonamiento de OpenAI: prohibida en el hot path (CLAUDE.md §3)' },
  { re: /^llama-3\.1-8b(?![a-z0-9])/iu, why: 'retirado por Groq el 16/08/2026 para free y developer tier (R3)' },
];

function assertModelAllowed(id: string, varName: string): void {
  for (const { re, why } of FORBIDDEN_MODEL_PATTERNS) {
    if (re.test(id)) {
      throw new AiError(
        'AI_CONFIG_INVALID',
        `${varName}="${id}" está prohibido: ${why}. Ver docs/research/llm-pricing.md.`,
      );
    }
  }
}

const modelId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._\-/]*$/iu, 'ID de modelo con forma inválida (esperaba algo tipo "familia-version-variante")');

const tokenCeiling = (ceiling: number, varName: string) =>
  z.coerce
    .number()
    .int()
    .positive()
    .max(ceiling, `${varName} no puede pasar de ${ceiling}: la dieta se baja por env, nunca se sube`);

const baseSchema = z.object({
  LLM_DRIVER: z.enum(LLM_DRIVERS).default('stub'),
  LLM_PRIMARY_MODEL: modelId,
  LLM_FALLBACK_MODEL: modelId,
  LLM_MAX_INPUT_TOKENS: tokenCeiling(MAX_INPUT_TOKENS, 'LLM_MAX_INPUT_TOKENS').default(MAX_INPUT_TOKENS),
  LLM_MAX_OUTPUT_TOKENS: tokenCeiling(MAX_OUTPUT_TOKENS, 'LLM_MAX_OUTPUT_TOKENS').default(MAX_OUTPUT_TOKENS),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().trim().optional(),
  GROQ_API_KEY: z.string().trim().optional(),
  /** La setea Vercel sola. Ausente = tu máquina, los evals o el gate. */
  VERCEL_ENV: z.string().trim().optional(),
});

const schema = baseSchema.superRefine((env, ctx) => {
  if (env.LLM_PRIMARY_MODEL === env.LLM_FALLBACK_MODEL) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_FALLBACK_MODEL'],
      message:
        'el fallback no puede ser el mismo modelo que el primario: el fallback existe porque el ' +
        'primario se puede apagar (R3: riesgo de shutdown en octubre 2026)',
    });
  }
  if (env.LLM_DRIVER === 'live') {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_GENERATIVE_AI_API_KEY'],
        message:
          'obligatoria con LLM_DRIVER=live. Usá el tier PAGO: el free tier de Gemini entrena con ' +
          'los prompts, y adentro del prompt va la conversación de un comprador real (R3 §7).',
      });
    }
    if (!env.GROQ_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message:
          'obligatoria con LLM_DRIVER=live. Un fallback sin credencial no es un fallback: es una ' +
          'caída con más pasos. Activá ZDR antes de producción.',
      });
    }
  }
  if (env.VERCEL_ENV === 'production' && env.LLM_DRIVER !== 'live') {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_DRIVER'],
      message:
        'en producción el driver tiene que ser "live". Con "stub" el chatbot contesta un texto ' +
        'canned a compradores reales y nadie se entera, porque no falla.',
    });
  }
});

export interface AiEnv {
  readonly driver: LlmDriverName;
  readonly primaryModel: string;
  readonly fallbackModel: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly hasGoogleKey: boolean;
  readonly hasGroqKey: boolean;
}

/**
 * Parsea y valida. Pura: recibe el mapa de env, no lee `process.env`. Eso la hace testeable sin
 * ensuciar el proceso, que es la única forma de tener un test por cada rama de arriba.
 */
export function parseAiEnv(source: Readonly<Record<string, string | undefined>>): AiEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join(' · ');
    throw new AiError('AI_CONFIG_INVALID', `env del chatbot inválida → ${detail}`);
  }
  const env = parsed.data;
  assertModelAllowed(env.LLM_PRIMARY_MODEL, 'LLM_PRIMARY_MODEL');
  assertModelAllowed(env.LLM_FALLBACK_MODEL, 'LLM_FALLBACK_MODEL');
  return {
    driver: env.LLM_DRIVER,
    primaryModel: env.LLM_PRIMARY_MODEL,
    fallbackModel: env.LLM_FALLBACK_MODEL,
    maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    // No es configurable: 0.2 es decisión de producto (docs/CHATBOT.md), no de operación.
    temperature: TEMPERATURE,
    hasGoogleKey: env.GOOGLE_GENERATIVE_AI_API_KEY !== undefined && env.GOOGLE_GENERATIVE_AI_API_KEY.length > 0,
    hasGroqKey: env.GROQ_API_KEY !== undefined && env.GROQ_API_KEY.length > 0,
  };
}

let cached: AiEnv | undefined;

/** Versión con `process.env`, memoizada. Server-only: nada de esto cruza al browser. */
export function aiEnv(): AiEnv {
  cached ??= parseAiEnv(process.env);
  return cached;
}

/** Para tests: olvida la memoización. */
export function resetAiEnvCache(): void {
  cached = undefined;
}
