import { describe, expect, it } from 'vitest';

import {
  MIN_PHOTOS_TO_PUBLISH,
  allowedTargets,
  canTransition,
  checkTransition,
  transitionEffects,
  type TransitionContext,
} from './listing-status';
import { LISTING_STATUSES, SIDE_STATUSES, type ListingStatus } from './types';

const NOW = new Date('2026-08-27T18:00:00.000Z');
const TENANT = 'tenant-a';

/** Contexto de un listing perfectamente publicable, sin reserva. */
function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    now: NOW,
    tenantId: TENANT,
    kind: 'unit',
    photoCount: 3,
    priceUsdCents: 62_000,
    condition: 'used_excellent',
    catalogModelId: 'model-iphone-14-pro',
    qty: 1,
    entitlements: { reservations: true },
    activeReservation: null,
    ...overrides,
  };
}

const activeReservation = { tenantId: TENANT, expiresAt: new Date('2026-08-27T19:00:00.000Z') };
const expiredReservation = { tenantId: TENANT, expiresAt: new Date('2026-08-27T17:00:00.000Z') };

describe('canTransition — máquina de estados del listing', () => {
  it('U5 — draft → available publica si la ficha mínima está completa', () => {
    expect(canTransition('draft', 'available', ctx())).toBe(true);
  });

  it('U5b — sin 3 fotos reales no se publica', () => {
    expect(MIN_PHOTOS_TO_PUBLISH).toBe(3);
    expect(canTransition('draft', 'available', ctx({ photoCount: MIN_PHOTOS_TO_PUBLISH - 1 }))).toBe(false);
    expect(checkTransition('draft', 'available', ctx({ photoCount: 2 }))).toEqual({
      ok: false,
      reason: 'missing_photos',
    });
  });

  it('U5c — sin precio USD, sin condición o sin modelo no se publica', () => {
    expect(canTransition('draft', 'available', ctx({ priceUsdCents: 0 }))).toBe(false);
    expect(canTransition('draft', 'available', ctx({ condition: null }))).toBe(false);
    expect(canTransition('draft', 'available', ctx({ catalogModelId: null }))).toBe(false);
  });

  it('U5d — un lote no necesita catalog_model pero sí cantidad', () => {
    expect(canTransition('draft', 'available', ctx({ kind: 'lot', catalogModelId: null }))).toBe(true);
    expect(canTransition('draft', 'available', ctx({ kind: 'lot', catalogModelId: null, qty: 0 }))).toBe(false);
  });

  it('U6 — available → reserved exige el entitlement de reservas (plan negocio)', () => {
    expect(canTransition('available', 'reserved', ctx())).toBe(true);
    expect(checkTransition('available', 'reserved', ctx({ entitlements: { reservations: false } }))).toEqual({
      ok: false,
      reason: 'entitlement_required',
    });
  });

  it('U6b — una unidad tiene como máximo una reserva activa', () => {
    expect(checkTransition('available', 'reserved', ctx({ activeReservation }))).toEqual({
      ok: false,
      reason: 'reservation_already_active',
    });
  });

  it('U7 — reserved → available sólo con la reserva vencida o cancelación manual', () => {
    expect(checkTransition('reserved', 'available', ctx({ activeReservation }))).toEqual({
      ok: false,
      reason: 'reservation_not_expired',
    });
    expect(canTransition('reserved', 'available', ctx({ activeReservation, intent: 'cancel' }))).toBe(true);
    expect(canTransition('reserved', 'available', ctx({ activeReservation: expiredReservation }))).toBe(true);
  });

  it('U7b — en el instante exacto de expires_at ya se puede liberar', () => {
    const borde = { tenantId: TENANT, expiresAt: NOW };
    expect(canTransition('reserved', 'available', ctx({ activeReservation: borde }))).toBe(true);
  });

  it('U8 — reserved → sold exige reserva vigente y del mismo tenant', () => {
    expect(canTransition('reserved', 'sold', ctx({ activeReservation }))).toBe(true);
    expect(checkTransition('reserved', 'sold', ctx({ activeReservation: null }))).toEqual({
      ok: false,
      reason: 'reservation_not_active',
    });
    expect(checkTransition('reserved', 'sold', ctx({ activeReservation: expiredReservation }))).toEqual({
      ok: false,
      reason: 'reservation_not_active',
    });
  });

  it('U8b — la reserva de OTRO tenant nunca habilita nada (defensa en profundidad)', () => {
    const ajena = { tenantId: 'tenant-b', expiresAt: new Date('2026-08-27T19:00:00.000Z') };
    expect(checkTransition('reserved', 'sold', ctx({ activeReservation: ajena }))).toEqual({
      ok: false,
      reason: 'reservation_tenant_mismatch',
    });
    expect(checkTransition('reserved', 'available', ctx({ activeReservation: ajena }))).toEqual({
      ok: false,
      reason: 'reservation_tenant_mismatch',
    });
  });

  it('U9 — available → sold (venta directa) y available → draft (despublicar)', () => {
    expect(canTransition('available', 'sold', ctx())).toBe(true);
    expect(canTransition('available', 'draft', ctx())).toBe(true);
  });

  it('U10 — transiciones inválidas: no listada = false, sin default permisivo', () => {
    const invalid: ReadonlyArray<readonly [ListingStatus, ListingStatus]> = [
      ['draft', 'sold'],
      ['draft', 'reserved'],
      ['in_service', 'sold'],
      ['in_transit', 'reserved'],
      ['unavailable', 'sold'],
      ['in_tradein', 'reserved'],
      ['available', 'available'],
    ];
    for (const [from, to] of invalid) {
      expect(canTransition(from, to, ctx())).toBe(false);
    }
  });

  it('U10b — el mismo estado no es una transición', () => {
    for (const status of LISTING_STATUSES) {
      expect(canTransition(status, status, ctx())).toBe(false);
    }
  });

  it('U11 — sold es TERMINAL: no sale a ningún estado', () => {
    expect(allowedTargets('sold')).toEqual([]);
    for (const to of LISTING_STATUSES) {
      expect(canTransition('sold', to, ctx({ activeReservation }))).toBe(false);
    }
    expect(checkTransition('sold', 'available', ctx())).toEqual({ ok: false, reason: 'terminal_state' });
  });

  it('U11b — cualquier estado no terminal puede irse a un lateral', () => {
    for (const from of ['draft', 'available', 'reserved'] as const) {
      for (const side of SIDE_STATUSES) {
        expect(canTransition(from, side, ctx({ activeReservation }))).toBe(true);
      }
    }
  });

  it('U11c — un lateral vuelve a available sólo si la ficha mínima está completa', () => {
    for (const side of SIDE_STATUSES) {
      expect(canTransition(side, 'available', ctx())).toBe(true);
      expect(canTransition(side, 'available', ctx({ photoCount: 0 }))).toBe(false);
      expect(canTransition(side, 'draft', ctx())).toBe(true);
    }
  });

  it('la tabla de aristas es exhaustiva sobre TODOS los estados', () => {
    for (const status of LISTING_STATUSES) {
      expect(Array.isArray(allowedTargets(status))).toBe(true);
      for (const target of allowedTargets(status)) {
        expect(LISTING_STATUSES).toContain(target);
      }
    }
  });

  it('cada transición declara sus efectos: revalidar, reserva, venta y evento', () => {
    expect(transitionEffects('draft', 'available')).toEqual({
      revalidateStorefront: true,
      createsReservation: false,
      closesReservation: false,
      createsSale: false,
      writesListingEvent: true,
    });
    expect(transitionEffects('available', 'reserved').createsReservation).toBe(true);
    expect(transitionEffects('reserved', 'in_service').closesReservation).toBe(true);
    expect(transitionEffects('available', 'sold').createsSale).toBe(true);
    expect(transitionEffects('in_transit', 'in_service').revalidateStorefront).toBe(false);
    expect(transitionEffects('reserved', 'available').revalidateStorefront).toBe(true);
  });
});
