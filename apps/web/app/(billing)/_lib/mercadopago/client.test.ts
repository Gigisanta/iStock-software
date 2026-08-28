import { afterEach, describe, expect, it, vi } from 'vitest';

// El cliente es `server-only`: el access token de MP en el bundle del browser es rechazo
// automatico (CLAUDE.md §2). El mock existe porque en un test no hay runtime de servidor, no
// porque la marca sobre.
vi.mock('server-only', () => ({}));

import {
  MercadoPagoApiError,
  createHttpMercadoPagoClient,
  createMockMercadoPagoClient,
} from './client';
import { decodeExternalReference } from './external-reference';

/**
 * El puerto de Mercado Pago.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Lo que este archivo NO prueba, dicho antes que lo que prueba
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **No prueba que la integración con Mercado Pago funcione.** B3 (sandbox, aplicación, secreto) es
 * un bloqueo humano abierto: nunca se ejerció una llamada real. Lo que se mide con `fetch`
 * stubeado es el **mapeo de campos** —que es donde viven los errores baratos de encontrar ahora y
 * caros de encontrar en producción— y el manejo de errores. Que MP responda lo que el schema
 * espera es exactamente lo que falta verificar, y los tests que lo verificarían están abajo,
 * **salteados con motivo**, no escritos de forma que pasen por vacío.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mock · devuelve lo que se le sembró, no simula el negocio de MP', () => {
  it('sin sembrar, un recurso no existe (null, no un objeto vacío)', async () => {
    const client = createMockMercadoPagoClient();
    expect(await client.getPreapproval('nope')).toBeNull();
    expect(await client.getAuthorizedPayment('nope')).toBeNull();
  });

  it('cuenta las llamadas: es lo que deja medir que el webhook pregunte una vez por evento', async () => {
    const client = createMockMercadoPagoClient();
    await client.getPreapproval('a');
    await client.getPreapproval('b');
    expect(client.calls.preapproval).toBe(2);
  });

  it('createPreapproval deja el external_reference legible de vuelta', async () => {
    const client = createMockMercadoPagoClient();
    const tenantId = '11111111-2222-4333-8444-555555555555';

    const { preapprovalId, initPoint } = await client.createPreapproval({
      tenantId,
      plan: 'negocio',
      preapprovalPlanId: 'plan-negocio',
      payerEmail: 'dueño@nortecel.test',
      backUrl: 'https://nortecel.maat.work/app/plan',
    });

    // El redirect va al init_point de la SUSCRIPCIÓN (`?preapproval_id=`), no al del plan
    // (`?preapproval_plan_id=`), que es idéntico para todos los tenants: mandar a alguien ahí es
    // mandarlo a un checkout sin referencia, y de vuelta no se sabe quién pagó.
    expect(initPoint).toContain('preapproval_id=');
    expect(initPoint).not.toContain('preapproval_plan_id=');

    const creado = await client.getPreapproval(preapprovalId);
    expect(decodeExternalReference(creado?.externalReference ?? null)).toEqual({ tenantId, plan: 'negocio' });
  });
});

describe('driver HTTP · mapeo de campos, con fetch stubeado', () => {
  function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
    const spy = vi.fn(async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('preapproval: snake_case de MP → camelCase nuestro, y el token va como Bearer', async () => {
    const spy = stubFetch(200, {
      id: 987654,
      status: 'authorized',
      external_reference: 'istock:v1:11111111-2222-4333-8444-555555555555:base',
      preapproval_plan_id: 'plan-base',
      payment_method_id: 'account_money',
      next_payment_date: '2026-09-28T14:00:00.000Z',
    });

    const snapshot = await createHttpMercadoPagoClient('token-secreto').getPreapproval('987654');

    expect(snapshot).toEqual({
      id: '987654',
      status: 'authorized',
      externalReference: 'istock:v1:11111111-2222-4333-8444-555555555555:base',
      preapprovalPlanId: 'plan-base',
      paymentMethodId: 'account_money',
      nextPaymentDate: '2026-09-28T14:00:00.000Z',
    });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/preapproval/987654');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer token-secreto');
  });

  it('authorized_payment: transaction_amount viene en UNIDADES y se guarda en centavos', async () => {
    stubFetch(200, {
      id: 1,
      preapproval_id: 2,
      status: 'processed',
      payment_method_id: 'debin_transfer',
      transaction_amount: 35000.5,
      next_payment_date: null,
    });

    const pago = await createHttpMercadoPagoClient('t0ken-de-prueba-largo').getAuthorizedPayment('1');

    // Si esto se leyera como centavos, un plan de $35.000 se registraría como $350. Es el bug de
    // unidades clásico y no se ve hasta que alguien mira un reporte.
    expect(pago?.amountArsCents).toBe(3500050);
  });

  it('404 es "no existe", no un error', async () => {
    stubFetch(404, { message: 'not found' });
    expect(await createHttpMercadoPagoClient('t0ken-de-prueba-largo').getPreapproval('x')).toBeNull();
  });

  it('un 500 de MP tira MercadoPagoApiError SIN el cuerpo de la respuesta adentro', async () => {
    stubFetch(500, { message: 'error de juan@ejemplo.com', cause: 'lo que sea' });
    const client = createHttpMercadoPagoClient('t0ken-de-prueba-largo');

    await expect(client.getPreapproval('x')).rejects.toThrow(MercadoPagoApiError);
    // El cuerpo de un error de MP puede citar el mail del pagador, y de ahí a los logs de Vercel
    // es un paso (CLAUDE.md §2). El mensaje lleva status y endpoint, nada más.
    await expect(client.getPreapproval('x')).rejects.toThrow(/^Mercado Pago respondió 500 en \/preapproval\/x$/u);
  });

  it('createPreapproval NO restringe medios de pago por default', async () => {
    const spy = stubFetch(201, {
      id: 'pre-1',
      status: 'pending',
      init_point: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-1',
    });

    await createHttpMercadoPagoClient('t0ken-de-prueba-largo').createPreapproval({
      tenantId: '11111111-2222-4333-8444-555555555555',
      plan: 'base',
      preapprovalPlanId: 'plan-base',
      payerEmail: 'dueño@nortecel.test',
      backUrl: 'https://nortecel.maat.work/app/plan',
    });

    const body = JSON.parse(((spy.mock.calls[0] as [string, RequestInit])[1].body ?? '{}') as string) as Record<
      string,
      unknown
    >;

    // Una lista restrictiva escrita de memoria deja afuera el dinero en cuenta de MP y empuja a
    // todos a tarjeta de crédito, que es el medio caro. Se restringe cuando el experimento 1 de
    // ADR-008 diga qué se puede adherir de verdad; hasta entonces, no restringir es lo barato.
    expect(body).not.toHaveProperty('payment_methods_allowed');
    expect(body['external_reference']).toBe('istock:v1:11111111-2222-4333-8444-555555555555:base');
  });

  it('si el llamador SÍ pide una lista, viaja tal cual', async () => {
    const spy = stubFetch(201, { id: 'pre-1', status: 'pending', init_point: 'https://x' });

    await createHttpMercadoPagoClient('t0ken-de-prueba-largo').createPreapproval({
      tenantId: '11111111-2222-4333-8444-555555555555',
      plan: 'base',
      preapprovalPlanId: 'plan-base',
      payerEmail: 'dueño@nortecel.test',
      backUrl: 'https://x',
      paymentMethodsAllowed: ['account_money'],
    });

    const body = JSON.parse(((spy.mock.calls[0] as [string, RequestInit])[1].body ?? '{}') as string) as Record<
      string,
      unknown
    >;
    expect(body['payment_methods_allowed']).toEqual(['account_money']);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  SALTEADOS A PROPÓSITO — bloqueo B3
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Estos cuatro son los experimentos de ADR-008 y **no se pueden correr**: exigen una aplicación de
 * Mercado Pago con `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`, y —lo que hace el bloqueo humano y no
 * técnico— las credenciales de *test* de MP sólo existen para Checkout API y Bricks, así que
 * Suscripciones se prueba con credenciales de **producción** de una cuenta de prueba. Eso lo abre
 * una persona, no un agente.
 *
 * Están escritos como `it.skip` con el motivo adentro, y no como un test que pasa sin ejercer
 * nada, por una razón: este repo trata el verde vacuo como su peor modo de falla. Un `skip` sale
 * listado en cada corrida; un test vacío sale en verde y nadie vuelve.
 */
describe('experimentos de ADR-008 · requieren credenciales de MP (B3)', () => {
  it.skip('exp. 1 — ¿se puede ADHERIR un CBU a un preapproval? (el enum de la respuesta no lo prueba)', () => {
    expect.unreachable('B3: falta MP_ACCESS_TOKEN de una cuenta de prueba');
  });

  it.skip('exp. 2 — comisión real: depende de provincia, medio de pago y plazo de acreditación', () => {
    expect.unreachable('B3: la comisión se mide con un cobro real, no con la FAQ');
  });

  it.skip('exp. 3 — MP reentregando el MISMO id: ¿reusa el ts firmado o refirma?', () => {
    expect.unreachable('B3: define si MAX_SIGNATURE_AGE_SECONDS puede bajar de 900');
  });

  it.skip('exp. 4 — ¿el external_reference sobrevive el checkout hosteado?', () => {
    expect.unreachable('B3: es el puente MP → tenant; si no sobrevive, cambia el diseño del alta');
  });
});
