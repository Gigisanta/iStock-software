import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getPanelSession: vi.fn(),
  billingDriver: vi.fn(),
  mpAccessToken: vi.fn(),
  mpPreapprovalPlanId: vi.fn(),
  createHttpMercadoPagoClient: vi.fn(),
  logError: vi.fn(),
  createPreapproval: vi.fn(),
}));

vi.mock('../../../(app)/_lib/session', () => ({ getPanelSession: mocks.getPanelSession }));
vi.mock('../../../(app)/_lib/env', () => ({
  serverEnv: () => ({ NEXT_PUBLIC_APP_URL: 'https://maat.work' }),
}));
vi.mock('../../../(app)/_lib/log', () => ({ logError: mocks.logError }));
vi.mock('../../_lib/env', () => ({
  billingDriver: mocks.billingDriver,
  mpAccessToken: mocks.mpAccessToken,
  mpPreapprovalPlanId: mocks.mpPreapprovalPlanId,
}));
vi.mock('../../_lib/mercadopago/client', () => ({
  createHttpMercadoPagoClient: mocks.createHttpMercadoPagoClient,
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
  mocks.billingDriver.mockReturnValue('mercadopago');
  mocks.mpAccessToken.mockReturnValue('mp-token-de-prueba-largo');
  mocks.mpPreapprovalPlanId.mockReturnValue('preapproval-plan-negocio');
  mocks.createPreapproval.mockResolvedValue({
    preapprovalId: 'pre-123',
    initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-123',
  });
  mocks.createHttpMercadoPagoClient.mockReturnValue({ createPreapproval: mocks.createPreapproval });
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
      preapprovalPlanId: 'preapproval-plan-negocio',
      payerEmail: 'dueno@nortecel.test',
      backUrl: 'https://maat.work/billing',
    });
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

  it('devuelve 503 sin configuración y no usa el mock como si cobrara', async () => {
    mocks.billingDriver.mockReturnValue('mock');

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'El pago no está disponible en este momento.' });
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('devuelve 503 si falta el access token del driver real', async () => {
    mocks.mpAccessToken.mockReturnValue(null);

    const response = await POST(formRequest('base'));

    expect(response.status).toBe(503);
    expect(mocks.createHttpMercadoPagoClient).not.toHaveBeenCalled();
  });

  it('devuelve error genérico si MP falla, sin filtrar mail ni secreto', async () => {
    mocks.createPreapproval.mockRejectedValueOnce(new Error('mail dueño@nortecel.test token mp-secreto'));

    const response = await POST(formRequest('base'));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe('{"error":"No pudimos iniciar el pago. Probá de nuevo en unos minutos."}');
    expect(body).not.toContain('nortecel.test');
    expect(body).not.toContain('mp-secreto');
  });
});
