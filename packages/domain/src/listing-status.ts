/**
 * Máquina de estados del listing (DOMAIN.md §"Máquina de estados").
 *
 * ```
 *   draft ──publish──> available ──reserve──> reserved ──confirm──> sold
 *     ▲                   │  ▲                    │
 *     │                   │  └──expire/cancel─────┘
 *     │                   └──sell_direct──────────────────────────> sold
 *     └──── unpublish ────┘
 *
 *   Laterales: in_transit · in_tradein · in_service · unavailable
 * ```
 *
 * **Exhaustiva**: la tabla de aristas es un `Record` completo sobre `ListingStatus`. Una
 * transición que no está listada devuelve `false`. No hay default permisivo.
 */

import {
  SIDE_STATUSES,
  type Condition,
  type ListingKind,
  type ListingStatus,
  type SideStatus,
} from './types';

/** Gate de la ficha pública mínima: 3 fotos reales (CLAUDE.md §1). */
export const MIN_PHOTOS_TO_PUBLISH = 3;

export interface ActiveReservation {
  readonly tenantId: string;
  readonly expiresAt: Date;
}

/** Motivo humano de `reserved → available`. */
export type TransitionIntent = 'expire' | 'cancel';

export interface TransitionContext {
  /** Inyectado. El dominio nunca llama `Date.now()`. */
  readonly now: Date;
  readonly tenantId: string;
  readonly kind: ListingKind;
  readonly photoCount: number;
  readonly priceUsdCents: number;
  readonly condition: Condition | null;
  readonly catalogModelId: string | null;
  /** Sólo relevante para `kind: 'lot'`. */
  readonly qty: number;
  readonly entitlements: { readonly reservations: boolean };
  /** La reserva viva del listing, si existe. Máximo una por unidad. */
  readonly activeReservation: ActiveReservation | null;
  readonly intent?: TransitionIntent;
}

export type TransitionDenyReason =
  | 'same_state'
  | 'terminal_state'
  | 'edge_not_allowed'
  | 'missing_photos'
  | 'missing_price'
  | 'missing_condition'
  | 'missing_catalog_model'
  | 'invalid_qty'
  | 'entitlement_required'
  | 'reservation_already_active'
  | 'reservation_not_active'
  | 'reservation_not_expired'
  | 'reservation_tenant_mismatch';

export type TransitionCheck = { readonly ok: true } | { readonly ok: false; readonly reason: TransitionDenyReason };

const OK: TransitionCheck = { ok: true };
const deny = (reason: TransitionDenyReason): TransitionCheck => ({ ok: false, reason });

const isSide = (status: ListingStatus): status is SideStatus =>
  (SIDE_STATUSES as readonly string[]).includes(status);

/**
 * Aristas permitidas, sin guards. `Record` exhaustivo: agregar un estado a `ListingStatus`
 * rompe la compilación hasta que se declare explícitamente a dónde puede ir.
 */
const EDGES: Readonly<Record<ListingStatus, readonly ListingStatus[]>> = {
  draft: ['available', ...SIDE_STATUSES],
  available: ['draft', 'reserved', 'sold', ...SIDE_STATUSES],
  // Desde `reserved` se puede ir a un lateral (el equipo se fue a service / se cayó la venta).
  // Efecto obligatorio: cierra la reserva activa. Ver `transitionEffects`.
  reserved: ['available', 'sold', ...SIDE_STATUSES],
  // `sold` es TERMINAL. Revertir es un evento de corrección auditado, no una transición.
  sold: [],
  in_transit: ['draft', 'available', 'in_tradein', 'in_service', 'unavailable'],
  in_tradein: ['draft', 'available', 'in_transit', 'in_service', 'unavailable'],
  in_service: ['draft', 'available', 'in_transit', 'in_tradein', 'unavailable'],
  unavailable: ['draft', 'available', 'in_transit', 'in_tradein', 'in_service'],
};

/** Los destinos declarados para un estado. Sin guards: `checkTransition` es la verdad. */
export function allowedTargets(from: ListingStatus): readonly ListingStatus[] {
  return EDGES[from];
}

/** ¿Cumple el mínimo publicable? Mismo guard para `draft → available` y `lateral → available`. */
function checkPublishable(ctx: TransitionContext): TransitionCheck {
  if (ctx.photoCount < MIN_PHOTOS_TO_PUBLISH) return deny('missing_photos');
  if (!Number.isSafeInteger(ctx.priceUsdCents) || ctx.priceUsdCents <= 0) return deny('missing_price');
  if (ctx.condition === null) return deny('missing_condition');
  if (ctx.kind === 'unit' && ctx.catalogModelId === null) return deny('missing_catalog_model');
  if (ctx.kind === 'lot' && (!Number.isSafeInteger(ctx.qty) || ctx.qty < 1)) return deny('invalid_qty');
  return OK;
}

function checkReserve(ctx: TransitionContext): TransitionCheck {
  if (!ctx.entitlements.reservations) return deny('entitlement_required');
  if (ctx.activeReservation !== null) return deny('reservation_already_active');
  return OK;
}

function checkRelease(ctx: TransitionContext): TransitionCheck {
  const reservation = ctx.activeReservation;
  // Sin reserva viva, volver a `available` es reparar un estado inconsistente: se permite.
  if (reservation === null) return OK;
  if (reservation.tenantId !== ctx.tenantId) return deny('reservation_tenant_mismatch');
  if (ctx.intent === 'cancel') return OK;
  if (ctx.now.getTime() >= reservation.expiresAt.getTime()) return OK;
  return deny('reservation_not_expired');
}

function checkConfirmSale(ctx: TransitionContext): TransitionCheck {
  const reservation = ctx.activeReservation;
  if (reservation === null) return deny('reservation_not_active');
  if (reservation.tenantId !== ctx.tenantId) return deny('reservation_tenant_mismatch');
  // Reserva vencida: primero `reserved → available`, después se vende. No se saltea el paso.
  if (ctx.now.getTime() >= reservation.expiresAt.getTime()) return deny('reservation_not_active');
  return OK;
}

/**
 * Chequeo con motivo. `canTransition` es esto mismo devolviendo booleano.
 */
export function checkTransition(from: ListingStatus, to: ListingStatus, ctx: TransitionContext): TransitionCheck {
  if (from === to) return deny('same_state');
  if (from === 'sold') return deny('terminal_state');
  if (!EDGES[from].includes(to)) return deny('edge_not_allowed');

  if (to === 'available' && (from === 'draft' || isSide(from))) return checkPublishable(ctx);
  if (from === 'available' && to === 'reserved') return checkReserve(ctx);
  if (from === 'reserved' && to === 'available') return checkRelease(ctx);
  if (from === 'reserved' && to === 'sold') return checkConfirmSale(ctx);

  // Resto de aristas declaradas (unpublish, laterales, venta directa): sin guard adicional.
  return OK;
}

/** Máquina de estados exhaustiva. Transición no listada → `false`. */
export function canTransition(from: ListingStatus, to: ListingStatus, ctx: TransitionContext): boolean {
  return checkTransition(from, to, ctx).ok;
}

export interface TransitionEffects {
  /** `revalidateTag('storefront:{slug}')`: entra o sale de la vidriera. */
  readonly revalidateStorefront: boolean;
  readonly createsReservation: boolean;
  readonly closesReservation: boolean;
  readonly createsSale: boolean;
  /** Toda transición escribe en `listing_events`. Siempre `true`, explícito a propósito. */
  readonly writesListingEvent: boolean;
}

/**
 * Efectos declarados de una transición. El dominio los describe; `apps/web` los ejecuta.
 * Acá no hay I/O: es una tabla, no un side effect.
 */
export function transitionEffects(from: ListingStatus, to: ListingStatus): TransitionEffects {
  const wasPublic = from === 'available' || from === 'reserved';
  const isPublic = to === 'available' || to === 'reserved' || to === 'sold';
  return {
    revalidateStorefront: wasPublic || isPublic,
    createsReservation: from === 'available' && to === 'reserved',
    closesReservation: from === 'reserved',
    createsSale: to === 'sold',
    writesListingEvent: true,
  };
}
