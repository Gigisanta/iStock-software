import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getPanelSession: vi.fn(),
  loadFxSettings: vi.fn(),
  billingDriver: vi.fn(),
  mpAccessToken: vi.fn(),
  createHttpMercadoPagoClient: vi.fn(),
  logError: vi.fn(),
  claimSubscriptionCheckout: vi.fn(),
  completeSubscriptionCheckout: vi.fn(),
  failSubscriptionCheckout: vi.fn(),
  createPreapproval: vi.fn(),
}));

vi.mock('../../../(app)/_lib/session', () => ({ getPanelSession: mocks.getPanelSession }));
vi.mock('../../../(app)/_lib/tenants/queries', () => ({ loadFxSettings: mocks.loadFxSettings }));
vi.mock('../../../(app)/_lib/env', () => ({
  serverEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://maat.work' }),
}));
vi.mock('../../../(app)/_lib/log', () => ({ logError: mocks.logError }));
vi.mock('../../_lib/env', () => ({
  billingDriver: mocks.billingDriver,
  mpAccessToken: mocks.mpAccessToken,
}));
vi.mock('../../_lib/mercadopago/client', () => ({
  createHttpMercadoPagoClient: mocks.createHttpMercadoPagoClient,
}));
vi.mock('../../_lib/checkout-intents', () => ({
  claimSubscriptionCheckout: mocks.claimSubscriptionCheckout,
  completeSubscriptionCheckout: mocks.completeSubscriptionCheckout,
  failSubscriptionCheckout: mocks.failSubscriptionCheckout,
}));

const { POST } = await import('./route');

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const activeOwner = {
  identity: { userId: USER_ID, email: 'dueno@nortecel.test', fullName: 'Dueño' },
  tenant: {
    id: TENANT_ID,
    slug: 'nortecel',
    name: 'Norte Cel',
    plan: 'trial' as const,
    status: 'active' as const,
    trialEndsAt: new Date('2026-09-10T00:00:00.000Z'),
  },
  role: 'owner' as const,
};

function formRequest(plan: string): Request {
  return new Request('https://maat.work/billing/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ plan }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPanelSession.mockResolvedValue(activeOwner);
  mocks.loadFxSettings.mockResolvedValue({ arsCentsPerUsd: 148_750, rounding: 'ceil_1000' });
  mocks.billingDriver.mockReturnValue('mercadopago');
  mocks.mpAccessToken.mockReturnValue('mp-token-de-prueba-largo');
  mocks.createPreapproval.mockResolvedValue({
    preapprovalId: 'pre-123',
    initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-123',
  });
  mocks.createHttpMercadoPagoClient.mockReturnValue({ createPreapproval: mocks.createPreapproval });
  mocks.claimSubscriptionCheckout.mockResolvedValue({ kind: 'claimed', intentId: 'intent-123' });
  mocks.completeSubscriptionCheckout.mockResolvedValue(true);
  mocks.failSubscriptionCheckout.mockResolvedValue(undefined);
});

describe('POST /billing/subscribe', () => {
  it('crea la suscripción server-side y redirige al init_point de la suscripción', async () => {
    const response = await POST(formRequest('negocio'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-123',
    );
    expect(mocks.createHttpMercadoPagoClient).toHaveBeenCalledWith('mp-token-de-prueba-largo');
    expect(mocks.createPreapproval).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      plan: 'negocio',
      payerEmail: 'dueno@nortecel.test',
      backUrl: 'https://maat.work/billing',
      amountArsCents: 5_300_000,
    });
    expect(mocks.claimSubscriptionCheckout).toHaveBeenCalledWith(
      { userId: USER_ID, tenantId: TENANT_ID, role: 'owner' },
      { plan: 'negocio', amountArsCents: 5_300_000 },
    );
    expect(mocks.completeSubscriptionCheckout).toHaveBeenCalledWith(
      { userId: USER_ID, tenantId: TENANT_ID, role: 'owner' },
      {
        intentId: 'intent-123',
        providerPreapprovalId: 'pre-123',
        initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-123',
      },
    );
  });

  it('reutiliza el checkout listo sin crear otro preapproval', async () => {
    mocks.claimSubscriptionCheckout.mockResolvedValueOnce({
      kind: 'ready',
      plan: 'base',
      initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-ready',
    });

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-ready',
    );
    expect(mocks.createPreapproval).not.toHaveBeenCalled();
    expect(mocks.completeSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('no duplica un checkout que otra pestaña todavía está creando', async () => {
    mocks.claimSubscriptionCheckout.mockResolvedValueOnce({ kind: 'in_progress', plan: 'base' });

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=en-curso');
    expect(mocks.createPreapproval).not.toHaveBeenCalled();
  });

  it('no cambia silenciosamente de plan cuando ya hay otro checkout listo', async () => {
    mocks.claimSubscriptionCheckout.mockResolvedValueOnce({ kind: 'conflict', plan: 'base' });

    const response = await POST(formRequest('negocio'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=otro-plan');
    expect(mocks.createPreapproval).not.toHaveBeenCalled();
  });

  it('rechaza plan inválido y no toca MP', async () => {
    const response = await POST(formRequest('trial'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Elegí un plan válido.' });
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('rechaza campos adicionales del JSON: el cliente sólo puede elegir plan', async () => {
    const response = await POST(
      new Request('https://maat.work/billing/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'base', tenantId: TENANT_ID }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('maneja sesión ausente y usuario sin tenant sin crear una suscripción', async () => {
    mocks.getPanelSession.mockResolvedValueOnce(null);
    const unauthenticated = await POST(formRequest('base'));
    expect(unauthenticated.status).toBe(401);

    mocks.getPanelSession.mockResolvedValueOnce({
      identity: activeOwner.identity,
      tenant: null,
      role: null,
    });
    const withoutTenant = await POST(formRequest('base'));
    expect(withoutTenant.status).toBe(403);
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('no crea otra suscripción cuando el tenant ya tiene un plan pago', async () => {
    mocks.getPanelSession.mockResolvedValueOnce({
      ...activeOwner,
      tenant: { ...activeOwner.tenant, plan: 'base' as const },
    });

    const response = await POST(formRequest('negocio'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Tu negocio ya tiene una suscripción activa.' });
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('devuelve 503 sin configuración y no usa el mock como si cobrara', async () => {
    mocks.billingDriver.mockReturnValue('mock');

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=no-disponible');
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('devuelve 503 si falta el access token del driver real', async () => {
    mocks.mpAccessToken.mockReturnValue(null);

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=no-disponible');
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('devuelve 503 si el tipo de cambio persistido no está disponible', async () => {
    mocks.loadFxSettings.mockResolvedValue(null);

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=no-disponible');
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('retiene el intent si no se puede saber si MP creó el preapproval', async () => {
    mocks.createPreapproval.mockRejectedValueOnce(new Error('mail dueño@nortecel.test token mp-secreto'));

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=verificar');
    expect(mocks.failSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('libera el intent ante un rechazo HTTP definitivo de MP', async () => {
    mocks.createPreapproval.mockRejectedValueOnce(
      Object.assign(new Error('mail dueño@nortecel.test token mp-secreto'), {
        name: 'MercadoPagoApiError',
        status: 422,
      }),
    );

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://maat.work/billing?checkout=no-disponible');
    expect(mocks.failSubscriptionCheckout).toHaveBeenCalledWith(
      { userId: USER_ID, tenantId: TENANT_ID, role: 'owner' },
      { intentId: 'intent-123' },
    );
  });

  it('mantiene el mensaje seguro para clientes JSON cuando MP falla de forma incierta', async () => {
    mocks.createPreapproval.mockRejectedValueOnce(new Error('mail dueño@nortecel.test token mp-secreto'));

    const response = await POST(
      new Request('https://maat.work/billing/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'base' }),
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(
      '{"error":"No pudimos confirmar si el inicio del pago se completó. Esperá unos minutos antes de volver a intentar para evitar duplicar la suscripción."}',
    );
    expect(mocks.failSubscriptionCheckout).not.toHaveBeenCalled();
    expect(body).not.toContain('nortecel.test');
    expect(body).not.toContain('mp-secreto');
  });
});
