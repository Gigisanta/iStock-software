/**
 * Traducción del vocabulario de Mercado Pago al nuestro. TS puro, sin I/O: es una tabla.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Dos ortografías de "cancelado", y no es una anécdota
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `docs/research/mp-subscriptions.md` lo documenta y sobrevivió al override del LEAD:
 * `payment.status` usa **`cancelled`** (dos "l") y `preapproval.status` / `authorized_payment.status`
 * usan **`canceled`** (una). Escribir sólo una de las dos deja un estado sin mapear que se ignora
 * en silencio — o sea una suscripción cancelada que sigue cobrando features. Se aceptan las dos,
 * siempre, en todos los mapas.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Un estado que no reconocemos NO es un error
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Devuelve `null` y el handler responde 200 con `unknown_status`. Devolver 4xx haría que MP
 * reintente cada 15 minutos para siempre por un estado que agregaron ellos, y el research ya
 * encontró uno que existe sólo en la guía (`waiting for gateway`). El parseo es tolerante; lo
 * estrecho es esto: lo que no está en la tabla no cambia nada.
 */

import type { PaidPlanTier } from '../plans';

/** Espejo del enum `subscription_status` de `packages/db`. No se redefine allá ni acá se amplía. */
export type SubscriptionStatus = 'trialing' | 'authorized' | 'paused' | 'cancelled' | 'payment_failed';

/** Qué hace el evento con el plan del tenant, además de con el estado de la suscripción. */
export type PlanEffect =
  /** Le da el plan pago que compró. */
  | 'grant'
  /** Se lo saca. */
  | 'revoke'
  /** No lo toca: el estado cambió pero la relación comercial sigue viva. */
  | 'keep';

export interface StatusMapping {
  readonly status: SubscriptionStatus;
  readonly planEffect: PlanEffect;
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replaceAll(' ', '_');
}

/**
 * `preapproval.status` → nuestro estado.
 *
 * `pending` (la suscripción existe pero el pagador todavía no autorizó) devuelve `null` a
 * propósito: no es un estado nuestro, es la mitad de un alta. Guardarlo como `trialing` mezclaría
 * "está probando el producto" con "abrió el checkout y no terminó", que son dos cosas distintas
 * y una de ellas se cobra.
 */
export function mapPreapprovalStatus(raw: string): StatusMapping | null {
  switch (normalize(raw)) {
    case 'authorized':
      return { status: 'authorized', planEffect: 'grant' };
    case 'paused':
      // Pausada NO baja el plan. Ver `apply-event.ts`: la política de corte (P1 de PRODUCT.md)
      // está ABIERTA y no la inventa este agente.
      return { status: 'paused', planEffect: 'keep' };
    case 'canceled':
    case 'cancelled':
      return { status: 'cancelled', planEffect: 'revoke' };
    default:
      return null;
  }
}

/**
 * `authorized_payment.status` → nuestro estado. Es la cuota, no la suscripción.
 *
 * - `processed`: la cuota terminó, pero puede haber terminado con el pago rechazado después de
 *   agotar los reintentos. Sólo se mapea a autorizado si el pago anidado está aprobado.
 * - `recycling`: MP está reintentando el cobro. Se registra como `payment_failed` **sin bajar el
 *   plan**: el reintento puede salir bien mañana, y cortarle el panel a alguien porque una tarjeta
 *   rebotó un martes es perder un cliente que iba a pagar.
 * - `scheduled`: todavía no pasó nada. `null`.
 * - `cancelled`/`canceled`: la cuota se dio de baja. No cancela la suscripción por sí sola — eso
 *   llega por el topic de `preapproval`, que es la fuente de esa verdad.
 */
export function mapAuthorizedPaymentStatus(raw: string, paymentStatus: string | null = null): StatusMapping | null {
  switch (normalize(raw)) {
    case 'processed':
      // `processed` también puede significar que MP agotó los reintentos con un pago rechazado.
      // El pago anidado es la fuente que distingue cobrado de rechazado; sin él no se habilita
      // nada por error.
      return paymentStatus === null ? null : mapPaymentStatus(paymentStatus);
    case 'recycling':
      return { status: 'payment_failed', planEffect: 'keep' };
    case 'canceled':
    case 'cancelled':
      return { status: 'payment_failed', planEffect: 'keep' };
    default:
      return null;
  }
}

/** `payment.status` → nuestro estado. Es el pago concreto, distinto de la cuota y la suscripción. */
export function mapPaymentStatus(raw: string): StatusMapping | null {
  switch (normalize(raw)) {
    case 'approved':
    case 'authorized':
      return { status: 'authorized', planEffect: 'grant' };
    case 'rejected':
    case 'cancelled':
    case 'refunded':
    case 'charged_back':
      return { status: 'payment_failed', planEffect: 'keep' };
    default:
      // `pending`, `in_process` e `in_mediation` todavía no son un resultado comercial.
      return null;
  }
}

/**
 * El plan que queda en `tenants.plan` después del evento.
 *
 * `revoke` devuelve `'trial'` porque **es el único downgrade que admite el enum `plan_tier`**: no
 * hay `none`. Con un `trial_ends_at` en el pasado —que es el caso de cualquier tenant que llegó a
 * pagar— eso significa exactamente "sin features pagas" según ADR-018, sin código nuevo.
 *
 * Lo que NO se toca es `tenants.status`: pasarlo a `suspended` apagaría la vidriera de golpe
 * (la policy anónima de `tenants` exige `status = 'active'`), y eso es justo lo que el encargo
 * prohíbe y lo que P1 de `PRODUCT.md` todavía no decidió.
 */
export function planAfterEffect(effect: PlanEffect, purchased: PaidPlanTier): 'trial' | PaidPlanTier | null {
  switch (effect) {
    case 'grant':
      return purchased;
    case 'revoke':
      return 'trial';
    case 'keep':
      // `null` = no se escribe `tenants.plan`. Es distinto de "escribir el mismo valor": un
      // `update` que no se emite no puede pisar un cambio que hizo otra cosa entre medio.
      return null;
  }
}
