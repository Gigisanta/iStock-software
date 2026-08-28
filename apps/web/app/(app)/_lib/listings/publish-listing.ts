import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import {
  MIN_PHOTOS_TO_PUBLISH,
  checkTransition,
  transitionEffects,
  type ListingStatus,
  type TransitionContext,
  type TransitionDenyReason,
} from '@istock/domain';
import { listingEvents, listings } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import { logEvent } from '../log';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';
import { loadUnitForTransition, type UnitForTransition } from './queries';

/**
 * Publicar / despublicar una unidad.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  No hay un `UPDATE status` suelto en ningún lado de este panel.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Toda transición pasa por `checkTransition()` de `@istock/domain`, que es exhaustivo: la tabla de
 * aristas es un `Record` completo sobre `ListingStatus` y lo que no está listado devuelve `false`.
 * Reimplementar el criterio acá sería tener dos máquinas de estados, y la segunda siempre es la
 * que se olvida de que `sold` es terminal.
 *
 * Y los **efectos** tampoco se deciden a ojo: `transitionEffects(from, to)` dice si la vidriera
 * cambió. `CLAUDE.md` §0.7 — *"Mutación que cambia stock visible → siempre
 * `revalidateTag('storefront:' + slug)`"*. Acá eso se cumple porque la tabla del dominio lo dice,
 * no porque quien escribió esta función se acordó.
 *
 * ── Por qué el alta NO llama a esto ──────────────────────────────────────────────────────────
 * Una unidad nace en `draft`. La policy de `anon` sobre `listings` exige
 * `status in ('available','reserved','sold') and published_at is not null`: un borrador no existe
 * para el visitante. Invalidar el cache al crear un borrador sería un miss de CDN por cada equipo
 * cargado sin que nadie vea nada distinto.
 *
 * ── `published_at` ───────────────────────────────────────────────────────────────────────────
 * No se escribe desde acá. Lo estampa el trigger `listings_stamp_published_at` (migración 0002),
 * y está bien que así sea: *"la policy de anon exige published_at not null y no puede depender de
 * que el panel se acuerde"*.
 */

export type PublishOutcome =
  | { readonly ok: true; readonly status: ListingStatus }
  | { readonly ok: false; readonly message: string };

/** Motivo del dominio → castellano rioplatense. Le habla a alguien parado en el mostrador. */
export function denyReasonText(reason: TransitionDenyReason): string {
  switch (reason) {
    case 'missing_photos':
      return `Faltan fotos: para publicarlo necesitás ${String(MIN_PHOTOS_TO_PUBLISH)}.`;
    case 'missing_price':
      return 'Falta el precio en dólares.';
    case 'missing_condition':
      return 'Falta decir en qué estado está.';
    case 'missing_catalog_model':
      return 'Falta elegir el modelo. Todavía no se puede desde acá.';
    case 'invalid_qty':
      return 'Falta poner cuántas unidades hay.';
    case 'same_state':
      return 'Ya está así.';
    case 'terminal_state':
      return 'Está vendido: no se puede volver atrás desde acá.';
    case 'edge_not_allowed':
      return 'Ese cambio no se puede hacer desde el estado actual.';
    case 'entitlement_required':
      return 'Eso viene con el plan Negocio.';
    case 'reservation_already_active':
      return 'Ya tiene una reserva activa.';
    case 'reservation_not_active':
      return 'No tiene una reserva activa.';
    case 'reservation_not_expired':
      return 'La reserva todavía no venció.';
    case 'reservation_tenant_mismatch':
      return 'Esa reserva no es de este negocio.';
  }
}

/**
 * El contexto que pide `@istock/domain` para decidir. Se arma en un solo lugar para que la
 * pantalla y la Server Action evalúen **exactamente** lo mismo: si el botón se dibuja con un
 * criterio y la acción valida con otro, el dueño ve un botón que siempre falla.
 */
export function transitionContextFor(
  ctx: TenantContext,
  unit: UnitForTransition,
  now: Date,
): TransitionContext {
  return {
    now,
    tenantId: ctx.tenantId,
    kind: unit.kind,
    photoCount: unit.photoCount,
    priceUsdCents: unit.priceUsdCents,
    condition: unit.condition,
    catalogModelId: unit.catalogModelId,
    qty: unit.qty,
    /**
     * Las reservas son S6 y del plan Negocio. `checkPublishable` no las mira; la arista
     * `available → reserved` sí, y cuando exista va a leer el plan del tenant. Poner `false` acá
     * es correcto **hoy** para las aristas que este módulo ejecuta (publicar / despublicar) y no
     * es una deuda escondida: la arista que lo usaría todavía no está implementada.
     */
    entitlements: { reservations: false },
    activeReservation: null,
  };
}

/**
 * Cambia el estado de una unidad. `tenantSlug` viene de la sesión, no del request: es lo que se
 * usa para invalidar el cache y un slug de otro tenant purgaría la vidriera ajena.
 */
export async function transitionUnit(
  ctx: TenantContext,
  tenantSlug: string,
  listingId: string,
  to: ListingStatus,
  now: Date = new Date(),
): Promise<PublishOutcome> {
  const unit = await loadUnitForTransition(ctx, listingId);
  if (unit === null) return { ok: false, message: 'No encontramos ese equipo.' };

  const from = unit.status;
  const check = checkTransition(from, to, transitionContextFor(ctx, unit, now));
  if (!check.ok) return { ok: false, message: denyReasonText(check.reason) };

  const updated = await withTenantDb(ctx, async (tx) => {
    // `eq(status, from)` es el guard de concurrencia: si otro dispositivo ya lo movió, esta
    // actualización afecta 0 filas en vez de pisar una transición que ya ocurrió.
    const rows = await tx
      .update(listings)
      .set({ status: to, updatedAt: sql`now()` })
      .where(
        and(
          eq(listings.tenantId, ctx.tenantId),
          eq(listings.id, listingId),
          eq(listings.status, from),
        ),
      )
      .returning({ id: listings.id });

    if (rows.length === 0) return false;

    await tx.insert(listingEvents).values({
      tenantId: ctx.tenantId,
      listingId,
      kind: 'status_change',
      fromStatus: from,
      toStatus: to,
      actorUserId: ctx.userId,
    });

    return true;
  });

  if (!updated) {
    return { ok: false, message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.' };
  }

  /**
   * El dominio decide si la vidriera cambió; nosotros ejecutamos.
   *
   * Publicar o despublicar mueve la **grilla** (el equipo entra o sale) y la **ficha**, así que va
   * la invalidación de los tres tags: los dos del tenant más `listing:{uuid}`. El de la unidad no
   * se saltea aunque hoy sea redundante — ver el bloque "el TERCER tag" en `storefront-cache.ts`.
   */
  if (transitionEffects(from, to).revalidateStorefront) {
    invalidateStorefrontUnit(tenantSlug, listingId);
  }

  logEvent('listing.status_changed', {
    tenantId: ctx.tenantId,
    listingId,
    from,
    to,
  });

  return { ok: true, status: to };
}
