import type { Tx } from '../../../(app)/_lib/db/connection';

/**
 * El **ledger de eventos**: lo que hace que procesar dos veces el mismo webhook tenga un solo
 * efecto.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto es un puerto y no tres líneas adentro del handler
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Porque la idempotencia **no es "chequear si ya lo vi"**: es *reclamar el evento y aplicar el
 * efecto en la misma transacción*. Si fueran dos pasos separados —`select` para ver si existe,
 * después el `update`— dos entregas simultáneas del mismo evento leen "no existe" las dos y cobran
 * las dos. MP reintenta y sus reintentos se pisan; esa carrera no es teórica.
 *
 * Por eso el contrato del puerto es `claimAndApply` y no `hasSeen` + `markSeen`. La atomicidad es
 * responsabilidad de la implementación, y la implementación de producción la delega en el motor:
 * un índice único sobre `(provider, provider_event_id)` y un `on conflict do nothing`. **El que
 * garantiza la unicidad es Postgres, no un `if` nuestro y mucho menos un `Set` en memoria** — una
 * función de Vercel muere entre requests y hay N instancias a la vez, así que un `Set` de módulo
 * sería una idempotencia que sólo funciona cuando no hace falta.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El único punto de la clave que hay que entender
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La unicidad es `(provider, provider_event_id)` — **sin `tenant_id`**. Es a propósito: los ids de
 * notificación de MP son globales, y meter el tenant en la clave permitiría que el mismo evento se
 * aplique una vez por tenant, que es exactamente el cobro doble con otro disfraz. El `tenant_id`
 * está igual en la fila (con su índice y su RLS, `CLAUDE.md` §0.7), porque el evento **pertenece**
 * a un tenant aunque no se identifique por él.
 */

/** Lo que se guarda de un evento. Nada de cuerpos crudos: un body de MP puede citar el mail del pagador. */
export interface EventClaim {
  readonly tenantId: string;
  readonly provider: string;
  /** El `id` del cuerpo de la notificación. Ver `mercadopago/notification.ts`. */
  readonly eventId: string;
  readonly topic: string;
  readonly action: string | null;
  readonly resourceId: string | null;
}

export type ClaimOutcome = 'applied' | 'duplicate';

export interface BillingEventLedger {
  /**
   * Reclama el evento. Si es la primera vez, corre `effect` **en la misma transacción** y devuelve
   * `'applied'`. Si ya estaba, no corre nada y devuelve `'duplicate'`.
   *
   * Si `effect` tira, la transacción entera vuelve atrás **incluida la marca**: el evento queda
   * sin reclamar y el próximo reintento de MP lo vuelve a intentar. Es la propiedad que se quiere:
   * un fallo transitorio no puede consumir el evento.
   */
  claimAndApply(claim: EventClaim, effect: (tx: Tx) => Promise<void>): Promise<ClaimOutcome>;
}

/**
 * Ledger en memoria. **Sólo para tests.**
 *
 * No es "la versión de desarrollo": es el doble de prueba. Vive acá y no en el archivo de test
 * porque el mismo doble lo usan el test del handler y el test de la ruta, y dos copias del doble
 * derivan igual que dos copias de un helper.
 *
 * Que en producción esto sería falso es justamente lo que documenta el encabezado, y es la razón
 * por la que el driver real existe aunque hoy no se pueda correr.
 */
export interface InMemoryBillingEventLedger extends BillingEventLedger {
  /** Un elemento por evento efectivamente aplicado. Es lo que cuentan los tests. */
  readonly applied: readonly EventClaim[];
  /** Un elemento por evento descartado por duplicado. */
  readonly duplicates: readonly EventClaim[];
}

export function createInMemoryBillingEventLedger(tx: Tx): InMemoryBillingEventLedger {
  const seen = new Set<string>();
  const applied: EventClaim[] = [];
  const duplicates: EventClaim[] = [];

  return {
    applied,
    duplicates,
    async claimAndApply(claim, effect) {
      const key = `${claim.provider}::${claim.eventId}`;
      if (seen.has(key)) {
        duplicates.push(claim);
        return 'duplicate';
      }
      // Se marca ANTES de correr el efecto y se desmarca si el efecto tira, para imitar el
      // rollback de la transacción real. Sin el `catch`, un efecto fallido dejaría el evento
      // consumido y el reintento de MP no lo volvería a intentar — que es el bug contrario al que
      // este módulo existe para evitar, y el más difícil de ver.
      seen.add(key);
      try {
        await effect(tx);
      } catch (error) {
        seen.delete(key);
        throw error;
      }
      applied.push(claim);
      return 'applied';
    },
  };
}
