/**
 * El **borde** del alta de una unidad. `CLAUDE.md` §5: Zod en todos los bordes, y un `FormData`
 * es un borde igual que un webhook — llega por POST desde cualquier lado, no sólo desde el
 * formulario que escribimos nosotros.
 *
 * Tres cosas que este archivo hace y que no son ceremonia:
 *
 * 1. **Los rangos son los mismos que los `CHECK` de Postgres** (`packages/db/src/schema/listings.ts`):
 *    `battery_pct between 0 and 100`, `storage_gb > 0`, `price_usd > 0`, `imei ~ '^[0-9]{15}$'`.
 *    No es duplicación decorativa: sin esto, un dato malo viaja hasta el `insert` y vuelve como un
 *    error de constraint de Postgres, cuyo mensaje **incluye la fila que lo violó** — o sea, el
 *    IMEI, en un log. Se rechaza acá, con un mensaje en castellano y por campo.
 * 2. **La condición sale de `@istock/domain`** (`isCondition`), no de una lista local. Dos listas
 *    de condiciones es cómo se termina con un `select` que Postgres rechaza por enum.
 * 3. **La foto se valida antes de tocar el pipeline**: tipo y peso. Decodificar un archivo de
 *    40 MB para descubrir que era un PDF es CPU regalada.
 *
 * **Entra UNA foto por request.** No es una simplificación de la UI: es el techo de plataforma de
 * 4 MB del Routing Middleware de Vercel, que corre sobre el POST del alta porque `proxy.ts` lo
 * matchea. Ver `MAX_PHOTO_BYTES` acá abajo y el bloque de `next.config.ts`.
 *
 * `title` está en el schema sólo para conservar el valor visible del formulario: la unidad se
 * nombra desde el catálogo en el server y el texto del browser no es una fuente de verdad.
 * `costUsd` está en el schema pero **no lo parsea cualquiera**: la Server Action sólo lo mira si
 * el rol es `owner` (`CLAUDE.md` §0.9). Ver `actions.ts`.
 */

import { z } from 'zod';
import { CONDITIONS, DEFAULT_MAX_DESCRIPTION_LENGTH, isCondition } from '@istock/domain';
import { MAX_UPLOAD_BYTES } from '@istock/media';
import { parseUsdToCents } from './parse-money';

export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 120;

/**
 * Cuántas fotos entran en una ficha. 8 es más de lo que nadie saca de un teléfono en un local.
 * Sigue siendo el techo del listing; ahora se alcanza **de a una**, en `/app/stock/{id}/fotos`.
 */
export const MAX_PHOTOS_PER_LISTING = 8;

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Techo por archivo: 3 MB. Por qué 3 y no 8.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Antes decía 8 MiB, y estaba mal: elegía un número mirando la cámara del cliente en vez de la
 * plataforma que transporta el byte. Debajo nuestro hay una **cadena de techos**, y el más bajo de
 * los ajenos gana siempre (verificados por el LEAD contra la doc oficial de Vercel el 2026-08-27,
 * `docs/research/vercel-request-body-limit.md`):
 *
 * ```
 *   3 MB (este cap, Zod, mensaje en castellano)
 *     <  3.5 MB  experimental.serverActions.bodySizeLimit  → Next tira 413
 *     <  4   MB  Routing Middleware (nuestro `proxy.ts`)   → lo pone Vercel, NO varía por plan
 *     <  4.5 MB  Vercel Function                           → lo pone Vercel
 * ```
 *
 * Cada eslabón tiene aire bajo el siguiente **a propósito**: queremos que el rechazo lo escriba
 * Zod, en castellano y por campo, y no que la plataforma corte la conexión con una página en
 * inglés que el dueño lee parado en el mostrador. Con 8 MiB acá, el cap nuestro nunca disparaba:
 * disparaba el 413 de Next, que es exactamente el error que nadie puede explicar.
 *
 * El techo de 4 MB del middleware es el que manda de verdad. No se saca el POST del `matcher` de
 * `proxy.ts` para ganar los 0.5 MB que faltan hasta el de la función: ahí corre
 * `stripInboundTenantHeaders()`, y cambiar una defensa de tenant por medio mega es un mal negocio.
 *
 * `Math.min` con `MAX_UPLOAD_BYTES` se queda: si algún día `packages/media` baja su propio techo,
 * este baja solo. Rechazar acá, antes de `uploadListingPhoto`, ahorra el decode.
 *
 * Corolario que vive en el cliente: `_ui/downscale-photo.ts` achica **sólo** si el archivo pasa
 * este cap. Bajo el cap el byte original viaja intacto — ver el comentario de ese archivo.
 */
export const MAX_PHOTO_BYTES = Math.min(3 * 1024 * 1024, MAX_UPLOAD_BYTES);

/** El cap en MB, redondeado, para escribirlo en un mensaje sin repetir la cuenta en cada lugar. */
export const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

/**
 * Tipos que el pipeline sabe decodificar (`ALLOWED_INPUT_FORMATS` de `packages/media`).
 * **SVG queda afuera a propósito**: es XSS y bomba de descompresión, no una foto.
 */
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
]);

/** Lo que va en el `accept` del `<input type="file">`. Se deriva de la misma lista. */
export const PHOTO_ACCEPT_ATTR = [...ACCEPTED_IMAGE_TYPES].join(',');

const optionalText = (max: number) =>
  z
    .string()
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .pipe(z.string().max(max, `No puede pasar de ${String(max)} caracteres.`))
    .transform((value) => (value === '' ? null : value));

const optionalIntInRange = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((raw) => raw.trim())
    .transform((raw, ctx) => {
      if (raw === '') return null;
      if (!/^\d{1,6}$/u.test(raw)) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      const value = Number(raw);
      if (value < min || value > max) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return value;
    });

const requiredMoney = z
  .string({ error: 'Poné el precio en dólares.' })
  .transform((raw, ctx) => {
    const parsed = parseUsdToCents(raw);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.reason });
      return z.NEVER;
    }
    // `listings_price_positive`: `price_usd > 0`. Un equipo a USD 0 no es una oferta, es un typo.
    if (parsed.cents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'El precio tiene que ser mayor a cero.' });
      return z.NEVER;
    }
    return parsed.cents;
  });

const optionalMoney = z.string().transform((raw, ctx) => {
  if (raw.trim() === '') return null;
  const parsed = parseUsdToCents(raw);
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.reason });
    return z.NEVER;
  }
  return parsed.cents;
});

/**
 * IMEI. 15 dígitos, bloqueante, igual que el `CHECK listings_imei_format`.
 * **Luhn no se valida acá**: `packages/db` lo deja escrito con todas las letras — *"un gate de
 * alta que rechaza stock es peor que un warning que el dueño ignora"*. El warning se muestra en
 * pantalla (ver `actions.ts`), no bloquea.
 */
const optionalImei = z
  .string()
  .transform((raw) => raw.replace(/[\s-]/gu, ''))
  .transform((raw, ctx) => {
    if (raw === '') return null;
    if (!/^\d{15}$/u.test(raw)) {
      ctx.addIssue({ code: 'custom', message: 'El IMEI son 15 números, sin letras ni espacios.' });
      return z.NEVER;
    }
    return raw;
  });

export const newUnitSchema = z.object({
  title: z
    .string()
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .pipe(
      z
        .string()
        .max(TITLE_MAX_LENGTH, `El nombre no puede pasar de ${String(TITLE_MAX_LENGTH)} caracteres.`),
    )
    .optional()
    .default(''),

  condition: z
    .string({ error: 'Elegí en qué estado está el equipo.' })
    .refine(isCondition, 'Elegí una condición de la lista.')
    .transform((value) => value as (typeof CONDITIONS)[number]),

  /**
   * **Obligatorio, y no es burocracia.** `checkPublishable()` de `@istock/domain` deniega
   * `missing_catalog_model` para todo `kind: 'unit'` sin modelo, así que una unidad cargada con
   * texto libre nace impublicable: no entra a la vidriera, no la puede filtrar el visitante y el
   * chatbot de FASE 5 no la puede contestar. Pedirlo en el alta es más barato que fabricar
   * borradores que nadie puede publicar.
   *
   * Es un `uuid` de `catalog_models`, la tabla **global** (sin `tenant_id`, `SELECT` para
   * `authenticated`). Que el uuid exista lo verifica la FK `listings_catalog_model_id_fkey`; acá
   * sólo se verifica la forma, para no mandarle a Postgres un string que rompe el cast.
   */
  catalogModelId: z
    .string({ error: 'Elegí el modelo del equipo.' })
    .trim()
    .pipe(z.uuid('Elegí el modelo del equipo.')),

  storageGb: optionalIntInRange(1, 999_999, 'Los GB tienen que ser un número mayor a cero.'),
  color: optionalText(40),
  priceUsd: requiredMoney,
  batteryPct: optionalIntInRange(0, 100, 'La batería es un número de 0 a 100.'),
  imei: optionalImei,
  costUsd: optionalMoney,
  description: optionalText(DEFAULT_MAX_DESCRIPTION_LENGTH),
});

export type NewUnitInput = z.infer<typeof newUnitSchema>;

export type PhotoCheck =
  | { readonly ok: true; readonly file: File }
  | { readonly ok: false; readonly reason: string };

/**
 * Valida la **forma** del archivo sin leerlo: se corre antes del `arrayBuffer()`. Materializar
 * 3 MB en RAM para descubrir que era un PDF es plata de función serverless tirada.
 *
 * Es **un** archivo, en singular, y el `name` del input es `photo`. El diseño anterior mandaba
 * hasta ocho en un submit y estaba muerto en producción: dos fotos de celular ya pasan el techo
 * de 4 MB del Routing Middleware. Ver `MAX_PHOTO_BYTES`.
 */
export function checkPhotoFile(file: File | null): PhotoCheck {
  if (file === null) return { ok: false, reason: 'Elegí una foto del equipo.' };

  if (!ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return { ok: false, reason: 'Sólo fotos: JPG, PNG, WebP, AVIF o HEIC.' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      reason: `Esa foto pesa más de ${String(MAX_PHOTO_MB)} MB. Sacala de nuevo con menos calidad o mandá una más chica.`,
    };
  }
  return { ok: true, file };
}

/**
 * El `File` real del `FormData`, o `null`. Un `<input type="file">` sin elegir nada igual manda
 * una entrada: un `File` de 0 bytes y nombre vacío. Eso no es una foto y no llega al pipeline.
 */
export function photoFromFormData(formData: FormData, key = 'photo'): File | null {
  const entry = formData.get(key);
  if (!(entry instanceof File)) return null;
  if (entry.size === 0 || entry.name === '') return null;
  return entry;
}
