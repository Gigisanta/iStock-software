import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El webhook de Mercado Pago, medido.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué se afirma acá, y por qué se afirma CONTANDO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-020: un gate afirma una **conducta medida**, nunca un identificador grepeado. "El handler es
 * idempotente" no se puede grepear; lo que se puede hacer es entregar el mismo evento dos veces y
 * **contar las escrituras**. Si el contador da 2, el test falla, y eso es lo único que separa esta
 * suite de un comentario optimista.
 *
 * El Postgres es de mentira (mismo patrón que `reserve-unit.test.ts`): un `tx` que graba
 * `insert`/`update` en una lista. No prueba que la SQL sea válida —para eso está el test de RLS
 * contra Postgres real, que es de `qa-agent`— prueba **cuántas veces se escribe y con qué valores**,
 * que es exactamente la pregunta de plata.
 *
 * El ledger es el de memoria, y eso hay que decirlo con todas las letras: **la idempotencia de
 * producción la garantiza un índice único en Postgres**, no este `Set`. Lo que este archivo mide
 * es que el handler *use* el ledger para envolver el efecto, y que un duplicado no llegue a
 * escribir. Que el índice exista es responsabilidad de la migración de `db-agent`
 * (`billing_webhook_events`, pedida al LEAD) y su ausencia hoy hace fallar el driver real con un
 * error con nombre propio, no lo hace degradar a "procesar sin deduplicar".
 */

vi.mock('server-only', () => ({}));

const logEvent = vi.fn();
const logError = vi.fn();
vi.mock('../../../(app)/_lib/log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: (event: string, code: string, fields: unknown) => {
    logError(event, code, fields);
  },
}));

const { handleWebhookNotification } = await import('./handle-notification');
const { createInMemoryBillingEventLedger } = await import('./ledger');
const { createMockMercadoPagoClient } = await import('../mercadopago/client');
const { encodeExternalReference } = await import('../mercadopago/external-reference');
const { signManifest, signatureManifest } = await import('../mercadopago/signature');
const { subscriptions, tenants } = await import('@istock/db');
const { TOPIC_AUTHORIZED_PAYMENT, TOPIC_PREAPPROVAL } = await import('../mercadopago/notification');

// ── Postgres de mentira ────────────────────────────────────────────────────────────────────────

interface Recorded {
  readonly op: 'insert' | 'update';
  readonly table: unknown;
  readonly row: Record<string, unknown>;
}

const db = {
  writes: [] as Recorded[],
  /** Error a tirar en la próxima escritura. Con esto se mide el rollback del ledger. */
  failNextWrite: null as unknown,
};

function record(op: 'insert' | 'update', table: unknown, row: Record<string, unknown>): unknown[] {
  if (db.failNextWrite !== null) {
    const error = db.failNextWrite;
    db.failNextWrite = null;
    throw error;
  }
  db.writes.push({ op, table, row });
  return [];
}

function thenable(produce: () => unknown): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    where: () => builder,
    onConflictDoUpdate: () => builder,
    returning: () => builder,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder;
}

const tx = {
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) => thenable(() => record('insert', table, row)),
  }),
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) => thenable(() => record('update', table, row)),
  }),
};

const rowsOf = (table: unknown): Recorded[] => db.writes.filter((w) => w.table === table);

// ── Datos ──────────────────────────────────────────────────────────────────────────────────────

const SECRET = 'un-secreto-de-webhook-largo-y-feo';
const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const PREAPPROVAL_ID = '2c9380848f0e2ff0018f1a2b3c4d5e6f';
const NOW = new Date('2026-08-28T14:00:00.000Z');

let client: ReturnType<typeof createMockMercadoPagoClient>;
let ledger: ReturnType<typeof createInMemoryBillingEventLedger>;

function deps() {
  return { secret: SECRET, client, ledger, now: () => NOW };
}

function givenPreapproval(overrides: Partial<Parameters<typeof client.seedPreapproval>[0]> = {}): void {
  client.seedPreapproval({
    id: PREAPPROVAL_ID,
    status: 'authorized',
    externalReference: encodeExternalReference({ tenantId: TENANT_ID, plan: 'negocio' }),
    preapprovalPlanId: 'plan-negocio',
    paymentMethodId: 'account_money',
    nextPaymentDate: '2026-09-28T14:00:00.000Z',
    ...overrides,
  });
}

interface DeliveryOptions {
  readonly eventId?: string;
  readonly dataId?: string;
  readonly requestId?: string;
  readonly topic?: string;
  readonly ts?: string;
  readonly secret?: string;
  readonly signature?: string | null;
  /** Cuerpo crudo, para los casos en que el JSON tiene que estar roto o mentir. */
  readonly body?: string;
}

/**
 * Una entrega firmada de verdad: el header se calcula con las mismas funciones que usa el handler
 * para verificarlo. Que la receta del manifiesto sea la correcta se prueba aparte, en
 * `signature.test.ts`, contra un HMAC calculado a mano — si se probara sólo acá, el test estaría
 * comprobando que la función coincide consigo misma.
 */
function delivery(options: DeliveryOptions = {}): Request {
  const eventId = options.eventId ?? 'notif-1';
  const dataId = options.dataId ?? PREAPPROVAL_ID;
  const requestId = options.requestId ?? 'req-1';
  const topic = options.topic ?? TOPIC_PREAPPROVAL;
  const ts = options.ts ?? String(Math.floor(NOW.getTime() / 1000));

  const body =
    options.body ??
    JSON.stringify({ id: eventId, type: topic, action: 'updated', data: { id: dataId }, live_mode: true });

  const signature =
    options.signature === undefined
      ? `ts=${ts},v1=${signManifest(signatureManifest({ dataId, requestId, ts }), options.secret ?? SECRET)}`
      : options.signature;

  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': requestId };
  if (signature !== null) headers['x-signature'] = signature;

  return new Request(
    `https://nortecel.maat.work/billing/webhooks/mercadopago?data.id=${encodeURIComponent(dataId)}&type=${topic}`,
    { method: 'POST', headers, body },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.writes = [];
  db.failNextWrite = null;
  client = createMockMercadoPagoClient();
  ledger = createInMemoryBillingEventLedger(tx as never);
  givenPreapproval();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  LA ACEPTACIÓN: el mismo webhook dos veces
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('idempotencia · el mismo evento entregado dos veces', () => {
  it('escribe UNA vez, aunque MP lo reentregue con otro x-request-id y otro ts', async () => {
    const primera = await handleWebhookNotification(delivery({ eventId: 'notif-42' }), deps());

    // La reentrega de MP no es un replay byte a byte: viene con otro `x-request-id` y por lo tanto
    // con otra firma. Si el handler deduplicara por la firma o por el request-id, este segundo
    // pasaría como nuevo. Deduplica por el `id` del evento, que es el que MP repite.
    const segunda = await handleWebhookNotification(
      delivery({ eventId: 'notif-42', requestId: 'req-2-reintento', ts: String(Math.floor(NOW.getTime() / 1000) + 30) }),
      deps(),
    );

    expect(primera).toEqual({ status: 200, outcome: 'applied' });
    expect(segunda).toEqual({ status: 200, outcome: 'duplicate' });

    // EL CONTEO. Es la aserción de este archivo; todo lo demás es contexto.
    expect(db.writes).toHaveLength(2); // un upsert de subscriptions + un update de tenants
    expect(rowsOf(subscriptions)).toHaveLength(1);
    expect(rowsOf(tenants)).toHaveLength(1);
    expect(ledger.applied).toHaveLength(1);
    expect(ledger.duplicates).toHaveLength(1);
  });

  /**
   * Control de polaridad. Sin esto, el test de arriba pasaría igual con un handler que **nunca**
   * escribe: dos entregas, cero efectos, "una sola vez" vacío. Acá se cambia lo único que debería
   * importar —el `id` del evento— y el contador tiene que subir. Si no sube, el que está roto es
   * el test, no el código.
   */
  it('control: dos eventos DISTINTOS sobre el mismo recurso escriben dos veces', async () => {
    await handleWebhookNotification(delivery({ eventId: 'notif-42' }), deps());
    const otro = await handleWebhookNotification(delivery({ eventId: 'notif-43' }), deps());

    expect(otro).toEqual({ status: 200, outcome: 'applied' });
    expect(rowsOf(subscriptions)).toHaveLength(2);
    expect(ledger.applied).toHaveLength(2);
  });

  it('si el efecto falla, el evento queda SIN reclamar y el reintento de MP lo aplica', async () => {
    db.failNextWrite = new Error('la base se cayó');

    const primera = await handleWebhookNotification(delivery({ eventId: 'notif-44' }), deps());
    expect(primera).toEqual({ status: 500, outcome: 'provider_error' });
    expect(db.writes).toHaveLength(0);

    // 500 le pide a MP que reintente. Si el ledger hubiera consumido el evento igual, este segundo
    // sería `duplicate` y el pago se habría perdido en silencio: es el modo de falla contrario al
    // cobro doble, más difícil de ver y más caro.
    const reintento = await handleWebhookNotification(delivery({ eventId: 'notif-44' }), deps());
    expect(reintento).toEqual({ status: 200, outcome: 'applied' });
    expect(rowsOf(subscriptions)).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  La puerta
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('firma · sin origen verificado no pasa nada', () => {
  it('firma inválida: 401, cero escrituras y NI SIQUIERA se le pregunta a MP', async () => {
    const result = await handleWebhookNotification(
      delivery({ secret: 'otro-secreto-igual-de-largo-pero-no' }),
      deps(),
    );

    expect(result).toEqual({ status: 401, outcome: 'unauthorized' });
    expect(db.writes).toHaveLength(0);
    // El orden importa: verificar DESPUÉS de trabajar es un endpoint abierto con una hoja de parra.
    expect(client.calls.preapproval).toBe(0);
  });

  it('sin header de firma: 401', async () => {
    const result = await handleWebhookNotification(delivery({ signature: null }), deps());
    expect(result).toEqual({ status: 401, outcome: 'unauthorized' });
    expect(db.writes).toHaveLength(0);
  });

  it('sin secreto configurado (B3 pendiente): 401, no hay a quién autorizar', async () => {
    const result = await handleWebhookNotification(delivery(), { ...deps(), secret: null });
    expect(result).toEqual({ status: 401, outcome: 'unauthorized' });
    expect(db.writes).toHaveLength(0);
  });

  it('firma vieja: 401 aunque el HMAC cierre', async () => {
    const viejo = String(Math.floor(NOW.getTime() / 1000) - 3600);
    const result = await handleWebhookNotification(delivery({ ts: viejo }), deps());
    expect(result).toEqual({ status: 401, outcome: 'unauthorized' });
  });
});

/**
 * El cuerpo NO entra en el HMAC de MP. Este bloque es la medición de esa consecuencia: con una
 * firma perfectamente válida, un cuerpo que dice `cancelled` no cancela nada, porque el estado se
 * lo pregunta a la API de MP con nuestro access token.
 */
describe('el cuerpo no manda sobre el estado', () => {
  it('un body que miente el estado no cambia lo que se escribe', async () => {
    const dataId = PREAPPROVAL_ID;
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const requestId = 'req-1';
    const mentira = JSON.stringify({
      id: 'notif-mentiroso',
      type: TOPIC_PREAPPROVAL,
      action: 'updated',
      data: { id: dataId },
      // Nada de esto se lee. Está acá para que el test falle si alguien decide "optimizar" el
      // handler leyendo el estado del cuerpo y ahorrándose el GET.
      status: 'cancelled',
      external_reference: encodeExternalReference({
        tenantId: '99999999-9999-4999-8999-999999999999',
        plan: 'base',
      }),
    });

    const result = await handleWebhookNotification(delivery({ body: mentira, dataId, ts, requestId }), deps());

    expect(result.outcome).toBe('applied');
    const row = rowsOf(subscriptions)[0]?.row;
    expect(row?.['status']).toBe('authorized');
    expect(row?.['tenantId']).toBe(TENANT_ID);
    expect(row?.['plan']).toBe('negocio');
  });

  it('cuerpo ilegible: 400 y cero escrituras', async () => {
    const result = await handleWebhookNotification(delivery({ body: 'no soy json' }), deps());
    expect(result).toEqual({ status: 400, outcome: 'bad_request' });
    expect(db.writes).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Lo que se escribe
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('preapproval autorizada', () => {
  it('activa el plan comprado en las DOS tablas, en la misma transacción', async () => {
    await handleWebhookNotification(delivery(), deps());

    const subscription = rowsOf(subscriptions)[0];
    expect(subscription?.op).toBe('insert');
    expect(subscription?.row).toMatchObject({
      tenantId: TENANT_ID,
      provider: 'mercadopago',
      plan: 'negocio',
      status: 'authorized',
      providerPreapprovalId: PREAPPROVAL_ID,
      paymentMethod: 'account_money',
      cancelledAt: null,
    });
    expect(subscription?.row['currentPeriodEnd']).toEqual(new Date('2026-09-28T14:00:00.000Z'));

    // El modelo de lectura. Sin esto el webhook anda perfecto y el cliente sigue sin chatbot.
    expect(rowsOf(tenants)[0]?.row).toMatchObject({ plan: 'negocio' });
    // `trial_ends_at` NO se toca: es el registro histórico de cuándo terminó la prueba.
    expect(rowsOf(tenants)[0]?.row).not.toHaveProperty('trialEndsAt');
  });

  it('cancelada: baja el plan a trial y NO suspende el tenant (la vidriera no se cae de golpe)', async () => {
    client = createMockMercadoPagoClient();
    givenPreapproval({ status: 'cancelled' });

    await handleWebhookNotification(delivery(), deps());

    expect(rowsOf(subscriptions)[0]?.row).toMatchObject({ status: 'cancelled', cancelledAt: NOW });
    const tenantRow = rowsOf(tenants)[0]?.row;
    expect(tenantRow).toMatchObject({ plan: 'trial' });
    // Pasar `tenants.status` a `suspended` apagaría la vidriera entera: la policy anónima exige
    // `status = 'active'`. La política de degradación es P1 de PRODUCT.md y está ABIERTA.
    expect(tenantRow).not.toHaveProperty('status');
  });

  it('acepta "canceled" con una sola L, que es como lo escribe preapproval', async () => {
    client = createMockMercadoPagoClient();
    givenPreapproval({ status: 'canceled' });

    await handleWebhookNotification(delivery(), deps());
    expect(rowsOf(subscriptions)[0]?.row).toMatchObject({ status: 'cancelled' });
  });

  it('pausada: registra el estado y NO toca el plan del tenant', async () => {
    client = createMockMercadoPagoClient();
    givenPreapproval({ status: 'paused' });

    await handleWebhookNotification(delivery(), deps());

    expect(rowsOf(subscriptions)[0]?.row).toMatchObject({ status: 'paused' });
    expect(rowsOf(tenants)).toHaveLength(0);
  });

  it('estado que no conocemos: 200 y CERO escrituras (no se le pide a MP que reintente)', async () => {
    client = createMockMercadoPagoClient();
    givenPreapproval({ status: 'waiting for gateway' });

    const result = await handleWebhookNotification(delivery(), deps());

    expect(result).toEqual({ status: 200, outcome: 'unknown_status' });
    expect(db.writes).toHaveLength(0);
  });

  it('external_reference ilegible: 200, cero escrituras y ningún tenant elegido al azar', async () => {
    client = createMockMercadoPagoClient();
    givenPreapproval({ externalReference: 'basura' });

    const result = await handleWebhookNotification(delivery(), deps());

    expect(result).toEqual({ status: 200, outcome: 'unknown_reference' });
    expect(db.writes).toHaveLength(0);
  });
});

describe('cuota (authorized_payment)', () => {
  beforeEach(() => {
    client.seedAuthorizedPayment({
      id: 'pay-1',
      preapprovalId: PREAPPROVAL_ID,
      status: 'processed',
      paymentMethodId: 'debin_transfer',
      amountArsCents: 3500000,
      nextPaymentDate: '2026-09-28T14:00:00.000Z',
    });
  });

  it('procesada: extiende el período y guarda el importe y el medio de pago', async () => {
    const result = await handleWebhookNotification(
      delivery({ topic: TOPIC_AUTHORIZED_PAYMENT, dataId: 'pay-1', eventId: 'notif-pago' }),
      deps(),
    );

    expect(result).toEqual({ status: 200, outcome: 'applied' });
    expect(rowsOf(subscriptions)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      status: 'authorized',
      amountArs: 3500000,
      paymentMethod: 'debin_transfer',
    });
    // La cuota no trae `external_reference`: hay que subir a la suscripción para saber de quién es.
    expect(client.calls.authorizedPayment).toBe(1);
    expect(client.calls.preapproval).toBe(1);
  });

  it('en reintento de cobro (recycling): queda payment_failed y el plan NO se baja', async () => {
    client.seedAuthorizedPayment({
      id: 'pay-2',
      preapprovalId: PREAPPROVAL_ID,
      status: 'recycling',
      paymentMethodId: 'credit_card',
      amountArsCents: 3500000,
      nextPaymentDate: null,
    });

    await handleWebhookNotification(
      delivery({ topic: TOPIC_AUTHORIZED_PAYMENT, dataId: 'pay-2', eventId: 'notif-recycle' }),
      deps(),
    );

    expect(rowsOf(subscriptions)[0]?.row).toMatchObject({ status: 'payment_failed' });
    // Cortarle el panel a alguien porque una tarjeta rebotó un martes es perder un cliente que
    // iba a pagar. MP recicla; si termina cancelando, llega por el topic de preapproval.
    expect(rowsOf(tenants)).toHaveLength(0);
  });
});

describe('lo que se ignora', () => {
  it('topic ajeno: 200, cero escrituras y cero llamadas a MP', async () => {
    const result = await handleWebhookNotification(
      delivery({ topic: 'payment', eventId: 'notif-otro' }),
      deps(),
    );

    expect(result).toEqual({ status: 200, outcome: 'ignored_topic' });
    expect(db.writes).toHaveLength(0);
    expect(client.calls.preapproval).toBe(0);
  });

  it('recurso que MP no conoce: 200 y cero escrituras', async () => {
    const result = await handleWebhookNotification(delivery({ dataId: 'no-existe' }), deps());
    expect(result).toEqual({ status: 200, outcome: 'unknown_resource' });
    expect(db.writes).toHaveLength(0);
  });
});

describe('errores del proveedor', () => {
  it('si MP no contesta: 500 para que reintente, y el evento queda sin reclamar', async () => {
    const roto = {
      ...client,
      getPreapproval: async () => {
        throw Object.assign(new Error('boom'), { name: 'MercadoPagoApiError' });
      },
    };

    const result = await handleWebhookNotification(delivery(), { ...deps(), client: roto as never });

    expect(result).toEqual({ status: 500, outcome: 'provider_error' });
    expect(db.writes).toHaveLength(0);
    expect(ledger.applied).toHaveLength(0);
  });

  it('el mensaje del error del proveedor NUNCA se loguea: sólo su nombre', async () => {
    const roto = {
      ...client,
      getPreapproval: async () => {
        // Un cuerpo de error de MP puede citar el mail del pagador. Si esto apareciera en el log,
        // quedaría en Vercel para siempre.
        throw Object.assign(new Error('payer juan@ejemplo.com rechazado'), { name: 'MercadoPagoApiError' });
      },
    };

    await handleWebhookNotification(delivery(), { ...deps(), client: roto as never });

    const logueado = JSON.stringify(logError.mock.calls);
    expect(logueado).not.toContain('juan@ejemplo.com');
    expect(logueado).toContain('MercadoPagoApiError');
  });
});
