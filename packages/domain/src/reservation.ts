/**
 * Reservas (DOMAIN.md §Reservas).
 *
 * Duración ∈ [30, 120] minutos, default 60. Entitlement `reservations` (plan `negocio`).
 * Una unidad tiene **como máximo una** reserva activa.
 *
 * `expireReservation` es **puro** y **idempotente**: el cron lo llama, no al revés. Correrlo dos
 * veces sobre la misma reserva no cambia nada la segunda vez (ARCHITECTURE.md §Jobs).
 */

import { DomainError } from './errors';

export const RESERVATION_MIN_MINUTES = 30;
export const RESERVATION_MAX_MINUTES = 120;
export const RESERVATION_DEFAULT_MINUTES = 60;

const MS_PER_MINUTE = 60_000;

export type ReservationStatus = 'active' | 'expired' | 'cancelled' | 'confirmed';

export interface Reservation {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  readonly status: ReservationStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CreateReservationInput {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  /** Minutos de vigencia. Default 60. Fuera de [30, 120] → `DomainError`. */
  readonly minutes?: number;
}

function assertValidDate(date: Date, label: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('RESERVATION_INVALID', `${label} no es una fecha válida`);
  }
}

/** Constructor puro. `now` inyectado: el dominio no conoce el reloj. */
export function createReservation(input: CreateReservationInput, now: Date): Reservation {
  assertValidDate(now, 'now');
  const minutes = input.minutes ?? RESERVATION_DEFAULT_MINUTES;
  if (!Number.isInteger(minutes) || minutes < RESERVATION_MIN_MINUTES || minutes > RESERVATION_MAX_MINUTES) {
    throw new DomainError(
      'RESERVATION_INVALID',
      `la duración debe ser un entero entre ${String(RESERVATION_MIN_MINUTES)} y ${String(RESERVATION_MAX_MINUTES)} minutos, recibí: ${String(minutes)}`,
    );
  }
  if (input.tenantId.length === 0 || input.listingId.length === 0 || input.id.length === 0) {
    throw new DomainError('RESERVATION_INVALID', 'id, tenantId y listingId son obligatorios');
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    listingId: input.listingId,
    status: 'active',
    createdAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + minutes * MS_PER_MINUTE),
  };
}

/**
 * Vencida = `now >= expiresAt`. En el instante exacto de `expires_at` **ya está vencida**:
 * el borde es cerrado del lado del vencimiento para que el cron nunca deje una reserva
 * "viva por un milisegundo" que bloquee una venta.
 */
export function isReservationExpired(reservation: Reservation, now: Date): boolean {
  assertValidDate(now, 'now');
  return now.getTime() >= reservation.expiresAt.getTime();
}

/** Milisegundos que le quedan. 0 si ya venció (nunca negativo). */
export function reservationMsRemaining(reservation: Reservation, now: Date): number {
  assertValidDate(now, 'now');
  return Math.max(0, reservation.expiresAt.getTime() - now.getTime());
}

export interface ExpireReservationResult {
  /** `false` = no había nada que hacer. El cron no escribe. */
  readonly changed: boolean;
  readonly reservation: Reservation;
  /** Transición que el caller debe aplicar al listing, o `null`. */
  readonly listingTransition: { readonly from: 'reserved'; readonly to: 'available' } | null;
}

/**
 * `expireReservation(reservation, now)` — puro, `now` inyectado, sin I/O.
 * Sólo una reserva `active` y vencida cambia. Todo lo demás vuelve tal cual.
 */
export function expireReservation(reservation: Reservation, now: Date): ExpireReservationResult {
  assertValidDate(now, 'now');
  if (reservation.status !== 'active' || !isReservationExpired(reservation, now)) {
    return { changed: false, reservation, listingTransition: null };
  }
  return {
    changed: true,
    reservation: { ...reservation, status: 'expired' },
    listingTransition: { from: 'reserved', to: 'available' },
  };
}
