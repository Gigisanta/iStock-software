import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
  createReservation,
  expireReservation,
  isReservationExpired,
  reservationMsRemaining,
  type Reservation,
} from './reservation';

const NOW = new Date('2026-08-27T18:00:00.000Z');

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-1',
    tenantId: 'tenant-a',
    listingId: 'listing-1',
    status: 'active',
    createdAt: NOW,
    expiresAt: new Date('2026-08-27T19:00:00.000Z'),
    ...overrides,
  };
}

describe('createReservation — 30 a 120 minutos, default 60', () => {
  it('default 60 minutos, contados desde el `now` inyectado', () => {
    const res = createReservation({ id: 'r', tenantId: 't', listingId: 'l' }, NOW);
    expect(RESERVATION_DEFAULT_MINUTES).toBe(60);
    expect(res.expiresAt.toISOString()).toBe('2026-08-27T19:00:00.000Z');
    expect(res.status).toBe('active');
    expect(res.createdAt.toISOString()).toBe(NOW.toISOString());
  });

  it('respeta el rango [30, 120] y rechaza lo de afuera', () => {
    expect(RESERVATION_MIN_MINUTES).toBe(30);
    expect(RESERVATION_MAX_MINUTES).toBe(120);
    expect(createReservation({ id: 'r', tenantId: 't', listingId: 'l', minutes: 30 }, NOW).expiresAt.toISOString()).toBe(
      '2026-08-27T18:30:00.000Z',
    );
    expect(
      createReservation({ id: 'r', tenantId: 't', listingId: 'l', minutes: 120 }, NOW).expiresAt.toISOString(),
    ).toBe('2026-08-27T20:00:00.000Z');
    expect(() => createReservation({ id: 'r', tenantId: 't', listingId: 'l', minutes: 29 }, NOW)).toThrow(DomainError);
    expect(() => createReservation({ id: 'r', tenantId: 't', listingId: 'l', minutes: 121 }, NOW)).toThrow(
      /entre 30 y 120/u,
    );
    expect(() => createReservation({ id: 'r', tenantId: 't', listingId: 'l', minutes: 45.5 }, NOW)).toThrow(DomainError);
  });

  it('no crea reservas huérfanas ni con fecha inválida', () => {
    expect(() => createReservation({ id: '', tenantId: 't', listingId: 'l' }, NOW)).toThrow(/obligatorios/u);
    expect(() => createReservation({ id: 'r', tenantId: 't', listingId: 'l' }, new Date('no-es-fecha'))).toThrow(
      /fecha válida/u,
    );
  });

  it('la reserva creada no comparte la instancia de Date con el caller', () => {
    const mutable = new Date(NOW.getTime());
    const res = createReservation({ id: 'r', tenantId: 't', listingId: 'l' }, mutable);
    mutable.setFullYear(2030);
    expect(res.createdAt.toISOString()).toBe('2026-08-27T18:00:00.000Z');
  });
});

describe('expireReservation — puro, `now` inyectado, idempotente', () => {
  it('U12 — antes de expires_at no pasa nada', () => {
    const res = reservation();
    const result = expireReservation(res, new Date('2026-08-27T18:59:59.999Z'));
    expect(result.changed).toBe(false);
    expect(result.reservation).toBe(res);
    expect(result.listingTransition).toBeNull();
  });

  it('U12b — en el instante EXACTO de expires_at ya expiró', () => {
    const result = expireReservation(reservation(), new Date('2026-08-27T19:00:00.000Z'));
    expect(result.changed).toBe(true);
    expect(result.reservation.status).toBe('expired');
    expect(result.listingTransition).toEqual({ from: 'reserved', to: 'available' });
  });

  it('U13 — correr el cron dos veces no vuelve a cambiar nada', () => {
    const after = new Date('2026-08-27T19:30:00.000Z');
    const first = expireReservation(reservation(), after);
    const second = expireReservation(first.reservation, after);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.listingTransition).toBeNull();
    expect(second.reservation).toEqual(first.reservation);
  });

  it('U13b — una reserva cancelada o confirmada no se toca', () => {
    const after = new Date('2026-08-28T00:00:00.000Z');
    expect(expireReservation(reservation({ status: 'cancelled' }), after).changed).toBe(false);
    expect(expireReservation(reservation({ status: 'confirmed' }), after).changed).toBe(false);
  });

  it('no muta el objeto de entrada', () => {
    const res = reservation();
    expireReservation(res, new Date('2026-08-27T20:00:00.000Z'));
    expect(res.status).toBe('active');
  });

  it('el dominio no conoce el reloj: `now` inválido revienta', () => {
    expect(() => expireReservation(reservation(), new Date('nope'))).toThrow(/fecha válida/u);
  });
});

describe('helpers de vigencia', () => {
  it('isReservationExpired usa el borde cerrado en expires_at', () => {
    expect(isReservationExpired(reservation(), new Date('2026-08-27T18:59:59.999Z'))).toBe(false);
    expect(isReservationExpired(reservation(), new Date('2026-08-27T19:00:00.000Z'))).toBe(true);
  });

  it('reservationMsRemaining nunca es negativo', () => {
    expect(reservationMsRemaining(reservation(), NOW)).toBe(3_600_000);
    expect(reservationMsRemaining(reservation(), new Date('2026-08-28T00:00:00.000Z'))).toBe(0);
  });
});
