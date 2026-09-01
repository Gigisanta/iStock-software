import 'server-only';

import { sql } from 'drizzle-orm';
import type { ListingStatus } from '@istock/domain';
import type { Tx } from '../db/connection';
import type { TenantContext } from '../db/session';

/**
 * Única puerta del panel para cambiar `listings.status`.
 *
 * El RPC corre con los claims de `withTenantDb()` y valida de nuevo tenant, membresía, arista y
 * estado esperado. Devuelve 0 cuando la fila no existe para ese tenant o alguien ganó la carrera;
 * en ese caso no hay que escribir reservas, ventas ni eventos derivados.
 */
export async function transitionListingStatus(
  tx: Tx,
  ctx: TenantContext,
  listingId: string,
  expectedStatus: ListingStatus,
  nextStatus: ListingStatus,
): Promise<boolean> {
  const rows = await tx.execute<{ changed: number }>(sql`
    select public.transition_listing_status(
      ${ctx.tenantId}::uuid,
      ${listingId}::uuid,
      ${expectedStatus}::listing_status,
      ${nextStatus}::listing_status
    ) as changed
  `);

  return Number(rows[0]?.changed ?? 0) === 1;
}
