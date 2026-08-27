import 'server-only';
import { eq } from 'drizzle-orm';
import { tenants } from '@istock/db';
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
  readonly waPhone: string;
  readonly acceptsTradeIn: boolean;
  readonly paymentMethods: readonly string[];
  readonly plan: 'trial' | 'base' | 'negocio';
  readonly status: 'active' | 'suspended' | 'cancelled';
  readonly trialEndsAt: Date | null;
}

export async function loadTenantSettings(ctx: TenantContext): Promise<TenantSettings | null> {
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        waPhone: tenants.waPhone,
        acceptsTradeIn: tenants.acceptsTradeIn,
        paymentMethods: tenants.paymentMethods,
        plan: tenants.plan,
        status: tenants.status,
        trialEndsAt: tenants.trialEndsAt,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
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
