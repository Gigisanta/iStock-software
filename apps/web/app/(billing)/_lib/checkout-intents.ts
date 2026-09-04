import 'server-only';
import { and, eq } from 'drizzle-orm';
import { billingCheckoutIntents } from '@istock/db';
import { withTenantDb, type TenantContext } from '../../(app)/_lib/db/session';
import type { Tx } from '../../(app)/_lib/db/connection';
import type { PaidPlanTier } from './plans';

/** Una función caída no puede dejar bloqueado el checkout para siempre. */
export const CHECKOUT_INTENT_LEASE_MS = 10 * 60 * 1000;

export type CheckoutIntentRow = {
  readonly id: string;
  readonly plan: PaidPlanTier;
  readonly status: 'creating' | 'ready' | 'failed';
  readonly initPoint: string | null;
  readonly leaseExpiresAt: Date | null;
};

export type CheckoutIntentClaim =
  | { readonly kind: 'claimed'; readonly intentId: string }
  | { readonly kind: 'ready'; readonly plan: PaidPlanTier; readonly initPoint: string }
  | { readonly kind: 'in_progress'; readonly plan: PaidPlanTier }
  | { readonly kind: 'conflict'; readonly plan: PaidPlanTier };

const intentColumns = {
  id: billingCheckoutIntents.id,
  plan: billingCheckoutIntents.plan,
  status: billingCheckoutIntents.status,
  initPoint: billingCheckoutIntents.initPoint,
  leaseExpiresAt: billingCheckoutIntents.leaseExpiresAt,
} as const;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveExistingCheckoutIntent(
  row: CheckoutIntentRow,
  requestedPlan: PaidPlanTier,
  now: Date,
): Exclude<CheckoutIntentClaim, { readonly kind: 'claimed' }> | null {
  if (row.status === 'ready') {
    if (row.initPoint === null || !isHttpsUrl(row.initPoint)) {
      throw new Error('checkout intent ready sin init point válido');
    }
    return row.plan === requestedPlan
      ? { kind: 'ready', plan: row.plan, initPoint: row.initPoint }
      : { kind: 'conflict', plan: row.plan };
  }

  if (row.status === 'creating' && row.leaseExpiresAt !== null && row.leaseExpiresAt > now) {
    return row.plan === requestedPlan
      ? { kind: 'in_progress', plan: row.plan }
      : { kind: 'conflict', plan: row.plan };
  }

  return null;
}

async function lockIntent(tx: Tx, tenantId: string) {
  const rows = await tx
    .select(intentColumns)
    .from(billingCheckoutIntents)
    .where(eq(billingCheckoutIntents.tenantId, tenantId))
    .for('update')
    .limit(1);
  return rows[0] as CheckoutIntentRow | undefined;
}

/**
 * Reclama el único checkout pendiente del tenant de forma serializable a nivel de fila.
 *
 * La inserción con `ON CONFLICT DO NOTHING` cierra la carrera entre dos pestañas; el `FOR
 * UPDATE` reevalúa el estado ganador después de que Postgres libera el lock de la otra
 * transacción. El proveedor no ofrece una clave de idempotencia documentada para
 * `POST /preapproval`, por eso esta garantía vive acá y no en el browser.
 */
export async function claimSubscriptionCheckout(
  ctx: TenantContext,
  input: { readonly plan: PaidPlanTier; readonly amountArsCents: number; readonly now?: Date },
): Promise<CheckoutIntentClaim> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + CHECKOUT_INTENT_LEASE_MS);

  return withTenantDb(ctx, async (tx) => {
    const inserted = await tx
      .insert(billingCheckoutIntents)
      .values({
        tenantId: ctx.tenantId,
        provider: 'mercadopago',
        plan: input.plan,
        amountArs: input.amountArsCents,
        status: 'creating',
        leaseExpiresAt,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: billingCheckoutIntents.tenantId })
      .returning({ id: billingCheckoutIntents.id });

    const created = inserted[0];
    if (created !== undefined) return { kind: 'claimed', intentId: created.id };

    const existing = await lockIntent(tx, ctx.tenantId);
    if (existing === undefined) throw new Error('checkout intent desapareció durante el reclamo');

    const current = resolveExistingCheckoutIntent(existing, input.plan, now);
    if (current !== null) return current;

    const reclaimed = await tx
      .update(billingCheckoutIntents)
      .set({
        provider: 'mercadopago',
        plan: input.plan,
        amountArs: input.amountArsCents,
        status: 'creating',
        providerPreapprovalId: null,
        initPoint: null,
        leaseExpiresAt,
        updatedAt: now,
      })
      .where(and(eq(billingCheckoutIntents.id, existing.id), eq(billingCheckoutIntents.tenantId, ctx.tenantId)))
      .returning({ id: billingCheckoutIntents.id });

    const row = reclaimed[0];
    if (row === undefined) throw new Error('checkout intent no se pudo reclamar');
    return { kind: 'claimed', intentId: row.id };
  });
}

/** Guarda el checkout del proveedor sólo si este proceso todavía es el dueño del lease. */
export async function completeSubscriptionCheckout(
  ctx: TenantContext,
  input: { readonly intentId: string; readonly providerPreapprovalId: string; readonly initPoint: string; readonly now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  if (input.providerPreapprovalId.trim().length === 0 || !isHttpsUrl(input.initPoint)) {
    throw new Error('checkout intent inválido');
  }
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .update(billingCheckoutIntents)
      .set({
        status: 'ready',
        providerPreapprovalId: input.providerPreapprovalId,
        initPoint: input.initPoint,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(billingCheckoutIntents.id, input.intentId),
          eq(billingCheckoutIntents.tenantId, ctx.tenantId),
          eq(billingCheckoutIntents.status, 'creating'),
        ),
      )
      .returning({ id: billingCheckoutIntents.id }),
  );
  return rows.length === 1;
}

/** Marca un fallo recuperable; no borra el rastro ni libera una fila de otro proceso. */
export async function failSubscriptionCheckout(
  ctx: TenantContext,
  input: { readonly intentId: string; readonly now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await withTenantDb(ctx, async (tx) => {
    await tx
      .update(billingCheckoutIntents)
      .set({
        status: 'failed',
        providerPreapprovalId: null,
        initPoint: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(billingCheckoutIntents.id, input.intentId),
          eq(billingCheckoutIntents.tenantId, ctx.tenantId),
          eq(billingCheckoutIntents.status, 'creating'),
        ),
      );
  });
}
