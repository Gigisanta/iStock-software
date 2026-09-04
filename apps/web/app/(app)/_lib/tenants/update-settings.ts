import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { locations, tenants } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import { logError } from '../log';
import { invalidateStorefront } from './storefront-cache';
import type { UpdateTenantSettingsInput } from './settings-schema';

export async function updateTenantSettings(
  ctx: TenantContext,
  slug: string,
  input: UpdateTenantSettingsInput,
): Promise<void> {
  try {
    await withTenantDb(ctx, async (tx) => {
      const updatedTenants = await tx
        .update(tenants)
        .set({
          name: input.name,
          waPhone: input.waPhone,
          paymentMethods: input.paymentMethods,
          acceptsTradeIn: input.acceptsTradeIn,
          reservationMinutes: input.reservationMinutes,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId))
        .returning({ id: tenants.id });

      if (updatedTenants.length !== 1) throw new Error('tenant_not_updated');

      const pickupRows = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.isActive, true)))
        .orderBy(asc(locations.sortOrder), asc(locations.name))
        .limit(1);
      const pickup = pickupRows[0];

      if (pickup === undefined) {
        await tx.insert(locations).values({
          tenantId: ctx.tenantId,
          name: input.pickupName,
          address: input.pickupAddress,
          hours: input.pickupHours,
          isActive: true,
          sortOrder: 0,
        });
      } else {
        await tx
          .update(locations)
          .set({
            name: input.pickupName,
            address: input.pickupAddress,
            hours: input.pickupHours,
            updatedAt: new Date(),
          })
          .where(and(eq(locations.id, pickup.id), eq(locations.tenantId, ctx.tenantId)));
      }
    });
  } catch (error) {
    logError('tenant.settings.update_failed', errorCode(error), { tenantId: ctx.tenantId });
    throw error;
  }

  // Debe ejecutarse después del commit: la próxima visita pública tiene que ver los datos nuevos.
  invalidateStorefront(slug);
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const named = error as { code?: string; name?: string };
  return named.code ?? named.name ?? 'unknown';
}
