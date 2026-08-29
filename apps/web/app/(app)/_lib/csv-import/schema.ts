/**
 * El **borde** del import CSV. `CLAUDE.md` §5: Zod en todos los bordes, y un archivo que sube una
 * persona es el borde más hostil que tiene el panel — no lo escribió nuestro formulario, lo
 * escribió Excel, o Google Sheets, o el proveedor que le pasó una planilla al dueño.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los techos. De dónde sale cada número.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **`MAX_CSV_BYTES` = 1 MB.** No sale de "un CSV pesa poco": sale de la misma cadena de techos de
 * plataforma que documenta `_lib/listings/schema.ts` (`MAX_PHOTO_BYTES`), leída de abajo hacia
 * arriba:
 *
 * ```
 *   1   MB (este cap, Zod, mensaje en castellano)
 *     <  3.5 MB  experimental.serverActions.bodySizeLimit  → Next tira 413
 *     <  4   MB  Routing Middleware (nuestro `proxy.ts`)   → lo pone Vercel, NO varía por plan
 *     <  4.5 MB  Vercel Function                           → lo pone Vercel
 * ```
 *
 * El aire hasta el 3.5 MB es deliberado y es el mismo criterio que con las fotos: queremos que el
 * rechazo lo escriba Zod, en castellano y explicando qué hacer, y no que Next corte con un 413 en
 * inglés que nadie puede explicar por teléfono. Y 1 MB no aprieta: con `MAX_CSV_ROWS` filas de
 * ~120 bytes, el archivo más grande que este import acepta pesa ~60 KB. 1 MB es **16×** eso, o
 * sea que el cap de bytes sólo se toca con un archivo que no es un CSV de stock — que es
 * exactamente el caso que tiene que cortar barato, antes de decodificar un byte.
 *
 * **`MAX_CSV_ROWS` = 500.** El ICP de `CLAUDE.md` §1 tiene **20–200 equipos**. 500 es 2,5× el
 * techo del ICP: un reseller migrando su Excel entero entra de una, con margen para crecer, y
 * nadie va a partir un archivo por culpa nuestra. Arriba de eso el número deja de estar limitado
 * por el negocio y pasa a estar limitado por dos cosas nuestras que sí duelen: la escritura es
 * **una sola transacción** (ver `./import-listings.ts`), y el bucle de corrección —*un typo, se
 * corrige el archivo, se vuelve a subir entero*— deja de ser humano. Un tenant con 3.000 equipos
 * es otro producto y necesita otro diseño, no un número más grande acá.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los mensajes NO citan el valor de la celda
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §1: *"IMEI nunca en logs"*, y §0.9: el costo no cruza a un payload. Un mensaje como
 * *"el IMEI 353xxxxxxxxxxxx no es válido"* pone el IMEI en el HTML, en el estado del formulario y
 * en cualquier captura de pantalla que el dueño mande por soporte. **Todo mensaje de este archivo
 * se arma con constantes**; lo único variable es el número de fila y el nombre de la columna, y
 * los dos los pone `./build-import.ts`. La única excepción declarada —el texto del modelo que no
 * se encontró en el catálogo— vive allá, explicada allá, y tiene test.
 */

import { z } from 'zod';
import {
  CONDITIONS,
  DEFAULT_MAX_DESCRIPTION_LENGTH,
  conditionLabel,
  waConditionLabel,
  type Condition,
} from '@istock/domain';
import { TITLE_MAX_LENGTH, TITLE_MIN_LENGTH } from '../listings/schema';
import { parseUsdToCents } from '../listings/parse-money';

/** Ver el docblock. 1 MB, con 2,5 MB de aire debajo del techo de Next. */
export const MAX_CSV_BYTES = 1024 * 1024;

/** Ver el docblock. 2,5× el techo del ICP (20–200 equipos). Sin contar el encabezado. */
export const MAX_CSV_ROWS = 500;

/**
 * Tipos de archivo aceptados. `text/csv` es el correcto; el resto son los que manda Windows
 * cuando el `.csv` está asociado a Excel — el navegador reporta lo que dice el registro del SO,
 * no lo que el archivo es. Se acepta también el vacío: Safari en iOS manda `''` seguido.
 *
 * Esto **no es la validación**: la validación es el parseo. Es un filtro barato para no
 * decodificar un `.xlsx` de 900 KB y descubrir después que era un ZIP.
 */
const ACCEPTED_CSV_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'text/comma-separated-values',
  '',
]);

/** Para el `accept` del `<input type="file">`. Deriva de la misma lista más la extensión. */
export const CSV_ACCEPT_ATTR = '.csv,text/csv';

export type CsvFileCheck =
  | { readonly ok: true; readonly file: File }
  | { readonly ok: false; readonly reason: string };

/**
 * Valida la **forma** del archivo sin leerlo. Corre antes de `text()`: materializar un MB para
 * descubrir que era un `.xlsx` es CPU de función serverless regalada, igual que con las fotos.
 *
 * Un `.xlsx` **no** se acepta y no es un olvido: leerlo pide una librería de ZIP + XML, o sea una
 * dependencia nueva sobre un formato binario, para resolver un problema que Excel resuelve con
 * *"Guardar como → CSV"*. La pantalla lo dice con esas palabras.
 */
export function checkCsvFile(file: File | null): CsvFileCheck {
  if (file === null) return { ok: false, reason: 'Elegí el archivo CSV con tus equipos.' };

  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return {
      ok: false,
      reason:
        'Ese es un Excel, no un CSV. Abrilo, andá a "Guardar como" y elegí CSV. Después subí ese archivo.',
    };
  }
  if (!name.endsWith('.csv') && !ACCEPTED_CSV_TYPES.has(file.type.toLowerCase())) {
    return { ok: false, reason: 'Subí un archivo .csv.' };
  }
  if (file.size === 0) {
    return { ok: false, reason: 'Ese archivo está vacío.' };
  }
  if (file.size > MAX_CSV_BYTES) {
    return {
      ok: false,
      reason: `Ese archivo pesa más de ${String(Math.round(MAX_CSV_BYTES / 1024))} KB. Un CSV de ${String(MAX_CSV_ROWS)} equipos pesa mucho menos: fijate que sea el archivo correcto.`,
    };
  }
  return { ok: true, file };
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Las columnas
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Los encabezados se normalizan antes de comparar (`normalizeHeader`), así que `"Precio USD"`,
 * `"precio usd"` y `"PRECIO_USD"` son la misma columna. Los alias existen porque el dueño no
 * escribió su planilla pensando en nosotros: la tenía antes.
 *
 * **El orden de las columnas no importa** y sobrar columnas tampoco: una planilla real trae
 * `proveedor`, `fecha`, `observaciones`. Lo que no está en esta tabla se ignora —y la pantalla lo
 * dice, para que ignorar no sea silencioso.
 */
export const CSV_FIELDS = {
  model: 'modelo',
  condition: 'condicion',
  priceUsd: 'precio_usd',
  title: 'titulo',
  storageGb: 'gb',
  color: 'color',
  batteryPct: 'bateria',
  imei: 'imei',
  costUsd: 'costo_usd',
  description: 'descripcion',
} as const;

export type CsvField = (typeof CSV_FIELDS)[keyof typeof CSV_FIELDS];

/** Sin estas tres no hay equipo que dar de alta. */
export const REQUIRED_CSV_FIELDS: readonly CsvField[] = [
  CSV_FIELDS.model,
  CSV_FIELDS.condition,
  CSV_FIELDS.priceUsd,
];

/** Alias → nombre canónico. Todo lo que no esté acá se ignora (y se informa). */
const HEADER_ALIASES: Readonly<Record<string, CsvField>> = {
  modelo: CSV_FIELDS.model,
  equipo: CSV_FIELDS.model,
  producto: CSV_FIELDS.model,

  condicion: CSV_FIELDS.condition,
  estado: CSV_FIELDS.condition,

  precio_usd: CSV_FIELDS.priceUsd,
  precio: CSV_FIELDS.priceUsd,
  precio_dolares: CSV_FIELDS.priceUsd,
  usd: CSV_FIELDS.priceUsd,
  venta: CSV_FIELDS.priceUsd,

  titulo: CSV_FIELDS.title,
  nombre: CSV_FIELDS.title,

  gb: CSV_FIELDS.storageGb,
  storage_gb: CSV_FIELDS.storageGb,
  almacenamiento: CSV_FIELDS.storageGb,
  capacidad: CSV_FIELDS.storageGb,
  memoria: CSV_FIELDS.storageGb,

  color: CSV_FIELDS.color,

  bateria: CSV_FIELDS.batteryPct,
  bateria_pct: CSV_FIELDS.batteryPct,
  salud_bateria: CSV_FIELDS.batteryPct,

  imei: CSV_FIELDS.imei,

  costo_usd: CSV_FIELDS.costUsd,
  costo: CSV_FIELDS.costUsd,
  compra: CSV_FIELDS.costUsd,

  descripcion: CSV_FIELDS.description,
  detalle: CSV_FIELDS.description,
  observaciones: CSV_FIELDS.description,
};

/**
 * `"Batería %"` → `"bateria"`. Sin acentos, minúsculas, todo lo que no es alfanumérico pasa a `_`.
 *
 * El `%` de `"Batería %"` cae acá: si no se descartaran los `_` del final, la columna se llamaría
 * `bateria_` y no matchearía nunca. Es el mismo tipo de fallo mudo que el BOM.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

/** Encabezado crudo → campo canónico, o `null` si es una columna que no usamos. */
export function canonicalField(raw: string): CsvField | null {
  return HEADER_ALIASES[normalizeHeader(raw)] ?? null;
}

/**
 * Texto de condición → `Condition`, **derivado de `@istock/domain`** y no de una lista local.
 *
 * `_lib/listings/schema.ts` ya deja escrito por qué: *"dos listas de condiciones es cómo se
 * termina con un `select` que Postgres rechaza por enum"*. Acá el riesgo es peor, porque la
 * entrada es texto libre: se aceptan las tres formas que el dueño puede tener escritas —la clave
 * del enum (`used_excellent`), la etiqueta de la ficha (`usado excelente`) y la jerga de reseller
 * que usa el mensaje de WhatsApp (`usado A`)—, y las tres salen de los mismos exports del dominio.
 * El día que se agregue una condición, este mapa la tiene sin tocar una línea.
 *
 * Los dos registros son a propósito y `CLAUDE.md` §1 los ratifica; acá se **aceptan los dos**
 * porque el dueño escribe indistintamente uno u otro en su planilla.
 */
const CONDITION_BY_TEXT: ReadonlyMap<string, Condition> = (() => {
  const map = new Map<string, Condition>();
  for (const condition of CONDITIONS) {
    map.set(normalizeHeader(condition), condition);
    map.set(normalizeHeader(conditionLabel(condition)), condition);
    map.set(normalizeHeader(waConditionLabel(condition)), condition);
  }
  return map;
})();

/** Lo que la pantalla y el mensaje de error listan como aceptado. Misma fuente que el mapa. */
export const CONDITION_HINT = CONDITIONS.map((c) => conditionLabel(c)).join(' · ');

const optionalText = (max: number, message: string) =>
  z
    .string()
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .transform((value, ctx) => {
      if (value === '') return null;
      if (value.length > max) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return value;
    });

const optionalIntInRange = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((raw) => raw.trim())
    .transform((raw, ctx) => {
      if (raw === '') return null;
      // Se acepta `128 GB` y `85%`: es lo que hay escrito en las planillas reales. Lo que no se
      // acepta es un número con basura en el medio — eso es un typo y se rechaza con su fila.
      const cleaned = raw.replace(/\s*(gb|%)\s*$/iu, '').trim();
      if (!/^\d{1,6}$/u.test(cleaned)) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      const value = Number(cleaned);
      if (value < min || value > max) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return value;
    });

/**
 * Plata. **Delega en `parseUsdToCents`**, que es el único lugar del panel donde un string se
 * convierte en centavos. Duplicar la regla del separador de miles acá publicaría un iPhone a
 * USD 1,20 por una coma, que es exactamente lo que ese archivo existe para impedir.
 *
 * Se limpia un `USD`/`u$s`/`$` adelante o atrás porque una planilla real lo trae; el resto lo
 * decide `parseUsdToCents` y su mensaje es el que sale en pantalla.
 */
function stripCurrency(raw: string): string {
  return raw
    .trim()
    .replace(/^(usd|u\$s|us\$|\$)\s*/iu, '')
    .replace(/\s*(usd|dolares|dólares)$/iu, '')
    .trim();
}

const requiredMoney = z.string().transform((raw, ctx) => {
  const value = stripCurrency(raw);
  if (value === '') {
    ctx.addIssue({ code: 'custom', message: 'Falta el precio en dólares.' });
    return z.NEVER;
  }
  const parsed = parseUsdToCents(value);
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
  const value = stripCurrency(raw);
  if (value === '') return null;
  const parsed = parseUsdToCents(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.reason });
    return z.NEVER;
  }
  return parsed.cents;
});

/**
 * IMEI. 15 dígitos, igual que el `CHECK listings_imei_format`. **Luhn no bloquea** (`packages/db`:
 * *"un gate de alta que rechaza stock es peor que un warning que el dueño ignora"*), así que acá
 * sólo se valida el largo y que sean dígitos.
 *
 * El mensaje **no dice cuál era el IMEI**. Es la regla del encabezado de este archivo y es la que
 * más fácil se rompe: es el error que uno querría hacer "más útil" citando el valor.
 */
const optionalImei = z
  .string()
  .transform((raw) => raw.replace(/[\s-]/gu, ''))
  .transform((raw, ctx) => {
    if (raw === '') return null;
    if (!/^\d{15}$/u.test(raw)) {
      ctx.addIssue({ code: 'custom', message: 'El IMEI tiene que ser 15 números, sin letras.' });
      return z.NEVER;
    }
    return raw;
  });

/**
 * Una fila del CSV. La entrada es **siempre** un objeto de strings con las diez claves: las
 * columnas que el archivo no trae entran como `''`. Es lo que deja usar `optionalX` sin
 * `.optional()` y sin que `exactOptionalPropertyTypes` complique el tipo de salida.
 */
export const csvRowSchema = z.object({
  [CSV_FIELDS.model]: z.string().transform((raw, ctx) => {
    const value = raw.trim().replace(/\s+/gu, ' ');
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: 'Falta el modelo del equipo.' });
      return z.NEVER;
    }
    if (value.length > TITLE_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'El modelo es demasiado largo para ser un modelo.' });
      return z.NEVER;
    }
    return value;
  }),

  [CSV_FIELDS.condition]: z.string().transform((raw, ctx) => {
    const key = normalizeHeader(raw);
    if (key === '') {
      ctx.addIssue({ code: 'custom', message: `Falta la condición. Puede ser: ${CONDITION_HINT}.` });
      return z.NEVER;
    }
    const condition = CONDITION_BY_TEXT.get(key);
    if (condition === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `Esa condición no existe. Puede ser: ${CONDITION_HINT}.`,
      });
      return z.NEVER;
    }
    return condition;
  }),

  [CSV_FIELDS.priceUsd]: requiredMoney,

  [CSV_FIELDS.title]: optionalText(
    TITLE_MAX_LENGTH,
    `El nombre no puede pasar de ${String(TITLE_MAX_LENGTH)} caracteres.`,
  ).transform((value, ctx) => {
    if (value !== null && value.length < TITLE_MIN_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        message: `El nombre necesita al menos ${String(TITLE_MIN_LENGTH)} caracteres. Dejalo en blanco y usamos el modelo.`,
      });
      return z.NEVER;
    }
    return value;
  }),

  [CSV_FIELDS.storageGb]: optionalIntInRange(
    1,
    999_999,
    'Los GB tienen que ser un número mayor a cero. Ejemplo: 256.',
  ),
  [CSV_FIELDS.color]: optionalText(40, 'El color no puede pasar de 40 caracteres.'),
  [CSV_FIELDS.batteryPct]: optionalIntInRange(0, 100, 'La batería es un número de 0 a 100.'),
  [CSV_FIELDS.imei]: optionalImei,
  [CSV_FIELDS.costUsd]: optionalMoney,
  [CSV_FIELDS.description]: optionalText(
    DEFAULT_MAX_DESCRIPTION_LENGTH,
    `La descripción no puede pasar de ${String(DEFAULT_MAX_DESCRIPTION_LENGTH)} caracteres.`,
  ),
});

export type CsvRowInput = z.infer<typeof csvRowSchema>;

/**
 * La plantilla que se le ofrece al dueño para copiar. Se **deriva** de `CSV_FIELDS`, así que el
 * día que se agregue una columna la plantilla la tiene sin que nadie se acuerde — una plantilla
 * escrita a mano que se desincroniza del parser es una forma cara de mentirle al usuario.
 *
 * La fila de ejemplo enseña dos cosas a propósito: que la descripción con coma **va entre
 * comillas**, y que las columnas que no se usan se dejan **vacías** en vez de borrarlas. El IMEI
 * del ejemplo va en blanco para no enseñar a copiar un IMEI de mentira a 200 equipos.
 *
 * `includeCost` es `false` para el `seller`: no se le ofrece una columna que su rol no puede
 * cargar (`CLAUDE.md` §0.9). No es la defensa —esa está en el server— es no invitarlo al error.
 */
export function csvTemplate(includeCost: boolean): string {
  const fields = Object.values(CSV_FIELDS).filter(
    (field) => includeCost || field !== CSV_FIELDS.costUsd,
  );
  const example: Readonly<Record<CsvField, string>> = {
    [CSV_FIELDS.model]: 'iPhone 14 Pro',
    [CSV_FIELDS.condition]: 'usado excelente',
    [CSV_FIELDS.priceUsd]: '620',
    [CSV_FIELDS.title]: '',
    [CSV_FIELDS.storageGb]: '256',
    [CSV_FIELDS.color]: 'Grafito',
    [CSV_FIELDS.batteryPct]: '87',
    [CSV_FIELDS.imei]: '',
    [CSV_FIELDS.costUsd]: '480',
    [CSV_FIELDS.description]: '"Impecable, sin detalles"',
  };
  return `${fields.join(',')}\n${fields.map((field) => example[field]).join(',')}`;
}
