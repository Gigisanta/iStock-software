/**
 * Errores de `packages/media`. Todos llevan `code` estable para que el borde HTTP pueda
 * mapear a un status sin parsear mensajes.
 *
 * Regla de log: **nunca** se loguea el buffer, ni el nombre de archivo original, ni la
 * `masterKey`. Sólo `code` + medidas.
 */

export type MediaErrorCode =
  | 'MEDIA_UNSUPPORTED_IMAGE'
  | 'MEDIA_IMAGE_TOO_LARGE'
  | 'MEDIA_BUDGET_EXCEEDED'
  | 'MEDIA_UNSAFE_KEY'
  | 'MEDIA_CONFIG'
  | 'MEDIA_STORAGE'
  | 'MEDIA_FORBIDDEN_DELETE';

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.code = code;
    this.name = new.target.name;
  }
}

export class UnsupportedImageError extends MediaError {
  constructor(detail: string) {
    super('MEDIA_UNSUPPORTED_IMAGE', `Formato de imagen no soportado: ${detail}`);
  }
}

export class ImageTooLargeError extends MediaError {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(byteLength: number, maxBytes: number) {
    super('MEDIA_IMAGE_TOO_LARGE', `La imagen pesa ${byteLength} bytes; el máximo es ${maxBytes}.`);
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

/**
 * Se lanza cuando una variante no entra en su presupuesto de bytes ni bajando la calidad
 * hasta el piso. Es un **fallo de costo**, no un warning: `docs/COST.md` lo trata como FAIL.
 */
export class VariantBudgetExceededError extends MediaError {
  readonly variant: string;
  readonly byteLength: number;
  readonly budgetBytes: number;
  readonly quality: number;

  constructor(params: { variant: string; byteLength: number; budgetBytes: number; quality: number }) {
    super(
      'MEDIA_BUDGET_EXCEEDED',
      `La variante "${params.variant}" pesa ${params.byteLength} bytes y su techo es ` +
        `${params.budgetBytes} bytes (calidad mínima probada: ${params.quality}).`,
    );
    this.variant = params.variant;
    this.byteLength = params.byteLength;
    this.budgetBytes = params.budgetBytes;
    this.quality = params.quality;
  }
}

/** Key que no cumple el contrato de ADR-006 (opaca, sin tenant/listing, sin PII). */
export class UnsafeMediaKeyError extends MediaError {
  readonly reason: string;

  constructor(reason: string) {
    super('MEDIA_UNSAFE_KEY', `Key de media rechazada: ${reason}`);
    this.reason = reason;
  }
}

export class MediaConfigError extends MediaError {
  constructor(message: string) {
    super('MEDIA_CONFIG', message);
  }
}

export class MediaStorageError extends MediaError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('MEDIA_STORAGE', message, options);
  }
}

/**
 * Borrar un objeto de R2 por key es **borrado cruzado entre tenants** (la key es
 * content-addressed: dos tenants que suben la misma foto comparten el byte).
 * `CLAUDE.md` §2 lo marca como causal de rechazo. Este error existe para que el intento
 * explote en runtime y no en producción.
 */
export class ForbiddenObjectDeleteError extends MediaError {
  constructor(key: string, reason: string) {
    super(
      'MEDIA_FORBIDDEN_DELETE',
      `Borrado de objeto bloqueado (${reason}). La key ${key.slice(0, 8)}… puede estar ` +
        'referenciada por otro tenant: se borra el mapeo, no el byte.',
    );
  }
}
