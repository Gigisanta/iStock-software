/**
 * Enums de Postgres. **El vocabulario lo define `@istock/domain`**, no este paquete
 * (`packages/domain/src/types.ts`: "un solo lugar donde viven los enums de negocio.
 * `packages/db` los refleja en Postgres; nadie los redefine").
 *
 * Los que no existen en `domain` (porque no son reglas de negocio puras sino formas de
 * almacenamiento) se declaran acá y quedan cubiertos por `src/schema.test.ts`.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import { CONDITIONS, LISTING_KINDS, LISTING_STATUSES } from '@istock/domain';

// ── Reflejo directo de @istock/domain ────────────────────────────────────────────────────────
export const listingConditionEnum = pgEnum('listing_condition', CONDITIONS);
export const listingKindEnum = pgEnum('listing_kind', LISTING_KINDS);
export const listingStatusEnum = pgEnum('listing_status', LISTING_STATUSES);
export const reservationStatusEnum = pgEnum('reservation_status', [
  'active',
  'expired',
  'cancelled',
  'confirmed',
]);
export const fxRoundingModeEnum = pgEnum('fx_rounding_mode', [
  'exact',
  'ceil_100',
  'nearest_1000',
  'ceil_1000',
]);

// ── Propios de la capa de almacenamiento ─────────────────────────────────────────────────────

/** `owner` ve costo y margen. `seller` **nunca** (CLAUDE.md §0.9). */
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'seller']);

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'cancelled']);

export const planTierEnum = pgEnum('plan_tier', ['trial', 'base', 'negocio']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'authorized',
  'paused',
  'cancelled',
  'payment_failed',
]);

/** Estado del intento local que evita crear dos preapprovals para el mismo tenant. */
export const billingCheckoutIntentStatusEnum = pgEnum('billing_checkout_intent_status', [
  'creating',
  'ready',
  'failed',
]);

/**
 * ADR-009. `not_checked` es un estado **normal y mayoritario**, no una deuda: el alta de unidad
 * NO consulta ENACOM (5 consultas/día/IP; el dueño que carga 15 equipos vería el corte en el 6º).
 * `inconclusive` = "no pude consultar" (cupo excedido), que es un resultado real, no un error.
 */
export const imeiCheckStatusEnum = pgEnum('imei_check_status', [
  'not_checked',
  'valid',
  'blocked',
  'invalid',
  'inconclusive',
]);

export const listingEventKindEnum = pgEnum('listing_event_kind', [
  'created',
  'status_change',
  'price_change',
  'photo_change',
  'imei_check',
  'correction',
]);

export const tradeinStatusEnum = pgEnum('tradein_status', [
  'new',
  'contacted',
  'evaluating',
  'accepted',
  'rejected',
]);

export const tradeinCheckResultEnum = pgEnum('tradein_check_result', ['ok', 'fail', 'na']);

/**
 * De dónde salió una unidad de stock. **Es el reverso interno de `listings.provenance_text`**, que
 * es el texto que el dueño escribe para la ficha pública ("Compra a particular en Neuquén"); esto
 * es el hecho, en tres valores, para poder contarlo y filtrarlo.
 *
 * Lo pidió `app-agent` por escrito en el §6 de `accept-to-stock.ts`: hasta S8 la procedencia de una
 * unidad nacida de un canje se deducía de DOS lugares y ninguno declarativo — el vínculo duro
 * (`tradein_leads.created_listing_id`) y la bitácora (`listing_events.metadata.source = 'tradein'`).
 * Un `join` a la tabla de leads y un `->>` sobre un `jsonb` no son un canal: son dos rastros.
 *
 * Tres valores y no más, a propósito. `consignment`, `import`, `warranty_swap` y compañía son
 * vocabulario que el producto **todavía no tiene** (no aparecen en `PRODUCT.md` ni en `DOMAIN.md`),
 * y un valor de enum no se borra: se hereda. Agregar el cuarto el día que exista el flujo es una
 * migración de una línea; sacar uno que se publicó no lo es.
 *
 * Vive acá y no en `@istock/domain` porque hoy no hay ninguna regla de negocio pura que lo consuma
 * —no entra en `publicListingDTO`, no cambia el `wa.me`, no cambia la máquina de estados—. El día
 * que la UI necesite un mapa de etiquetas en rioplatense, eso es de `domain-agent` y este enum pasa
 * a reflejarlo, igual que `listing_condition`.
 */
export const acquisitionChannelEnum = pgEnum('acquisition_channel', [
  /** Compra: el default de cargar una unidad a mano. Es lo que hace el dueño el 95% del tiempo. */
  'purchase',
  /** Canje presencial. Lo escribe `accept-to-stock` al aceptar un `tradein_lead`. */
  'trade_in',
  /** Ni compra ni canje. Existe para no forzar una mentira cuando el caso no es ninguno de los dos. */
  'other',
]);

/** Sin PII: de dónde salió el click, no quién lo hizo. */
export const waClickSourceEnum = pgEnum('wa_click_source', [
  'storefront_card',
  'storefront_detail',
  'storefront_footer',
  'chatbot',
  'demo',
]);

export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant', 'system']);
