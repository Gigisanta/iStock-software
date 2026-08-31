import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildBillingBackUrl,
  createSubscriptionCheckout,
  parseSubscriptionRequest,
  type SubscriptionCheckoutDeps,
} from './subscribe';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';

function deps(overrides: Partial<SubscriptionCheckoutDeps> = {}): SubscriptionCheckoutDeps {
  return {
    preapprovalPlanId: 'plan-base',
    backUrl: 'https://maat.work/billing',
    client: {
      createPreapproval: vi.fn().mockResolvedValue({
        preapprovalId: 'pre-1',
        initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-1',
      }),
    },
    ...overrides,
  };
}

describe('POST /billing/subscribe · contrato del input', () => {
  it('acepta exactamente base y negocio', () => {
    expect(parseSubscriptionRequest({ plan: 'base' })).toEqual({ plan: 'base' });
    expect(parseSubscriptionRequest({ plan: 'negocio' })).toEqual({ plan: 'negocio' });
    expect(parseSubscriptionRequest({ plan: 'trial' })).toBeNull();
    expect(parseSubscriptionRequest({ plan: 'base', tenantId: TENANT_ID })).toBeNull();
  });

  it('rechaza un plan inválido antes de llamar a Mercado Pago', async () => {
    const dependencies = deps();
    const result = await createSubscriptionCheckout(
      { tenantId: TENANT_ID, plan: 'trial', payerEmail: 'dueño@nortecel.test' },
      dependencies,
    );

    expect(result).toEqual({ ok: false, code: 'invalid_input' });
    expect(dependencies.client.createPreapproval).not.toHaveBeenCalled();
  });
});

describe('createSubscriptionCheckout', () => {
  it('usa tenant/identity/configuración server-side y no recibe tarjeta', async () => {
    const dependencies = deps();
    const result = await createSubscriptionCheckout(
        { tenantId: TENANT_ID, plan: 'negocio', payerEmail: 'dueno@nortecel.test' },
      dependencies,
    );

    expect(result).toEqual({
      ok: true,
      initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-1',
    });
    expect(dependencies.client.createPreapproval).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      plan: 'negocio',
      preapprovalPlanId: 'plan-base',
      payerEmail: 'dueno@nortecel.test',
      backUrl: 'https://maat.work/billing',
    });
    expect(dependencies.client.createPreapproval).not.toHaveBeenCalledWith(
      expect.objectContaining({ cardTokenId: expect.anything() }),
    );
  });

  it('convierte cualquier error de MP en un código genérico sin filtrar el cuerpo', async () => {
    const providerError = new Error('respuesta de juan@nortecel.test con token-secreto');
    const dependencies = deps({ client: { createPreapproval: vi.fn().mockRejectedValue(providerError) } });

    await expect(
      createSubscriptionCheckout(
        { tenantId: TENANT_ID, plan: 'base', payerEmail: 'dueno@nortecel.test' },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: 'provider_error' });
  });

  it('falla cerrado si el proveedor devuelve un init_point que no es HTTPS', async () => {
    const dependencies = deps({
      client: {
        createPreapproval: vi.fn().mockResolvedValue({ preapprovalId: 'pre-1', initPoint: 'javascript:alert(1)' }),
      },
    });

    await expect(
      createSubscriptionCheckout(
        { tenantId: TENANT_ID, plan: 'base', payerEmail: 'dueno@nortecel.test' },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: 'provider_error' });
  });
});

describe('back_url pública', () => {
  it('usa HTTPS en producción y permite sólo hosts locales explícitos en desarrollo', () => {
    expect(buildBillingBackUrl('https://maat.work')).toBe('https://maat.work/billing');
    expect(buildBillingBackUrl('http://localhost:3000')).toBe('http://localhost:3000/billing');
    expect(buildBillingBackUrl('http://evil.example')).toBeNull();
    expect(buildBillingBackUrl('https://user:pass@maat.work')).toBeNull();
  });
});
