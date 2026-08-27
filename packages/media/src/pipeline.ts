/**
 * Pipeline de resize. **Encode propio con sharp, no transformaciones on-the-fly** (ADR-006).
 *
 * ```
 * bytes del celular (12MP, ~4MB)
 *   → decode UNA vez + auto-orient por EXIF
 *   → downscale a un intermedio RAW de 1600px           ← el 12MP muere acá
 *   → 4 encodes WebP desde ese RAW: master / detail / card / thumb
 * ```
 *
 * Por qué el intermedio RAW y no re-decodificar el original 4 veces: cuesta ~1 decode en vez de 4
 * (el decode del 12MP es el grueso del CPU) y evita doble compresión — `detail` no se genera a
 * partir del WebP del master sino del mismo RAW.
 *
 * **EXIF se descarta.** sharp no copia metadata salvo que se pida `withMetadata()`, y no se pide:
 * la foto del dueño trae GPS y modelo de cámara. Eso es PII y no entra a un bucket público.
 *
 * Cada variante se encodea con **descenso adaptativo de calidad** hasta entrar en su techo de
 * bytes. Si ni con la calidad mínima entra, se lanza `VariantBudgetExceededError`: el presupuesto
 * se hace cumplir en runtime, no sólo en el test.
 */

import sharp from 'sharp';
import type { Metadata, OutputInfo, Sharp } from 'sharp';
import {
  MASTER_SPEC,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_EDGE,
  VARIANT_SPECS,
  assertWithinBudget,
  qualityLadder,
  type BudgetTable,
  type EncodeSpec,
} from './budgets';
import { UnsupportedImageError, VariantBudgetExceededError } from './errors';
import { VARIANTS, type Variant } from './types';

/** Formatos que aceptamos del dueño. SVG queda afuera a propósito (XSS + bombas). */
const ALLOWED_INPUT_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'avif', 'heif', 'tiff']);

export const OUTPUT_CONTENT_TYPE = 'image/webp';

export interface EncodedImage {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly quality: number;
  /** Cuántos encodes hicieron falta hasta entrar en el techo. 1 = entró de una. */
  readonly attempts: number;
  /** Sigma del denoise de último recurso. 0 = la foto salió sin tocar. */
  readonly blurSigma: number;
  /** `true` si hubo que bajar calidad o denoisear para entrar en el techo. */
  readonly degraded: boolean;
  /** `false` sólo puede pasar en el master, que tiene techo blando. Ver `encodeWithinBudget`. */
  readonly withinBudget: boolean;
}

export interface SourceInfo {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

export interface BuiltVariants {
  readonly source: SourceInfo;
  readonly master: EncodedImage;
  readonly variants: Readonly<Record<Variant, EncodedImage>>;
  /**
   * `false` si el master no entró en sus 350 KB ni al mínimo de calidad. **No aborta el upload**:
   * el master vive en un bucket privado, no se sirve nunca y su costo es sólo storage
   * (~USD 0.0000105/mes por 350 KB extra). Rechazar la foto del dueño por eso sería peor.
   * Se devuelve para que `cost-auditor` lo pueda contar.
   */
  readonly masterWithinBudget: boolean;
  /** Milisegundos de CPU de sharp. Lo consume `cost-auditor`. */
  readonly encodeMs: number;
}

export interface BuildVariantsOptions {
  /** Override de techos. Sólo para tests del gate. */
  readonly budgets?: BudgetTable;
  /** Override de specs. Sólo para tests / benchmarks. */
  readonly specs?: Partial<Record<Variant, EncodeSpec>>;
}

/** Denoise de último recurso, en sigma. Sólo se usa si la escalera de calidad no alcanzó. */
const BLUR_RESCUE_SIGMAS = [1.0, 1.6] as const;

/**
 * Encodea a WebP bajando la calidad hasta entrar en `spec.budgetBytes`.
 * Determinista: mismo input + misma libwebp ⇒ mismo byte de salida ⇒ misma key.
 *
 * ## Dos políticas, porque son dos objetos distintos
 *
 * `mode: 'public'` — las tres variantes que se sirven por CDN. El techo es **ley**: primero baja
 * la calidad; si aun así no entra, aplica un denoise (`blur`) creciente, que es lo que hace
 * cualquier pipeline serio con una foto ruidosa. Recién si nada alcanza, **lanza**. Nunca sale
 * una variante pesada a la vidriera: eso es lo que audita `docs/COST.md`.
 *
 * `mode: 'archive'` — el master. **No se blurea nunca** (su razón de ser es poder re-encodear las
 * variantes el día que cambiemos tamaños) y **no rechaza la foto**: si no entra en 350 KB, se
 * guarda igual con `withinBudget: false`. Vive en un bucket privado, no se sirve, y su exceso
 * cuesta storage y nada más.
 *
 * El caso normal es `attempts === 1` y `blurSigma === 0`. El test de aceptación lo verifica: si
 * la foto de referencia empieza a necesitar degradación, algo cambió y hay que mirarlo.
 */
async function encodeWithinBudget(
  make: () => Sharp,
  spec: EncodeSpec,
  label: string,
  budgetBytes: number,
  mode: 'public' | 'archive',
): Promise<EncodedImage> {
  const plan: { quality: number; blurSigma: number }[] = qualityLadder(spec).map((quality) => ({
    quality,
    blurSigma: 0,
  }));
  if (mode === 'public') {
    for (const blurSigma of BLUR_RESCUE_SIGMAS) {
      plan.push({ quality: spec.minQuality, blurSigma });
    }
  }

  let attempts = 0;
  let last: { buffer: Buffer; info: OutputInfo; quality: number; blurSigma: number } | null =
    null;

  for (const step of plan) {
    attempts += 1;
    let pipe = make().resize({
      width: spec.maxEdge,
      height: spec.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
    if (step.blurSigma > 0) pipe = pipe.blur(step.blurSigma);

    const { data, info } = await pipe
      .webp({ quality: step.quality, effort: spec.effort, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    last = { buffer: data, info, quality: step.quality, blurSigma: step.blurSigma };
    if (data.byteLength <= budgetBytes) {
      return {
        bytes: data,
        byteLength: data.byteLength,
        width: info.width,
        height: info.height,
        quality: step.quality,
        attempts,
        blurSigma: step.blurSigma,
        degraded: step.quality < spec.quality || step.blurSigma > 0,
        withinBudget: true,
      };
    }
  }

  if (mode === 'public' || last === null) {
    throw new VariantBudgetExceededError({
      variant: label,
      byteLength: last?.buffer.byteLength ?? 0,
      budgetBytes,
      quality: last?.quality ?? spec.minQuality,
    });
  }

  return {
    bytes: last.buffer,
    byteLength: last.buffer.byteLength,
    width: last.info.width,
    height: last.info.height,
    quality: last.quality,
    attempts,
    blurSigma: last.blurSigma,
    degraded: true,
    withinBudget: false,
  };
}

export async function buildVariants(
  input: Uint8Array,
  options: BuildVariantsOptions = {},
): Promise<BuiltVariants> {
  const started = Date.now();
  const source = sharp(Buffer.from(input), {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: 'error',
    animated: false,
  });

  let metadata: Metadata;
  try {
    metadata = await source.metadata();
  } catch (cause) {
    throw new UnsupportedImageError(`no se pudo decodificar (${(cause as Error).message})`);
  }

  const format = metadata.format ?? 'desconocido';
  if (!ALLOWED_INPUT_FORMATS.has(format)) {
    throw new UnsupportedImageError(format);
  }
  if (!metadata.width || !metadata.height) {
    throw new UnsupportedImageError('sin dimensiones');
  }

  // Un solo decode + un solo downscale a 1600px. De acá salen las 4 salidas.
  // `rotate()` sin argumentos aplica la orientación EXIF y después la descarta.
  const { data: raw, info: rawInfo } = await source
    .rotate()
    .resize({
      width: MAX_OUTPUT_EDGE,
      height: MAX_OUTPUT_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const makeBase = (): Sharp =>
    sharp(raw, {
      raw: { width: rawInfo.width, height: rawInfo.height, channels: rawInfo.channels },
    });

  const master = await encodeWithinBudget(
    makeBase,
    MASTER_SPEC,
    'master',
    MASTER_SPEC.budgetBytes,
    'archive',
  );

  const variants = {} as Record<Variant, EncodedImage>;
  for (const variant of VARIANTS) {
    const spec = options.specs?.[variant] ?? VARIANT_SPECS[variant];
    const budgetBytes = options.budgets?.[variant] ?? spec.budgetBytes;
    const encoded = await encodeWithinBudget(makeBase, spec, variant, budgetBytes, 'public');
    // Gate redundante a propósito: si alguien afloja la escalera, esto sigue frenando.
    assertWithinBudget(variant, encoded.byteLength, {
      ...(options.budgets ? { budgets: options.budgets } : {}),
      quality: encoded.quality,
    });
    variants[variant] = encoded;
  }

  return {
    source: {
      format,
      width: metadata.width,
      height: metadata.height,
      byteLength: input.byteLength,
    },
    master,
    masterWithinBudget: master.withinBudget,
    variants: Object.freeze(variants),
    encodeMs: Date.now() - started,
  };
}
