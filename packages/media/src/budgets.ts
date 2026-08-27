/**
 * Presupuesto de bytes por variante. **Es un gate de aceptación, no un ideal.**
 *
 * Los techos salen de `docs/research/r2-images.md` §"Impacto en iStock / COST", que es más
 * estricto que el contrato del agente en `detail` (250KB vs 400KB). Se toma el más estricto:
 * cumplir 250KB cumple los dos.
 *
 * | variante | lado mayor | techo   | dónde se usa                 |
 * |----------|-----------:|--------:|------------------------------|
 * | thumb    |      200px |   25 KB | grilla densa del panel       |
 * | card     |      800px |  150 KB | grilla de la vidriera        |
 * | detail   |     1600px |  250 KB | ficha pública                |
 * | master   |     1600px |  350 KB | archivo privado, NO se sirve |
 *
 * KB = KiB = 1024 bytes. Total ≤ 775 KB por foto, de los cuales **≤425 KB son públicos**.
 */

import { VariantBudgetExceededError } from './errors';
import { VARIANTS, type Variant } from './types';

const KB = 1024;

export interface EncodeSpec {
  /** Lado mayor en px. `fit: inside` + `withoutEnlargement`. */
  readonly maxEdge: number;
  /** Techo duro de bytes del output. Superarlo es FAIL de costo. */
  readonly budgetBytes: number;
  /** Calidad WebP inicial. */
  readonly quality: number;
  /** Piso de calidad del descenso adaptativo. Debajo de esto se prefiere fallar. */
  readonly minQuality: number;
  /** `effort` de libwebp (0–6). Más alto = menos bytes y más CPU. */
  readonly effort: number;
}

export const VARIANT_SPECS: Readonly<Record<Variant, EncodeSpec>> = Object.freeze({
  thumb: { maxEdge: 200, budgetBytes: 25 * KB, quality: 72, minQuality: 45, effort: 4 },
  card: { maxEdge: 800, budgetBytes: 150 * KB, quality: 78, minQuality: 45, effort: 4 },
  detail: { maxEdge: 1600, budgetBytes: 250 * KB, quality: 78, minQuality: 45, effort: 4 },
});

/**
 * El master es un **archivo**, no una variante. Vive en `istock-originals` (privado) y ya viene
 * resizeado a 1600px: el 12MP del celular del dueño no entra a R2 tal cual (regla 1 del oficio).
 *
 * Su techo es **blando**: si una foto de textura extrema no entra en 350 KB ni al mínimo de
 * calidad, se guarda igual y se reporta `masterWithinBudget: false`. Motivo: el master no se sirve
 * nunca, así que su exceso es sólo storage privado (~USD 0.0000105/mes por 350 KB de más).
 * Rechazarle la foto al dueño por el archivo interno sería el trade-off equivocado.
 * Los techos de las tres variantes públicas, en cambio, son **duros**: lanzan.
 */
export const MASTER_SPEC: EncodeSpec = Object.freeze({
  maxEdge: 1600,
  budgetBytes: 350 * KB,
  quality: 90,
  minQuality: 55,
  effort: 4,
});

/** Máximo del archivo que aceptamos del browser antes de decodificar. 12MP JPEG ≈ 4–8 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Techo de píxeles del decode, contra decompression bombs. 50 MP. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Lado mayor absoluto que puede salir del pipeline. Regla 1: nunca más de 1600px. */
export const MAX_OUTPUT_EDGE = 1600;

export type BudgetTable = Readonly<Record<Variant, number>>;

export const VARIANT_BUDGETS: BudgetTable = Object.freeze(
  Object.fromEntries(VARIANTS.map((v) => [v, VARIANT_SPECS[v].budgetBytes])) as Record<
    Variant,
    number
  >,
);

/**
 * Gate. Lanza `VariantBudgetExceededError` si la variante se pasó del techo.
 * Se llama **dentro** del pipeline, no sólo en los tests: el presupuesto se hace cumplir en
 * runtime, así una foto rara no llega a la vidriera pesando 900KB.
 */
export function assertWithinBudget(
  variant: Variant,
  byteLength: number,
  options?: { budgets?: BudgetTable; quality?: number },
): void {
  const budgets = options?.budgets ?? VARIANT_BUDGETS;
  const budgetBytes = budgets[variant];
  if (byteLength > budgetBytes) {
    throw new VariantBudgetExceededError({
      variant,
      byteLength,
      budgetBytes,
      quality: options?.quality ?? VARIANT_SPECS[variant].minQuality,
    });
  }
}

/** Escalera de calidad del descenso adaptativo: de `quality` a `minQuality`, de a 6. */
export function qualityLadder(spec: EncodeSpec, step = 6): readonly number[] {
  const ladder: number[] = [];
  for (let q = spec.quality; q >= spec.minQuality; q -= step) ladder.push(q);
  const last = ladder[ladder.length - 1];
  if (last !== undefined && last !== spec.minQuality) ladder.push(spec.minQuality);
  return ladder;
}
