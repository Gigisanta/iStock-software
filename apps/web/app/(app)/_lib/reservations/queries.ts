import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { reservations } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';

/**
 * Lecturas de reservas del panel.
 *
 * ── Qué se selecciona, y qué no ──────────────────────────────────────────────────────────────
 * `customer_label` **no** entra en la lectura de la lista de stock. Es texto que escribió el dueño
 * sobre una persona ("Juan de Cipolletti") y no lo necesita ninguna decisión: la lista muestra
 * "Reservado hasta las 15:30", no a quién. Traerlo lo pondría en el payload RSC de cien filas para
 * pintar cero pantallas. Mismo criterio que `cost_usd` en `listings/queries.ts`: no se esconde, no
 * se pide.
 *
 * ── Las dos capas de tenant ──────────────────────────────────────────────────────────────────
 * `withTenantDb` prende RLS (`reservations_tenant_select`) **y** cada `where` lleva su
 * `eq(reservations.tenantId, ctx.tenantId)`. `CLAUDE.md` §2: las dos, siempre.
 *
 * ── "Activa" es un estado, no una fecha ──────────────────────────────────────────────────────
 * Se filtra por `status = 'active'` y **no** por `expires_at > now()`. Una reserva vencida que el
 * cron todavía no barrió sigue siendo la reserva activa de esa unidad: el índice único parcial la
 * cuenta, así que insertar otra rebota con `23505`. Si acá dijéramos que no existe, el panel
 * ofrecería reservar un equipo que la base va a rechazar. Quien decide si venció es
 * `expireReservation()` del dominio, con `now` inyectado.
 */

export interface ActiveReservationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  readonly expiresAt: Date;
  /**
   * Cuántas veces seguidas falló el barrido sobre esta fila. Lo escribe el cron
   * (`_lib/reservations/expire-reservations.ts`); acá se lee para **una** cosa: que
   * `reservationCountdown()` distinga "el cron pasa en un rato" de "el barrido ya la abandonó y
   * esta unidad no se libera sola nunca más". Es un `int` por fila y evita que el panel le pida al
   * dueño que espere algo que no va a pasar.
   */
  readonly sweepAttempts: number;
}

/**
 * La reserva viva de una unidad, o `null`.
 *
 * Devuelve el `tenantId` aunque la query ya filtre por él: es lo que
 * `checkTransition()` compara contra `ctx.tenantId` para decidir
 * `reservation_tenant_mismatch`. El dominio no confía en que el caller haya filtrado bien, y ese
 * es exactamente el punto de la defensa en profundidad — si el día de mañana esta query se
 * afloja, el chequeo del dominio sigue parado.
 */
export async function loadActiveReservation(
  ctx: TenantContext,
  listingId: string,
): Promise<ActiveReservationRow | null> {
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        listingId: reservations.listingId,
        expiresAt: reservations.expiresAt,
        sweepAttempts: reservations.sweepAttempts,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, ctx.tenantId),
          eq(reservations.listingId, listingId),
          eq(reservations.status, 'active'),
        ),
      )
      .limit(1),
  );

  return rows[0] ?? null;
}

/**
 * Las reservas vivas de un conjunto de unidades, indexadas por `listing_id`.
 *
 * Existe para que `/app/stock` no haga N+1: cien equipos en pantalla son **una** query, no cien.
 * El índice `reservations_tenant_status_idx` (`tenant_id, status, expires_at`) la cubre.
 */
export async function loadActiveReservations(
  ctx: TenantContext,
  listingIds: readonly string[],
): Promise<ReadonlyMap<string, ActiveReservationRow>> {
  if (listingIds.length === 0) return new Map();

  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        listingId: reservations.listingId,
        expiresAt: reservations.expiresAt,
        sweepAttempts: reservations.sweepAttempts,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, ctx.tenantId),
          inArray(reservations.listingId, [...listingIds]),
          eq(reservations.status, 'active'),
        ),
      ),
  );

  return new Map(rows.map((row) => [row.listingId, row]));
}
