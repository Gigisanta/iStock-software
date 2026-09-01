import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reservar y cancelar, con Postgres de mentira.
 *
 * Tres cosas y sólo tres, porque el resto ya tiene test en `packages/domain`:
 *
 * 1. **Quién decide.** La arista `available → reserved` la aprueba `checkTransition()` de
 *    `@istock/domain` con el entitlement y la reserva activa que le pasa este módulo. Si el
 *    entitlement está apagado no se escribe **nada**: ni el listing, ni la reserva, ni el evento.
 * 2. **La carrera la gana el motor, no un `if`.** Dos reservas simultáneas sobre la misma unidad:
 *    una escribe, la otra recibe un `23505` de `reservations_one_active_per_listing` y un mensaje
 *    propio. Una constraint **desconocida** se propaga: heredar el mensaje de la que conocemos es
 *    cómo se pierde un incidente (mismo criterio que `tenants/create-tenant.ts`).
 * 3. **La vidriera se entera.** `available → reserved` cambia el badge de la ficha y de la grilla
 *    (`storefront-agent` ya lo pinta en ámbar). Sin la invalidación, el equipo sigue diciendo
 *    "Disponible" en el CDN — que es exactamente la mentira de los estados de Instagram que el
 *    producto vino a matar.
 */

vi.mock('server-only', () => ({}));

const loadUnitForTransition = vi.fn();
vi.mock('../listings/queries', () => ({
  loadUnitForTransition: (...args: unknown[]) => loadUnitForTransition(...args) as unknown,
}));

const loadActiveReservation = vi.fn();
vi.mock('./queries', () => ({
  loadActiveReservation: (...args: unknown[]) => loadActiveReservation(...args) as unknown,
}));

const featureAccess = vi.fn();
vi.mock('../entitlements', () => ({
  FEATURE_RESERVATIONS: 'reservations',
  featureAccess: (...args: unknown[]) => featureAccess(...args) as unknown,
}));

const invalidateStorefrontUnit = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefront: vi.fn(),
  invalidateStorefrontUnit: (slug: string, listingId: string) => {
    invalidateStorefrontUnit(slug, listingId);
  },
  invalidateListing: vi.fn(),
}));

/**
 * El dominio **real**, con una sola función interceptable.
 *
 * `checkTransition` y `createReservation` siguen siendo los de verdad: mockear la máquina de
 * estados entera dejaría a este archivo probando su propio mock. Lo único que se envuelve es
 * `transitionEffects`, y sólo para poder hacer una pregunta que de otra forma no se puede hacer:
 * *si el dominio cambiara de opinión sobre esta arista, ¿el panel la sigue?* Con el status
 * hardcodeado la respuesta es no, y ninguna aserción contra el literal `'cancelled'` lo detecta.
 */
const transitionEffects = vi.fn();
vi.mock('@istock/domain', async (importOriginal) => {
  const domain = await importOriginal<typeof import('@istock/domain')>();
  return {
    ...domain,
    transitionEffects: (...args: Parameters<typeof domain.transitionEffects>) =>
      transitionEffects(...args) as ReturnType<typeof domain.transitionEffects>,
  };
});

const logEvent = vi.fn();
const logError = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: (event: string, code: string, fields: unknown) => {
    logError(event, code, fields);
  },
}));

interface Recorded {
  readonly op: 'insert' | 'update' | 'rpc';
  readonly table: unknown;
  readonly row: Record<string, unknown>;
}

const db = {
  writes: [] as Recorded[],
  /** Resultado del RPC optimista. 0 = otro dispositivo ganó. */
  rpcChanged: 1,
  /** Cantidad de llamadas a la puerta de estado. */
  rpcCalls: 0,
  /** Error a tirar en el `insert(reservations)`. Es donde muere el índice único parcial. */
  reservationInsertError: null as unknown,
  /** Error a tirar en el RPC. Es la primera operación que toma el lock del listing. */
  rpcError: null as unknown,
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    where: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) =>
      thenable(() => {
        db.writes.push({ op: 'update', table, row });
        return [{ id: LISTING_ID }];
      }),
  }),
  execute: async (query: unknown) => {
    db.rpcCalls += 1;
    if (db.rpcError !== null) throw db.rpcError;
    if (db.rpcChanged === 0) return [{ changed: 0 }];
    const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks;
    const nextStatus = chunks?.[7];
    db.writes.push({
      op: 'rpc',
      table: listings,
      row: { status: typeof nextStatus === 'string' ? nextStatus : 'transitioned' },
    });
    return [{ changed: 1 }];
  },
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        if (table === reservations && db.reservationInsertError !== null) {
          throw db.reservationInsertError;
        }
        db.writes.push({ op: 'insert', table, row });
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
  withServiceDb: (fn: (t: unknown) => unknown) => fn(tx),
}));

const { cancelReservation, reserveUnit } = await import('./reserve-unit');
const { listingEvents, listings, reservations } = await import('@istock/db');
/** La tabla de efectos sin envolver: es el oráculo, no una copia de la regla. */
const { transitionEffects: realTransitionEffects } =
  await vi.importActual<typeof import('@istock/domain')>('@istock/domain');

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';
const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-08-28T14:00:00.000Z');

const actor = {
  ctx: { userId: 'user-1', tenantId: TENANT_ID, role: 'owner' as const },
  // `trialEndsAt` viaja en el actor desde D2: la vigencia del trial se resuelve en
  // `featureAccess()`, así que el objeto que arma `panelActor()` la tiene que traer.
  tenant: { slug: 'nortecel', plan: 'negocio' as const, trialEndsAt: null },
};

function givenUnit(status: string): void {
  loadUnitForTransition.mockResolvedValue({
    id: LISTING_ID,
    slug: 'iphone-14-pro-256',
    status,
    kind: 'unit',
    condition: 'used_excellent',
    priceUsdCents: 620_00,
    qty: 1,
    catalogModelId: '4f1a0d2e-6b5c-4a3d-9e8f-0a1b2c3d4e5f',
    photoCount: 3,
  });
}

/**
 * ── Los errores se envuelven porque así llegan al `catch`, y eso se midió ─────────────────────
 *
 * Estas dos fábricas devolvían el error PLANO hasta el 2026-08-28, y por eso los cuatro casos de
 * carrera de este archivo estaban verdes por el motivo equivocado: `reserveUnit` y `cancelUnit`
 * corren por Drizzle, y **Drizzle 0.45.2 envuelve** lo que tira `postgres-js` en un
 * `DrizzleQueryError`, dejando el `PostgresError` en `.cause`. Con el error plano, este archivo
 * afirmaba "Ya tiene una reserva activa" y `LOST_RACE` sobre una forma que producción no produce:
 * en el mostrador salía un 500.
 *
 * El envoltorio es la clase real de Drizzle, no una imitación. La forma plana la cubre
 * `_lib/db/pg-error.test.ts` contra Postgres real, que es el único lugar donde se la puede afirmar
 * sin inventar un error.
 */
function envuelto(pg: Error): Error {
  return new DrizzleQueryError('insert into "reservations" ...', [], pg);
}

/** El `40P01` que tira Postgres cuando elige a esta transacción como víctima de un deadlock. */
function deadlock(): Error {
  return envuelto(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
}

function uniqueViolation(constraint: string): Error {
  return envuelto(
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: constraint,
    }),
  );
}

const rowsOf = (table: unknown): Recorded[] => db.writes.filter((w) => w.table === table);

const INPUT = { listingId: LISTING_ID, minutes: 90, customerLabel: 'Juan de Cipolletti' };

beforeEach(() => {
  vi.clearAllMocks();
  db.writes = [];
  db.rpcChanged = 1;
  db.rpcCalls = 0;
  db.reservationInsertError = null;
  db.rpcError = null;
  featureAccess.mockResolvedValue({ ok: true });
  loadActiveReservation.mockResolvedValue(null);
  transitionEffects.mockImplementation(realTransitionEffects);
  givenUnit('available');
});

describe('reserveUnit · el camino feliz', () => {
  it('mueve el listing a reserved y escribe la reserva con el tenant y el vencimiento', async () => {
    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reservation = rowsOf(reservations)[0];
    expect(reservation?.op).toBe('insert');
    expect(reservation?.row['tenantId']).toBe(TENANT_ID);
    expect(reservation?.row['listingId']).toBe(LISTING_ID);
    expect(reservation?.row['minutes']).toBe(90);
    expect(reservation?.row['customerLabel']).toBe('Juan de Cipolletti');
    // 90 minutos después de `now`. El vencimiento lo calcula `createReservation` del dominio.
    expect((reservation?.row['expiresAt'] as Date).toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(result.expiresAt.toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(reservation?.row['id']).toBe(result.reservationId);

    expect(db.rpcCalls).toBe(1);
    expect(rowsOf(listingEvents)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      fromStatus: 'available',
      toStatus: 'reserved',
      kind: 'status_change',
    });
  });

  it('invalida la vidriera de ESE tenant, con el id de la unidad', async () => {
    await reserveUnit(actor, INPUT, NOW);
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('nortecel', LISTING_ID);
  });

  it('no loguea la etiqueta del cliente: se loguean ids, nunca texto de una persona', async () => {
    await reserveUnit(actor, INPUT, NOW);
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('Juan de Cipolletti');
  });
});

describe('reserveUnit · las puertas', () => {
  it('sin entitlement no escribe NADA y lo dice en castellano', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'plan' });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Eso viene con el plan Negocio.' });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * D2. **La acción rebota**, no sólo el botón: `/app/stock` deja de dibujar el formulario cuando el
   * trial venció, pero una tab abierta desde antes lo sigue teniendo, y un `POST` a mano no mira
   * ningún CSS. Y el texto no es el del plan: a alguien que estaba en el plan que **sí** incluye
   * reservas, "eso viene con el plan Negocio" le explica cualquier cosa menos lo que pasó.
   */
  it('con el trial vencido rebota en la acción y explica que se terminó la prueba', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.',
    });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * El tercer motivo, por la otra puerta. `reserveUnit()` y `transitionUnit()` renderizan el mismo
   * `denyReasonText()`, así que esto no repite el mapeo: fija que **este** camino le pasa el
   * `access` y no se queda con el default del plan. Si alguien sacara el segundo argumento del
   * `denyReasonText(check.reason, access)` de arriba, el caso volvería a decir "Eso viene con el
   * plan Negocio" a alguien que lo tiene, y sólo un test de este archivo lo ve.
   */
  it('con la feature apagada a mano rebota y el mensaje no habla del plan', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'flag_off' });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Las reservas están apagadas en tu cuenta. No es el plan: escribinos y te las prendemos.',
    });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('con una reserva activa ya existente rebota antes de tocar la base', async () => {
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT_ID,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Ya tiene una reserva activa.' });
    expect(db.writes).toHaveLength(0);
  });

  it('una unidad que no está disponible no se reserva', async () => {
    givenUnit('draft');
    const result = await reserveUnit(actor, INPUT, NOW);
    expect(result.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it('una unidad de otro tenant (o inexistente) no se distingue: no existe', async () => {
    loadUnitForTransition.mockResolvedValue(null);
    const result = await reserveUnit(actor, INPUT, NOW);
    expect(result).toEqual({ ok: false, message: 'No encontramos ese equipo.' });
  });
});

describe('reserveUnit · la carrera la corta el motor', () => {
  it('el índice único parcial gana: la segunda reserva recibe su propio mensaje', async () => {
    db.reservationInsertError = uniqueViolation('reservations_one_active_per_listing');

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Ya tiene una reserva activa.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * Se afirma **identidad** y no el texto: con el error envuelto, el `message` de arriba es el
   * `Failed query: …` de Drizzle y el `duplicate key` vive en el `.cause`. "Se propaga" es el mismo
   * objeto subiendo sin traducir, que es `toBe`, no un substring que depende de quién quedó arriba.
   */
  it('una constraint DESCONOCIDA se propaga: no hereda el mensaje de la que sí conocemos', async () => {
    const error = uniqueViolation('reservations_alguna_constraint_nueva');
    db.reservationInsertError = error;

    await expect(reserveUnit(actor, INPUT, NOW)).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith(
      'reservation.create.unknown_unique_violation',
      '23505',
      expect.objectContaining({ constraint: 'reservations_alguna_constraint_nueva' }),
    );
  });

  it('si otro dispositivo movió el listing primero, no nace ninguna reserva', async () => {
    db.rpcChanged = 0;

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result.ok).toBe(false);
    expect(rowsOf(reservations)).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * D1. Un `40P01` es una carrera perdida, no un 500: para quien está parado en el mostrador es
   * indistinguible de que otro dispositivo le haya ganado de mano, y se resuelve igual (recargando).
   * Sin esto, el `throw` sube hasta la Server Action —que no tiene `catch`— y el dueño termina en el
   * error boundary del panel porque el cron le tocó la misma fila.
   */
  it('un deadlock se cuenta como carrera perdida, no como 500', async () => {
    db.rpcError = deadlock();

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(logError).toHaveBeenCalledWith('reservation.create.deadlock', '40P01', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });
});

describe('cancelReservation', () => {
  beforeEach(() => {
    givenUnit('reserved');
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT_ID,
      // Todavía NO venció: cancelar a mano tiene que poder igual (intent = 'cancel').
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });
  });

  it('devuelve la unidad a available, cierra la reserva y avisa a la vidriera', async () => {
    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result.ok).toBe(true);
    expect(db.rpcCalls).toBe(1);
    expect(rowsOf(reservations)[0]?.op).toBe('update');
    // El oráculo es el dominio, no el string: ver el bloque de más abajo.
    expect(rowsOf(reservations)[0]?.row['status']).toBe(
      realTransitionEffects('reserved', 'available', 'cancel').closesReservationAs,
    );
    expect(rowsOf(listingEvents)[0]?.row).toMatchObject({
      fromStatus: 'reserved',
      toStatus: 'available',
    });
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('nortecel', LISTING_ID);
  });

  it('una reserva de otro tenant no se cancela desde acá', async () => {
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: 'otro-tenant',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({ ok: false, message: 'Esa reserva no es de este negocio.' });
    expect(db.writes).toHaveLength(0);
  });

  it('si el listing ya no está reservado, no se inventa un evento', async () => {
    db.rpcChanged = 0;
    const result = await cancelReservation(actor, LISTING_ID, NOW);
    expect(result.ok).toBe(false);
    expect(rowsOf(listingEvents)).toHaveLength(0);
  });

  /** El mismo trato que en `reserveUnit`: esta era la función que no tenía `catch` (D1). */
  it('un deadlock contra el cron se cuenta como carrera perdida', async () => {
    db.rpcError = deadlock();

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(logError).toHaveBeenCalledWith('reservation.cancel.deadlock', '40P01', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
  });

  /**
   * Cancelar **no** pide entitlement: si el downgrade dejara las reservas trabadas, el plan Base
   * sería una trampa con stock adentro. Se prueba con el trial vencido porque es el caso que D2
   * volvió alcanzable de verdad: hasta S6 nada bajaba nunca el plan.
   */
  it('con el trial vencido igual se puede soltar la propia unidad', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({ ok: true });
    expect(db.rpcCalls).toBe(1);
  });
});

/**
 * S6.1, la mitad que faltaba. El cron ya derivaba el estado de cierre de
 * `transitionEffects(from, to, 'expire').closesReservationAs`; el panel seguía escribiendo
 * `'cancelled'` a mano sobre la MISMA arista `reserved → available`. Con una sola punta consumiendo
 * la tabla, la tabla es decorativa en la otra mitad del producto.
 *
 * Ninguno de estos casos compara contra un literal: un test que dice `toBe('cancelled')` pasa
 * idéntico con el hardcodeo, o sea que no mide lo único que hay que medir.
 */
describe('cancelReservation · el estado de cierre lo decide el dominio', () => {
  beforeEach(() => {
    givenUnit('reserved');
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT_ID,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });
  });

  it('le pregunta por la arista que chequeó, con la intención declarada', async () => {
    await cancelReservation(actor, LISTING_ID, NOW);
    expect(transitionEffects).toHaveBeenCalledWith('reserved', 'available', 'cancel');
  });

  /**
   * La pregunta que el literal no puede contestar: si la tabla del dominio cambiara de opinión
   * sobre esta arista, ¿el panel la sigue? Se simula haciéndola devolver otro estado de cierre
   * válido. Con `'cancelled'` escrito en el `.set()`, esto falla.
   */
  it('escribe el estado que devuelve el dominio, aunque no sea el de hoy', async () => {
    transitionEffects.mockImplementation((from: string, to: string, intent: string | null) => ({
      ...(realTransitionEffects as unknown as (f: string, t: string, i: string | null) => object)(
        from,
        to,
        intent,
      ),
      closesReservationAs: 'confirmed',
    }));

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({ ok: true });
    expect(rowsOf(reservations)[0]?.row['status']).toBe('confirmed');
  });

  /**
   * `closesReservationAs: null` es alcanzable de verdad y sin mock: una tab vieja aprieta "Soltar"
   * sobre una unidad que mientras tanto se fue a service. El dominio dice que esa arista no cierra
   * ninguna reserva, así que no hay default que inventar — y sobre todo no se escribe un
   * `listing_events` que afirme `fromStatus: 'reserved'` sobre algo que no lo está.
   */
  it('si la arista no cierra ninguna reserva, no escribe nada y lo deja logueado', async () => {
    givenUnit('in_service');

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      'reservation.cancel.no_closing_status',
      'domain_no_closing_status',
      { tenantId: TENANT_ID, listingId: LISTING_ID, fromStatus: 'in_service' },
    );
  });
});
