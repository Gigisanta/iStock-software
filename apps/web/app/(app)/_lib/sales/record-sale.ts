import 'server-only';
import { eq } from 'drizzle-orm';
import { applyFx, fxRateFromArsCents, type FxRoundingMode } from '@istock/domain';
import { fxSettings, sales } from '@istock/db';
import type { Tx } from '../db/connection';
import type { TenantContext } from '../db/session';
import { logError } from '../log';
import type { PaymentMethod } from './schema';

/**
 * La fila de `sales`. **Recibe la transacción, no la abre.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el parámetro es `tx` y no `ctx` a secas (D1 del LEAD)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `listings.status = 'sold'` es **terminal**: `checkTransition()` no tiene una sola arista que
 * salga de `sold`. Un crash entre el `update` del listing y el `insert` de la venta deja una unidad
 * vendida sin venta y **no hay forma de arreglarlo desde el panel** — ni volviendo atrás, ni
 * vendiéndola de nuevo. Es el mismo argumento que el repo ya escribió para `closesReservationAs`,
 * y allá todavía había vuelta atrás.
 *
 * Por eso esta función no toma `TenantContext` y abre su propio `withTenantDb`: toma el `Tx` que
 * ya está abierto. Una firma que pide la transacción **no se puede llamar después** — no hay un
 * `tx` colgando fuera de `withTenantDb` para pasarle. La alternativa habitual, `recordSale(ctx,…)`
 * llamada a continuación de `transitionUnit()`, compila igual de bien y es exactamente el bug.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El costo NUNCA entra al proceso de Node (D2 + D6)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `cost_usd` se deriva en un trigger SECURITY DEFINER dentro del mismo `INSERT`, no se lee a una
 * variable de JS ni se pide con un SELECT al rol autenticado. Dos consecuencias, y las dos son el punto:
 *
 *   1. El costo no existe en el heap del server durante esta operación, así que no puede filtrarse
 *      a un log, a un `PublishOutcome`, ni a un payload RSC. `CLAUDE.md` §0.9 ("el seller no ve
 *      costo ni margen") queda resuelto **por construcción**, no por un chequeo de rol. Y el matiz
 *      importa: `session.role` existe y ya se usa (`stock/nuevo/actions.ts` decide con él si acepta
 *      el costo al **alta** de un equipo), así que el motivo no es que falte la primitiva. Es que
 *      acá no hace falta preguntar: si el dato no sale de Postgres, no hay a quién ocultárselo, ni
 *      `if` que alguien pueda invertir el día que S11 rehaga los permisos del panel.
 *   2. Es exacto sin ida y vuelta: `numeric(12, 2)` → `numeric(12, 2)`, sin pasar por los centavos
 *      de `moneyCents`.
 *
 * El trigger usa `tenant_id` y `listing_id` del INSERT y lee la fuente como operador de base; la
 * policy sigue validando el tenant del caller, y el seller no obtiene ningún privilegio SELECT
 * sobre el costo.
 *
 * `margin_usd` **no se nombra**: es `generatedAlwaysAs(price_usd - cost_usd)` y Postgres rechaza
 * un `INSERT` que la mencione. La deriva el motor, siempre, con el costo congelado de esta fila.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Sin TC sincronizado no se bloquea la venta (D4)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `price_ars` y `fx_ars_per_usd` son nullable a propósito. Si el tenant no tiene `fx_settings`
 * —o tiene un valor que el dominio no puede aplicar— la venta entra igual con las dos en `NULL`:
 * no registrar la venta porque falta un dato informativo sería perder el hecho para conservar el
 * adorno. El ARS se congela con la función de `@istock/domain` y el modo de redondeo del tenant
 * (`ceil_1000` por default), nunca con lo que viajó en el formulario: el ARS que vio el comprador
 * en la ficha es informativo y lo que se archiva es lo que el server podía justificar.
 */

export interface SaleFacts {
  readonly listingId: string;
  /** La reserva que esta venta convirtió, si venía de una. La cierra `transitionUnit`. */
  readonly reservationId: string | null;
  /** Lo **realmente cobrado** en USD (D3), ya validado en el borde. */
  readonly priceUsdCents: number;
  readonly paymentMethod: PaymentMethod;
}

/** El TC del tenant no se pudo aplicar. No es un SQLSTATE: lo dijo el dominio. */
const FX_UNUSABLE = 'domain_fx_unusable';

interface FrozenFx {
  readonly priceArsCents: number;
  readonly arsCentsPerUsd: number;
}

/**
 * El ARS congelado, o `null` si este tenant todavía no tiene TC sincronizado.
 *
 * Se lee **dentro de la transacción de la venta**: el "congelado al momento de la venta" del que
 * habla `sales.price_ars` es el TC que estaba cuando se movió el listing, no el de un instante
 * antes ni el de un `select` que quedó viejo mientras se resolvía el resto.
 */
async function freezeFx(
  tx: Tx,
  ctx: TenantContext,
  priceUsdCents: number,
  listingId: string,
): Promise<FrozenFx | null> {
  const rows = await tx
    .select({ arsPerUsd: fxSettings.arsPerUsd, rounding: fxSettings.rounding })
    .from(fxSettings)
    .where(eq(fxSettings.tenantId, ctx.tenantId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  try {
    const rate = fxRateFromArsCents(row.arsPerUsd);
    return {
      priceArsCents: applyFx(priceUsdCents, rate, row.rounding satisfies FxRoundingMode),
      arsCentsPerUsd: rate.arsCentsPerUsd,
    };
  } catch {
    /**
     * El TC guardado no es aplicable (un cero que se coló, un monto que se va del rango seguro en
     * pesos). La venta **sigue**: ver el encabezado. Se loguean ids y el motivo, nunca el número —
     * el TC no es sensible, pero el `Error` del dominio cita el input crudo y ese hábito es el que
     * termina escribiendo un precio, un costo o un IMEI en un archivo.
     */
    logError('sale.fx_unusable', FX_UNUSABLE, { tenantId: ctx.tenantId, listingId });
    return null;
  }
}

export async function recordSale(tx: Tx, ctx: TenantContext, facts: SaleFacts): Promise<void> {
  const fx = await freezeFx(tx, ctx, facts.priceUsdCents, facts.listingId);

  await tx.insert(sales).values({
    tenantId: ctx.tenantId,
    listingId: facts.listingId,
    reservationId: facts.reservationId,
    priceUsd: facts.priceUsdCents,
    priceArs: fx === null ? null : fx.priceArsCents,
    fxArsPerUsd: fx === null ? null : fx.arsCentsPerUsd,
    paymentMethod: facts.paymentMethod,
    // D2. El trigger de la base copia el costo de la unidad lockeada en esta transacción. No se
    // nombra `cost_usd` acá: el caller autenticado no tiene SELECT sobre esa columna.
    soldBy: ctx.userId,
  });
}
