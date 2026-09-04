import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { fxSettings, locations, tenants } from '@istock/db';
import type { FxRoundingMode } from '@istock/domain';
import { withTenantDb, type TenantContext } from '../db/session';

/**
 * Lecturas de configuración del tenant.
 *
 * Este archivo es el ejemplo canónico de las dos reglas que más se olvidan, y las dos están en la
 * misma query:
 *
 * 1. **`withTenantDb`** → la query corre como `authenticated` con los claims del usuario, así que
 *    la policy `tenants_tenant_select` está activa.
 * 2. **`.where(eq(tenants.id, ctx.tenantId))`** → el filtro explícito, *además* de RLS.
 *    `CLAUDE.md` §2: *"Query sin filtro de tenant además de RLS → rechazo"*. Sí, es redundante
 *    con la policy. Esa es exactamente la idea: si mañana alguien afloja la policy en un fix
 *    apurado, esta query sigue devolviendo un solo negocio.
 *
 * Y una tercera que todavía no tiene columnas que proteger pero ya tiene forma: el `select` es una
 * **allowlist de columnas**, no un `select *`. Cuando `listings` entre en S2, `cost_usd` y
 * `margin_usd` no van a estar en el payload del `seller` porque nunca se van a pedir — no porque
 * un componente los esconda (`CLAUDE.md` §0.9).
 */

export interface TenantSettings {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly isDemo: boolean;
  readonly waPhone: string;
  readonly acceptsTradeIn: boolean;
  readonly reservationMinutes: number;
  readonly paymentMethods: readonly string[];
  readonly plan: 'trial' | 'base' | 'negocio';
  readonly status: 'active' | 'suspended' | 'cancelled';
  readonly trialEndsAt: Date | null;
  readonly pickup: TenantPickupSettings | null;
}

export interface TenantPickupSettings {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly hours: string;
}

export async function loadTenantSettings(ctx: TenantContext): Promise<TenantSettings | null> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        isDemo: tenants.isDemo,
        waPhone: tenants.waPhone,
        acceptsTradeIn: tenants.acceptsTradeIn,
        reservationMinutes: tenants.reservationMinutes,
        paymentMethods: tenants.paymentMethods,
        plan: tenants.plan,
        status: tenants.status,
        trialEndsAt: tenants.trialEndsAt,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    const pickupRows = await tx
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        hours: locations.hours,
      })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.isActive, true)))
      .orderBy(asc(locations.sortOrder), asc(locations.name))
      .limit(1);

    return {
      ...row,
      pickup: pickupRows[0] ?? null,
    };
  });
}

/**
 * El TC automático del tenant, tal como está guardado. `null` = todavía no sincronizó ninguno.
 *
 * **`null` no se rellena con un default**, y es la misma decisión que toma la vidriera en
 * `fxContext()`: publicar pesos calculados con un TC inventado por nosotros es peor que no
 * publicarlos. La fila la siembra el alta usando BCRA y la mantiene el cron diario.
 *
 * Es una lectura suelta y **no** reemplaza al `freezeFx()` de `_lib/sales/record-sale.ts`: aquel
 * corre adentro de la transacción de la venta porque congela el TC del instante en que se movió el
 * listing. Este es para mostrar y para armar texto; no archiva nada.
 *
 * Las dos capas de siempre: RLS por `withTenantDb` más el `eq(fxSettings.tenantId, …)` explícito.
 */
export interface TenantFxSettings {
  /** Centavos de ARS por 1 USD (`148750` = TC 1487,50). Sin validar: lo hace `@istock/domain`. */
  readonly arsCentsPerUsd: number;
  readonly rounding: FxRoundingMode;
}

export async function loadFxSettings(ctx: TenantContext): Promise<TenantFxSettings | null> {
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({ arsCentsPerUsd: fxSettings.arsPerUsd, rounding: fxSettings.rounding })
      .from(fxSettings)
      .where(eq(fxSettings.tenantId, ctx.tenantId))
      .limit(1),
  );

  return rows[0] ?? null;
}

/** Días que le quedan de prueba. Negativo o `null` no se muestran como número. */
export function trialDaysLeft(trialEndsAt: Date | null, now: Date = new Date()): number | null {
  if (trialEndsAt === null) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
