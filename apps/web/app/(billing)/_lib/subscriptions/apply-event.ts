import 'server-only';
import { and, eq } from 'drizzle-orm';
import { billingCheckoutIntents, subscriptions, tenants } from '@istock/db';
import type { Tx } from '../../../(app)/_lib/db/connection';
import type { PaidPlanTier } from '../plans';
import { planAfterEffect, type PlanEffect, type SubscriptionStatus } from './status';

/**
 * **El efecto.** Lo único que este paquete escribe cuando un evento de MP resulta ser real, nuevo
 * y entendible.
 *
 * Recibe la `Tx` y no la abre: la transacción la abre el ledger, porque reclamar el evento y
 * aplicarlo tienen que ser atómicos (ver `webhook/ledger.ts`). Si esta función abriera su propia
 * transacción habría dos, y entre una y otra cabe un reintento de MP.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  DOS tablas, UNA transacción, y por qué no alcanza con una
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `subscriptions` es el **libro comercial**: qué se compró, con qué medio de pago, hasta cuándo
 * está paga la relación. `tenants.plan` / `tenants.trial_ends_at` es el **modelo de lectura**: es
 * lo que `requireTenant()` levanta en cada request y lo que termina en el `PlanSnapshot` que
 * resuelve cada entitlement.
 *
 * Escribir sólo `subscriptions` sería un webhook que anda perfecto y no cambia nada de lo que el
 * cliente ve: pagó y el chatbot sigue apagado. Escribirlas en dos transacciones distintas sería
 * dejar una ventana donde cobramos y no habilitamos, o al revés. Van juntas o no van.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `upsert`, no `update`, y el motivo es un bug real de otra columna
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `createTenant()` (de `app-agent`) siembra `tenants`, `memberships`, `fx_settings` y `locations`
 * — **no** siembra `subscriptions`. Sólo el seed crea esa fila. O sea: hoy, todo tenant real vive
 * sin fila de suscripción, y un `update` acá no escribiría nada y no fallaría. El `on conflict`
 * sobre `subscriptions_tenant_key` hace que el primer pago cree la fila y los siguientes la pisen.
 * (Está reportado al LEAD; el `upsert` es correcto igual cuando se arregle.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `last_provider_event_id` NO es la idempotencia
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Se escribe, y sirve para mirar una fila y saber qué la tocó último. Pero es **una** columna: con
 * eventos entrelazados (A, B, A) sólo recuerda el inmediato anterior y dejaría pasar el segundo A.
 * La idempotencia es el ledger con su índice único. El docblock de `packages/db/src/schema/billing.ts`
 * dice que esta columna es "la idempotencia del webhook"; **eso está reportado al LEAD como
 * incorrecto** y esta línea es la versión que vale.
 */

export interface SubscriptionEvent {
  readonly tenantId: string;
  /** El plan que el tenant compró, leído del `external_reference` que viajó al checkout. */
  readonly plan: PaidPlanTier;
  readonly status: SubscriptionStatus;
  readonly planEffect: PlanEffect;
  readonly providerPreapprovalId: string | null;
  readonly externalReference: string | null;
  /** `account_money` · `debin_transfer` · `credit_card` ... lo que reporte MP, sin interpretar. */
  readonly paymentMethod: string | null;
  readonly amountArsCents: number | null;
  readonly currentPeriodEnd: Date | null;
  /** El `id` de la notificación. Rastro de auditoría, no clave de idempotencia. */
  readonly eventId: string;
  readonly occurredAt: Date;
}

/**
 * Aplica el evento. **No decide nada**: la traducción de estados ya la hizo `status.ts` y la
 * autenticidad ya la verificó la firma. Acá sólo se escribe.
 */
export async function applySubscriptionEvent(tx: Tx, event: SubscriptionEvent): Promise<void> {
  const cancelledAt = event.status === 'cancelled' ? event.occurredAt : null;

  await tx
    .insert(subscriptions)
    .values({
      tenantId: event.tenantId,
      provider: 'mercadopago',
      providerPreapprovalId: event.providerPreapprovalId,
      externalReference: event.externalReference,
      lastProviderEventId: event.eventId,
      plan: event.plan,
      status: event.status,
      amountArs: event.amountArsCents,
      paymentMethod: event.paymentMethod,
      currentPeriodEnd: event.currentPeriodEnd,
      cancelledAt,
      updatedAt: event.occurredAt,
    })
    .onConflictDoUpdate({
      target: subscriptions.tenantId,
      set: {
        providerPreapprovalId: event.providerPreapprovalId,
        externalReference: event.externalReference,
        lastProviderEventId: event.eventId,
        plan: event.plan,
        status: event.status,
        amountArs: event.amountArsCents,
        paymentMethod: event.paymentMethod,
        currentPeriodEnd: event.currentPeriodEnd,
        cancelledAt,
        updatedAt: event.occurredAt,
      },
    });

  // Un checkout queda abierto mientras el preapproval está pendiente: borrarlo acá permitiría
  // que la siguiente pestaña cree otro. Sólo un estado final o autorizado libera el intent.
  if (event.planEffect !== 'keep' && event.providerPreapprovalId !== null) {
    await tx
      .delete(billingCheckoutIntents)
      .where(
        and(
          eq(billingCheckoutIntents.tenantId, event.tenantId),
          eq(billingCheckoutIntents.providerPreapprovalId, event.providerPreapprovalId),
        ),
      );
  }

  const nextPlan = planAfterEffect(event.planEffect, event.plan);
  if (nextPlan === null) return;

  // `tenants` no lleva `tenant_id`: su identificador de tenant es su propio `id` (por eso usa
  // `selfTenantPolicies`). El `where` por `id` es el filtro explícito que pide `CLAUDE.md` §2.
  //
  // `trial_ends_at` NO se toca, ni al dar de alta ni al revocar. Es el registro histórico de
  // cuándo terminó la prueba, y `featureAccess()`/`hasEntitlement()` lo leen sólo cuando el plan
  // es `trial`. Pisarlo al cancelar sería regalar una prueba nueva cada vez que alguien se va.
  //
  // `tenants.status` tampoco: pasarlo a `suspended` apaga la vidriera entera (la policy anónima
  // exige `status = 'active'`), y "la vidriera no se cae de golpe" es requisito del encargo. La
  // política de degradación es P1 de `PRODUCT.md` y está ABIERTA: no se inventa acá.
  await tx
    .update(tenants)
    .set({ plan: nextPlan, updatedAt: event.occurredAt })
    .where(eq(tenants.id, event.tenantId));
}
