import { z } from 'zod';
import { CONDITIONS, isCondition } from '@istock/domain';
import { parseUsdToCents } from '../listings/parse-money';

/**
 * El **borde** de "aceptar un canje y meterlo al stock". `CLAUDE.md` §5: Zod en todos los bordes,
 * y un `FormData` es un borde igual que un webhook: llega por POST desde donde sea, no sólo desde
 * el formulario que escribimos nosotros.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Aceptar un canje ES un alta de unidad. Por eso los rangos son los mismos.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Cada campo replica el `CHECK` de Postgres que le corresponde
 * (`packages/db/src/schema/listings.ts`): `price_usd > 0`, `cost_usd is null or cost_usd >= 0`,
 * `battery_pct between 0 and 100`, `storage_gb > 0`. El título ya no se valida acá: se deriva del
 * modelo confirmado en el server. No es duplicación decorativa:
 * sin esto un dato malo viaja hasta el `insert` y vuelve como un error de constraint de Postgres,
 * cuyo mensaje **incluye la fila que lo violó**. La fila de un canje tiene el nombre y el WhatsApp
 * del visitante. Se rechaza acá, en castellano y por campo, antes de que Postgres tenga que hablar.
 *
 * ── `offerUsd` es el costo, y es obligatorio ─────────────────────────────────────────────────
 * Lo que el dueño paga por el equipo del visitante **es** `listings.cost_usd`. Es el dato entero
 * del gate de la slice, así que no es opcional: una unidad que entra por canje sin costo es una
 * unidad cuyo margen va a mentir para siempre, y no hay pantalla que lo arregle después.
 * Se acepta `0` porque el `CHECK` de Postgres acepta `0` (`cost_usd >= 0`) y porque "te lo tomo
 * sin cargo a cuenta de otra cosa" existe en el mostrador. Lo que no se acepta es **vacío**.
 *
 * ── Este schema NO se importa desde un componente cliente ────────────────────────────────────
 * Arrastra Zod y `@istock/domain`. La validación que decide corre en el server; lo que el `"use
 * client"` necesita son strings y una lista de opciones, y baja como props.
 */

const money = (opts: { readonly missing: string; readonly minCents: number; readonly tooLow: string }) =>
  z.string({ error: opts.missing }).transform((raw, ctx) => {
    if (raw.trim() === '') {
      ctx.addIssue({ code: 'custom', message: opts.missing });
      return z.NEVER;
    }
    const parsed = parseUsdToCents(raw);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.reason });
      return z.NEVER;
    }
    if (parsed.cents < opts.minCents) {
      ctx.addIssue({ code: 'custom', message: opts.tooLow });
      return z.NEVER;
    }
    return parsed.cents;
  });

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

const optionalText = (max: number) =>
  z
    .string()
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .pipe(z.string().max(max, `No puede pasar de ${String(max)} caracteres.`))
    .transform((value) => (value === '' ? null : value));

export const acceptTradeinSchema = z.object({
  /**
   * Viene de un `<input type="hidden">`, o sea del cliente, o sea de cualquiera. Sin `z.uuid()` un
   * string cualquiera llega a un `where id = $1` y Postgres contesta con un error de sintaxis de
   * UUID que después alguien loguea entero.
   */
  leadId: z.string({ error: 'Falta el canje.' }).trim().pipe(z.uuid('Falta el canje.')),

  /**
   * Obligatorio por el mismo motivo que en el alta: `checkPublishable()` deniega
   * `missing_catalog_model` para todo `kind: 'unit'`, así que sin modelo la unidad nace
   * impublicable. Un canje que se convierte en un borrador que nunca va a poder salir a la vidriera
   * no entró al stock, entró a un limbo.
   */
  catalogModelId: z
    .string({ error: 'Elegí el modelo del equipo.' })
    .trim()
    .pipe(z.uuid('Elegí el modelo del equipo.')),

  /**
   * La condición **real**, la que ve el dueño con el equipo en la mano. El visitante declaró una
   * (`tradein_leads.declared_condition`) y se usa para precargar el `<select>`, pero la que se
   * guarda es la que confirma quien lo revisó.
   */
  condition: z
    .string({ error: 'Elegí en qué estado está el equipo.' })
    .refine(isCondition, 'Elegí una condición de la lista.')
    .transform((value) => value as (typeof CONDITIONS)[number]),

  storageGb: optionalIntInRange(1, 999_999, 'Los GB tienen que ser un número mayor a cero.'),
  color: optionalText(40),
  batteryPct: optionalIntInRange(0, 100, 'La batería es un número de 0 a 100.'),

  /** A cuánto se va a publicar. `listings_price_positive`: mayor a cero. */
  priceUsd: money({
    missing: 'Poné a cuánto lo vas a publicar.',
    minCents: 1,
    tooLow: 'El precio tiene que ser mayor a cero.',
  }),

  /** Lo que le pagás al cliente. **Es el costo de la unidad.** Sólo lo escribe un `owner`. */
  offerUsd: money({
    missing: 'Poné cuánto le pagás por el equipo.',
    minCents: 0,
    tooLow: 'La oferta no puede ser negativa.',
  }),
});

export type AcceptTradeinInput = z.infer<typeof acceptTradeinSchema>;

export type AcceptTradeinField = keyof AcceptTradeinInput | 'form';

export type AcceptTradeinParse =
  | { readonly ok: true; readonly data: AcceptTradeinInput }
  | { readonly ok: false; readonly errors: Partial<Record<AcceptTradeinField, string>> };

/** Lee del `FormData` sólo las claves que este schema declara. Lo que no está acá, no se lee. */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * El `FormData` → input tipado, o el mapa de errores por campo.
 *
 * `offerUsd` se lee **siempre** acá porque este parser no conoce el rol: quien decide si un
 * `seller` puede aceptar es la Server Action, **antes** de llamar a esta función. Ver
 * `canjes/[id]/actions.ts`. Poner el `if (role)` adentro del parser haría que el borde dependa de
 * la sesión y que el test del borde necesite una sesión falsa para probar un mensaje de validación.
 */
export function parseAcceptTradeinForm(formData: FormData): AcceptTradeinParse {
  const parsed = acceptTradeinSchema.safeParse({
    leadId: readString(formData, 'leadId'),
    catalogModelId: readString(formData, 'catalogModelId'),
    condition: readString(formData, 'condition'),
    storageGb: readString(formData, 'storageGb'),
    color: readString(formData, 'color'),
    batteryPct: readString(formData, 'batteryPct'),
    priceUsd: readString(formData, 'priceUsd'),
    offerUsd: readString(formData, 'offerUsd'),
  });

  if (parsed.success) return { ok: true, data: parsed.data };

  const errors: Partial<Record<AcceptTradeinField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    const key: AcceptTradeinField = typeof field === 'string' ? (field as AcceptTradeinField) : 'form';
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}
