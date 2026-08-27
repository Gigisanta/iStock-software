/**
 * Errores del dominio. TS puro: no dependen de ningún runtime ni framework.
 *
 * Regla: el dominio nunca "corrige" un input inválido en silencio cuando la corrección
 * implicaría publicar plata equivocada. Tira `DomainError` y el borde (Zod) decide el mensaje.
 */

export type DomainErrorCode =
  | 'FX_RATE_INVALID'
  | 'MONEY_INVALID'
  | 'WA_PHONE_INVALID'
  | 'RESERVATION_INVALID'
  | 'SLUG_INVALID'
  | 'LISTING_INVALID';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
