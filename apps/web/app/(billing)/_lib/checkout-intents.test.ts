import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CHECKOUT_INTENT_LEASE_MS, resolveExistingCheckoutIntent, type CheckoutIntentRow } from './checkout-intents';

const NOW = new Date('2026-09-04T12:00:00.000Z');

function row(overrides: Partial<CheckoutIntentRow> = {}): CheckoutIntentRow {
  return {
    id: 'intent-1',
    plan: 'base',
    status: 'creating',
    initPoint: null,
    leaseExpiresAt: new Date(NOW.getTime() + CHECKOUT_INTENT_LEASE_MS),
    ...overrides,
  };
}

describe('resolveExistingCheckoutIntent', () => {
  it('reusa el init point de la misma suscripción lista', () => {
    expect(
      resolveExistingCheckoutIntent(
        row({
          status: 'ready',
          initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-1',
          leaseExpiresAt: null,
        }),
        'base',
        NOW,
      ),
    ).toEqual({
      kind: 'ready',
      plan: 'base',
      initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-1',
    });
  });

  it('marca conflicto si la persona intenta contratar otro plan', () => {
    expect(resolveExistingCheckoutIntent(row(), 'negocio', NOW)).toEqual({ kind: 'conflict', plan: 'base' });
  });

  it('no crea otro preapproval mientras el lease sigue vivo', () => {
    expect(resolveExistingCheckoutIntent(row(), 'base', NOW)).toEqual({ kind: 'in_progress', plan: 'base' });
  });

  it('permite reclamar un lease vencido o un intento fallido', () => {
    expect(
      resolveExistingCheckoutIntent(
        row({ leaseExpiresAt: new Date(NOW.getTime() - 1) }),
        'base',
        NOW,
      ),
    ).toBeNull();
    expect(resolveExistingCheckoutIntent(row({ status: 'failed', leaseExpiresAt: null }), 'base', NOW)).toBeNull();
  });

  it('falla cerrado si la base tiene un intent listo sin init point válido', () => {
    expect(() =>
      resolveExistingCheckoutIntent(row({ status: 'ready', leaseExpiresAt: null }), 'base', NOW),
    ).toThrow('checkout intent ready sin init point válido');
    expect(() =>
      resolveExistingCheckoutIntent(
        row({ status: 'ready', initPoint: 'javascript:alert(1)', leaseExpiresAt: null }),
        'base',
        NOW,
      ),
    ).toThrow('checkout intent ready sin init point válido');
  });
});
