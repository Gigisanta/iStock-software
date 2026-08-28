/**
 * Errores de `@istock/ai`. Mismo patrón que `DomainError`: código estable + mensaje que le sirve
 * a quien lo lea en Sentry a las 11 de la noche.
 */

export const AI_ERROR_CODES = [
  /** Env inválida: modelo prohibido, techo de dieta por encima del constitucional, driver sin key. */
  'AI_CONFIG_INVALID',
  /** El contexto no entra en la dieta ni después de recortar todo lo recortable. */
  'AI_BUDGET_EXCEEDED',
  /** Primario y fallback fallaron. El caller deriva a WhatsApp. */
  'AI_PROVIDER_FAILED',
  /** El plan del tenant no incluye chat. En Base el widget ni siquiera existe en el DOM. */
  'AI_NOT_ENTITLED',
  /** Entrada mal formada en el borde del paquete. */
  'AI_INPUT_INVALID',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiError';
    this.code = code;
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}
