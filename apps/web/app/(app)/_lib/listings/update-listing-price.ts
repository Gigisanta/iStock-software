import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { ListingStatus } from '@istock/domain';
import { listingEvents, listings } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import { logError } from '../log';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';

/** Resultado de una edición de precio hecha desde el stock. */
export type UpdateListingPriceResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly listingId: string;
      readonly status: ListingStatus;
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid' | 'not_found' | 'sold' | 'failed';
      readonly message: string;
    };

const NOT_FOUND = 'No encontramos ese equipo. Recargá la pantalla.';
const SOLD = 'Ese equipo ya está vendido y no se puede editar.';
const FAILED = 'No pudimos guardar el precio. Probá de nuevo en unos segundos.';

/**
 * Cambia sólo el precio público de una unidad.
 *
 * El lock de la fila hace que dos pestañas no armen eventos con un precio anterior incorrecto.
 * La transacción también deja la bitácora y la invalidación ocurre recién después del commit:
 * una vidriera nunca recibe un tag nuevo para una escritura que finalmente rebotó.
 */
export async function updateListingPrice(
  ctx: TenantContext,
  tenantSlug: string,
  listingId: string,
  priceUsdCents: number,
): Promise<UpdateListingPriceResult> {
  if (!Number.isSafeInteger(priceUsdCents) || priceUsdCents <= 0) {
    return { ok: false, reason: 'invalid', message: 'El precio tiene que ser mayor a cero.' };
  }

  let result: UpdateListingPriceResult;
  try {
    result = await withTenantDb(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: listings.id,
          status: listings.status,
          priceUsd: listings.priceUsd,
        })
        .from(listings)
        .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, listingId)))
        .for('update')
        .limit(1);

      const current = rows[0];
      if (current === undefined) return { ok: false, reason: 'not_found', message: NOT_FOUND };
      if (current.status === 'sold') return { ok: false, reason: 'sold', message: SOLD };
      if (current.priceUsd === priceUsdCents) {
        return {
          ok: true,
          changed: false,
          listingId: current.id,
          status: current.status,
        };
      }

      const updated = await tx
        .update(listings)
        .set({ priceUsd: priceUsdCents, updatedAt: new Date() })
        .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, current.id)))
        .returning({ id: listings.id, status: listings.status });

      const saved = updated[0];
      if (saved === undefined) return { ok: false, reason: 'not_found', message: NOT_FOUND };

      await tx.insert(listingEvents).values({
        tenantId: ctx.tenantId,
        listingId: saved.id,
        kind: 'price_change',
        actorUserId: ctx.userId,
        metadata: {
          fromPriceUsdCents: current.priceUsd,
          toPriceUsdCents: priceUsdCents,
        },
      });

      return {
        ok: true,
        changed: true,
        listingId: saved.id,
        status: saved.status,
      };
    });
  } catch (error) {
    logError('listing.price_update_failed', errorCode(error), {
      tenantId: ctx.tenantId,
      listingId,
    });
    return { ok: false, reason: 'failed', message: FAILED };
  }

  // Un borrador todavía no existe para la vidriera; evitar la purga mantiene el costo acotado.
  if (result.ok && result.changed && (result.status === 'available' || result.status === 'reserved')) {
    invalidateStorefrontUnit(tenantSlug, result.listingId);
  }

  return result;
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const named = error as { code?: string; name?: string };
  return named.code ?? named.name ?? 'unknown';
}
