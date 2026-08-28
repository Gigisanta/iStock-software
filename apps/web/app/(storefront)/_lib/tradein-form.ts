import { z } from 'zod';
import { CONDITIONS, conditionLabel, type Condition } from '@istock/domain';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El borde del canje público: los límites, el parser y la normalización del teléfono.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un solo módulo para los dos consumidores del mismo número:
 *
 * - `s/[slug]/api/tradein/route.ts` — el Zod que corre en el server, que es lo único entre un
 *   `curl` y la tabla además de los CHECK del motor.
 * - `s/[slug]/canje/page.tsx` — los `maxlength` / `min` / `max` del HTML, que son la validación
 *   que la persona ve en el teclado del teléfono antes de mandar.
 *
 * **Por qué una constante y no dos números tipeados.** Si el `maxlength` del input dijera 100 y el
 * Zod dijera 80, el formulario dejaría escribir un nombre que el server rechaza sin explicación, y
 * el modo de falla sería "toqué Enviar y volví a la misma pantalla". Acá los dos salen del mismo
 * objeto, así que no pueden divergir por construcción.
 *
 * **Y por qué `TRADEIN_LIMITS` es exactamente esta forma.** `tradein.test.ts` lee los `CHECK` de
 * `packages/db/drizzle/0008_storefront_tradein_lead_insert.sql` y compara número contra número.
 * Ese test es el que ata este archivo al motor: sin él, `db-agent` podría bajar un CHECK a 60 y
 * este borde seguiría aceptando 80 hasta que un visitante escribiera un nombre largo y su canje se
 * perdiera en un `catch`. La tabla de nombres de constraint vive acá abajo, no en el test, para que
 * el mapeo también sea una afirmación de este módulo y no del que lo audita.
 *
 * ## Lo que este archivo NO hace
 * - **No valida que el teléfono exista.** Se normaliza a dígitos y un `+` inicial, nada más. Un
 *   regex de teléfono argentino rechaza números legítimos (0/15, prefijos de dos a cuatro dígitos,
 *   gente que escribe el internacional) y el costo de un falso negativo acá es perder el canje.
 * - **No toca `status`.** El visitante no elige en qué estado entra su lead: sale del default
 *   `'new'` y ni siquiera está en el privilegio de columna de `anon` (`drizzle/0008_*`).
 * - **No conoce el precio.** Lo que el reseller ofrece pagar lo escribe el dueño desde el panel:
 *   es el costo de la unidad que va a nacer del canje (`CLAUDE.md` §0.9).
 */

/**
 * Los límites del borde, **en las mismas unidades que los `CHECK` del motor**: caracteres para los
 * textos, valor para los enteros. `min` de un campo opcional es el mínimo *cuando viene algo*: si
 * viene vacío el campo es `null`, que es un lead perfectamente legítimo — mucha gente no sabe los
 * GB de memoria ni el porcentaje de batería de su propio teléfono.
 */
export const TRADEIN_LIMITS = {
  customerName: { min: 1, max: 80 },
  customerWaPhone: { min: 6, max: 25 },
  modelText: { min: 1, max: 120 },
  storageGb: { min: 1, max: 4096 },
  color: { min: 1, max: 40 },
  batteryPct: { min: 0, max: 100 },
  notes: { min: 1, max: 500 },
} as const;

/**
 * Qué `CHECK` del motor respalda a cada límite. El nombre del constraint es el que emite
 * `drizzle-kit generate` desde `packages/db/src/schema/tradein.ts`.
 *
 * Está acá y no en el test a propósito: si mañana `db-agent` renombra un constraint, el test tiene
 * que ponerse **rojo por no encontrarlo**, no verde por no haberlo buscado. Un mapeo que vive en el
 * archivo auditado es una afirmación; uno que vive en el test es una casualidad que se corrige sola
 * y en silencio.
 */
export const TRADEIN_ENGINE_CHECKS = {
  tradein_leads_customer_name_len: 'customerName',
  tradein_leads_customer_wa_phone_len: 'customerWaPhone',
  tradein_leads_model_text_len: 'modelText',
  tradein_leads_storage_gb_range: 'storageGb',
  tradein_leads_color_len: 'color',
  tradein_leads_battery_pct_range: 'batteryPct',
  tradein_leads_notes_len: 'notes',
} as const satisfies Record<string, keyof typeof TRADEIN_LIMITS>;

/**
 * Techo de caracteres del body **antes** de parsearlo, hermano de `MAX_BEACON_CHARS` del beacon.
 *
 * Se calcula del peor caso legítimo y **está medido por un test**, no puesto a ojo. La suma de los
 * máximos de arriba son ~790 caracteres de contenido, pero el body no viaja en caracteres: viaja
 * percent-encodeado, y una `ñ` son dos bytes UTF-8, o sea `%C3%B1`, **seis** caracteres. El peor
 * envío honesto —los cuatro textos llenos de acentos— pesa ~4.8k, no 790. La primera versión de
 * esta constante decía 4096 justamente por hacer esa cuenta en caracteres en vez de en bytes
 * encodeados, y el modo de falla habría sido el peor de todos: un canje escrito en castellano con
 * muchas notas rebotando sin explicación mientras el mismo texto sin acentos entra.
 *
 * 6144 deja margen sobre ese peor caso y sigue siendo dos órdenes de magnitud menos que lo que
 * haría falta para que leer el body cueste algo. `tradein.test.ts` construye el peor envío
 * legítimo y verifica que entra: si alguien sube un límite de arriba, el techo se pone rojo.
 * Un POST más grande que esto no se parsea: se descarta antes.
 */
export const MAX_TRADEIN_BODY_CHARS = 6144;

/** Los `name=` del formulario. Son los de la columna, en snake_case, para que el mapeo se lea. */
export const TRADEIN_FIELDS = {
  customerName: 'customer_name',
  customerWaPhone: 'customer_wa_phone',
  modelText: 'model_text',
  storageGb: 'storage_gb',
  color: 'color',
  declaredCondition: 'declared_condition',
  batteryPct: 'battery_pct',
  notes: 'notes',
} as const;

/**
 * Dígitos y **un** `+` adelante. Nada más.
 *
 * `+54 9 299 415-3388` → `+5492994153388`. `(0299) 15 415 3388` → `02991541533 88` sin espacios, o
 * sea `0299154153388`. Las dos formas se guardan como las escribió la persona, sin inventar prefijo
 * de país: el dueño la va a llamar por WhatsApp desde su propio teléfono y sabe leer un número de
 * su zona mejor que nosotros.
 *
 * El `+` sólo sobrevive si viene primero. Un `+` en el medio es basura y se cae con el resto.
 */
export function normalizeWaPhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

/** `''` (el campo opcional que la persona dejó en blanco) es `null`, no un string vacío. */
function blankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const L = TRADEIN_LIMITS;

/** Entero opcional: `null` si vino vacío, y si vino algo tiene que ser entero y estar en rango. */
const optionalInt = (min: number, max: number) =>
  z.preprocess(blankToNull, z.union([z.null(), z.coerce.number().int().min(min).max(max)]));

/** Texto opcional: `null` si vino vacío, con techo de caracteres si vino algo. */
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.union([z.null(), z.string().min(1).max(max)]));

/**
 * El esquema del borde. `.strict()` **y no** `passthrough`: un campo que el formulario no manda es
 * alguien probando, no un navegador viejo. Y una clave de más que se ignora en silencio es cómo se
 * cuela un `tenant_id` en el body — que acá no serviría de nada porque el tenant sale del claim del
 * slug, pero la próxima columna que alguien agregue puede no tener esa suerte.
 *
 * El teléfono se **normaliza antes** de medirse: los límites de largo son sobre lo que se guarda,
 * que es lo mismo que mide el `CHECK` del motor. Si midiéramos el crudo, `+54 9 299 415 3388`
 * (18 caracteres) pasaría un techo de 25 y guardaría 14 — y el día que alguien bajara el techo, los
 * dos bordes estarían midiendo cosas distintas sin que nada lo dijera.
 */
export const tradeinLeadSchema = z
  .object({
    [TRADEIN_FIELDS.customerName]: z.string().trim().min(L.customerName.min).max(L.customerName.max),
    [TRADEIN_FIELDS.customerWaPhone]: z
      .string()
      .transform(normalizeWaPhone)
      .pipe(z.string().min(L.customerWaPhone.min).max(L.customerWaPhone.max)),
    [TRADEIN_FIELDS.modelText]: z.string().trim().min(L.modelText.min).max(L.modelText.max),
    [TRADEIN_FIELDS.storageGb]: optionalInt(L.storageGb.min, L.storageGb.max),
    [TRADEIN_FIELDS.color]: optionalText(L.color.max),
    [TRADEIN_FIELDS.declaredCondition]: z.preprocess(
      blankToNull,
      z.union([z.null(), z.enum(CONDITIONS)]),
    ),
    [TRADEIN_FIELDS.batteryPct]: optionalInt(L.batteryPct.min, L.batteryPct.max),
    [TRADEIN_FIELDS.notes]: optionalText(L.notes.max),
  })
  .strict();

/**
 * Lo que sale del borde, ya con los nombres de columna y los `null` puestos. Es **exactamente** la
 * lista de nueve columnas del privilegio de `anon` menos `tenant_id`, que no viene del body y no
 * puede venir del body: sale del claim del slug que escribió `proxy.ts` desde el host.
 */
export interface TradeinLead {
  readonly customerName: string;
  readonly customerWaPhone: string;
  readonly modelText: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly declaredCondition: Condition | null;
  readonly batteryPct: number | null;
  readonly notes: string | null;
}

/**
 * Parsea un body de formulario (`application/x-www-form-urlencoded`) a un lead validado.
 *
 * Devuelve `null` ante **cualquier** problema y sin decir cuál. Quien llama sólo puede distinguir
 * "entró" de "no entró": el motivo se lo queda el server. Un borde que contesta *qué* campo falló
 * en un endpoint anónimo y sin login es un oráculo gratis, y acá no compra nada — la persona tiene
 * el formulario delante con los mismos límites puestos en el HTML.
 */
export function parseTradeinBody(body: string): TradeinLead | null {
  if (body.length === 0 || body.length > MAX_TRADEIN_BODY_CHARS) return null;

  const entries: Record<string, string> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return null;
  }
  for (const [key, value] of params) {
    // Una clave repetida (`color=a&color=b`) se queda con la primera y no concatena: `getAll` sería
    // aceptar que alguien mande un array donde el formulario manda un campo.
    if (!(key in entries)) entries[key] = value;
  }

  const parsed = tradeinLeadSchema.safeParse(entries);
  if (!parsed.success) return null;

  const data = parsed.data;
  return {
    customerName: data[TRADEIN_FIELDS.customerName],
    customerWaPhone: data[TRADEIN_FIELDS.customerWaPhone],
    modelText: data[TRADEIN_FIELDS.modelText],
    storageGb: data[TRADEIN_FIELDS.storageGb],
    color: data[TRADEIN_FIELDS.color],
    declaredCondition: data[TRADEIN_FIELDS.declaredCondition],
    batteryPct: data[TRADEIN_FIELDS.batteryPct],
    notes: data[TRADEIN_FIELDS.notes],
  };
}

/**
 * Las opciones del `<select>` de condición, en el registro de la **ficha** (`usado excelente`), no
 * en el de WhatsApp (`usado A`). Son dos mapas distintos a propósito y está ratificado en
 * `CLAUDE.md` §1: acá le habla a un comprador que está describiendo su propio teléfono.
 */
export const TRADEIN_CONDITION_OPTIONS: ReadonlyArray<{ value: Condition; label: string }> =
  CONDITIONS.map((value) => ({ value, label: conditionLabel(value) }));
