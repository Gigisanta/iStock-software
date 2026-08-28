import { z } from 'zod';
import { parseUsdToCents } from '../listings/parse-money';

/**
 * El **borde** de la venta manual. `CLAUDE.md` §5: Zod en todos los bordes, y un `FormData` es un
 * borde igual que un webhook — llega por POST desde cualquier lado, no sólo desde el formulario
 * que escribimos nosotros.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Lo que este schema NO acepta, y por qué esa lista importa más que la que acepta
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Del formulario de venta entran **dos** campos: el precio realmente cobrado y con qué pagaron.
 * Nada más. Los otros cuatro números que terminan en la fila de `sales` se resuelven del lado del
 * server y **no existen en este schema**, así que no hay forma de mandarlos aunque se arme el
 * `POST` a mano:
 *
 * | columna | de dónde sale | qué pasaría si entrara por acá |
 * |---|---|---|
 * | `cost_usd` | se copia de `listings.cost_usd` dentro de la transacción (D2) | `margin_usd` es una columna **generada** a partir del costo: escribir el costo es escribir el margen |
 * | `margin_usd` | la deriva Postgres | el `insert` no la nombra nunca |
 * | `price_ars` / `fx_ars_per_usd` | el TC del tenant, congelado server-side (D4) | el ARS de la ficha es informativo; lo que se archiva es lo que el server podía justificar |
 * | `sold_by` | `ctx.userId`, de la sesión (D7) | una venta se la firmaría cualquiera a cualquiera |
 *
 * ── El precio SÍ entra por el formulario, y es a propósito (D3) ──────────────────────────────
 * `sales.price_usd` es lo **realmente cobrado**, que puede no ser el publicado: acá se regatea, y
 * ése es justo el número que hace útil al margen. Tomarlo de `listings.price_usd` sería archivar
 * el precio de la vidriera y llamarlo venta.
 */

/**
 * Con qué pagaron. Códigos en inglés (identificadores) y etiquetas en castellano rioplatense
 * (`_lib/sales/presentation.ts`), como pide `CLAUDE.md` §0.10.
 *
 * ── Por qué una lista fija acá y no `tenants.payment_methods` ────────────────────────────────
 * Son dos cosas distintas y confundirlas se paga en datos: `tenants.payment_methods` es lo que el
 * negocio **anuncia** en la ficha ("Efectivo · Transferencia"), texto libre que el dueño escribe
 * para el visitante. Esto es con qué le pagaron **esta** venta, que puede no estar en esa lista
 * —una transferencia sobre un negocio que publica "efectivo"— y que además tiene que existir
 * antes de que el dueño configure nada: `createTenant()` no siembra `payment_methods`, así que un
 * `<select>` derivado de esa columna nace **vacío** y no se puede vender.
 *
 * Códigos estables y no las etiquetas: el reporte de ventas de la slice de margen agrupa por este
 * valor, y agrupar por un texto que alguien puede reescribir es cómo se pierde una serie histórica.
 */
export const PAYMENT_METHODS = [
  'cash_usd',
  'cash_ars',
  'transfer',
  'usdt',
  'card',
  'trade_in',
  'other',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Lo realmente cobrado, en USD, como texto de mostrador.
 *
 * Se parsea con `parseUsdToCents()` —el mismo del alta— y no con `z.coerce.number()`: `1.200` es
 * mil doscientos para el dueño y uno con dos para `parseFloat`, y equivocarse acá archiva una
 * venta de USD 1,20. El parser rechaza los separadores de miles en vez de adivinar.
 *
 * `> 0` replica el `CHECK sales_price_positive` de Postgres. La elección no es "validar o no": es
 * fallar acá con un mensaje en castellano, o fallar allá con un `23514` en inglés que arrastra la
 * fila en el `DETAIL`.
 */
export const salePriceSchema = z.preprocess(
  (raw) => raw ?? '',
  z
    .string({ error: 'Poné a cuánto lo vendiste.' })
    .transform((raw, ctx) => {
      const parsed = parseUsdToCents(raw);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.reason });
        return z.NEVER;
      }
      if (parsed.cents <= 0) {
        ctx.addIssue({ code: 'custom', message: 'El precio de venta tiene que ser mayor a cero.' });
        return z.NEVER;
      }
      return parsed.cents;
    }),
);

/**
 * Con qué pagaron. **Obligatorio**, aunque la columna sea nullable.
 *
 * La columna admite `null` porque una venta importada de otro lado puede no tener el dato; una
 * venta que carga una persona parada en el mostrador sí lo tiene, y es un toque. Un default
 * silencioso ("efectivo" preseleccionado) archivaría el medio de pago equivocado en cada venta que
 * no lo fue, sin cartel y sin log — el mismo error que `reservations/schema.ts` no comete al
 * negarse a clampear los minutos. Por eso el `<select>` abre sin elegir y `'other'` existe: nadie
 * queda trabado, nadie miente.
 */
export const paymentMethodSchema = z.preprocess(
  (raw) => raw ?? '',
  z.enum(PAYMENT_METHODS, { error: 'Elegí con qué te pagaron.' }),
);

/**
 * Los dos campos de la venta, sin el `listingId`: se comparte con el schema de la Server Action,
 * que los suma a la rama `to: 'sold'` de su unión discriminada.
 */
export const saleFieldsSchema = z.object({
  priceUsdCents: salePriceSchema,
  paymentMethod: paymentMethodSchema,
});

export type SaleFields = z.infer<typeof saleFieldsSchema>;
