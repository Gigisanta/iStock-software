import 'server-only';
import { sql } from 'drizzle-orm';
import { withServiceDb } from '../../../(app)/_lib/db/session';
import type { BillingEventLedger, ClaimOutcome, EventClaim } from './ledger';

/**
 * El ledger de verdad: una fila por evento, con **índice único**, y el efecto en la misma
 * transacción.
 *
 * La tabla vive en `packages/db/src/schema/billing.ts` y en la migración
 * `packages/db/drizzle/0010_breezy_norrin_radd.sql`. Su forma es:
 *
 *   billing_webhook_events
 *     id                 uuid pk
 *     tenant_id          uuid not null references tenants(id) on delete cascade
 *     provider           text not null default 'mercadopago'
 *     provider_event_id  text not null
 *     topic              text not null
 *     action             text
 *     resource_id        text
 *     received_at        timestamptz not null default now()
 *     índice único (provider, provider_event_id)   ← la idempotencia
 *     índice (tenant_id)
 *     RLS: tenantPolicies('billing_webhook_events')
 *     GRANT: sólo service_role la escribe (el webhook no tiene sesión)
 *
 * **El único único es `(provider, provider_event_id)`, SIN `tenant_id`.** Los ids de notificación
 * de MP son globales; agregar el tenant a la clave permitiría aplicar el mismo evento una vez por
 * tenant, que es el cobro doble con otro disfraz.
 *
 * Si el deploy objetivo todavía no aplicó la migración, este driver falla con
 * `BillingLedgerMissingError` y el handler responde 500. Es a propósito: MP reintenta, así que
 * nada se pierde, y el error tiene nombre propio en el log en vez de ser un `42P01` anónimo. Lo
 * que no hace es degradar a "procesar sin deduplicar": un ledger que se saltea cuando falta la
 * tabla es peor que no tenerlo, porque parece que anda.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué `withServiceDb`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Es el mismo argumento del cron de reservas: **lo dispara Mercado Pago, no una persona; no hay
 * sesión, no hay claim y por lo tanto no hay tenant**. Bajo
 * `withTenantDb` las policies se evaluarían contra un claim inexistente y no escribirían nada
 * **sin fallar**: el webhook devolvería 200 y no habría activado ningún plan. Menos permiso acá no
 * da menos datos, da la respuesta equivocada.
 *
 * Lo que acota el permiso es lo que se escribe: `tenant_id` sale del `external_reference`
 * validado con forma de UUID, y el `values` lo lleva explícito (`CLAUDE.md` §2, defensa en
 * profundidad).
 */

export class BillingLedgerMissingError extends Error {
  constructor() {
    super(
      'falta la tabla billing_webhook_events: aplicá la migración de billing antes de habilitar ' +
        'el webhook de Mercado Pago.',
    );
    this.name = 'BillingLedgerMissingError';
  }
}

/** `42P01` = undefined_table. Es el síntoma exacto de la migración que falta. */
function isUndefinedTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
}

export function createPgBillingEventLedger(): BillingEventLedger {
  return {
    async claimAndApply(claim: EventClaim, effect): Promise<ClaimOutcome> {
      return withServiceDb(async (tx) => {
        let claimed: { readonly length: number };
        try {
          // `on conflict do nothing` + `returning`: si la fila ya estaba, no vuelve nada. La
          // unicidad la garantiza el índice, no un `select` previo — dos entregas simultáneas
          // leerían las dos "no existe" y aplicarían las dos.
          claimed = await tx.execute(sql`
            insert into billing_webhook_events
              (tenant_id, provider, provider_event_id, topic, action, resource_id)
            values (
              ${claim.tenantId}::uuid,
              ${claim.provider},
              ${claim.eventId},
              ${claim.topic},
              ${claim.action},
              ${claim.resourceId}
            )
            on conflict (provider, provider_event_id) do nothing
            returning id
          `);
        } catch (error) {
          if (isUndefinedTable(error)) throw new BillingLedgerMissingError();
          throw error;
        }

        if (claimed.length === 0) return 'duplicate';

        // Mismo `tx`: si esto tira, la transacción vuelve atrás con la fila del ledger adentro y
        // el reintento de MP encuentra el evento sin reclamar. Es la propiedad que se quiere.
        await effect(tx);
        return 'applied';
      });
    },
  };
}
